// JFP round 2 (Lee, 14 Oct 2026): any run in a quote (Rest of term, Whole
// term, any N up to what is left), "Upcoming sessions" instead of "Nothing
// owing" for session by session players, paid marks on My sessions, no coach
// names for families, the phone bottom bar with More, and adding brothers and
// sisters in one go. Units, then the pages in jsdom.
// Every name, email and amount here is invented.
//   node scripts/test-jfp-round2.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM, VirtualConsole } from 'jsdom'
import { cleanQuote, quoteOptions, restOption } from '../api/_jfp-quote.js'
import { termRun } from '../api/_jfp-quote-staff.js'
import { owedItems } from '../api/_jfp-account-pay.js'
import { sessionMarks } from '../api/jfp-account.js'
import { familyWelcome, accountInvite } from '../api/_jfp-email.js'
import { normaliseConfig, PRO_TYPE, SESSION_TYPE } from '../api/_jfp-store.js'
import { openPortal } from './jfp-portal-dom.mjs'

let passed = 0
const test = async (n, fn) => { await fn(); passed += 1; console.log(`ok - ${n}`) }

const config = normaliseConfig({ term: 'Term 4 2026', termStart: '2026-10-13', weeks: 10 })
const group = { id: 'g-wed', day: 'Wednesday', time: '7:30am', location: 'North Turramurra', durationMin: 60 }
const before = Date.parse('2026-10-13T12:00:00+11:00') // the day before the first Wednesday
const midTerm = Date.parse('2026-11-05T12:00:00+11:00') // four Wednesdays gone

// ---------- 1. a run of any length ----------

await test('quote runs: up to the sessions left (new tiers only), the whole term before it starts', () => {
  assert.equal(cleanQuote({ perCents: 10000, tiers: [{ n: 10, cents: 9000 }] }, { maxN: 10 }).ok, true, 'the whole term, before it starts')
  assert.match(cleanQuote({ perCents: 10000, tiers: [{ n: 8, cents: 9000 }] }, { maxN: 6 }).error, /Only 6 sessions are left this term/)
  assert.equal(cleanQuote({ perCents: 10000, tiers: [{ n: 8, cents: 9000 }, { n: 4, cents: 9500 }] }, { maxN: 6, fresh: [{ n: 4 }] }).ok, true, 'a saved 8 that no longer fits does not block a new 4')
  assert.equal(cleanQuote({ perCents: 10000, tiers: [{ n: 12, cents: 9000 }] }).ok, true, 'no limit known: 2 to 20 as before')
  const whole = termRun(config, {}, group, before)
  assert.deepEqual([whole.whole, whole.left], [10, 10], 'before the term: rest of term = whole term = 10')
  const mid = termRun(config, {}, group, midTerm)
  assert.deepEqual([mid.whole, mid.left], [10, 6], 'mid term: 6 left of 10')
  const late = termRun(config, { day: 'Wednesday', time: '7:30am', notes: '[STARTS:2026-11-18]' }, null, before)
  assert.equal(late.left, 5, "a player who starts in week 6 has only their own dates (weeks 6 to 10)")
  const none = termRun(config, {}, null, midTerm)
  assert.equal(none.whole, 10); assert.ok(none.left >= 6 && none.left <= 7, 'no group: the most left on any day')
})

await test('the rest of the term: every date left at the price per session, or staff\'s tier when it is exactly that run', () => {
  const dates = ['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18'].map((iso) => ({ iso, label: iso }))
  assert.deepEqual(restOption({ perCents: 8000, dates }), { key: 'rest', n: 6, perCents: 8000, totalCents: 48000, saveCents: 0, rest: true, title: 'Pay for the rest of the term, 6 sessions, A$480', dates })
  assert.equal(restOption({ perCents: 8000, dates: dates.slice(0, 1) }), null, 'one session left: that is just the next session')
  const o = quoteOptions({ perCents: 10000, tiers: [{ n: 3, cents: 9500 }, { n: 6, cents: 9000 }], dates })
  assert.deepEqual(o.map((x) => [x.key, x.totalCents, Boolean(x.rest)]), [['one', 10000, false], ['commit:3', 28500, false], ['commit:6', 54000, true]], 'the 6-run is the rest of the term, at its lower price; no second rest option')
})

