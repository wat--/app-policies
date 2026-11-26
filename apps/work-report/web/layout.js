// スプレッドシート上の配置と、記録の計算。iPhone・iPad アプリと同じ決まりで読み書きする。
// 月ごとに 1 タブ（名前は "yyyyMM"）。作業実績は 8 行目から日曜始まりで 37 日分、請求書は A1:G33。

export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
export const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const FIRST_ROW = 8;
export const SHEET_ROW_COUNT = 37;
export const LAST_ROW = FIRST_ROW + SHEET_ROW_COUNT - 1;
export const NOTES_FIRST_ROW = LAST_ROW + 3;
export const NOTES_ROW_COUNT = 24;
const PROJECT_PREFIX = 'プロジェクト名：';

// ---- 日付 ----

export const pad2 = (n) => String(n).padStart(2, '0');
export const monthKey = (ym) => `${ym.year}${pad2(ym.month)}`;
export const dayKey = (d) => `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;

export function monthFromTab(name) {
  if (!/^\d{6}$/.test(name)) return null;
  const month = Number(name.slice(4));
  return month >= 1 && month <= 12 ? { year: Number(name.slice(0, 4)), month } : null;
}

export function addMonths(ym, delta) {
  const total = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function daysInMonth(ym) {
  return new Date(ym.year, ym.month, 0).getDate();
}

export function weekdayIndex(d) {
  return new Date(d.year, d.month - 1, d.day).getDay();
}

export function addDays(d, delta) {
  const date = new Date(d.year, d.month - 1, d.day + delta);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

export function monthDays(ym) {
  return Array.from({ length: daysInMonth(ym) }, (_, i) => ({ year: ym.year, month: ym.month, day: i + 1 }));
}

/** タブの行に並ぶ日付（1 日を含む週の日曜から 37 日） */
export function sheetDays(ym) {
  const first = { year: ym.year, month: ym.month, day: 1 };
  const start = addDays(first, -weekdayIndex(first));
  return Array.from({ length: SHEET_ROW_COUNT }, (_, i) => addDays(start, i));
}

export function rowOf(d) {
  const index = sheetDays({ year: d.year, month: d.month }).findIndex((x) => dayKey(x) === dayKey(d));
  return index < 0 ? null : FIRST_ROW + index;
}

// ---- 時刻 ----

/** "16:00" / "16:00:00" → 分 */
export function minutes(text) {
  const parts = String(text ?? '').trim().split(':').map((p) => Number.parseInt(p, 10));
  if (parts.length < 2 || !Number.isInteger(parts[0]) || !Number.isInteger(parts[1])) return null;
  if (parts[0] < 0 || parts[1] < 0 || parts[1] >= 60) return null;
  return parts[0] * 60 + parts[1];
}

/** 分 → "H:mm"（時は 0 埋めしない） */
export function timeText(total) {
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

/** 終了が開始以前なら日をまたいだものとして数える（17:00〜0:00 = 7:00） */
export function workedMinutes(entry) {
  let span = entry.end - entry.start;
  if (span <= 0) span += 24 * 60;
  return Math.max(0, span - entry.breakMinutes);
}

// ---- 読み取り ----

/** grid（A1 から、表示どおりの文字列）のセル。row は 1 始まり、column は A = 0 */
export function cell(grid, row, column) {
  return grid?.[row - 1]?.[column] ?? '';
}

/** 作業実績のタブから、当月分の記録を取り出す。稼働が ○ で時刻が読める行だけを記録とみなす */
export function parseReport(grid, ym) {
  const entries = new Map();
  sheetDays(ym).forEach((d, index) => {
    if (d.year !== ym.year || d.month !== ym.month) return;
    const row = FIRST_ROW + index;
    const start = minutes(cell(grid, row, 2));
    const end = minutes(cell(grid, row, 3));
    if (cell(grid, row, 6).trim() !== '○' || start === null || end === null) return;
    entries.set(dayKey(d), {
      start,
      end: end % (24 * 60),
      breakMinutes: minutes(cell(grid, row, 4)) ?? 0,
      summary: cell(grid, row, 7),
    });
  });
  return entries;
}

/** 見出し（タイトル・プロジェクト名・会社名と氏名・注意書き）と、曜日の表記 */
export function parseHeader(grid, ym) {
  let project = cell(grid, 4, 1).trim();
  for (const prefix of [PROJECT_PREFIX, 'プロジェクト名:']) {
    if (project.startsWith(prefix)) project = project.slice(prefix.length);
  }
  const notes = [];
  for (let i = 0; i < NOTES_ROW_COUNT; i++) notes.push(cell(grid, NOTES_FIRST_ROW + i, 1));
  while (notes.length && notes[notes.length - 1].trim() === '') notes.pop();
  // 日付のセル（「11月2日(月)」/「11月2日(Mon)」）から曜日の表記を判断する
  const firstRow = rowOf({ year: ym.year, month: ym.month, day: 1 });
  const english = /\([A-Za-z]+\)/.test(cell(grid, firstRow, 1));
  return {
    title: cell(grid, 1, 1).trim() || '作業実績報告書',
    projectName: project,
    signature: cell(grid, 5, 1).trim(),
    notes,
    weekdays: english ? WEEKDAYS_EN : WEEKDAYS_JA,
  };
}

/** "2026年10月31日" / "2026/10/31" / "2026-10-31" */
export function parseDay(text) {
  const parts = String(text ?? '').split(/\D+/).filter(Boolean).map(Number);
  if (parts.length !== 3 || parts[0] < 1900 || parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31) return null;
  return { year: parts[0], month: parts[1], day: parts[2] };
}

/** "4,500" / "¥4,500" / "1.5" */
export function parseNumber(text) {
  const cleaned = String(text ?? '').replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const a1 = (name) => ({ row: Number(name.slice(1)), column: name.charCodeAt(0) - 65 });

/** 請求書のタブから、その月の請求書の内容を取り出す */
export function parseInvoice(grid, ym) {
  const at = (name) => {
    const { row, column } = a1(name);
    return cell(grid, row, column).trim();
  };
  const extraItems = [];
  for (let row = 18; row <= 22; row++) {
    const item = {
      name: at(`A${row}`),
      unitPrice: Math.trunc(parseNumber(at(`D${row}`)) ?? 0),
      quantity: Math.round((parseNumber(at(`E${row}`)) ?? 0) * 100) / 100,
    };
    if (item.name || item.unitPrice || item.quantity) extraItems.push(item);
  }
  const lastDay = { year: ym.year, month: ym.month, day: daysInMonth(ym) };
  const next = addMonths(ym, 1);
  return {
    clientName: at('A6'),
    issuerName: at('F6'),
    postalCode: at('F8'),
    address1: at('F9'),
    address2: at('F10'),
    phone: at('F11'),
    issueDate: parseDay(at('F5')) ?? lastDay,
    dueDate: parseDay(at('F14')) ?? { year: next.year, month: next.month, day: daysInMonth(next) },
    itemName: at('A17'),
    hourlyRate: Math.trunc(parseNumber(at('D17')) ?? 0),
    extraItems,
    showsTax: at('E24') !== '',
    note: cell(grid, 26, 0).trim(),
    bank: [
      ['銀行名：', at('B29')],
      ['支店名：', at('B30')],
      ['種別：', at('B31')],
      ['口座番号：', at('B32')],
      ['口座名義：', at('B33')],
    ].filter(([, value]) => value !== ''),
  };
}

// ---- 書き込み ----

/** 数式や日付として解釈されないよう、文字列として入れる */
const literal = (text) => (text === '' ? '' : `'${text}`);

