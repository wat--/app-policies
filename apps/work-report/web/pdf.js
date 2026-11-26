// 報告書と請求書を A4 縦の PDF に描く。寸法は iPhone・iPad アプリ（元の Excel シートの列幅・行の高さ）と同じ。
import {
  WEEKDAYS_JA, dayKey, monthDays, sheetDays, weekdayIndex, timeText, workedMinutes,
  grouped, yen, hoursText, decimalText, hourlyAmount, itemAmount, includedTax, dateText, monthKey, personName,
} from './layout.js';

const { PDFDocument, rgb } = window.PDFLib;

const PAGE = { width: 595.28, height: 841.89 };
const BLACK = rgb(0, 0, 0);
const SUNDAY = rgb(1, 0, 0);
const SATURDAY = rgb(0, 0x70 / 255, 0xc0 / 255);
const HEADER_FILL = rgb(0.85, 0.85, 0.85);

let resources;
/** 日本語の書体（BIZ UDPゴシック）と、書体を切り出す部品（HarfBuzz）。初回だけ読み込む */
async function loadResources() {
  resources ??= (async () => {
    const fetchBytes = async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('書体を読み込めませんでした。');
      return new Uint8Array(await response.arrayBuffer());
    };
    const [regular, bold, wasm] = await Promise.all([
      fetchBytes('fonts/BIZUDPGothic-Regular.ttf'),
      fetchBytes('fonts/BIZUDPGothic-Bold.ttf'),
      fetchBytes('lib/harfbuzz-subset.wasm'),
    ]);
    const { instance } = await WebAssembly.instantiate(wasm);
    return { regular, bold, hb: instance.exports };
  })();
  return resources;
}

/** 書体から、使う文字だけを切り出す。丸ごと埋め込むと PDF が数 MB になるため */
function subsetFont(hb, fontBytes, text) {
  const pointer = hb.malloc(fontBytes.byteLength);
  new Uint8Array(hb.memory.buffer).set(fontBytes, pointer);
  const blob = hb.hb_blob_create(pointer, fontBytes.byteLength, 2, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  const unicodes = hb.hb_subset_input_unicode_set(input);
  for (const character of new Set(text)) hb.hb_set_add(unicodes, character.codePointAt(0));
  const subset = hb.hb_subset_or_fail(face, input);
  hb.hb_subset_input_destroy(input);
  if (!subset) {
    hb.hb_face_destroy(face);
    hb.free(pointer);
    throw new Error('書体を準備できませんでした。');
  }
  const result = hb.hb_face_reference_blob(subset);
  const offset = hb.hb_blob_get_data(result, 0);
  const bytes = new Uint8Array(hb.memory.buffer).slice(offset, offset + hb.hb_blob_get_length(result));
  hb.hb_blob_destroy(result);
  hb.hb_face_destroy(subset);
  hb.hb_face_destroy(face);
  hb.free(pointer);
  return bytes;
}

/** @param text この PDF に出てくる文字をすべて含む文字列 */
async function newDocument(title, text) {
  const { regular, bold, hb } = await loadResources();
  const doc = await PDFDocument.create();
  doc.registerFontkit(window.fontkit);
  doc.setTitle(title);
  const used = `${text}…0123456789:`;
  const fonts = {
    regular: await doc.embedFont(subsetFont(hb, regular, used), { subset: false }),
    bold: await doc.embedFont(subsetFont(hb, bold, used), { subset: false }),
  };
  return { doc, fonts };
}

/** 余白の内側を原点（左上）にして、全体を scale 倍で描くための部品 */
class Canvas {
  constructor(doc, fonts, margin, scale) {
    this.doc = doc;
    this.fonts = fonts;
    this.margin = margin;
    this.scale = scale;
    this.page = null;
  }

  addPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
  }

  x(value) { return this.margin.x + value * this.scale; }
  y(value) { return PAGE.height - this.margin.y - value * this.scale; }

  line(x1, y1, x2, y2) {
    this.page.drawLine({
      start: { x: this.x(x1), y: this.y(y1) }, end: { x: this.x(x2), y: this.y(y2) },
      thickness: 0.5 * this.scale, color: BLACK,
    });
  }

  box(rect, { fill = null, stroke = true } = {}) {
    this.page.drawRectangle({
      x: this.x(rect.x), y: this.y(rect.y + rect.h), width: rect.w * this.scale, height: rect.h * this.scale,
      color: fill ?? undefined,
      borderColor: stroke ? BLACK : undefined,
      borderWidth: stroke ? 0.5 * this.scale : 0,
    });
  }

  /** 1 行の文字をセルの上下中央に描く。shrink のときは幅に収まるまで小さくし、それでも余れば末尾を省略する */
  text(value, rect, { size, bold = false, align = 'left', color = BLACK, shrink = false } = {}) {
    let text = String(value ?? '').replace(/[\r\n]+/g, ' ');
    if (!text) return;
    const font = bold ? this.fonts.bold : this.fonts.regular;
    const padding = 3;
    const available = rect.w - padding * 2;
    let width = font.widthOfTextAtSize(text, size);
    if (shrink) {
      while (size > 5.5 && width > available) {
        size -= 0.5;
        width = font.widthOfTextAtSize(text, size);
      }
    }
    while (width > available && text.length > 1) {
      text = `${text.slice(0, -2)}…`;
      width = font.widthOfTextAtSize(text, size);
    }
    let left = rect.x + padding;
    if (align === 'center') left = rect.x + (rect.w - width) / 2;
    if (align === 'right') left = rect.x + rect.w - padding - width;
    const baseline = rect.y + rect.h / 2 + size * 0.36;
    this.page.drawText(text, { x: this.x(left), y: this.y(baseline), size: size * this.scale, font, color });
  }
}