const sessRow = (notes = '', x = {}) => ({ id: 'recSES00000000001', player: 'Sol Session', email: 'sol.family@example.com', emails: ['sol.family@example.com'], holdsPlace: true, groupId: group.id, day: 'Wednesday', time: '7:30am', location: 'North Turramurra', paymentType: SESSION_TYPE, feeAud: 0, paidAud: 0, paymentStatus: 'Unpaid', notes, perSessionCents: Number((notes.match(/\[PERSESSION:(\d+)\]/) || [])[1]) || null, ...x })
const fam = (row) => [{ key: 'sol session', name: 'Sol Session', waiver: { onFile: true }, term4: [row] }]

await test('My account knows how many sessions are left and what they come to, with a rest-of-term option, quote or not', () => {
  const [a] = owedItems({ config, players: fam(sessRow('[PERSESSION:8000]')), payreqs: [], byGroup: { [group.id]: group }, nowMs: midTerm })
  assert.deepEqual([a.kind, a.left, a.leftCents, a.leftLabel, a.rest.key, a.rest.n, a.rest.totalLabel], ['prepay', 6, 48000, 'A$480', 'rest', 6, 'A$480'])
  assert.equal(a.quote, undefined)
  const [b] = owedItems({ config, players: fam(sessRow('[PERSESSION:10000] [QUOTE:6x9000]', { paymentType: PRO_TYPE })), payreqs: [], byGroup: { [group.id]: group }, nowMs: midTerm })
  assert.deepEqual([b.rest.key, b.rest.commit, b.rest.totalCents], ['commit:6', true, 54000], 'a tier covers the rest of the term: that is the rest option')
})

await test('My sessions: committed and paid-ahead dates are Paid, an open link is started, an undated prepaid count marks the next dates', () => {
  const row = sessRow('[PREPAID:3] [COVERED:2026-11-11]')
  const payreqs = [
    { status: 'paid', prepay: { rowId: row.id, dates: ['2026-11-18'] } },
    { status: 'open', prepay: { rowId: row.id, dates: ['2026-11-25'] } },
    { status: 'paid', prepay: { rowId: 'recOTHER000000001', dates: ['2026-12-02'] } },
  ]
  const m = sessionMarks(row, payreqs, ['2026-11-11', '2026-11-18', '2026-11-25', '2026-12-02', '2026-12-09'])
  assert.deepEqual(m, { paidDates: ['2026-11-11', '2026-11-18', '2026-12-02'], openDates: ['2026-11-25'] }, 'two dated, one more prepaid with no date: the next free one (not the open one, not another row\'s)')
  assert.deepEqual(sessionMarks(sessRow(''), [], ['2026-11-11']), { paidDates: [], openDates: [] })
})

// ---------- 4. no coach names to families ----------