/** 1 日分の行（業務開始〜実施概要、C〜H 列）。合計はシート側の数式 */
export function rowValues(entry, row) {
  const formula = `=IF(G${row}="○",MOD(D${row}-C${row},1)-E${row},0)`;
  if (!entry) return ['', '', '', formula, '×', ''];
  return [timeText(entry.start), timeText(entry.end), timeText(entry.breakMinutes), formula, '○', literal(entry.summary)];
}

export function rowRange(d, row) {
  return `'${monthKey(d)}'!C${row}:H${row}`;
}

// ---- 金額と表記 ----

/** 3 桁ごとにカンマ */
export function grouped(value) {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const yen = (value) => `¥${grouped(value)}`;

/** 分 → 時間数。端数があるときだけ小数で出す（71 / 71.5 / 71.25） */
export function hoursText(total) {
  if (total % 60 === 0) return String(total / 60);
  return (total / 60).toFixed(2).replace(/0$/, '');
}

export function decimalText(value) {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/** 金額は 単価 × 時間。1 円未満は切り捨て */
export const hourlyAmount = (rate, total) => Math.floor((rate * total) / 60);
export const itemAmount = (item) => Math.floor(item.unitPrice * item.quantity);
/** 税込み金額のうちの消費税（10%）。1 円未満は切り捨て */
export const includedTax = (total) => Math.floor(total / 11);

export const dateText = (d) => `${d.year}年${d.month}月${d.day}日`;

/** ファイル名に入れる氏名。請求書の「名前」があればそれを、無ければ「会社名・氏名」の最後の区切りより後ろ */
export function personName(issuerName, signature) {
  if (issuerName?.trim()) return issuerName.trim();
  const parts = String(signature ?? '').split(/[_＿・/／ 　]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** よく使う実施概要（多い順） */
export function frequentSummaries(allEntries, limit = 12) {
  const counts = new Map();
  for (const entry of allEntries) {
    if (entry.summary) counts.set(entry.summary, (counts.get(entry.summary) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([summary]) => summary);
}