// ---- 報告書 ----

const REPORT = {
  margin: 14.17,
  columns: [93.7, 58.5, 58.5, 58.5, 58.5, 58.5, 192.75],
  headers: ['日付', '業務開始', '業務終了', '休憩時間', '合計', '稼働', '実施概要'],
  titleHeight: 21, infoHeight: 16.5, headerHeight: 17.25, rowHeight: 15.75, noteHeight: 12,
};
REPORT.width = REPORT.columns.reduce((sum, w) => sum + w, 0);

/** 報告書の内容を組み立てる */
export function buildReport({ ym, entries, header, range, includeNotes, issuerName }) {
  const weekdays = header.weekdays ?? WEEKDAYS_JA;
  const days = range === 'sheet' ? sheetDays(ym) : monthDays(ym);
  let total = 0;
  let workingDays = 0;
  const rows = days.map((d) => {
    const row = { weekday: weekdayIndex(d), date: `${d.month}月${d.day}日(${weekdays[weekdayIndex(d)]})`, visible: true };
    if (d.year !== ym.year || d.month !== ym.month) return { ...row, visible: false };
    const entry = entries.get(dayKey(d));
    if (!entry) return { ...row, start: '', end: '', breakTime: '', total: '0:00', status: '×', summary: '' };
    const worked = workedMinutes(entry);
    total += worked;
    workingDays += 1;
    return {
      ...row, start: timeText(entry.start), end: timeText(entry.end), breakTime: timeText(entry.breakMinutes),
      total: timeText(worked), status: '○', summary: entry.summary,
    };
  });
  const lastDay = monthDays(ym).at(-1);
  const name = personName(issuerName, header.signature);
  const stamp = `${lastDay.year}${String(lastDay.month).padStart(2, '0')}${String(lastDay.day).padStart(2, '0')}`;
  return {
    title: header.title,
    monthLabel: `【${ym.year}年${ym.month}月度】`,
    projectLine: header.projectName ? `プロジェクト名：${header.projectName}` : '',
    signature: header.signature,
    rows,
    totalText: timeText(total),
    totalMinutes: total,
    workingDays,
    notes: includeNotes ? header.notes : [],
    fileName: `${[stamp, header.title || '報告書', name].filter(Boolean).join('_')}.pdf`.replaceAll('/', '_'),
  };
}

