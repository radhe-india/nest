// Reads bank statements and screenshots on the phone itself. Nothing is uploaded:
// screenshots are read with Tesseract (text recognition), PDFs with pdf.js and
// CSV / Excel files with SheetJS. The result is a list of candidate rows that the
// person checks before anything is saved.

const LIBS = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
};
const loaded = {};
function loadScript(src) {
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res;
    s.onerror = () => { delete loaded[src]; rej(new Error('Could not load the reader. Check your internet connection and try again.')); };
    document.head.appendChild(s);
  });
  return loaded[src];
}

/* ---------------- dates ---------------- */
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
function mkDate(y, m, d, today) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  let yr = y;
  if (yr == null) {
    yr = today.getFullYear();
    const cand = new Date(yr, m - 1, d);
    if (cand - today > 3 * 864e5) yr -= 1; // a date in the future most likely belongs to last year
  } else if (yr < 100) yr += 2000;
  if (yr < 2000 || yr > 2100) return null;
  const dt = new Date(yr, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return `${yr}-${pad(m)}-${pad(d)}`;
}
const MONRE = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';
const DATE_PATTERNS = [
  // 2026-10-29
  { re: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g, f: (m, t) => mkDate(+m[1], +m[2], +m[3], t) },
  // 29/10/2026, 29-10-26, 29.10.2026 (Indian day-first)
  { re: /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g, f: (m, t) => mkDate(+m[3], +m[2], +m[1], t) },
  // 29 Oct 2026, 29-Oct-26, 29 October, 29th Oct
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-]*${MONRE}[\\s\\-,']*(\\d{4}|\\d{2}(?!\\d|:))?`, 'gi'), f: (m, t) => mkDate(m[3] ? +m[3] : null, MON[m[2].toLowerCase().slice(0, 4).replace(/t$/, '')] || MON[m[2].toLowerCase().slice(0, 3)], +m[1], t) },
  // Oct 29, 2026 / October 29
  { re: new RegExp(`\\b${MONRE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, 'gi'), f: (m, t) => mkDate(m[3] ? +m[3] : null, MON[m[1].toLowerCase().slice(0, 3)], +m[2], t) },
  // Today / Yesterday
  { re: /\b(today|yesterday)\b/gi, f: (m, t) => { const d = new Date(t); if (/yest/i.test(m[1])) d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; } }
];
export function findDates(line, today = new Date()) {
  const out = [];
  for (const p of DATE_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(line))) {
      const iso = p.f(m, today);
      if (iso && !out.some(o => m.index < o.end && m.index + m[0].length > o.start)) out.push({ iso, start: m.index, end: m.index + m[0].length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/* ---------------- amounts ---------------- */
// ₹ is often read as %, Z, or z by text recognition; Rs/INR are common in statements.
const AMT_RE = /([+\-−])?\s*(₹|rs\.?|inr|%|\bz(?=\d))?\s*([+\-−])?\s*((?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)(?!\d)\s*(cr|dr|c|d)?(?![a-z])/gi;
export function findAmounts(line) {
  const out = [];
  AMT_RE.lastIndex = 0;
  let m;
  while ((m = AMT_RE.exec(line))) {
    const raw = m[4];
    const digits = raw.replace(/[,.]/g, '');
    const hasCur = !!m[2];
    const hasDec = /\.\d{1,2}$/.test(raw);
    const hasComma = raw.includes(',');
    if (digits.length > 9 && !hasDec) continue;         // account / reference numbers
    if (!hasCur && !hasDec && !hasComma) continue;      // bare numbers are usually ids, times or years
    const value = parseFloat(raw.replace(/,/g, ''));
    if (!(value > 0) || value > 1e8) continue;
    let sign = 0;
    const sg = m[3] || (hasCur || hasDec || hasComma ? m[1] : null);
    if (sg === '+') sign = 1;
    else if ((sg === '-' || sg === '−') && hasCur) sign = -1;
    const crdr = (m[5] || '').toLowerCase();
    if (crdr === 'cr' || crdr === 'c') sign = 1;
    if (crdr === 'dr' || crdr === 'd') sign = -1;
    out.push({ value, sign, start: m.index, end: m.index + m[0].length, hasCur });
  }
  return out;
}

/* ---------------- line parsing ---------------- */
const NOISE = /(opening|closing|available|avl\.?|total|minimum amount|min\.? amt|amount due|credit limit|cash limit|statement|reward points?|page \d|balance as on|b\/f|c\/f|carried forward|brought forward|gstin|customer id|ifsc|micr|nominee)/i;
const IN_WORDS = /\b(received|credited|credit|refund|reversal|cashback|deposit|salary|interest|int\.?\s*pd|dividend|by transfer|neft cr|imps cr|upi cr)\b/i;
const OUT_WORDS = /\b(paid|sent|debited|debit|spent|withdrawal|purchase|pos|atm|to transfer|neft dr|imps dr|upi dr|bill pay)\b/i;

function cleanDesc(s) {
  return s.replace(/\s{2,}/g, ' ').replace(/^[\s\-|:,.•·]+|[\s\-|:,.•·]+$/g, '').trim();
}

export function parseLines(lines, today = new Date()) {
  const rows = [];
  const dateAt = [];       // line index -> iso date when a line is only a date
  let lastDate = null, prevBal = null, lastRowIdx = -1;
  lines = lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  lines.forEach((line, i) => {
    if (NOISE.test(line)) {
      // still learn the running balance from "opening balance" lines
      const a = findAmounts(line); if (/opening|b\/f|brought/i.test(line) && a.length) prevBal = a[a.length - 1].value;
      return;
    }
    const dates = findDates(line, today);
    let rest = line;
    for (const d of [...dates].reverse()) rest = rest.slice(0, d.start) + ' ' + rest.slice(d.end);
    const amts = findAmounts(rest);
    if (dates.length) lastDate = dates[0].iso;
    if (!amts.length) {
      if (dates.length && !cleanDesc(rest).match(/[a-z]{3,}/i)) dateAt[i] = dates[0].iso;
      // a text-only line right after a row is usually the rest of its description
      else if (!dates.length && lastRowIdx === i - 1 && rows.length && rows[rows.length - 1].desc.length < 90) {
        const t = cleanDesc(rest);
        if (t && /[a-z]{2,}/i.test(t)) rows[rows.length - 1].desc = cleanDesc(rows[rows.length - 1].desc + ' ' + t);
        lastRowIdx = i;
      }
      return;
    }
    // with two or more amounts the last one is usually the running balance
    let txn = amts[0], bal = null;
    if (amts.length >= 2) { bal = amts[amts.length - 1].value; txn = amts[amts.length - 2]; }
    let desc = rest;
    for (const a of [...amts].reverse()) desc = desc.slice(0, a.start) + ' ' + desc.slice(a.end);
    desc = cleanDesc(desc);
    if (!/[a-z]{2,}/i.test(desc)) {
      // e.g. a screenshot where the name sits on the line above the amount
      const prev = lines[i - 1];
      if (prev && !findAmounts(prev).length && /[a-z]{2,}/i.test(prev)) desc = cleanDesc(prev.replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi, ''));
    }
    let kind = null;
    if (bal != null && prevBal != null) {
      const delta = Math.round((bal - prevBal) * 100) / 100;
      if (Math.abs(Math.abs(delta) - txn.value) < 0.02) kind = delta > 0 ? 'in' : 'spent';
    }
    if (!kind && txn.sign) kind = txn.sign > 0 ? 'in' : 'spent';
    if (!kind && IN_WORDS.test(line + ' ' + desc) && !OUT_WORDS.test(line + ' ' + desc)) kind = 'in';
    if (!kind) kind = 'spent';
    if (bal != null) prevBal = bal;
    rows.push({ line: i, date: dates.length ? dates[0].iso : null, amount: txn.value, kind, desc: desc.slice(0, 140), raw: line });
    lastRowIdx = i;
  });
  // fill missing dates: a date-only line just after (screenshots) or the last date above (statements)
  let running = null;
  for (const r of rows) {
    if (r.date) { running = r.date; continue; }
    let found = null;
    for (let k = r.line + 1; k <= r.line + 2; k++) if (dateAt[k]) { found = dateAt[k]; break; }
    if (!found) for (let k = r.line - 1; k >= Math.max(0, r.line - 3); k--) if (dateAt[k]) { found = dateAt[k]; break; }
    r.date = found || running || lastDate;
  }
  return rows;
}

/* ---------------- spreadsheets / CSV ---------------- */
function num(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[₹,\s]|inr|rs\.?/gi, '');
  const n = parseFloat(s.replace(/(cr|dr)$/i, ''));
  return isNaN(n) ? 0 : n;
}
function cellDate(v, today) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  const f = findDates(String(v), today);
  return f.length ? f[0].iso : null;
}
export function parseTable(table, today = new Date()) {
  const find = (row, re) => row.findIndex(c => re.test(String(c || '').toLowerCase().trim()));
  let h = -1, cols = null;
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    const row = table[i] || [];
    const d = find(row, /date/);
    const amt = find(row, /^amount|amount \(|txn amount|transaction amount|^amt/);
    const dr = find(row, /withdraw|debit|^dr\b|paid out|money out/);
    const cr = find(row, /deposit|credit|^cr\b|paid in|money in/);
    if (d >= 0 && (amt >= 0 || dr >= 0 || cr >= 0)) {
      h = i;
      cols = { d, amt, dr, cr, desc: find(row, /narration|description|particular|details|remark|merchant|transaction|info/), type: find(row, /type|dr\/cr|cr\/dr|debit\/credit/) , bal: find(row, /balance/) };
      if (cols.desc === d) cols.desc = -1;
      break;
    }
  }
  if (h < 0) return parseLines(table.map(r => (r || []).join('  ')), today);
  const rows = [];
  for (let i = h + 1; i < table.length; i++) {
    const r = table[i] || [];
    const date = cellDate(r[cols.d], today);
    if (!date) continue;
    let amount = 0, kind = 'spent';
    const dr = cols.dr >= 0 ? num(r[cols.dr]) : 0, cr = cols.cr >= 0 ? num(r[cols.cr]) : 0;
    if (dr > 0) { amount = dr; kind = 'spent'; }
    else if (cr > 0) { amount = cr; kind = 'in'; }
    else if (cols.amt >= 0) {
      const raw = String(r[cols.amt] ?? '');
      amount = Math.abs(num(raw));
      const t = cols.type >= 0 ? String(r[cols.type] || '').toLowerCase() : '';
      if (/cr|credit/.test(t) || /cr$/i.test(raw.trim()) || num(raw) < 0 && /refund/i.test(String(r[cols.desc] || ''))) kind = 'in';
      else if (/dr|debit/.test(t) || /dr$/i.test(raw.trim())) kind = 'spent';
      else if (num(raw) < 0) kind = 'in'; // card statements often show payments/refunds as negative
    }
    if (!(amount > 0)) continue;
    const desc = cleanDesc(String(cols.desc >= 0 ? r[cols.desc] ?? '' : r.filter((_, k) => k !== cols.d).join(' ')));
    rows.push({ line: i, date, amount: Math.round(amount * 100) / 100, kind, desc: desc.slice(0, 140), raw: r.join(' | ') });
  }
  return rows;
}

/* ---------------- readers ---------------- */
async function readImage(file, onProgress) {
  await loadScript(LIBS.tesseract);
  const { data } = await window.Tesseract.recognize(file, 'eng', {
    logger: m => { if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 100), 'Reading the screenshot'); else onProgress?.(null, 'Getting the text reader ready'); }
  });
  const lines = (data.lines && data.lines.length ? data.lines.map(l => l.text) : data.text.split('\n'));
  return { lines, text: data.text };
}

export class PasswordNeeded extends Error { constructor(wrong) { super(wrong ? 'That password did not open the PDF.' : 'This PDF is password-protected.'); this.wrong = wrong; } }

async function readPdf(file, password, onProgress) {
  await loadScript(LIBS.pdf);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try { doc = await pdfjs.getDocument({ data, password: password || undefined }).promise; }
  catch (e) {
    if (e && e.name === 'PasswordException') throw new PasswordNeeded(!!password);
    throw new Error('This PDF could not be opened.');
  }
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(Math.round((p - 1) / doc.numPages * 100), `Reading page ${p} of ${doc.numPages}`);
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str && it.str.trim()).map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str, w: it.width || 0 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = [], cy = null;
    const flush = () => { if (cur.length) { cur.sort((a, b) => a.x - b.x); let t = '', lastX = null; for (const it of cur) { t += (lastX != null && it.x - lastX > 4 ? '  ' : (t ? ' ' : '')) + it.s; lastX = it.x + it.w; } lines.push(t); } cur = []; };
    for (const it of items) { if (cy == null || Math.abs(it.y - cy) > 3) { flush(); cy = it.y; } cur.push(it); }
    flush();
  }
  const scanned = lines.join('').replace(/\s/g, '').length < 40;
  return { lines, scanned };
}

async function readSheet(file) {
  await loadScript(LIBS.xlsx);
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
  let table = [];
  for (const name of wb.SheetNames) {
    const t = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    if (t.length > table.length) table = t;
  }
  return table;
}

export async function extractFromFile(file, { password, onProgress } = {}) {
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  const today = new Date();
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/.test(name)) {
    const { lines } = await readImage(file, onProgress);
    return { method: 'screenshot', rows: parseLines(lines, today), lineCount: lines.length };
  }
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    const { lines, scanned } = await readPdf(file, password, onProgress);
    if (scanned) throw new Error('This PDF is a scanned image with no text inside. Take a screenshot of the page and import that instead.');
    return { method: 'pdf', rows: parseLines(lines, today), lineCount: lines.length };
  }
  if (/\.(csv|xlsx?|xls|ods|txt)$/.test(name) || /csv|sheet|excel/.test(type)) {
    onProgress?.(null, 'Reading the file');
    const table = await readSheet(file);
    return { method: 'sheet', rows: parseTable(table, today), lineCount: table.length };
  }
  throw new Error('Nest can read screenshots (PNG, JPG), PDF statements, and CSV or Excel files.');
}

/* ---------------- helpers for the review step ---------------- */
const STOP = new Set(['upi', 'neft', 'imps', 'rtgs', 'pos', 'ach', 'nach', 'ecom', 'dr', 'cr', 'tpt', 'inb', 'mob', 'payment', 'pay', 'paid', 'to', 'from', 'by', 'via', 'at', 'the', 'and', 'for', 'txn', 'transaction', 'rsp', 'pvt', 'private', 'ltd', 'limited', 'india', 'in', 'technologies', 'tech', 'services', 'okaxis', 'okhdfcbank', 'okicici', 'oksbi', 'ybl', 'ibl', 'axl', 'paytm', 'apl', 'upi', 'hdfc', 'icici', 'sbi', 'axis', 'yes', 'bank', 'ref', 'no', 'debit', 'credit', 'card', 'purchase', 'sent', 'received', 'transfer', 'mr', 'mrs', 'ms', 'payu', 'razorpay', 'billdesk', 'cashfree', 'ccavenue', 'gateway', 'till', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'autopay', 'tad', 'mandate', 'emi']);
export function merchantKey(desc) {
  const words = String(desc || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w) && !/\d/.test(w) && !/bank$/.test(w));
  return [...new Set(words)].slice(0, 2).join(' ');
}
export function prettyMerchant(desc) {
  const key = merchantKey(desc);
  if (!key) return String(desc || '').slice(0, 40);
  return key.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}
