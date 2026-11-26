// 作業実績 Web 版。iPhone・iPad アプリが Google ドライブに作ったスプレッドシートを読み、PDF の出力と記録の修正を行う。
import {
  WEEKDAYS_JA, addMonths, cell, dayKey, frequentSummaries, minutes, monthDays, monthFromTab, monthKey, pad2,
  parseHeader, parseInvoice, parseReport, rowOf, rowRange, rowValues, timeText, weekdayIndex, workedMinutes,
} from './layout.js';
import { buildInvoice, buildReport, renderInvoice, renderReport } from './pdf.js';

const CLIENT_ID = '858656674872-2167l0bd0s1j3b12o1hrpm30btnvljhg.apps.googleusercontent.com';
// このアプリが作成したファイルだけを読み書きする権限
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'workReportToken';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const BREAK_CHOICES = [0, 15, 30, 45, 60, 90, 120];

const $ = (id) => document.getElementById(id);
const today = (() => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
})();

const state = {
  token: null,
  reportId: null,
  /** タブ名 → grid（A1 から、表示どおりの文字列） */
  report: new Map(),
  invoice: new Map(),
  ym: { year: today.year, month: today.month },
  editingDay: null,
  previewUrl: null,
  previewRun: 0,
};

// ---- 表示の部品 ----

function setStatus(message, isError = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', isError);
}

function showWorkspace(isSignedIn) {
  $('welcome').hidden = isSignedIn;
  $('workspace').hidden = !isSignedIn;
  $('signout').hidden = !isSignedIn;
  $('reload').hidden = !isSignedIn;
}

// ---- Google ログイン ----

function savedToken() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null');
    return saved && saved.expiry > Date.now() + 60_000 ? saved.token : null;
  } catch {
    return null;
  }
}

function signOut(message = '') {
  sessionStorage.removeItem(TOKEN_KEY);
  state.token = null;
  state.report.clear();
  state.invoice.clear();
  showWorkspace(false);
  setStatus(message, Boolean(message));
}

function signIn() {
  if (!window.google?.accounts?.oauth2) {
    setStatus('Google のログイン画面を読み込めませんでした。ページを読み込み直してください。', true);
    return;
  }
  const client = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (response) => {
      if (response.error || !response.access_token) {
        setStatus('ログインできませんでした。', true);
        return;
      }
      state.token = response.access_token;
      const expiry = Date.now() + Number(response.expires_in ?? 3600) * 1000;
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: state.token, expiry }));
      load();
    },
    error_callback: () => setStatus('ログインを取り消しました。', true),
  });
  client.requestAccessToken();
}

// ---- Google との通信 ----

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (response.status === 401) {
    signOut('ログインの有効期限が切れました。もう一度ログインしてください。');
    throw new Error('signed out');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? `通信に失敗しました（${response.status}）`);
  return body;
}

/** タブの一覧と全タブの中身を 1 回で読む */
async function readAll(spreadsheetId) {
  const fields = 'sheets(properties(title),data(rowData(values(formattedValue))))';
  const body = await api(`${SHEETS}/${spreadsheetId}?fields=${encodeURIComponent(fields)}`);
  const result = new Map();
  for (const sheet of body.sheets ?? []) {
    const rows = sheet.data?.[0]?.rowData ?? [];
    result.set(sheet.properties.title, rows.map((row) => (row.values ?? []).map((value) => value.formattedValue ?? '')));
  }
  return result;
}