export async function renderReport(report) {
  const { doc, fonts } = await newDocument(report.title, JSON.stringify(report) + REPORT.headers.join('') + '合計');
  const R = REPORT;
  const scale = (PAGE.width - R.margin * 2) / R.width;
  const usable = (PAGE.height - R.margin * 2) / scale;
  const canvas = new Canvas(doc, fonts, { x: R.margin, y: R.margin }, scale);

  let topHeight = R.titleHeight + 6 + R.infoHeight + 9;
  if (report.projectLine) topHeight += R.infoHeight;
  if (report.signature) topHeight += R.infoHeight;
  const tailHeight = R.headerHeight + (report.notes.length ? 12.75 + report.notes.length * R.noteHeight : 0);

  // ページごとの行の割り当て
  const chunks = [];
  let remaining = report.rows;
  do {
    const top = chunks.length === 0 ? topHeight : 0;
    const capacity = Math.max(1, Math.floor((usable - top - R.headerHeight) / R.rowHeight));
    chunks.push(remaining.slice(0, capacity));
    remaining = remaining.slice(capacity);
  } while (remaining.length);

  const cells = (y, h) => {
    let x = 0;
    return R.columns.map((w) => {
      const rect = { x, y, w, h };
      x += w;
      return rect;
    });
  };

  let y = 0;
  chunks.forEach((chunk, index) => {
    canvas.addPage();
    y = 0;
    if (index === 0) {
      canvas.text(report.title, { x: 0, y, w: R.width, h: R.titleHeight }, { size: 14, bold: true, align: 'center' });
      y += R.titleHeight + 6;
      canvas.text(report.monthLabel, { x: 0, y, w: R.width, h: R.infoHeight }, { size: 12 });
      y += R.infoHeight;
      if (report.projectLine) {
        canvas.text(report.projectLine, { x: 0, y, w: R.width, h: R.infoHeight }, { size: 10 });
        y += R.infoHeight;
      }
      if (report.signature) {
        canvas.text(report.signature, { x: 0, y, w: R.width, h: R.infoHeight }, { size: 10 });
        y += R.infoHeight;
        canvas.line(0, y, R.width - R.columns[6], y);
      }
      y += 9;
    }
    cells(y, R.headerHeight).forEach((rect, column) => {
      canvas.box(rect);
      canvas.text(R.headers[column], rect, { size: 10, align: 'center' });
    });
    y += R.headerHeight;
    for (const row of chunk) {
      const rects = cells(y, R.rowHeight);
      rects.forEach((rect) => canvas.box(rect));
      y += R.rowHeight;
      if (!row.visible) continue;
      const color = row.weekday === 0 ? SUNDAY : row.weekday === 6 ? SATURDAY : BLACK;
      canvas.text(row.date, rects[0], { size: 10, align: 'center', color });
      canvas.text(row.start, rects[1], { size: 10, align: 'right' });
      canvas.text(row.end, rects[2], { size: 10, align: 'right' });
      canvas.text(row.breakTime, rects[3], { size: 10, align: 'right' });
      canvas.text(row.total, rects[4], { size: 10, align: 'right' });
      canvas.text(row.status, rects[5], { size: 10, align: 'center' });
      canvas.text(row.summary, rects[6], { size: 8, shrink: true });
    }
  });

  if (y + tailHeight > usable) {
    canvas.addPage();
    y = 0;
  }
  const rects = cells(y, R.headerHeight);
  canvas.text('合計', rects[3], { size: 10, align: 'right' });
  canvas.box(rects[4]);
  canvas.box(rects[5]);
  canvas.text(report.totalText, rects[4], { size: 10, align: 'right' });
  canvas.text(String(report.workingDays), rects[5], { size: 10, align: 'right' });
  y += R.headerHeight + 12.75;
  for (const note of report.notes) {
    canvas.text(note, { x: 0, y, w: R.width, h: R.noteHeight }, { size: 9, shrink: true });
    y += R.noteHeight;
  }
  return doc.save();
}

