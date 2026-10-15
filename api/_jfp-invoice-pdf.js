// The JFP tax invoice as a PDF (Lee, 16 Oct 2026: "a custom invoice when we
// email them the fees, so it is attached as a PDF"). A plain Joner Football
// invoice (Lee: keep it simple): the logo, Anton for the headings, one line
// per player, one A4 page (more only when there are many lines). Made with pdf-lib, pure JS, nothing to install
// on the server and no browser.
//
// Two kinds of invoice go through the same drawing:
//   docFromInvoice  a custom invoice (INV-<n>, _jfp-invoices.js)
//   docFromPayreq   a term fee, payment link, family or sessions invoice: a
//                   statement-style tax invoice for that payment request, with
//                   its own number FEE-<n>, given once per request and kept
//                   (feeInvoiceNumber), so the same request always prints the
//                   same number.
// Nothing about any other family, no coach names, no staff names. Bank
// details only when Settings > Invoices has bank transfer switched on AND all
// three fields saved (bankOffered). The ABN only when one is saved.
// pdf-lib, the font and the QR code load only when a PDF is made, so the
// functions that just read invoices start as fast as before.
import { kvCommand, formatAud, sydneyToday, locationFor, hasBankDetails } from './_jfp-store.js'

export const FEE_PREFIX = 'FEE-'
const FEE_SEQ = 'jfp:fee-invoice-seq'
const FEE_NUMBERS = 'jfp:fee-invoice-no'
// FEE-1001 is the first, as INV-1001 is for custom invoices.
const FEE_START = 1000
export const SITE = 'jonerfootball.com'
export const CONTACTS = [['Ligia', 'ligia@jonerfootball.com'], ['Lee', 'leejones@jonerfootball.com']]
const BUSINESS = { name: 'Joner Football', address: '20 Narabang Way (Unit 2), Belrose NSW 2085', email: 'ligia@jonerfootball.com' }