await test('family emails: the family add email and the account invite name no coach; time and place only', () => {
  const { subject, html } = familyWelcome({ to: 'robin.family@example.com', parentName: 'Robin Family', config: { ...config, kitUrl: 'https://kit.example.com' }, url: 'https://x.test/jfp-account/?pay=PAY-1', amountCents: 150000, children: [
    { name: 'Ari Family', where: 'Tuesday 4:20pm, Belrose HQ', pay: 'Term, small group, A$850', link: true, waiver: true },
    { name: 'Bea Family', where: 'Thursday 4:20pm, Belrose HQ', pay: 'Sibling rate, second child, A$650', link: true, waiver: true },
  ] })
  assert.equal(subject, 'Ari and Bea: your Term 4 2026 places')
  assert.match(html, /Hi Robin, Ari and Bea are booked in/)
  assert.match(html, /Ari Family.*Tuesday 4:20pm, Belrose HQ.*A\$850.*Bea Family.*Thursday 4:20pm, Belrose HQ.*A\$650.*Total to pay.*A\$1,?500/s)
  assert.match(html, /Sign the waiver for each child: Ari and Bea.*Pay <b>A\$1,?500<\/b> in one payment for Ari and Bea.*Check each child's details/s)
  assert.doesNotMatch(html, /Coach/)
  const inv = accountInvite({ parentName: 'Robin Family', players: [{ name: 'Ari Family', group: 'Tuesday 4:20pm, Belrose HQ' }], config, signInUrl: 'https://x.test/', money: false, email: 'robin.family@example.com', needsWaiver: true })
  assert.doesNotMatch(inv.html, /coach,|Coach [A-Z]/)
})

// ---------- the family account in jsdom ----------

const root = fileURLToPath(new URL('../', import.meta.url))
const bundled = (await build({ entryPoints: [path.join(root, 'src/scripts/jfp-account.js')], bundle: true, write: false, format: 'iife', target: 'es2022', logLevel: 'silent' })).outputFiles[0].text
const astro = fs.readFileSync(path.join(root, 'src/pages/jfp-account.astro'), 'utf8')
const markup = astro.slice(astro.indexOf('<div class="jfp ja" id="jfp-account"'), astro.lastIndexOf('</BaseLayout>'))

async function openAccount(overview, onPost = () => null) {
  const errors = [], posts = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => { if (!/Not implemented: navigation/.test(e.message)) errors.push(e) })
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, { url: 'http://localhost/jfp-account/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  const w = dom.window
  w.scrollTo = () => {}
  w.requestAnimationFrame = (f) => setTimeout(f, 0)
  w.confirm = () => true
  w.CSS = w.CSS || { escape: (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) }
  w.Element.prototype.scrollIntoView = () => {}
  w.addEventListener('unhandledrejection', (e) => errors.push(e.reason))
  const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data })
  w.fetch = async (url, init = {}) => {
    if (String(url).startsWith('/api/jfp-auth')) return reply({ success: true, user: { email: overview.email } })
    const body = init.body ? JSON.parse(init.body) : {}
    posts.push(body)
    const custom = onPost(body)
    if (custom) { const { status, ...json } = custom; return reply(json, typeof status === 'number' ? status : 200) }
    if (body.action === 'overview') return reply({ success: true, ...structuredClone(overview) })
    if (body.action === 'profiles') return reply({ success: true, players: [] })
    if (body.action === 'fees') return reply({ success: true, fees: { term: 'Term 4 2026', places: [], totals: [], paidCents: 0, paidLabel: 'A$0', records: [] } })
    if (body.action === 'payOwed') return reply({ success: false, error: 'Not in this test.' }, 400)
    return reply({ success: true })
  }
  w.eval(bundled)
  const d = w.document
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 4)) }
  await settle()
  const $ = (s) => d.querySelector(s)
  const text = (s) => ($(s)?.textContent || '').replace(/\s+/g, ' ').trim()
  const click = async (s) => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error(`Nothing to click: ${s}`); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle() }
  return { w, d, $, text, click, settle, posts, errors, close: () => w.close() }
}