// ---- 請求書 ----

const INVOICE = { margin: { x: 50.4, y: 54 }, column: 54.3, row: 15.75, itemRows: 6 };
INVOICE.width = INVOICE.column * 7;
const INVOICE_LABELS = '御　請　求　書請求書No,請求日名前：下記の通り、ご請求申し上げます。〒住所：TEL：ご請求額(税込み)振込期日案件名単価数量金額合計うち消費税10%下記口座にお振込みをお願いいたします。【お振込先】';

/** 請求書の内容を組み立てる。数量は、その月の作業時間の合計 */
export function buildInvoice({ ym, record, workedMinutes: worked }) {
  const first = hourlyAmount(record.hourlyRate, worked);
  const total = first + record.extraItems.reduce((sum, item) => sum + itemAmount(item), 0);
  const items = [
    { name: record.itemName, rate: grouped(record.hourlyRate), quantity: hoursText(worked), amount: yen(first) },
    ...record.extraItems.map((item) => ({
      name: item.name, rate: grouped(item.unitPrice), quantity: decimalText(item.quantity), amount: yen(itemAmount(item)),
    })),
  ];
  while (items.length < INVOICE.itemRows) items.push({ name: '', rate: '', quantity: '', amount: '' });
  return {
    number: `${ym.year}-${ym.month}`,
    issueDate: dateText(record.issueDate),
    dueDate: dateText(record.dueDate),
    clientName: record.clientName,
    issuerName: record.issuerName,
    postalCode: record.postalCode,
    address1: record.address1,
    address2: record.address2,
    phone: record.phone,
    amount: yen(total),
    items,
    total: yen(total),
    tax: record.showsTax ? yen(includedTax(total)) : '',
    note: record.note,
    bank: record.bank,
    fileName: `${[monthKey(ym), record.clientName, '請求書', record.issuerName].filter(Boolean).join('_')}.pdf`.replaceAll('/', '_'),
  };
}