export const gstOf = (cents) => Math.round(cents / 11)
export const abnLabel = (abn) => String(abn || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4')
// Bank transfer is offered only when staff switch it on (Lee, 16 Oct 2026:
// not yet) and every field is there.
export const bankOffered = (config) => config?.invoice?.bankEnabled === true && hasBankDetails(config.invoice)
export const attachOn = (config) => config?.invoice?.attachPdf !== false
const dayOf = (iso) => (iso ? sydneyToday(Date.parse(iso)) : sydneyToday())
const longDate = (isoDay) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${isoDay}T00:00:00Z`))

// The FEE number for a payment request: made once, the same ever after.
export async function feeInvoiceNumber(payreqId) {
  const id = String(payreqId || '')
  if (!id) throw new Error('No payment request.')
  const have = await kvCommand(['HGET', FEE_NUMBERS, id])
  if (have) return `${FEE_PREFIX}${have}`
  const n = FEE_START + Number(await kvCommand(['INCR', FEE_SEQ]))
  if (Number(await kvCommand(['HSETNX', FEE_NUMBERS, id, String(n)])) === 1) return `${FEE_PREFIX}${n}`
  return `${FEE_PREFIX}${await kvCommand(['HGET', FEE_NUMBERS, id])}`
}

// ---------- what goes on it ----------

function business(config) {
  const abn = config?.invoice?.abn ? abnLabel(config.invoice.abn) : ''
  return { ...BUSINESS, ...(abn ? { abn } : {}) }
}
function bankFor(config, reference) {
  if (!bankOffered(config)) return null
  const b = config.invoice
  return { accountName: b.accountName, bsb: `${b.bsb.slice(0, 3)}-${b.bsb.slice(3)}`, accountNumber: b.accountNumber, reference }
}
function totals(totalCents, paidCents) {
  const paid = Math.max(0, Math.min(paidCents, totalCents))
  return { totalCents, gstCents: gstOf(totalCents), paidCents: paid, balanceCents: Math.max(0, totalCents - paid) }
}

// A custom invoice. view: publicInvoice(inv, config) from _jfp-invoices.js.
// Each line: what staff typed (x quantity) and its amount.
export function docFromInvoice(inv, view, config, { payUrl = '' } = {}) {
  const self = !view.billTo.name && view.players.length === 1
  const lines = view.lines.map((l) => ({ title: `${l.description}${l.qty > 1 ? ` x ${l.qty}` : ''}`, details: [], amountCents: l.totalCents }))
  const t = totals(view.totalCents, view.paidCents)
  const status = view.status === 'void' ? 'void' : t.balanceCents === 0 ? 'paid' : view.draft ? 'draft' : 'open'
  return {
    number: view.number, issueDate: view.issueDate, dueDate: view.dueDate || '',
    from: business(config), to: { name: view.billTo.name || (self ? view.players[0] : '') || view.billTo.email, email: view.billTo.email, players: self ? [] : view.players },
    lines, ...t, status, notes: view.notes || '',
    payUrl: t.balanceCents > 0 && !['void', 'draft'].includes(status) ? payUrl : '',
    bank: t.balanceCents > 0 && status !== 'void' ? bankFor(config, view.bank?.reference || inv.id) : null,
  }
}

// A payment request: a term fee or payment link, a family invoice (places),
// session by session, a charge. Kept plain (Lee, 16 Oct 2026): each line is
// the player, their session day, time and location, the term, and the
// amount. No group or product names. groups: { [id]: group }.
export function docFromPayreq(q, config, { number, groups = {}, payUrl = '' }) {
  const term = config.term || ''
  const self = q.ownContact === true
  const lines = []
  const where = (g) => (g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : '')
  let total = 0, paidBefore = 0
  if (Array.isArray(q.places) && q.places.length) {
    for (const p of q.places) {
      const fee = Number(p.feeCents) || 0
      // A family place's label is already "Tuesday 4:15pm, Belrose HQ"; a sessions line says how many.
      lines.push({ title: p.name, details: [p.label, term].filter(Boolean), amountCents: fee })
      total += fee
      paidBefore += Number(p.paidCents) || 0
    }
  } else {
    const g = q.groupId ? groups[q.groupId] : null
    const names = (q.playerNames || []).length ? q.playerNames : ['Joner Football']
    // An even split per player (siblings on one link), whole dollars, the rest on the last.
    const n = names.length
    const base = Math.floor(q.amountCents / n / 100) * 100
    names.forEach((name, i) => {
      const cents = i === n - 1 ? q.amountCents - base * (n - 1) : base
      const details = q.charge ? [q.groupLabel || q.productLabel || 'Joner Football'] : [where(g), term]
      lines.push({ title: name, details: details.filter(Boolean), amountCents: cents })
      total += cents
    })
  }
  const paidNow = q.status === 'paid' ? (q.paidCents ?? q.amountCents) : 0
  const t = totals(total, paidBefore + paidNow)
  const status = q.status === 'cancelled' ? 'void' : t.balanceCents === 0 ? 'paid' : 'open'
  const toName = self ? (q.playerNames || [])[0] || q.parentName : q.parentName || (q.playerNames || []).join(' and ')
  return {
    number, issueDate: dayOf(q.createdAt), dueDate: q.expiresAt ? dayOf(q.expiresAt) : '',
    from: business(config), to: { name: toName || q.email, email: q.email, players: self ? [] : q.playerNames || [] },
    lines, ...t, status, notes: '',
    payUrl: t.balanceCents > 0 && status !== 'void' ? payUrl : '',
    bank: t.balanceCents > 0 && status !== 'void' ? bankFor(config, `${number} ${String((q.playerNames || [])[0] || '').split(/\s+/)[0]}`.trim().slice(0, 40)) : null,
  }
}

// ---------- drawing ----------

let lib = null
async function load() {
  if (lib) return lib
  const [pdfLib, fk, qrMod, assets] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit'), import('qrcode-generator'), import('./_jfp-invoice-assets.js')])
  const { rgb } = pdfLib
  lib = {
    ...pdfLib, fontkit: fk.default || fk, qrcode: qrMod.default || qrMod, assets,
    C: { black: rgb(0.043, 0.043, 0.047), ink: rgb(0.067, 0.094, 0.153), grey: rgb(0.42, 0.45, 0.5), line: rgb(0.86, 0.87, 0.89), red: rgb(0.886, 0.098, 0.169), white: rgb(1, 1, 1) },
  }
  return lib
}
const A4 = [595.28, 841.89]
const M = 48

// Helvetica speaks WinAnsi only: anything else (another script, an emoji)
// falls back to its plain letter, or a question mark, so a name can never
// stop the invoice being made.
const SWAP = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ' }
function safeFor(font) {
  const ok = new Set(font.getCharacterSet())
  return (s) => [...String(s ?? '')].map((ch) => {
    if (SWAP[ch]) return SWAP[ch]
    if (ok.has(ch.codePointAt(0))) return ch
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    return base && [...base].every((b) => ok.has(b.codePointAt(0))) ? base : '?'
  }).join('').replace(/[\r\n\t]+/g, ' ')
}
function wrap(text, font, size, width, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const out = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (font.widthOfTextAtSize(next, size) <= width) { cur = next; continue }
    if (cur) out.push(cur)
    cur = w
    while (font.widthOfTextAtSize(cur, size) > width && cur.length > 1) {
      let i = cur.length - 1
      while (i > 1 && font.widthOfTextAtSize(cur.slice(0, i), size) > width) i--
      out.push(cur.slice(0, i)); cur = cur.slice(i)
    }
  }
  if (cur) out.push(cur)
  if (out.length > maxLines) { const keep = out.slice(0, maxLines); let last = keep[maxLines - 1]; while (last.length > 1 && font.widthOfTextAtSize(`${last}...`, size) > width) last = last.slice(0, -1); keep[maxLines - 1] = `${last}...`; return keep }
  return out
}
function link({ PDFName, PDFString }, pdf, page, [x, y, w, h], url) {
  const annot = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } }))
  const annots = page.node.lookup(PDFName.of('Annots'))
  if (annots) annots.push(annot); else page.node.set(PDFName.of('Annots'), pdf.context.obj([annot]))
}
function qr({ qrcode, C }, page, url, x, y, size) {
  const code = qrcode(0, 'M')
  code.addData(url)
  code.make()
  const n = code.getModuleCount()
  const cell = size / n
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (code.isDark(r, c)) page.drawRectangle({ x: x + c * cell, y: y + size - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: C.black })
    }
  }
}

// The PDF, as bytes. A plain Joner Football invoice (Lee, 16 Oct 2026: keep
// it simple): logo and "Tax invoice", number and dates, from and to, one line
// per player, total with GST included, balance due, Pay online with a QR code.
export async function renderInvoicePdf(doc) {
  // A harness switch only, so tests can prove a failure never stops the email.
  if (process.env.JFP_TEST_CLOCK === '1' && globalThis.__jfpTestFaults?.has?.('pdf')) throw new Error('PDF test fault')
  const L = await load()
  const { PDFDocument, StandardFonts, fontkit, C } = L
  const { ANTON_TTF, LOGO_PNG } = L.assets
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setTitle(`Tax invoice ${doc.number}`)
  pdf.setAuthor('Joner Football')
  pdf.setCreator(SITE)
  pdf.setProducer(SITE)
  const anton = await pdf.embedFont(Buffer.from(ANTON_TTF, 'base64'), { subset: true })
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG, 'base64'))
  const s = safeFor(reg)
  const [W, H] = A4
  const pages = []
  const right = (page, text, xr, y, font, size, color = C.ink) => page.drawText(text, { x: xr - font.widthOfTextAtSize(text, size), y, size, font, color })
  const rule = (page, y, t = 0.75, color = C.line) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: t, color })

  const newPage = (first) => {
    const page = pdf.addPage(A4)
    pages.push(page)
    if (!first) { page.drawText(s(`Tax invoice ${doc.number} (continued)`), { x: M, y: H - M - 10, size: 10, font: bold, color: C.grey }); return { page, y: H - M - 40 } }
    // The logo is white, so it sits on a small black square.
    page.drawRectangle({ x: M, y: H - M - 56, width: 56, height: 56, color: C.black })
    page.drawImage(logo, { x: M + 3, y: H - M - 53, width: 50, height: 50 })
    page.drawText('JONER FOOTBALL', { x: M + 70, y: H - M - 26, size: 20, font: anton, color: C.ink })
    page.drawText(SITE, { x: M + 70, y: H - M - 44, size: 9.5, font: reg, color: C.grey })
    right(page, 'TAX INVOICE', W - M, H - M - 30, anton, 28, C.ink)
    return { page, y: H - M - 96 }
  }
  let { page, y } = newPage(true)

  // Number and dates.
  const meta = [['Invoice number', doc.number], ['Issue date', longDate(doc.issueDate)], ['Due date', doc.dueDate ? longDate(doc.dueDate) : 'On receipt']]
  const colW = (W - 2 * M) / 3
  meta.forEach(([k, v], i) => {
    page.drawText(k, { x: M + i * colW, y, size: 8.5, font: reg, color: C.grey })
    page.drawText(s(v), { x: M + i * colW, y: y - 15, size: 11, font: bold, color: C.ink })
  })
  y -= 34
  rule(page, y)
  y -= 22

  // From and bill to.
  const half = (W - 2 * M - 24) / 2
  const block = (x, label, rows) => {
    let yy = y
    page.drawText(label, { x, y: yy, size: 8.5, font: reg, color: C.grey })
    yy -= 15
    rows.forEach(([text, font, size, color]) => {
      for (const ln of wrap(s(text), font, size, half, 2)) { page.drawText(ln, { x, y: yy, size, font, color }); yy -= size + 4 }
    })
    return yy
  }
  const fromRows = [[doc.from.name, bold, 11, C.ink], [doc.from.address, reg, 9.5, C.ink], [doc.from.email, reg, 9.5, C.ink], ...(doc.from.abn ? [[`ABN ${doc.from.abn}`, reg, 9.5, C.ink]] : [])]
  const toRows = [[doc.to.name, bold, 11, C.ink], ...(doc.to.email && doc.to.email !== doc.to.name ? [[doc.to.email, reg, 9.5, C.ink]] : [])]
  y = Math.min(block(M, 'From', fromRows), block(M + half + 24, 'Bill to', toRows)) - 18

  // The lines: player, session and term, amount.
  const amtX = W - M
  const descW = W - 2 * M - 110
  const head = () => {
    page.drawText('Description', { x: M, y, size: 8.5, font: bold, color: C.grey })
    right(page, 'Amount', amtX, y, bold, 8.5, C.grey)
    y -= 8
    rule(page, y, 1.2, C.ink)
    y -= 18
  }
  head()
  doc.lines.forEach((l) => {
    const title = wrap(s(l.title), bold, 10.5, descW, 2)
    const details = l.details.flatMap((d) => wrap(s(d), reg, 9.5, descW, 2))
    const h = title.length * 14 + details.length * 13 + 14
    if (y - h < 250) { ({ page, y } = newPage(false)); head() }
    let yy = y
    title.forEach((t) => { page.drawText(t, { x: M, y: yy, size: 10.5, font: bold, color: C.ink }); yy -= 14 })
    details.forEach((d) => { page.drawText(d, { x: M, y: yy, size: 9.5, font: reg, color: C.grey }); yy -= 13 })
    right(page, s(formatAud(l.amountCents)), amtX, y, bold, 10.5, C.ink)
    y -= h
    rule(page, y + 10)
  })
  y -= 10

  // Totals.
  if (y < 250) ({ page, y } = newPage(false))
  const tx = W - M - 230
  const trow = (k, v, font = reg, size = 10, color = C.ink) => { page.drawText(k, { x: tx, y, size, font, color }); right(page, s(v), amtX, y, font, size, color); y -= size + 9 }
  const top = y
  trow('Total (AUD)', formatAud(doc.totalCents), bold, 11)
  trow('GST included in total', formatAud(doc.gstCents), reg, 9.5, C.grey)
  if (doc.paidCents > 0) trow('Amount paid', formatAud(doc.paidCents), reg, 10)
  y -= 2
  page.drawLine({ start: { x: tx, y: y + 6 }, end: { x: amtX, y: y + 6 }, thickness: 1.2, color: C.ink })
  y -= 14
  page.drawText('Balance due', { x: tx, y, size: 12, font: bold, color: C.ink })
  right(page, s(formatAud(doc.balanceCents)), amtX, y - 2, anton, 20, C.ink)
  const totalsBottom = y - 24
  y = top

  // Pay online and the QR code, on the left.
  if (doc.payUrl) {
    const qs = 76
    const bw = 150
    page.drawRectangle({ x: M, y: y - 26, width: bw, height: 32, color: C.red })
    const label = `PAY ${formatAud(doc.balanceCents)} ONLINE`
    const lsz = anton.widthOfTextAtSize(label, 14) > bw - 16 ? 11 : 14
    page.drawText(label, { x: M + (bw - anton.widthOfTextAtSize(label, lsz)) / 2, y: y - 15, size: lsz, font: anton, color: C.white })
    link(L, pdf, page, [M, y - 26, bw, 32], doc.payUrl)
    let yy = y - 42
    for (const ln of ['Press the button, or scan the code', 'with your phone camera.']) { page.drawText(ln, { x: M, y: yy, size: 8.5, font: reg, color: C.grey }); yy -= 11 }
    for (const ln of wrap(s(doc.payUrl.replace(/^https?:\/\//, '')), reg, 7.5, bw, 2)) { page.drawText(ln, { x: M, y: yy, size: 7.5, font: reg, color: C.grey }); yy -= 9.5 }
    qr(L, page, doc.payUrl, M + bw + 14, y - qs + 6, qs)
    link(L, pdf, page, [M + bw + 14, y - qs + 6, qs, qs], doc.payUrl)
    y = Math.min(yy, y - qs) - 10
  }
  if (doc.bank) {
    y -= 6
    page.drawText('Pay by bank transfer', { x: M, y, size: 9.5, font: bold, color: C.ink })
    y -= 14
    for (const [k, v] of [['Account name', doc.bank.accountName], ['BSB', doc.bank.bsb], ['Account number', doc.bank.accountNumber], ['Reference', doc.bank.reference]]) {
      page.drawText(k, { x: M, y, size: 9, font: reg, color: C.grey })
      page.drawText(s(v), { x: M + 90, y, size: 9.5, font: bold, color: C.ink })
      y -= 13
    }
  }
  y = Math.min(y, totalsBottom) - 8
  if (doc.notes) {
    for (const ln of wrap(s(doc.notes), reg, 9.5, W - 2 * M, 6)) { page.drawText(ln, { x: M, y, size: 9.5, font: reg, color: C.ink }); y -= 13 }
  }

  // Footer on every page.
  pages.forEach((p, i) => {
    rule(p, 64)
    p.drawText(`Questions? ${CONTACTS.map(([n, e]) => `${n}: ${e}`).join('   |   ')}`, { x: M, y: 46, size: 9, font: reg, color: C.ink })
    p.drawText(SITE, { x: M, y: 32, size: 9, font: reg, color: C.grey })
    link(L, pdf, p, [M, 28, reg.widthOfTextAtSize(SITE, 9), 12], `https://${SITE}`)
    if (pages.length > 1) right(p, `Page ${i + 1} of ${pages.length}`, W - M, 32, reg, 9, C.grey)
  })
  return pdf.save()
}

export const pdfName = (number) => `Joner-Football-${String(number).replace(/[^A-Za-z0-9-]/g, '')}.pdf`

// A Brevo attachment ({ name, content: base64 }) for a document.
export async function pdfAttachment(doc) {
  const bytes = await renderInvoicePdf(doc)
  return { name: pdfName(doc.number), content: Buffer.from(bytes).toString('base64') }
}