const lbl = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00Z`)).replace(',', '')
const DAY = 86400000
const future = [1, 2, 3].map((n) => new Date(Date.now() + n * 7 * DAY).toISOString().slice(0, 10))
const pastIso = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10)
const sessEnrol = {
  rowId: 'recSES00000000001', day: 'Wednesday', time: '7:30am', location: 'North Turramurra', address: '', maps: '', status: 'Confirmed', durationMin: 60,
  dates: [pastIso, ...future].map(lbl), firstDate: lbl(pastIso), payment: { state: 'sessions', label: 'Session by session' },
  sessions: future.map((iso, i) => ({ iso, label: lbl(iso), startMs: Date.now() + (i + 1) * 7 * DAY, cancelled: '' })), contacts: [{ name: 'Coach', phone: '0400 000 111', tel: '0400000111' }], cancelled: [],
  sessionPay: true, isoDates: [pastIso, ...future], paidDates: [pastIso, future[0]], openDates: [future[1]],
}
const owedFor = (x = {}) => ({ rowId: sessEnrol.rowId, playerKey: 'sol session', player: 'Sol Session', group: 'Wednesday 7:30am, North Turramurra', needsWaiver: false, kind: 'prepay', title: 'Pay for your sessions', perCents: 8000, perLabel: 'A$80', max: 2, left: 2, leftCents: 16000, leftLabel: 'A$160', dates: future.slice(1).map((iso) => ({ iso, label: lbl(iso) })), rest: { key: 'rest', n: 2, totalCents: 16000, totalLabel: 'A$160', perCents: 8000, commit: false }, ...x })
const SESS = {
  email: 'sol.family@example.com', parentName: 'Sky Session', nextTerm: null, term: 'Term 4 2026', waiverVersion: 'v1', kitUrl: '', kitPriceLabel: 'A$60', keep: { name: 'Term 1 2027', players: [] },
  players: [{ key: 'sol session', name: 'Sol Session', age: 12, needsDob: false, waiver: { onFile: true }, placeNoSession: false, enrolments: [sessEnrol] }],
  todo: [], owed: [owedFor()], reasons: [{ key: 'sick', label: 'Sick' }], noteMax: 300, paid: [], requests: [], bookings: [], juniors: null,
}

await test('Fees for a session by session player: "Upcoming sessions: 2 left this term at A$80", each way to pay ahead as a card, never "Nothing owing"', async () => {
  const p = await openAccount(SESS)
  await p.click('#ja-tabs [data-go="fees"]')
  const fees = p.text('[data-pane="fees"]')
  assert.match(fees, /Pay ahead and save/)
  assert.match(fees, /Upcoming sessions: 2 left this term at A\$80/)
  assert.match(fees, /Sessions you do not pay ahead are billed after they happen\./)
  assert.match(p.text('[data-pane="fees"] [data-opt="rest"]'), /Rest of term\s*A\$160\s*2 sessions at A\$80.*Pay A\$160/)
  assert.doesNotMatch(fees, /Nothing owing|all paid up/)
  // One button per way to pay; the page's own copy is the one sent (Home has one too).
  await p.click('[data-pane="fees"] [data-fees-owed] [data-owed-option="one"]')
  await p.click('[data-pane="fees"] [data-owed-option="rest"]')
  const pays = p.posts.filter((b) => b.action === 'payOwed')
  assert.deepEqual(pays.map((b) => [b.rowId, b.sessions ?? null, b.option ?? null]), [[sessEnrol.rowId, null, 'one'], [sessEnrol.rowId, null, 'rest']])
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('a quoted player: the options on Fees include the rest of the term; Home shows the same cards, fewer of them', async () => {
  const quote = { options: [
    { key: 'one', n: 1, perCents: 10000, totalCents: 10000, saveCents: 0, dates: [{ iso: future[1], label: lbl(future[1]) }] },
    { key: 'rest', n: 2, perCents: 10000, totalCents: 20000, saveCents: 0, rest: true, dates: future.slice(1).map((iso) => ({ iso, label: lbl(iso) })) },
  ], commitment: null }
  const p = await openAccount({ ...SESS, owed: [owedFor({ quote, perCents: 10000, perLabel: 'A$100', leftLabel: 'A$200', rest: { key: 'rest', n: 2, totalCents: 20000, totalLabel: 'A$200', perCents: 10000 } })] })
  await p.click('#ja-tabs [data-go="fees"]')
  assert.match(p.text('[data-pane="fees"] [data-fees-owed]'), /Next session\s*A\$100.*Rest of term\s*A\$200.*Pay A\$200/)
  // Redesign (17 Oct 2026): Home's "to sort" line opens the same cards in a sheet.
  await p.click('#ja-tabs [data-go="home"]')
  await p.click('[data-todo-open]')
  assert.ok(p.$('.j-sheet [data-todo-owed] [data-owed-option="one"]'), 'the same cards from Home')
  p.d.querySelector('.j-sheet .j-close')?.click(); await p.settle()
  await p.click('[data-pane="fees"] [data-fees-owed] [data-owed-option="rest"]')
  assert.equal(p.posts.find((b) => b.action === 'payOwed').option, 'rest')
  p.close()
})

await test('"Nothing owing" only when nothing is billed and no session is left to pay for', async () => {
  const termOnly = { ...SESS, owed: [], players: [{ ...SESS.players[0], enrolments: [{ ...sessEnrol, sessionPay: false, payment: { state: 'paid', label: 'Paid' } }] }] }
  const p = await openAccount(termOnly)
  await p.click('#ja-tabs [data-go="fees"]')
  assert.match(p.text('[data-pane="fees"]'), /Nothing owing\s*You are all paid up/)
  p.close()
})

await test('My sessions: Paid / Payment started / Not paid yet on each date, and Pay for sessions opens Fees at the options; no coach name', async () => {
  const p = await openAccount(SESS)
  await p.click('#ja-tabs [data-go="sessions"]')
  // Redesign (17 Oct 2026): past dates fold into "N done"; Show all lists every week.
  assert.match(p.text('[data-pane="sessions"] [data-enrol]'), /1 done this term/)
  await p.click('[data-pane="sessions"] [data-expand]')
  const card = p.$('[data-pane="sessions"] [data-enrol]')
  const rows = [...card.querySelectorAll('.ja-date')].map((li) => li.textContent.replace(/\s+/g, ' ').trim())
  assert.match(rows[0], /Paid/, 'a past date paid ahead'); assert.match(rows[0], /Done/)
  assert.match(rows[1], /Paid/); assert.match(rows[2], /Payment started/); assert.match(rows[3], /Not paid yet/)
  assert.match(p.text('[data-pane="sessions"]'), /Not paid yet: billed after the session, or pay ahead now/)
  await p.click('[data-go-pay="recSES00000000001"]')
  assert.equal(p.$('[data-pane="fees"]').hidden, false, 'Fees is open')
  assert.ok(p.$('[data-pane="fees"] [data-fees-owed="recSES00000000001"]'))
  // No coach's name anywhere a family looks (the overview no longer sends one).
  for (const pane of ['home', 'sessions', 'cancel', 'keep']) { await p.click(`[data-go="${pane}"]`); assert.doesNotMatch(p.text(`[data-pane="${pane}"]`), /Coach [A-Z][a-z]+ [A-Z]/, pane) }
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('phones: Home, Sessions, Fees, Family and More (Lee, 17 Oct 2026); the badge sits on the page it counts; More holds My family and Explore Joner', async () => {
  const p = await openAccount({ ...SESS, players: [{ ...SESS.players[0], waiver: { onFile: false } }] })
  assert.deepEqual([...p.d.querySelectorAll('#ja-tabs .ja-tab')].map((b) => b.textContent.replace(/[^A-Za-z ]/g, '').trim()), ['Home', 'Sessions', 'Fees', 'Family', 'More'])
  assert.equal(p.text('#ja-tabs [data-go="family"] .badge'), '1', 'the waiver to sign counts on Family')
  assert.equal(p.$('#ja-tabs [data-more] .badge'), null, 'no badge on More')
  await p.click('#ja-tabs [data-go="family"]')
  assert.ok(p.$('[data-pane="family"] [data-waiver-player]'), 'Family has the Sign button')
  await p.click('#ja-tabs [data-more]')
  const groups = [...p.d.querySelectorAll('.j-sheet .ja-more-group')].map((g) => g.querySelector('.ja-nav-label').textContent)
  assert.deepEqual(groups, ['Manage', 'Explore Joner'])
  const rows = [...p.d.querySelectorAll('.j-sheet .ja-mrow b')].map((t) => t.textContent)
  for (const t of ['Player information', "Can't make it", 'Keep my spot', 'Videos', 'The JF App', 'Waivers', 'Book extra sessions', 'Game analysis', 'Contact us']) assert.ok(rows.includes(t), t)
  for (const t of ['Home', 'Sessions', 'Fees', 'Family']) assert.ok(!rows.includes(t), `${t} is on the bar, not in More`)
  await p.click('.j-sheet [data-go="videos"]')
  assert.equal(p.$('[data-pane="videos"]').hidden, false)
  assert.equal(p.$('.j-sheet'), null, 'the sheet closes')
  assert.equal(p.$('#ja-tabs [data-more]').getAttribute('aria-current'), 'page', 'More is lit while a More page is open')
  // The name button opens the account sheet: light or dark, and sign out.
  await p.click('#ja-me')
  assert.ok(p.$('.j-sheet [data-theme-pick="dark"]') && p.$('.j-sheet #ja-signout2'))
  await p.click('.j-sheet [data-theme-pick="dark"]')
  assert.equal(p.$('#jfp-account').getAttribute('data-theme'), 'dark')
  assert.deepEqual(p.errors, [])
  p.close()
})

// ---------- the staff portal in jsdom ----------

const PRICING = {
  success: true, weeks: 10, today: '2026-10-13', prices: { group: 85000, sibling: 65000, trial: 8500 },
  products: [{ key: 'group', label: 'Term, small group', type: 'JFP 10 weeks', proRata: true, perPlaces: 1, cents: 85000 }, { key: 'sibling', label: 'Sibling rate, second child', type: 'Sibling / 2 sessions per week', proRata: true, perPlaces: 1, cents: 65000 }, { key: 'trial', label: 'Trial session', type: 'JFP Trial', proRata: false, perPlaces: 1, cents: 8500 }],
  datesByDay: { Tuesday: Array.from({ length: 10 }, (_, i) => ({ iso: `2026-${i < 3 ? '10' : '11'}-${String(i < 3 ? 13 + i * 7 : (i - 3) * 7 + 3).padStart(2, '0')}`, label: `Tue ${i}`, past: i < 3 })), Thursday: Array.from({ length: 10 }, (_, i) => ({ iso: `2026-11-${String(i + 1).padStart(2, '0')}`, label: `Thu ${i}`, past: i < 3 })) },
  priceList: [], programmes: [{ id: 'jfp', label: 'JFP' }], holidayPeriods: [], defaultQuote: null,
  runs: { byGroup: { g1: { whole: 10, left: 7 }, g2: { whole: 10, left: 7 } }, noGroup: { whole: 10, left: 7 } },
}
const G = (id, day) => ({ id, day, time: '4:20pm', location: 'Belrose HQ', locationId: 'belrose', locationName: 'Belrose HQ', coachId: 'sam', coachName: 'Sam', capacity: 8, mode: 'direct', product: 'group', players: [], taken: 0, holds: 0, placesLeft: 8, confirmed: 0, sortTime: '16:20', period: 'pm', pendingRequests: 0, extraCoachNames: [] })
const BOARD = { success: true, term: 'Term 4 2026', at: Date.now(), totals: { players: 0, dashboard: 0, awaiting: 0, placesLeft: 16, pendingRequests: 0, waivers: 0 }, groups: [G('g1', 'Tuesday'), G('g2', 'Thursday')], unassigned: [], coaches: [], locations: [{ id: 'belrose', name: 'Belrose HQ' }] }
const PLAYERS = { success: true, players: [], groups: [], coaches: [], locations: [] }
const famReply = (b) => ({ success: true, familyId: 'FAM-1', rows: b.children.map((c, i) => ({ rowId: `recKID0000000000${i}`, name: c.player.name, where: c.groupId === 'g2' ? 'Thursday 4:20pm, Belrose HQ' : 'Tuesday 4:20pm, Belrose HQ', payment: c.payment, amountLabel: c.payment === 'link' ? `A$${c.amountCents / 100}` : '' })), payreq: { id: 'PAY-FAM', url: 'http://localhost/jfp-account/?pay=PAY-FAM', amountLabel: 'A$1500' }, emailed: true, emailTo: b.parent.email })
const staffAnswers = (b) => (b.action === 'board' ? structuredClone(BOARD) : b.action === 'pricing' ? structuredClone(PRICING) : b.action === 'playersList' ? structuredClone(PLAYERS) : b.action === 'addFamily' ? famReply(b) : null)
const set = (p, sel, v) => { const el = p.$(sel); el.value = v; el.dispatchEvent(new p.w.Event('input', { bubbles: true })); el.dispatchEvent(new p.w.Event('change', { bubbles: true })) }

await test('quote editor: Rest of term (7) and Whole term (10, off mid term) buttons; any run up to 7', async () => {
  const p = await openPortal({ hash: '#board', onPost: staffAnswers })
  await p.click('#b-add'); await p.click('#pg-go')
  set(p, '#ap-pay', 'pro')
  const runs = [...p.d.querySelectorAll('#ap-q-runs [data-run]')]
  assert.deepEqual(runs.map((b) => [b.textContent, b.disabled]), [['Rest of term (7 sessions)', false], ['Whole term (10 sessions)', true]])
  assert.match(p.text('#ap-q-runnote'), /Any run from 2 to 7 sessions \(7 left this term\)/)
  set(p, '#ap-per', '100')
  await p.click('#ap-q-runs [data-run="7"]')
  const row = p.$('#ap-q-rows [data-tier]')
  assert.equal(row.querySelector('[data-n]').value, '7', 'a row for the rest of the term, price to type')
  set(p, '#ap-q-rows [data-c]', '90')
  assert.match(p.text('#ap-q-sum'), /7 in a row: A\$630/)
  set(p, '#ap-q-rows [data-n]', '8')
  assert.match(p.text('#ap-q-err'), /Only 7 sessions are left this term/)
  p.close()
})

await test('Timetable Add: "+ Add another child (same family)" adds a brother or sister with their own group and price; one addFamily request', async () => {
  const p = await openPortal({ hash: '#board', onPost: staffAnswers })
  await p.click('#b-add'); await p.click('#pg-go')
  set(p, '#ap-name', 'Ari Family'); set(p, '#ap-parent', 'Robin Family'); set(p, '#ap-email', 'robin.family@example.com'); set(p, '#ap-mobile', '0400 999 000')
  assert.equal(p.$('#ap-kids-bar').hidden, false)
  await p.click('#ap-kid-add')
  const kid = p.$('#ap-kids [data-child-block]')
  assert.match(kid.textContent, /Child 2/)
  const px = kid.dataset.childBlock
  set(p, `#${px}-name`, 'Bea Family'); set(p, `#${px}-dob`, '2016-02-02'); set(p, `#${px}-group`, 'g2')
  set(p, `#${px}-price-prod`, 'sibling')
  assert.equal(p.text('#ap-go'), 'Add 2 children and email the parent')
  await p.click('#ap-go')
  const fam = p.posts.find((b) => b.action === 'addFamily')
  assert.ok(fam, JSON.stringify(p.posts.map((b) => b.action)))
  assert.deepEqual(fam.parent, { name: 'Robin Family', email: 'robin.family@example.com', mobile: '0400 999 000' })
  assert.deepEqual(fam.children.map((c) => [c.player.name, c.groupId, c.payment, c.product]), [['Ari Family', 'g1', 'link', 'group'], ['Bea Family', 'g2', 'link', 'sibling']])
  assert.ok(fam.children[1].amountCents > 0 && fam.children[1].amountCents < fam.children[0].amountCents, 'each child keeps their own price')
  assert.equal(fam.sendEmail, true)
  assert.ok(!p.posts.some((b) => b.action === 'addPlayer'), 'not added one by one')
  assert.match(p.text('#jp-modal'), /2 children added.*Ari Family.*Bea Family.*A\$1500 for everyone/)
  // Own contact (an adult): no family to add, the button hides.
  p.close()
})

