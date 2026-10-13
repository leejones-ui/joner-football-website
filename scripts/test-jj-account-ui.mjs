// The family account page (My account) in jsdom, stage 2: a JFP-only family
// sees exactly what they saw before; a family with a Joners Juniors child
// sees them on the same login with the class, dates, paid status, the
// waiver and Pay; next term choices. Every name and email is invented.
//   node scripts/test-jj-account-ui.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = fileURLToPath(new URL('../', import.meta.url))
const bundled = (await build({ entryPoints: [path.join(root, 'src/scripts/jfp-account.js')], bundle: true, write: false, format: 'iife', target: 'es2022', logLevel: 'silent' })).outputFiles[0].text
const astro = fs.readFileSync(path.join(root, 'src/pages/jfp-account.astro'), 'utf8')
const markup = astro.slice(astro.indexOf('<div class="jfp" id="jfp-account">'), astro.indexOf('<JfpFooter />')).replace('<JfpHeader active="account" />', '<button type="button" id="sign-out" hidden>Sign out</button>') + '</div>'

let passed = 0
const test = async (n, fn) => { await fn(); passed += 1; console.log(`ok - ${n}`) }

async function openAccount(overview, onPost = () => null, search = '') {
  const errors = [], posts = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => { if (!/Not implemented: navigation/.test(e.message)) errors.push(e) })
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, { url: `http://localhost/jfp-account/${search}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  const w = dom.window
  w.scrollTo = () => {}
  w.confirm = () => true
  w.CSS = w.CSS || { escape: (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) }
  w.Element.prototype.scrollIntoView = () => {}
  w.addEventListener('unhandledrejection', (e) => errors.push(e.reason))
  const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data })
  w.fetch = async (url, init = {}) => {
    if (String(url).startsWith('/api/jfp-auth')) return reply({ success: true, user: { email: overview.email } })
    if (String(url).startsWith('/api/jfp-confirm')) return reply(onPost({ action: '__confirm', url: String(url) }) || { success: true, status: 'pending' })
    const body = init.body ? JSON.parse(init.body) : {}
    posts.push(body)
    const custom = onPost(body)
    if (custom) { const { status, ...json } = custom; return reply(json, typeof status === 'number' ? status : 200) }
    if (body.action === 'overview') return reply({ success: true, ...structuredClone(overview) })
    return reply({ success: true })
  }
  w.eval(bundled)
  const d = w.document
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 4)) }
  await settle()
  const $ = (s) => d.querySelector(s)
  const text = (s) => ($(s)?.textContent || '').replace(/\s+/g, ' ').trim()
  const click = async (s) => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error(`Nothing to click: ${s}`); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle() }
  return { w, d, $, text, click, settle, posts, errors }
}

const enrol = { rowId: 'recJFP00000000001', day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', address: '', maps: '', coach: 'Coach Sam', status: 'Confirmed', dates: ['Tue 13 Oct'], firstDate: 'Tue 13 Oct', payment: { state: 'paid', label: 'Paid' }, sessions: [], contacts: [], cancelled: [] }
const BASE = {
  email: 'pat@example.com', parentName: 'Pat Parent', nextTerm: null, term: 'Term 4 2026', waiverVersion: 'v1', kitUrl: '', kitPriceLabel: 'A$60',
  players: [{ key: 'cy senior', name: 'Cy Senior', age: 9, needsDob: false, waiver: { onFile: true }, placeNoSession: false, enrolments: [enrol] }],
  todo: [], reasons: [{ key: 'sick', label: 'Sick' }], noteMax: 300, paid: [], requests: [], bookings: [], juniors: null,
}
const jkid = (rowId, name, x = {}) => ({ key: `jj:${rowId}`, rowId, name, age: 4, needsDob: false, waiver: { onFile: false }, className: 'Saturday 9:15am to 10:00am', location: 'Joner Football HQ, Belrose', term: 'Term 4 2026', dates: ['17 Oct 2026', '24 Oct 2026'], firstDate: '17 Oct 2026', nextDate: '17 Oct 2026', payment: { state: 'owing', label: 'A$220 to pay', canPay: true }, next: null, ...x })
const JUNIORS = {
  parentName: 'Pat Parent', term: 'Term 4 2026', termShort: 'Term 4', classLabel: 'Saturday 9:15am to 10:00am', datesLabel: '17 October 2026 to 19 December 2026', location: 'Joner Football HQ, Belrose', ageLabel: 'Ages 3 to early primary', waiverVersion: 'Juniors v1',
  children: [
    jkid('recJJ000000000001', 'Ada Junior', { payment: { state: 'due', label: 'A$220 to pay', payreqId: 'JJPAY-1-AAAAAA' } }),
    jkid('recJJ000000000002', 'Bo Junior', { waiver: { onFile: true }, next: { status: 'invited', fullLabel: 'A$230', holdLabel: 'A$50', afterHoldLabel: '', openPayreqId: '' } }),
  ],
  todo: [{ id: 'JJPAY-1-AAAAAA', juniors: true, amountLabel: 'A$220', players: ['Ada Junior'], what: 'Term 4: Saturday 9:15am to 10:00am', needsWaiver: true, places: [] }],
  nextTerm: { name: 'Term 1 2027', holdLabel: 'A$50', fullLabel: 'A$230' }, paid: [],
}

await test('a JFP family with no Juniors child: no Juniors block, the page is as before', async () => {
  const p = await openAccount(BASE)
  assert.equal(p.$('#jj-wrap').hidden, true)
  assert.match(p.text('#home'), /Cy Senior/)
  assert.equal(p.$('#todo-wrap').hidden, true)
  assert.equal(p.text('#jj-home'), '', 'nothing rendered in it')
  assert.ok(!p.text('#todo').includes('Joners Juniors') && !p.text('#players').includes('Joners Juniors'))
  assert.deepEqual(p.errors, [])
})

await test('JFP and Juniors children on one login: the class, dates, paid status, waiver and the payment checklist', async () => {
  const p = await openAccount({ ...BASE, juniors: structuredClone(JUNIORS) }, () => null, '?pay=JJPAY-1-AAAAAA')
  assert.equal(p.$('#jj-wrap').hidden, false)
  assert.match(p.text('#home'), /Cy Senior/, 'the JFP player is still there')
  assert.match(p.text('#jj-home'), /Saturday 9:15am to 10:00am · Joner Football HQ, Belrose · Term 4 2026/)
  assert.match(p.text('[data-jjchild="recJJ000000000001"]'), /Ada Junior.*Next class 17 Oct 2026.*A\$220 to pay/)
  assert.ok(p.$('[data-jjchild="recJJ000000000001"] [data-waiver-player="jj:recJJ000000000001"]'), 'sign the one family waiver')
  assert.equal(p.$('#todo-wrap').hidden, false)
  const card = p.$('[data-todo="JJPAY-1-AAAAAA"]')
  assert.match(card.textContent, /Joners Juniors/)
  assert.equal(card.querySelector('[data-jjpay]').disabled, true, 'the waiver comes first')
  assert.match(card.getAttribute('style'), /border-color/, 'opened from the email: this one stands out')
  // The waiver sheet takes the Juniors child, with the JFP and Juniors heading.
  await p.click('[data-waiver-player="jj:recJJ000000000001"]')
  assert.match(p.d.body.textContent, /JFP waiver and agreement, Term 4 2026, JFP and Joners Juniors/)
  // My sessions lists the Juniors dates too.
  assert.match(p.text('#players'), /Ada Junior Joners Juniors.*17 Oct 2026.*24 Oct 2026/)
  assert.deepEqual(p.errors, [])
})

await test('Pay on a child with no link asks the server for the amount, then goes to Stripe; next term choices start a payment', async () => {
  const kids = structuredClone(JUNIORS)
  kids.children[0] = jkid('recJJ000000000001', 'Ada Junior', { waiver: { onFile: true } })
  kids.todo = []
  const p = await openAccount({ ...BASE, juniors: kids }, (b) => {
    if (b.action === 'jjRequestPay') return { success: true, payreqId: 'JJPAY-9-ZZZZZZ' }
    if (b.action === 'jjNextChoice') return { success: true, payreqId: 'JJPAY-8-YYYYYY' }
    if (b.action === 'jjPay') return { success: true, url: 'http://localhost/mock-stripe/?cs=cs_test_x' }
    return null
  })
  await p.click('[data-jjask="recJJ000000000001"]')
  assert.deepEqual(p.posts.filter((x) => x.action !== 'overview').map((x) => [x.action, x.rowIds?.[0] || x.payreqId]), [['jjRequestPay', 'recJJ000000000001'], ['jjPay', 'JJPAY-9-ZZZZZZ']])
  assert.match(p.text('[data-jjchild="recJJ000000000002"]'), /Term 1 2027.*Keep the place: pay A\$230.*Hold the place: A\$50.*Not returning/)
  await p.click('[data-jjnext="hold"][data-row="recJJ000000000002"]')
  const after = p.posts.filter((x) => x.action !== 'overview').slice(2)
  assert.deepEqual(after.map((x) => [x.action, x.choice || x.payreqId]), [['jjNextChoice', 'hold'], ['jjPay', 'JJPAY-8-YYYYYY']])
  assert.deepEqual(p.errors, [])
})

await test('a family with only a Juniors child: no "No sessions booked yet", just their child', async () => {
  const p = await openAccount({ ...BASE, players: [], parentName: 'Pat Parent', juniors: structuredClone(JUNIORS) })
  assert.ok(!/No sessions booked yet/.test(p.text('#app')))
  assert.equal(p.$('#jj-wrap').hidden, false)
  assert.match(p.text('#players'), /Ada Junior/)
  assert.deepEqual(p.errors, [])
})

await test('back from Stripe: the Juniors payment is confirmed in plain words', async () => {
  const p = await openAccount({ ...BASE, juniors: structuredClone(JUNIORS) }, (b) => (b.action === '__confirm' ? { success: true, status: 'paid', kind: 'juniors', payment: { players: ['Ada Junior'], term: 'Term 4 2026', next: null } } : null), '?paid=1&session_id=cs_test_abc')
  assert.match(p.text('#banner'), /Payment received\. Thank you\. Ada Junior's Joners Juniors place for Term 4 2026 is paid\. We have emailed you a receipt/)
  assert.deepEqual(p.errors, [])
})

console.log(`\n${passed} family account Juniors checks passed`)
