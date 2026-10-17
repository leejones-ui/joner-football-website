// The player report as a PDF (Lee, 18 Oct 2026), drawn the same way as the
// card on /coach-report/: red top bar, logo and "Individual Player Report /
// Term N", the black player strip with Overall, 16 ratings in two columns,
// Coach's Feedback, Next Term, Coach and Report Date, and the two QR codes.
//
// One renderer for every copy: the coach's "Save to my device", the email
// attachment and the family's download are the same file from the same
// record, so what the coach saw is exactly what the family gets.
import { REPORT_ATTRS, REPORT_SCALE, QR_DEFAULTS, overallOf } from './_jfp-reports.js'

let lib = null
async function load() {
  if (lib) return lib
  const [pdfLib, fk, qrMod, assets] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit'), import('qrcode-generator'), import('./_jfp-invoice-assets.js')])
  const { rgb } = pdfLib
  lib = {
    ...pdfLib, fontkit: fk.default || fk, qrcode: qrMod.default || qrMod, assets,
    C: {
      black: rgb(0, 0, 0), ink: rgb(0.1, 0.1, 0.1), body: rgb(0.2, 0.2, 0.2), grey: rgb(0.55, 0.55, 0.55), light: rgb(0.7, 0.7, 0.7),
      line: rgb(0.9, 0.9, 0.9), stripe: rgb(0.969, 0.969, 0.969), box: rgb(0.973, 0.973, 0.973), red: rgb(0.8, 0, 0), white: rgb(1, 1, 1),
      pink: rgb(1, 0.957, 0.957), pinkLine: rgb(0.953, 0.816, 0.816), emptyBar: rgb(0.93, 0.93, 0.93), emptyNum: rgb(0.72, 0.72, 0.72), strip: rgb(0.75, 0.75, 0.75),
    },
  }
  return lib
}

const W = 595.28
const H = 841.89
const PAD = 21 // 28px on the 794px card

