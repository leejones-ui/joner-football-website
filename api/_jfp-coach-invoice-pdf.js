// A coach's invoice as a PDF, laid out like the invoices coaches already
// send (Lee, 20 Oct 2026, from Luke's example): the coach's name, ABN,
// address, phone and email; "To" Joner Football; the invoice number and
// dates; one row per session (date, what and who, location, hours, total);
// where to pay; subtotal and total. Made with pdf-lib, nothing stored: it is
// drawn again whenever someone opens it. Only ever served to that coach and
// to Lee and Ligia.
import { formatAud } from './_jfp-store.js'

const BLUE = [0.239, 0.482, 0.804]
const fmtDate = (iso) => { const [y, m, d] = String(iso).split('-'); return `${Number(d)}/${Number(m)}/${y}` }
const hoursLabel = (m) => { const h = m / 60; return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')}H` }

// inv: the stored invoice. biz: { abn, address, email } for Joner Football (Settings > Invoices).
export async function coachInvoicePdf(inv, biz = {}) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Invoice ${inv.number}`)
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  // Helvetica cannot draw every character: anything else becomes '?'.
  const s = (t) => String(t ?? '').replace(/[^\x20-\x7E -ÿ]/g, '?')
  const ink = rgb(0, 0, 0), grey = rgb(0.45, 0.45, 0.45), blue = rgb(...BLUE), line = rgb(0.6, 0.6, 0.6), fill = rgb(0.94, 0.94, 0.94)
  const W = 595.28, H = 841.89, M = 36
  let page = pdf.addPage([W, H])
  const text = (t, x, y, { font = reg, size = 10, color = ink } = {}) => page.drawText(s(t), { x, y, size, font, color })
  const fit = (t, font, size, w) => { let x = s(t); while (x && font.widthOfTextAtSize(x, size) > w) x = x.slice(0, -2); return x === s(t) ? x : `${x}...` }
  const wrap = (t, font, size, w, max = 3) => {
    const out = []; let cur = ''
    for (const word of s(t).split(/\s+/)) { const next = cur ? `${cur} ${word}` : word; if (font.widthOfTextAtSize(next, size) > w && cur) { out.push(cur); cur = word } else cur = next }
    if (cur) out.push(cur)
    return out.length > max ? [...out.slice(0, max - 1), fit(out.slice(max - 1).join(' '), font, size, w)] : out
  }
  const d = inv.details || {}

  // Header.
  text('Invoice', W - M - bold.widthOfTextAtSize('Invoice', 34), H - M - 34, { font: bold, size: 34, color: blue })
  let y = H - M - 70
  text(d.fullName || inv.coach, M, y, { font: bold, size: 14, color: blue }); y -= 18
  for (const [k, v] of [['ABN', d.abn], ['Address', d.address], ['Phone number', d.phone], ['Email', d.email]]) { if (v) { text(`${k}: ${v}`, M, y, { font: bold, size: 9.5 }); y -= 15 } }
  y -= 10
  text('TO:', M, y, { font: bold, size: 12, color: blue }); y -= 16
  for (const v of ['Joner Football', biz.abn ? `ABN: ${biz.abn}` : '', biz.address || 'Unit 2, 20 Narabang Way, Belrose NSW 2085', `Email: ${biz.email || 'leejones@jonerfootball.com'}`]) { if (v) { text(v, M, y, { size: 9.5 }); y -= 15 } }
  let ry = H - M - 100
  for (const [k, v] of [['Invoice #', inv.number], ['Invoice Date', fmtDate(inv.issueDate)], ['Due Date', fmtDate(inv.dueDate || inv.issueDate)]]) { text(`${k} ${v}`, W / 2 + 60, ry, { font: bold, size: 11 }); ry -= 26 }
  y = Math.min(y, ry) - 14
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: line })
  y -= 18

  // The table.
  const cols = [['Date', 62], ['Description', 238], ['Location', 92], ['Hours', 50], ['Total price', 81]]
  const head = () => {
    let x = M
    page.drawRectangle({ x: M, y: y - 8, width: W - 2 * M, height: 24, borderColor: line, borderWidth: 0.8 })
    for (const [t, w] of cols) { text(t, x + (w - bold.widthOfTextAtSize(t, 10)) / 2, y, { font: bold, size: 10, color: blue }); x += w }
    y -= 24
  }
  head()
  for (const l of inv.lines) {
    const desc = wrap(l.description, reg, 8.5, cols[1][1] - 10)
    const h = Math.max(24, desc.length * 11 + 12)
    if (y - h < 170) { page = pdf.addPage([W, H]); y = H - M - 20; head() }
    page.drawRectangle({ x: M, y: y - h + 16, width: W - 2 * M, height: h, color: fill, borderColor: line, borderWidth: 0.8 })
    let x = M
    const cells = [fmtDate(l.date), null, l.location || '', hoursLabel(l.minutes), l.cents == null ? 'TBC' : formatAud(l.cents)]
    cols.forEach(([, w], i) => {
      if (i === 1) desc.forEach((ln, j) => text(ln, x + 5, y - j * 11, { size: 8.5 }))
      else { const t = fit(cells[i], reg, 9, w - 8); text(t, x + (w - reg.widthOfTextAtSize(t, 9)) / 2, y, { size: 9, color: i === 0 ? ink : grey }) }
      x += w
    })
    y -= h
  }

  // Where to pay, and the totals.
  y -= 24
  const boxH = 86
  page.drawRectangle({ x: M, y: y - boxH, width: 230, height: boxH, borderColor: line, borderWidth: 0.8 })
  text('Payment details', M + 6, y - 16, { font: bold, size: 9.5 })
  let py = y - 34
  for (const [k, v] of [['Account name', d.accountName], ['BSB', d.bsb], ['Account number', d.accountNumber]]) { text(`${k}: ${v || ''}`, M + 6, py, { size: 9.5 }); py -= 16 }
  const tx = W - M - 170
  page.drawRectangle({ x: tx, y: y - 66, width: 170, height: 66, borderColor: ink, borderWidth: 1 })
  const pending = inv.lines.filter((l) => l.cents == null).length
  const rows = [['Subtotal', formatAud(inv.amountCents || 0)], ['GST', ''], ['Total', `${formatAud(inv.amountCents || 0)}${pending ? ' + TBC' : ''}`]]
  rows.forEach(([k, v], i) => { const yy = y - 16 - i * 20; text(k, tx + 14, yy, { font: bold, size: 11 }); text(v, tx + 160 - bold.widthOfTextAtSize(s(v), 11), yy, { font: bold, size: 11 }) })
  if (pending) text(`${pending} line${pending > 1 ? 's' : ''} marked TBC: Lee or Ligia set the amount.`, M, y - boxH - 18, { size: 8.5, color: grey })
  return pdf.save()
}
