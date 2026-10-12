// A bank statement CSV, read in the browser (Lee, 12 Oct 2026). Made for the
// CommBank NetBank export (no header: Date, Amount, Description, Balance) but
// it finds the date, the amount and the description in other layouts too.
// Only money in leaves the page: [{ date, cents, description }].

export const CSV_MAX_LINES = 2000

// Quotes, doubled quotes and line breaks inside quotes.
export function csvCells(text, sep = ',') {
  const rows = []
  let row = [], cur = '', q = false
  const t = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c
    } else if (c === '"') q = true
    else if (c === sep) { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean))
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n) => String(n).padStart(2, '0')
function ymd(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d)
  if (y < 100) y += 2000
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return ''
  const iso = `${y}-${pad(m)}-${pad(d)}`
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : ''
}
// 12/10/2026 (day first, as Australian banks write it), 2026-10-12, 12 Oct 2026.
export function bankDate(v) {
  const s = String(v || '').trim()
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) return ymd(m[3], m[2], m[1])
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  if (m) return ymd(m[1], m[2], m[3])
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2}|\d{4})$/)
  if (m && MONTHS[m[2].toLowerCase()]) return ymd(m[3], MONTHS[m[2].toLowerCase()], m[1])
  return ''
}
// "+850.00", "-12.00", "$1,234.50", "A$85", "(12.00)" -> cents, or null.
export function bankCents(v) {
  let s = String(v || '').replace(/\s/g, '')
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (/(CR)$/i.test(s)) s = s.slice(0, -2)
  if (/(DR)$/i.test(s)) { neg = true; s = s.slice(0, -2) }
  const m = s.match(/^([+-]?)(?:A?\$)?([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/i)
  if (!m) return null
  if (m[1] === '-' || m[2] === '-') neg = !neg
  const c = Number(m[3].replace(/,/g, '')) * 100 + Number((m[4] || '0').padEnd(2, '0'))
  return neg ? -c : c
}

const share = (list, test) => { const filled = list.filter(Boolean); return filled.length ? filled.filter(test).length / filled.length : 0 }

// Which numeric column is the running balance of which: balance moves by the amount.
function balanceOf(rows, a, b) {
  let ok = 0, n = 0
  for (let i = 1; i < rows.length; i++) {
    const [x0, x1, b0, b1] = [bankCents(rows[i - 1][a]), bankCents(rows[i][a]), bankCents(rows[i - 1][b]), bankCents(rows[i][b])]
    if ([x0, x1, b0, b1].some((v) => v == null)) continue
    n += 1
    if (b1 - b0 === x1 || b0 - b1 === x0) ok += 1
  }
  return n && ok / n >= 0.8
}

export function parseBankCsv(text) {
  const raw = String(text || '')
  const sep = raw.includes(',') ? ',' : raw.includes('\t') ? '\t' : raw.includes(';') ? ';' : ','
  let rows = csvCells(raw, sep)
  if (!rows.length) return { lines: [], rows: 0, credits: 0, error: 'That file is empty.' }
  const width = Math.max(...rows.map((r) => r.length))
  // A header row: no date in it, and words where the columns are.
  let head = null
  if (!rows[0].some(bankDate) && rows[0].some((c) => /[a-z]/i.test(c))) { head = rows[0].map((c) => c.toLowerCase()); rows = rows.slice(1) }
  const col = (i) => rows.map((r) => r[i] || '')
  const find = (re) => (head ? head.findIndex((h) => re.test(h)) : -1)
  let dateAt = find(/date/)
  if (dateAt < 0) {
    let best = 0
    for (let i = 0; i < width; i++) { const s = share(col(i), bankDate); if (s > best) { best = s; dateAt = i } }
    if (best < 0.8) dateAt = -1
  }
  if (dateAt < 0) return { lines: [], rows: rows.length, credits: 0, error: "Couldn't find the dates in that file." }
  let creditAt = find(/credit|deposit|money in|paid in/)
  let amountAt = creditAt >= 0 ? creditAt : find(/amount|value/)
  const balanceAt = find(/balance/)
  if (amountAt < 0) {
    const numeric = []
    for (let i = 0; i < width; i++) if (i !== dateAt && i !== balanceAt && share(col(i), (v) => bankCents(v) != null) >= 0.8) numeric.push(i)
    amountAt = numeric.find((a) => numeric.some((b) => b !== a && balanceOf(rows, a, b))) ?? numeric[0] ?? -1
  }
  if (amountAt < 0) return { lines: [], rows: rows.length, credits: 0, error: "Couldn't find the amounts in that file." }
  // The description: the longest text column.
  let descAt = find(/desc|narr|detail|particular|memo|transaction|payee/)
  if (descAt < 0) {
    let best = -1
    for (let i = 0; i < width; i++) {
      if (i === dateAt || i === amountAt || i === balanceAt) continue
      const vals = col(i)
      if (share(vals, (v) => bankCents(v) != null) > 0.5) continue
      const len = vals.reduce((t, v) => t + v.length, 0) / Math.max(1, vals.length)
      if (len > best) { best = len; descAt = i }
    }
  }
  const lines = []
  for (const r of rows) {
    const date = bankDate(r[dateAt])
    const cents = bankCents(r[amountAt])
    if (!date || !(cents > 0)) continue
    lines.push({ date, cents, description: (descAt >= 0 ? r[descAt] || '' : '').replace(/\s+/g, ' ').trim().slice(0, 200) })
  }
  lines.sort((a, b) => b.date.localeCompare(a.date))
  const credits = lines.length
  return { lines: lines.slice(0, CSV_MAX_LINES), rows: rows.length, credits, cut: Math.max(0, credits - CSV_MAX_LINES), error: credits ? '' : 'No money in found in that file.' }
}