export async function renderInvoice(invoice) {
  const { doc, fonts } = await newDocument(`御請求書 ${invoice.number}`, JSON.stringify(invoice) + INVOICE_LABELS);
  const I = INVOICE;
  const canvas = new Canvas(doc, fonts, I.margin, (PAGE.width - I.margin.x * 2) / I.width);
  canvas.addPage();
  /** 列 from〜to（0 = A）をまたぐ矩形 */
  const cell = (from, to, y, h = I.row) => ({ x: from * I.column, y, w: (to - from + 1) * I.column, h });
  const underline = (rect) => canvas.line(rect.x, rect.y + rect.h, rect.x + rect.w, rect.y + rect.h);

  canvas.text('御　請　求　書', cell(0, 6, 0, I.row * 2), { size: 18, align: 'center' });
  let y = I.row * 3;
  for (const [label, value] of [['請求書No,', invoice.number], ['請求日', invoice.issueDate]]) {
    canvas.text(label, cell(4, 4, y), { size: 9, align: 'right' });
    canvas.text(value, cell(5, 6, y), { size: 10, align: 'center' });
    underline(cell(5, 6, y));
    y += I.row;
  }
  canvas.text(invoice.clientName, cell(0, 3, y, I.row * 2), { size: 14, align: 'center', shrink: true });
  canvas.text('名前：', cell(4, 4, y + I.row), { size: 9, align: 'right' });
  canvas.text(invoice.issuerName, cell(5, 6, y, I.row * 2), { size: 12, shrink: true });
  y += I.row * 2;
  canvas.text('下記の通り、ご請求申し上げます。', cell(0, 3, y), { size: 10 });
  for (const [label, value] of [['〒', invoice.postalCode], ['住所：', invoice.address1], ['', invoice.address2], ['TEL：', invoice.phone]]) {
    canvas.text(label, cell(4, 4, y), { size: 9, align: 'right' });
    canvas.text(value, cell(5, 6, y), { size: 9, shrink: true });
    if (value) underline(cell(5, 6, y));
    y += I.row;
  }

  // 請求額と振込期日
  y += I.row;
  const amountHeight = I.row * 1.5;
  const label = cell(0, 1, y, amountHeight);
  const amount = cell(2, 3, y, amountHeight);
  const dueLabel = cell(4, 4, y, amountHeight);
  const due = cell(5, 6, y, amountHeight);
  canvas.box(label, { fill: HEADER_FILL });
  canvas.box(amount);
  canvas.box(dueLabel, { fill: HEADER_FILL });
  canvas.box(due);
  canvas.text('ご請求額(税込み)', label, { size: 11, align: 'center', shrink: true });
  canvas.text(invoice.amount, amount, { size: 12, bold: true, align: 'center', shrink: true });
  canvas.text('振込期日', dueLabel, { size: 10, align: 'center', shrink: true });
  canvas.text(invoice.dueDate, due, { size: 11, bold: true, align: 'center', shrink: true });
  y += amountHeight + I.row;

  // 明細
  const headerHeight = I.row * 1.3;
  const itemCells = (h) => [cell(0, 2, y, h), cell(3, 3, y, h), cell(4, 4, y, h), cell(5, 6, y, h)];
  itemCells(headerHeight).forEach((rect, index) => {
    canvas.box(rect, { fill: HEADER_FILL });
    canvas.text(['案件名', '単価', '数量', '金額'][index], rect, { size: 11, align: 'center' });
  });
  y += headerHeight;
  for (const item of invoice.items) {
    const rects = itemCells(I.row);
    rects.forEach((rect) => canvas.box(rect));
    canvas.text(item.name, rects[0], { size: 9, shrink: true });
    canvas.text(item.rate, rects[1], { size: 9, align: 'right' });
    canvas.text(item.quantity, rects[2], { size: 9, align: 'right' });
    canvas.text(item.amount, rects[3], { size: 11, align: 'right' });
    y += I.row;
  }
  const summary = [['合計', invoice.total, 10, 11]];
  if (invoice.tax) summary.push(['うち消費税10%', invoice.tax, 7, 9]);
  for (const [name, value, labelSize, valueSize] of summary) {
    canvas.box(cell(4, 4, y), { fill: HEADER_FILL });
    canvas.box(cell(5, 6, y));
    canvas.text(name, cell(4, 4, y), { size: labelSize, align: 'center', shrink: true });
    canvas.text(value, cell(5, 6, y), { size: valueSize, align: 'right' });
    y += I.row;
  }

  // 備考と振込先
  y += I.row;
  const lineHeight = 18.75;
  if (invoice.note) {
    const lines = invoice.note.split('\n');
    canvas.box(cell(0, 6, y, lineHeight * lines.length));
    for (const line of lines) {
      canvas.text(line, cell(0, 6, y, lineHeight), { size: 11, shrink: true });
      y += lineHeight;
    }
  }
  if (invoice.bank.length) {
    canvas.text('下記口座にお振込みをお願いいたします。', cell(0, 6, y, lineHeight), { size: 11 });
    y += lineHeight;
    canvas.text('【お振込先】', cell(0, 2, y), { size: 10 });
    y += I.row;
    for (const [name, value] of invoice.bank) {
      canvas.text(name, cell(0, 0, y), { size: 9, shrink: true });
      canvas.text(value, cell(1, 3, y), { size: 10, shrink: true });
      y += I.row;
    }
  }
  return doc.save();
}
