// The PDF tax invoice on fee emails (Lee, 16 Oct 2026), end to end against
// the local harness: fake Airtable, fake Stripe, captured Brevo payloads.
//   npm run build && HOLIDAY_LOCAL_PORT=4795 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-invoice-pdf-flow.mjs 4795                          (another)
// Checks: the PDF is attached to the fee emails with the right totals, no bank
// section while bank transfer is switched off, a stable FEE number per link,
// a PDF failure never stops the email (staff get a warning), the Settings
// switch, and who may download which invoice. Every name and amount is invented.
import assert from 'node:assert/strict'
import zlib from 'node:zlib'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client() {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const getJson = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => getJson('/__emails')
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
const fault = (what, on) => fetch(`${B}/__fail?what=${what}&on=${on ? 1 : 0}`)
const aud = (c) => `A$${c % 100 ? (c / 100).toFixed(2) : c / 100}`
async function signIn(c, email, audience) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}

// The words on a PDF page: pdf-lib writes each run as <hex> Tj in a deflated
// content stream; Helvetica runs are WinAnsi bytes. (The Anton headings are
// glyph ids and are not read here.)
function pdfText(base64) {
  const b = Buffer.from(base64, 'base64')
  assert.equal(b.subarray(0, 5).toString(), '%PDF-', 'a PDF')
  const s = b.toString('latin1')
  const out = []
  const re = /stream\r?\n/g
  let m
  while ((m = re.exec(s))) {
    const end = s.indexOf('endstream', m.index)
    try { out.push(zlib.inflateSync(b.subarray(m.index + m[0].length, end)).toString('latin1')) } catch {}
  }
  return [...out.join('\n').matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((x) => Buffer.from(x[1], 'hex').toString('latin1')).join('\n')
}
// "Total (AUD)" then its amount, and so on.
const after = (text, label) => { const l = text.split('\n'); const i = l.indexOf(label); return i >= 0 ? l[i + 1] : undefined }
const newMail = async (from, to, re) => (await emails()).slice(from).filter((e) => e.to.includes(to) && (!re || re.test(e.subject))).at(-1)
const pdfOf = (mail) => (mail?.attachments || []).find((a) => /\.pdf$/.test(a.name))

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const players = (await ok('playersList')).players
const single = (p) => p.email && p.holdsPlace && players.filter((x) => x.email === p.email).length === 1
const famRow = players.find((p) => single(p) && p.waiver?.onFile)
const otherRow = players.find((p) => single(p) && p.email !== famRow?.email)
assert.ok(famRow && otherRow, 'the harness has two families')
const BANK = { accountName: 'Example Football Trust', bsb: '062-000', accountNumber: '12345678', reference: 'INV-<n> <player>', abn: '12345678901' }
await ok('saveSettings', { config: { invoice: { ...BANK, bankEnabled: false, attachPdf: true } } })
let link = null

await test('a payment link email carries the PDF tax invoice: right totals, GST, the ABN, a pay link, and no bank section while bank transfer is off', async () => {
  const e0 = (await emails()).length
  const r = await ok('sendPaymentLink', { rowIds: [famRow.rowId], amountCents: 42000, sendEmail: true, replace: true })
  link = r.payreq
  assert.deepEqual([r.emailed, r.pdfWarning], [true, ''])
  const mail = await newMail(e0, famRow.email)
  const pdf = pdfOf(mail)
  assert.ok(pdf, 'a PDF is attached in the Brevo payload')
  assert.match(pdf.name, /^Joner-Football-FEE-\d{4,}\.pdf$/)
  assert.match(mail.html, /tax invoice is attached as a PDF/)
  const t = pdfText(pdf.base64)
  assert.equal(after(t, 'Total (AUD)'), 'A$420')
  assert.equal(after(t, 'GST included in total'), 'A$38.18')
  assert.equal(after(t, 'Amount paid'), undefined, 'nothing paid: no paid line')
  assert.ok(t.includes('ABN 12 345 678 901'), 'the ABN from Settings')
  assert.ok(t.includes(famRow.name), 'the player')
  assert.ok(t.includes('Press the button') && t.replace(/\n/g, '').includes(`pay=${link.id}`), 'the pay link')
  assert.ok(!t.includes('Pay by bank transfer') && !t.includes('062-000') && !t.includes('12345678\n'), 'no bank details while bank transfer is off')
  assert.ok(!/—|\x97/.test(t), 'no em dashes')
  assert.ok(t.includes('ligia@jonerfootball.com') && t.includes('jonerfootball.com'), 'the footer contacts')
})

await test('the same link always prints the same FEE number; staff download it from the open link', async () => {
  const a = await ok('invoicePdf', { payreqId: link.id })
  const b = await ok('invoicePdf', { payreqId: link.id })
  assert.equal(a.filename, b.filename)
  const mailed = (await emails()).filter((e) => e.to.includes(famRow.email) && pdfOf(e)).at(-1)
  assert.equal(pdfOf(mailed).name, a.filename)
  assert.equal(await kv(['HGET', 'jfp:fee-invoice-no', link.id]), a.number.replace('FEE-', ''))
})

await test('with bank transfer switched on (and all three fields saved) the PDF shows the bank details; off again, gone', async () => {
  await ok('saveSettings', { config: { invoice: { ...BANK, bankEnabled: true } } })
  const on = pdfText((await ok('invoicePdf', { payreqId: link.id })).pdf)
  assert.ok(on.includes('Pay by bank transfer') && on.includes('062-000') && on.includes('Example Football Trust'))
  await ok('saveSettings', { config: { invoice: { ...BANK, bankEnabled: false } } })
  assert.ok(!pdfText((await ok('invoicePdf', { payreqId: link.id })).pdf).includes('062-000'))
})

await test('a family invoice email: one line per place, total, what is already paid and the balance', async () => {
  const e0 = (await emails()).length
  const r = await ok('familyInvoice', { places: [{ rowId: otherRow.rowId, feeCents: 60000 }], email: otherRow.email, sendEmail: true, replace: true })
  assert.ok(r.payreq && r.emailed)
  const paidBefore = 60000 - r.payreq.amountCents
  const t = pdfText(pdfOf(await newMail(e0, otherRow.email)).base64)
  assert.equal(after(t, 'Total (AUD)'), 'A$600')
  assert.equal(after(t, 'Amount paid'), paidBefore ? aud(paidBefore) : undefined)
  assert.equal(after(t, 'GST included in total'), aud(Math.round(60000 / 11)))
  assert.ok(t.includes(otherRow.name))
})

await test('a PDF that cannot be made never stops the email: it goes without it and staff are told', async () => {
  await fault('pdf', true)
  try {
    const e0 = (await emails()).length
    const r = await ok('sendPaymentLink', { rowIds: [otherRow.rowId], amountCents: 15000, sendEmail: true, replace: true })
    assert.equal(r.emailed, true)
    assert.match(r.pdfWarning, /without it/)
    const mail = await newMail(e0, otherRow.email)
    assert.ok(mail, 'the email went')
    assert.equal(pdfOf(mail), undefined, 'no attachment')
    assert.ok(!/attached as a PDF/.test(mail.html), 'and it does not say there is one')
  } finally { await fault('pdf', false) }
})

await test('Settings: "Attach a PDF invoice to fee emails" off sends no PDF and no warning', async () => {
  await ok('saveSettings', { config: { invoice: { ...BANK, bankEnabled: false, attachPdf: false } } })
  try {
    const e0 = (await emails()).length
    const r = await ok('sendPaymentLink', { rowIds: [otherRow.rowId], amountCents: 16000, sendEmail: true, replace: true })
    assert.deepEqual([r.emailed, r.pdfWarning], [true, ''])
    assert.equal(pdfOf(await newMail(e0, otherRow.email)), undefined)
  } finally { await ok('saveSettings', { config: { invoice: { ...BANK, bankEnabled: false, attachPdf: true } } }) }
})

await test('who can download: the family their own, never another family\'s; a coach none', async () => {
  const fam = client(), other = client(), sam = client()
  await signIn(fam, famRow.email, 'parent')
  await signIn(other, otherRow.email, 'parent')
  await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  const mine = await fam.call('/api/jfp-account', { action: 'invoicePdf', payreqId: link.id })
  assert.equal(mine.status, 200, JSON.stringify(mine.data))
  assert.ok(pdfText(mine.data.pdf).includes(famRow.name))
  assert.equal((await other.call('/api/jfp-account', { action: 'invoicePdf', payreqId: link.id })).status, 404, 'another family')
  assert.equal((await sam.call('/api/jfp-portal-data', { action: 'invoicePdf', payreqId: link.id })).status, 403, 'a coach')
  assert.equal((await sam.call('/api/jfp-portal-data', { action: 'invoicePdf', id: 'INV-1001' })).status, 403, 'a coach, by invoice number')
  assert.equal((await client().call('/api/jfp-account', { action: 'invoicePdf', payreqId: link.id })).status, 401, 'nobody signed in')
})

await test('a custom invoice email carries its own INV PDF, also from its page; paid it reads paid', async () => {
  const d = await ok('invoiceSave', { programme: 'other', playerName: 'Robin Sample', email: 'robin.sample@example.com', parentName: 'Robin Parent', lines: [{ description: 'Video analysis', qty: 2, unitCents: 7500 }], dueDate: '2026-11-30' })
  const e0 = (await emails()).length
  const sent = await ok('invoiceSend', { id: d.invoice.id, sendEmail: true })
  assert.deepEqual([sent.emailed, sent.pdfWarning], [true, ''])
  const pdf = pdfOf(await newMail(e0, 'robin.sample@example.com', /^Invoice INV-/))
  assert.equal(pdf.name, `Joner-Football-${d.invoice.id}.pdf`)
  const t = pdfText(pdf.base64)
  assert.deepEqual([after(t, 'Total (AUD)'), after(t, 'GST included in total'), after(t, 'Amount paid')], ['A$150', 'A$13.64', undefined])
  assert.ok(t.includes('Video analysis x 2') && t.includes('Robin Parent') && !t.includes('062-000'))
  const token = new URL(sent.invoice.url).searchParams.get('i')
  const page = await client().call('/api/jfp-invoice', { action: 'pdf', token })
  assert.deepEqual([page.status, page.data.filename], [200, pdf.name])
  await ok('invoicePay', { id: d.invoice.id, method: 'cash', amountCents: 15000, date: '2026-10-16' })
  const paid = pdfText((await ok('invoicePdf', { id: d.invoice.id })).pdf)
  assert.equal(after(paid, 'Amount paid'), 'A$150')
  assert.ok(!paid.includes('Press the button'), 'paid: no Pay online')
})

console.log(`${passed} invoice PDF checks passed`)