await test('Players tab: "+ Add a family" with no group needed, two children ready, the parent first', async () => {
  const p = await openPortal({ hash: '#families', onPost: staffAnswers })
  await p.click('#ps-more')
  await p.click('#jp-menu [data-i="family"]')
  assert.equal(p.d.querySelectorAll('#fa-kids [data-child-block]').length, 2)
  const [a, b] = [...p.d.querySelectorAll('#fa-kids [data-child-block]')].map((x) => x.dataset.childBlock)
  assert.equal(p.$(`#${a}-group`).value, '', 'no group yet by default')
  assert.equal(p.$(`#${a}-pay option[value="trial"]`).disabled, true, 'a trial needs a group')
  set(p, '#fa-pname', 'Robin Family'); set(p, '#fa-pemail', 'robin.family@example.com')
  set(p, `#${a}-name`, 'Ari Family'); set(p, `#${a}-pay`, 'sessions'); set(p, `#${a}-per`, '80')
  set(p, `#${b}-name`, 'Bea Family'); set(p, `#${b}-pay`, 'none')
  await p.click('#fa-go')
  const fam = p.posts.find((x) => x.action === 'addFamily')
  assert.deepEqual(fam.children.map((c) => [c.player.name, c.groupId, c.payment, c.perSessionCents ?? null]), [['Ari Family', '', 'sessions', 8000], ['Bea Family', '', 'none', null]])
  assert.deepEqual(p.errors, [])
  p.close()
})