async function load() {
  showWorkspace(true);
  setStatus('スプレッドシートを読み込んでいます…');
  try {
    // 権限の範囲から、一覧に出るのはアプリ「作業実績」が作成したファイルだけ
    const query = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
    const list = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=createdTime&fields=${encodeURIComponent('files(id,appProperties)')}&pageSize=50`);
    const files = list.files ?? [];
    const reportFile = files.find((file) => file.appProperties?.kind !== 'invoice');
    const invoiceFile = files.find((file) => file.appProperties?.kind === 'invoice');
    if (!reportFile) {
      showWorkspace(false);
      $('signout').hidden = false;
      setStatus('このアカウントには、アプリ「作業実績」のスプレッドシートが見つかりません。アプリの「設定」で Google スプレッドシートと連携してから、同じアカウントでログインしてください。', true);
      return;
    }
    state.reportId = reportFile.id;
    const [report, invoice] = await Promise.all([readAll(reportFile.id), invoiceFile ? readAll(invoiceFile.id) : new Map()]);
    state.report = report;
    state.invoice = invoice;
    setStatus('');
    render();
  } catch (error) {
    if (error.message !== 'signed out') setStatus(error.message, true);
  }
}

// ---- 月の表示 ----

function currentGrid() {
  return state.report.get(monthKey(state.ym)) ?? null;
}

/** 見出しは、いちばん新しい月のタブのものを使う（アプリと同じ） */
function header() {
  const newest = [...state.report.keys()].filter(monthFromTab).sort().at(-1);
  return newest ? parseHeader(state.report.get(newest), monthFromTab(newest)) : { title: '作業実績報告書', projectName: '', signature: '', notes: [], weekdays: WEEKDAYS_JA };
}

function entriesOf(ym) {
  const grid = state.report.get(monthKey(ym));
  return grid ? parseReport(grid, ym) : new Map();
}

function render() {
  const { ym } = state;
  const grid = currentGrid();
  const entries = entriesOf(ym);
  let total = 0;
  for (const entry of entries.values()) total += workedMinutes(entry);
  $('month-label').textContent = `${ym.year}年${ym.month}月`;
  $('month-total').textContent = `合計 ${timeText(total)}・稼働 ${entries.size}日`;
  $('month-note').hidden = Boolean(grid);
  $('month-note').textContent = grid ? '' : 'この月のシートはまだありません。アプリでこの月の記録を付けると作られます。';

  const body = $('days').tBodies[0];
  body.replaceChildren();
  for (const d of monthDays(ym)) {
    const entry = entries.get(dayKey(d));
    const weekday = weekdayIndex(d);
    const tr = document.createElement('tr');
    if (weekday === 0) tr.classList.add('sunday');
    if (weekday === 6) tr.classList.add('saturday');
    if (dayKey(d) === dayKey(today)) tr.classList.add('today');
    if (!entry) tr.classList.add('off');

    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = `${d.day}日(${WEEKDAYS_JA[weekday]})`;
    tr.append(th);
    const cells = entry
      ? [[timeText(entry.start), 'number'], [timeText(entry.end), 'number'], [timeText(entry.breakMinutes), 'number'],
         [timeText(workedMinutes(entry)), 'number'], ['○', 'status'], [entry.summary, 'summary']]
      : [['', 'number'], ['', 'number'], ['', 'number'], ['0:00', 'number'], ['×', 'status'], ['', 'summary']];
    for (const [text, className] of cells) {
      const td = document.createElement('td');
      td.className = className;
      td.textContent = text;
      tr.append(td);
    }
    const action = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '編集';
    button.setAttribute('aria-label', `${d.month}月${d.day}日を編集`);
    button.disabled = !grid;
    button.addEventListener('click', () => openEditor(d));
    action.append(button);
    tr.append(action);
    body.append(tr);
  }
  updatePreview();
}

// ---- PDF ----

function reportDocument() {
  return buildReport({
    ym: state.ym,
    entries: entriesOf(state.ym),
    header: header(),
    range: $('range').value,
    includeNotes: $('include-notes').checked,
    issuerName: invoiceRecord()?.issuerName ?? '',
  });
}

function invoiceRecord() {
  const grid = state.invoice.get(monthKey(state.ym));
  return grid ? parseInvoice(grid, state.ym) : null;
}

function invoiceDocument() {
  const record = invoiceRecord();
  if (!record) return null;
  let worked = 0;
  for (const entry of entriesOf(state.ym).values()) worked += workedMinutes(entry);
  return buildInvoice({ ym: state.ym, record, workedMinutes: worked });
}

async function updatePreview() {
  const run = ++state.previewRun;
  const invoice = invoiceDocument();
  $('download-invoice').disabled = !invoice;
  $('kind-invoice').disabled = !invoice;
  if (!invoice && $('kind-invoice').checked) $('kind-report').checked = true;
  $('download-both').textContent = invoice ? 'PDF を 2 つダウンロード' : '報告書の PDF をダウンロード';
  $('invoice-note').hidden = Boolean(invoice);
  $('invoice-note').textContent = invoice ? '' : `${state.ym.year}年${state.ym.month}月の請求書はまだありません。アプリで請求書を使う設定にして、この月の出力画面を開くと作られます。`;
  try {
    const bytes = $('kind-invoice').checked && invoice ? await renderInvoice(invoice) : await renderReport(reportDocument());
    if (run !== state.previewRun) return;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    $('preview').src = `${state.previewUrl}#toolbar=0&view=FitH`;
  } catch (error) {
    setStatus(`PDF を作れませんでした。（${error.message}）`, true);
  }
}

function save(bytes, fileName) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function download(kinds) {
  try {
    if (kinds.includes('report')) {
      const report = reportDocument();
      save(await renderReport(report), report.fileName);
    }
    const invoice = invoiceDocument();
    if (kinds.includes('invoice') && invoice) save(await renderInvoice(invoice), invoice.fileName);
  } catch (error) {
    setStatus(`PDF を作れませんでした。（${error.message}）`, true);
  }
}

// ---- 記録の修正 ----