// Helvetica speaks WinAnsi only: anything else falls back to its plain letter,
// or a question mark, so no name or emoji can stop the report being made.
const SWAP = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', '•': '-' }
function safeFor(font) {
  const ok = new Set(font.getCharacterSet())
  return (s) => [...String(s ?? '')].map((ch) => {
    if (SWAP[ch]) return SWAP[ch]
    if (ch === '\n') return ch
    if (ok.has(ch.codePointAt(0))) return ch
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    return base && [...base].every((b) => ok.has(b.codePointAt(0))) ? base : ''
  }).join('').replace(/\t/g, ' ')
}
// Lines that fit a width, keeping the coach's own line breaks.
function wrapLines(text, font, size, width) {
  const out = []
  for (const para of String(text || '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(''); continue }
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
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}
// Letter-spaced capitals, as the card does with CSS letter-spacing.
function spaced(page, text, { x, y, size, font, color, track = 1.2, right = false }) {
  const chars = [...text]
  const width = chars.reduce((t, ch) => t + font.widthOfTextAtSize(ch, size) + track, 0) - track
  let cx = right ? x - width : x
  for (const ch of chars) { page.drawText(ch, { x: cx, y, size, font, color }); cx += font.widthOfTextAtSize(ch, size) + track }
  return width
}
function drawQr({ qrcode, C }, page, url, x, y, size) {
  const code = qrcode(0, 'M')
  code.addData(url)
  code.make()
  const n = code.getModuleCount()
  const cell = size / n
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) page.drawRectangle({ x: x + c * cell, y: y + size - (r + 1) * cell, width: cell + 0.04, height: cell + 0.04, color: C.black })
}
function prettyDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function reportFilename(rec) {
  const name = String(rec.player || 'Player').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Player'
  return `JFP_Report_${name}_Term${rec.termNo}_${rec.year}.pdf`
}

// The PDF, as bytes.
export async function renderReportPdf(rec) {
  if (process.env.JFP_TEST_CLOCK === '1' && globalThis.__jfpTestFaults?.has?.('report-pdf')) throw new Error('Report PDF test fault')
  const L = await load()
  const { PDFDocument, StandardFonts, fontkit, C } = L
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setTitle(`${rec.player}: Term ${rec.termNo} ${rec.year} player report`)
  pdf.setAuthor('Joner Football')
  pdf.setCreator('jonerfootball.com')
  pdf.setProducer('jonerfootball.com')
  const anton = await pdf.embedFont(Buffer.from(L.assets.ANTON_TTF, 'base64'), { subset: true })
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await pdf.embedPng(Buffer.from(L.assets.LOGO_PNG, 'base64'))
  const s = safeFor(reg)
  const sa = safeFor(anton)
  const right = (page, text, xr, y, font, size, color) => page.drawText(text, { x: xr - font.widthOfTextAtSize(text, size), y, size, font, color })

  const page = pdf.addPage([W, H])
  // Red top bar.
  page.drawRectangle({ x: 0, y: H - 4, width: W, height: 4, color: C.red })

  // Header: logo and brand left, title right.
  let y = H - 4 - PAD
  page.drawRectangle({ x: PAD, y: y - 33, width: 33, height: 33, color: C.black })
  page.drawImage(logo, { x: PAD - 2, y: y - 35, width: 37, height: 37 })
  spaced(page, 'JONER FOOTBALL', { x: PAD + 42, y: y - 17, size: 15, font: anton, color: C.black, track: 1.1 })
  spaced(page, 'PERFORMANCE', { x: PAD + 42, y: y - 29, size: 6.5, font: bold, color: C.red, track: 1.6 })
  spaced(page, 'INDIVIDUAL PLAYER REPORT', { x: W - PAD, y: y - 9, size: 8.5, font: anton, color: C.light, track: 1.2, right: true })
  spaced(page, `TERM ${sa(rec.termNo)}`, { x: W - PAD, y: y - 30, size: 19, font: anton, color: C.black, track: 0.6, right: true })
  right(page, s(`${rec.year} · ${rec.location || 'Sydney, AUS'}`), W - PAD, y - 42, reg, 7.5, C.grey)
  y -= 54

  // Player strip.
  const stripH = 45
  page.drawRectangle({ x: 0, y: y - stripH, width: W, height: stripH, color: C.black })
  const overall = overallOf(rec)
  let rx = W - PAD
  if (overall != null) {
    const val = overall.toFixed(1)
    const vw = anton.widthOfTextAtSize(val, 17) + reg.widthOfTextAtSize('/5', 7.5) + 1
    page.drawText(val, { x: rx - vw, y: y - 33, size: 17, font: anton, color: C.white })
    page.drawText('/5', { x: rx - reg.widthOfTextAtSize('/5', 7.5), y: y - 33, size: 7.5, font: reg, color: C.strip })
    spaced(page, 'OVERALL', { x: rx, y: y - 15, size: 5.5, font: bold, color: C.strip, track: 1.3, right: true })
    rx -= Math.max(vw, 40) + 12
    page.drawLine({ start: { x: rx, y: y - 9 }, end: { x: rx, y: y - stripH + 9 }, thickness: 0.6, color: rgbGrey(L) })
    rx -= 12
  }
  const prog = s(String(rec.program || '').toUpperCase())
  const progW = spaced(page, prog, { x: rx, y: y - 26, size: 7.5, font: reg, color: C.strip, track: 1.2, right: true })
  // The name, as big as fits beside the programme.
  const nameRoom = rx - progW - 18 - PAD
  const name = sa(String(rec.player || '').toUpperCase())
  let ns = 19
  while (ns > 11 && anton.widthOfTextAtSize(name, ns) + name.length * 0.8 > nameRoom) ns -= 0.5
  spaced(page, name, { x: PAD, y: y - 30, size: ns, font: anton, color: C.white, track: 0.8 })
  y -= stripH + 18

  // Ratings: two columns of eight.
  const colGap = 15
  const colW = (W - 2 * PAD - colGap) / 2
  spaced(page, 'PROFESSIONALISM & CHARACTER', { x: PAD, y, size: 7, font: anton, color: C.grey, track: 1.4 })
  spaced(page, 'TECHNICAL & TACTICAL', { x: PAD + colW + colGap, y, size: 7, font: anton, color: C.grey, track: 1.4 })
  y -= 10
  const rowH = 20
  const barW = 15.5
  const barH = 8
  const barGap = 2.2
  const drawCol = (attrs, x0) => {
    attrs.forEach((a, i) => {
      const top = y - i * rowH
      if (i % 2 === 0) page.drawRectangle({ x: x0, y: top - rowH, width: colW, height: rowH, color: C.stripe })
      page.drawLine({ start: { x: x0, y: top - rowH }, end: { x: x0 + colW, y: top - rowH }, thickness: 0.4, color: C.line })
      page.drawText(s(a.l), { x: x0 + 7, y: top - rowH + 7, size: 8.2, font: reg, color: C.ink })
      const v = rec.ratings?.[a.k] || 0
      const bx0 = x0 + colW - 7 - (5 * barW + 4 * barGap)
      for (let n = 1; n <= 5; n++) {
        const bx = bx0 + (n - 1) * (barW + barGap)
        const by = top - rowH / 2 - barH / 2
        const on = v >= n
        page.drawRectangle({ x: bx, y: by, width: barW, height: barH, color: on ? C.red : C.emptyBar, borderColor: on ? C.red : C.line, borderWidth: 0.4 })
        const t = String(n)
        page.drawText(t, { x: bx + barW / 2 - (on ? bold : reg).widthOfTextAtSize(t, 5.5) / 2, y: by + 2.3, size: 5.5, font: on ? bold : reg, color: on ? C.white : C.emptyNum })
      }
    })
  }
  drawCol(REPORT_ATTRS.slice(0, 8), PAD)
  drawCol(REPORT_ATTRS.slice(8, 16), PAD + colW + colGap)
  y -= 8 * rowH + 11
  const scale = REPORT_SCALE.map((l, i) => `${i + 1} = ${l}`).join('   ·   ')
  right(page, s(scale), W - PAD, y, reg, 6, C.light)
  y -= 9
  page.drawLine({ start: { x: PAD, y }, end: { x: W - PAD, y }, thickness: 0.6, color: C.line })
  y -= 15

  // What sits at the bottom of the page, so the feedback box fills the rest.
  const footerH = 68
  const sigH = 34
  const boxW = W - 2 * PAD
  const reminderLines = rec.reminder ? wrapLines(s(rec.reminder), reg, 8.2, boxW - 20) : []
  const reminderH = reminderLines.length ? 24 + reminderLines.length * 11 : 0
  const bottomOfFeedback = footerH + sigH + 14 + (reminderH ? reminderH + 10 : 0)

  spaced(page, "COACH'S FEEDBACK", { x: PAD, y, size: 7, font: anton, color: C.grey, track: 1.4 })
  y -= 9
  const fbText = rec.feedback ? s(rec.feedback) : 'No feedback provided.'
  let fbSize = 8.8
  let lines = wrapLines(fbText, reg, fbSize, boxW - 30)
  const room = y - bottomOfFeedback - 22
  while (fbSize > 7.4 && lines.length * fbSize * 1.55 > room) { fbSize -= 0.2; lines = wrapLines(fbText, reg, fbSize, boxW - 30) }
  const lh = fbSize * 1.55
  const fits = Math.max(1, Math.floor(room / lh))
  const here = lines.slice(0, fits)
  const rest = lines.slice(fits)
  const boxTop = y
  const boxBottom = bottomOfFeedback
  page.drawRectangle({ x: PAD, y: boxBottom, width: boxW, height: boxTop - boxBottom, color: C.box })
  page.drawRectangle({ x: PAD, y: boxBottom, width: 2.3, height: boxTop - boxBottom, color: C.red })
  let ly = boxTop - 13 - fbSize
  for (const ln of here) { if (ln) page.drawText(ln, { x: PAD + 15, y: ly, size: fbSize, font: rec.feedback ? reg : reg, color: rec.feedback ? C.body : C.grey }); ly -= lh }
  if (rest.length) right(page, 'Continued on the next page', W - PAD - 10, boxBottom + 7, reg, 6.5, C.grey)

  // Next term.
  let by = bottomOfFeedback - 10
  if (reminderH) {
    page.drawRectangle({ x: PAD, y: by - reminderH, width: boxW, height: reminderH, color: C.pink, borderColor: C.pinkLine, borderWidth: 0.6 })
    spaced(page, 'NEXT TERM', { x: PAD + 10, y: by - 14, size: 7.5, font: anton, color: C.red, track: 1.2 })
    let ry = by - 27
    for (const ln of reminderLines) { if (ln) page.drawText(ln, { x: PAD + 10, y: ry, size: 8.2, font: reg, color: C.body }); ry -= 11 }
    by -= reminderH + 10
  }

  // Coach and report date.
  const sigY = footerH + 14
  const half = (boxW - 24) / 2
  const sign = (x, label, value) => {
    spaced(page, label, { x, y: sigY + 22, size: 5.8, font: bold, color: C.light, track: 1.3 })
    page.drawText(s(value || ' '), { x, y: sigY + 8, size: 8.5, font: reg, color: C.ink })
    page.drawLine({ start: { x, y: sigY + 2 }, end: { x: x + half, y: sigY + 2 }, thickness: 0.6, color: C.line })
  }
  sign(PAD, 'COACH', rec.coachName)
  sign(PAD + half + 24, 'REPORT DATE', prettyDate(rec.reportDate))

  // Footer: QR codes left, brand right.
  page.drawLine({ start: { x: 0, y: footerH }, end: { x: W, y: footerH }, thickness: 0.6, color: C.line })
  const q = 40
  let qx = PAD + 4
  const qy = (footerH - q) / 2
  for (const k of ['list', 'app']) {
    const d = QR_DEFAULTS[k]
    drawQr(L, page, d.url, qx, qy, q)
    spaced(page, d.label.toUpperCase(), { x: qx + q + 10, y: qy + q / 2 + 2, size: 6.8, font: anton, color: C.black, track: 1 })
    page.drawText(d.sub, { x: qx + q + 10, y: qy + q / 2 - 9, size: 5.8, font: reg, color: C.grey })
    qx += q + 10 + 118
  }
  spaced(page, '@JonerFootball', { x: W - PAD, y: footerH / 2 + 3, size: 7, font: bold, color: C.red, track: 0.8, right: true })
  spaced(page, 'jonerfootball.com', { x: W - PAD, y: footerH / 2 - 8, size: 7, font: reg, color: C.grey, track: 0.8, right: true })

  // A long report runs on to a second page.
  if (rest.length) {
    const p2 = pdf.addPage([W, H])
    p2.drawRectangle({ x: 0, y: H - 4, width: W, height: 4, color: C.red })
    let y2 = H - 4 - PAD - 8
    spaced(p2, sa(String(rec.player || '').toUpperCase()), { x: PAD, y: y2, size: 13, font: anton, color: C.black, track: 0.6 })
    right(p2, s(`Term ${rec.termNo} ${rec.year} player report, continued`), W - PAD, y2 + 2, reg, 7.5, C.grey)
    y2 -= 20
    spaced(p2, "COACH'S FEEDBACK (CONTINUED)", { x: PAD, y: y2, size: 7, font: anton, color: C.grey, track: 1.4 })
    y2 -= 9
    const h2 = rest.length * lh + 26
    p2.drawRectangle({ x: PAD, y: y2 - h2, width: boxW, height: h2, color: C.box })
    p2.drawRectangle({ x: PAD, y: y2 - h2, width: 2.3, height: h2, color: C.red })
    let l2 = y2 - 13 - fbSize
    for (const ln of rest) { if (ln) p2.drawText(ln, { x: PAD + 15, y: l2, size: fbSize, font: reg, color: C.body }); l2 -= lh }
    spaced(p2, 'jonerfootball.com', { x: W - PAD, y: PAD, size: 7, font: reg, color: C.grey, track: 0.8, right: true })
  }
  return pdf.save()
}
function rgbGrey(L) { return L.rgb(0.25, 0.25, 0.25) }

export async function reportPdfBase64(rec) {
  return Buffer.from(await renderReportPdf(rec)).toString('base64')
}