// ---------- item 8: open accounts ----------

await test('open account with no session: "You\'re not booked into a session yet", Book a session, Add a player makes a profile only', async () => {
  const OPEN = { ...SESS, email: 'ola.open@example.com', parentName: '', owed: [], todo: [], bookUrl: '/jfp-booking/', players: [] }
  const p = await openAccount(OPEN, (b) => (b.action === 'addPlayer' ? { success: true, key: 'kip open', profile: {} } : b.action === 'profiles' ? { success: true, players: [], options: { levels: ['NPL'], positions: [], feet: [], playingUp: [] } } : null))
  const home = p.text('[data-pane="home"]')
  assert.match(home, /You're not booked\s*into a session yet/)
  assert.equal(p.$('[data-no-session] a.ja-btn-red').getAttribute('href'), '/jfp-booking/')
  assert.match(p.$('[data-no-session] a.ja-btn-red').textContent, /Book a session/)
  await p.click('[data-no-session] [data-add-player]')
  const set2 = (sel, v) => { const el = p.d.querySelector(sel); el.value = v; el.dispatchEvent(new p.w.Event('input', { bubbles: true })) }
  set2('#ap-name', 'Kip Open'); set2('#ap-dob', '2015-05-05'); set2('#ap-club', 'Test Valley FC'); set2('#ap-pname', 'Ola Open'); set2('#ap-pmob', '0400 123 456')
  await p.click('#ap-save')
  const add = p.posts.find((b) => b.action === 'addPlayer')
  assert.deepEqual([add.name, add.dob, add.self, add.values.club, add.values.parentName], ['Kip Open', '2015-05-05', false, 'Test Valley FC', 'Ola Open'])
  // A player with no session: listed, waiver to sign, still "not booked".
  const p2 = await openAccount({ ...OPEN, players: [{ key: 'kip open', name: 'Kip Open', age: 11, waiver: { onFile: false }, enrolments: [], noSession: true }] })
  assert.match(p2.text('[data-pane="home"]'), /Kip Open\s*Not booked into a session yet/)
  assert.ok(p2.$('[data-pane="home"] [data-waiver-player="kip open"]'), 'the waiver can be signed with no session')
  assert.deepEqual([...p.errors, ...p2.errors], [])
  p.close(); p2.close()
})

await test('staff: "Accounts with no session" lists profiles with no row; Add to a group opens the normal add, filled in', async () => {
  const ACCTS = [{ profileId: 'recPROF0000000001', key: 'kip open|ola.open@example.com', name: 'Kip Open', email: 'ola.open@example.com', emails: ['ola.open@example.com'], self: false, dob: '2015-05-05', age: 11, club: 'Test Valley FC', level: 'NPL', positions: ['Winger'], parentName: 'Ola Open', mobile: '0400 123 456', updatedAt: '2026-10-14T01:00:00Z' }]
  const p = await openPortal({ hash: '#families', onPost: (b) => (b.action === 'playersList' ? { ...structuredClone(PLAYERS), accounts: ACCTS } : staffAnswers(b)) })
  assert.match(p.text('#pl-place'), /Accounts with no session \(1\)/)
  set(p, '#pl-place', 'acct')
  await p.settle()
  assert.match(p.text('#pl-accts'), /Kip Open \(11\).*Ola Open.*ola\.open@example\.com.*Test Valley FC · NPL · Winger/)
  await p.click('[data-acct-add="0"]')
  await p.click('#ag-go')
  assert.deepEqual(['#ap-name', '#ap-dob', '#ap-parent', '#ap-email', '#ap-mobile'].map((x) => p.$(x).value), ['Kip Open', '2015-05-05', 'Ola Open', 'ola.open@example.com', '0400 123 456'])
  assert.match(p.text('#ap-results'), /From Kip Open's account/)
  assert.deepEqual(p.errors, [])
  p.close()
})

console.log(`\n${passed} round 2 checks passed`)