const timeValue = (total) => `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;

function formEntry() {
  if (!$('edit-working').checked) return null;
  const start = minutes($('edit-start').value);
  const end = minutes($('edit-end').value);
  if (start === null || end === null) return null;
  return { start, end, breakMinutes: Number($('edit-break').value), summary: $('edit-summary').value.trim() };
}

function refreshEditor() {
  const working = $('edit-working').checked;
  for (const id of ['edit-start', 'edit-end', 'edit-break', 'edit-summary']) $(id).disabled = !working;
  const entry = formEntry();
  $('edit-total').textContent = entry ? `合計 ${timeText(workedMinutes(entry))}` : working ? '' : 'この日は「稼働なし」として保存します。';
}

function openEditor(d) {
  state.editingDay = d;
  const entries = entriesOf(state.ym);
  const existing = entries.get(dayKey(d));
  // 新しく付ける日は、同じ曜日の直近の内容を初期値にする（無ければ直近の稼働日）
  const earlier = [...entries.entries()].filter(([key]) => key < dayKey(d)).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const sameWeekday = earlier.find(([key]) => {
    const [year, month, day] = key.split('-').map(Number);
    return weekdayIndex({ year, month, day }) === weekdayIndex(d);
  });
  const initial = existing ?? sameWeekday?.[1] ?? earlier[0]?.[1] ?? { start: 9 * 60, end: 18 * 60, breakMinutes: 60, summary: '' };

  $('edit-title').textContent = `${d.month}月${d.day}日(${WEEKDAYS_JA[weekdayIndex(d)]})`;
  $('edit-working').checked = true;
  $('edit-start').value = timeValue(initial.start);
  $('edit-end').value = timeValue(initial.end);
  const breaks = BREAK_CHOICES.includes(initial.breakMinutes) ? BREAK_CHOICES : [...BREAK_CHOICES, initial.breakMinutes].sort((a, b) => a - b);
  $('edit-break').replaceChildren(...breaks.map((value) => new Option(timeText(value), String(value))));
  $('edit-break').value = String(initial.breakMinutes);
  $('edit-summary').value = initial.summary;
  const all = [...state.report.entries()].flatMap(([name, grid]) => {
    const ym = monthFromTab(name);
    return ym ? [...parseReport(grid, ym).values()] : [];
  });
  $('summaries').replaceChildren(...frequentSummaries(all).map((summary) => new Option(summary)));
  refreshEditor();
  $('edit').returnValue = '';
  $('edit').showModal();
}

async function saveEdit() {
  const d = state.editingDay;
  const row = rowOf(d);
  const grid = currentGrid();
  if (!d || !row || !grid) return;
  const entry = formEntry();
  setStatus('保存しています…');
  try {
    // 画面で入力したのと同じ扱いで書く（時刻は時刻、合計は数式）
    await api(`${SHEETS}/${state.reportId}/values/${encodeURIComponent(rowRange(d, row))}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      body: JSON.stringify({ values: [rowValues(entry, row)] }),
    });
    // 読み込み済みの内容にも反映する
    while (grid.length < row) grid.push([]);
    const cells = grid[row - 1];
    while (cells.length < 8) cells.push('');
    const shown = entry
      ? [timeText(entry.start), timeText(entry.end), timeText(entry.breakMinutes), timeText(workedMinutes(entry)), '○', entry.summary]
      : ['', '', '', '0:00', '×', ''];
    shown.forEach((value, index) => { cells[2 + index] = value; });
    setStatus('保存しました。');
    render();
  } catch (error) {
    if (error.message !== 'signed out') setStatus(`保存できませんでした。（${error.message}）`, true);
  }
}

// ---- 操作 ----

$('signin').addEventListener('click', signIn);
$('signout').addEventListener('click', () => signOut());
$('reload').addEventListener('click', load);
$('prev-month').addEventListener('click', () => { state.ym = addMonths(state.ym, -1); render(); });
$('next-month').addEventListener('click', () => { state.ym = addMonths(state.ym, 1); render(); });
$('options').addEventListener('change', updatePreview);
$('options').addEventListener('submit', (event) => event.preventDefault());
$('download-both').addEventListener('click', () => download(['report', 'invoice']));
$('download-report').addEventListener('click', () => download(['report']));
$('download-invoice').addEventListener('click', () => download(['invoice']));

$('edit-form').addEventListener('input', refreshEditor);
$('edit-form').addEventListener('keydown', (event) => {
  // 日本語入力の変換を確定する Enter で、保存されてしまわないようにする
  if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
});
$('edit').addEventListener('close', () => {
  const action = $('edit').returnValue;
  $('edit').returnValue = '';
  if (action === 'save') saveEdit();
});

state.token = savedToken();
if (state.token) {
  load();
} else {
  showWorkspace(false);
}
