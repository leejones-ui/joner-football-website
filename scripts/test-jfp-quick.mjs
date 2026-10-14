// Money > Prices and quick payment links (Lee, 13 Oct 2026): the pure rules,
// the money views they land in, and the pages in jsdom. Every name, email
// and amount here is invented.
import assert from 'node:assert/strict'
import { openPortal } from './jfp-portal-dom.mjs'
import { cleanPrice, cleanCustomPrices, PROGRAMMES } from '../api/_jfp-prices.js'
import { builtinPrices, allPrices, priceById, quickLinkInput, quickStatus, quickCheckoutBody, publicQuick, quickToCheck, quickOpen, quickHolidayPeriods, QUICK_ID, quickUrl } from '../api/_jfp-quick.js'
import { normaliseConfig, DEFAULT_PRICES } from '../api/_jfp-store.js'
import { classifySession } from '../api/_jfp-stripe.js'
import { payEffectsFor, enrolled, PAY_EFFECTS, QUICK_EFFECTS } from '../api/_jfp-finalise.js'
import { holidayMoneyView } from '../api/_holiday-money.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

const NOW = Date.parse('2026-10-13T01:00:00Z')
const config = normaliseConfig({ customPrices: [
  { id: 'PR-1-AAAAAA', name: 'Holiday camp day', cents: 6500, programme: 'holiday', perSession: true, description: 'Full day' },
  { id: 'PR-2-BBBBBB', name: 'Kit fee', cents: 6000, programme: 'other' },
  { id: 'PR-3-CCCCCC', name: 'Old clinic', cents: 3000, programme: 'jfp', archived: true },
] })
const row = { id: 'recAAAAAAAAAAAAAA', player: 'Ivy Test', parent: 'Pat Test', email: 'pat.test@example.com', groupId: 'g-1' }

await test('a price needs a name, an amount from A$1 to A$20,000 and a programme', () => {
  assert.equal(cleanPrice({ amountCents: 500, programme: 'jfp' }).ok, false)
  assert.equal(cleanPrice({ name: 'X', amountCents: 50, programme: 'jfp' }).ok, false)
  assert.equal(cleanPrice({ name: 'X', amountCents: 2000001, programme: 'jfp' }).ok, false)
  assert.equal(cleanPrice({ name: 'X', amountCents: 12.5, programme: 'jfp' }).ok, false)
  assert.match(cleanPrice({ name: 'X', amountCents: 500, programme: 'camp' }).error, /Pick the program/)
  const r = cleanPrice({ name: '  Camp day  ', amountCents: 6500, programme: 'holiday', perSession: true, description: 'x'.repeat(400) }, { id: 'PR-9-ZZZZZZ', now: '2026-10-13T00:00:00Z' })
  assert.deepEqual(r.price, { id: 'PR-9-ZZZZZZ', name: 'Camp day', cents: 6500, programme: 'holiday', description: 'x'.repeat(300), perSession: true, archived: false, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' })
  assert.deepEqual(PROGRAMMES.map(([id]) => id), ['jfp', 'pro', 'extra', 'juniors', 'holiday', 'other'], 'Pro sessions is a programme (13 Oct 2026)')
})

await test('the saved price list keeps every good price, drops broken ones, and the JFP price keys still work', () => {
  const list = cleanCustomPrices([{ id: 'PR-1-AAAAAA', name: 'A', cents: 100, programme: 'jfp' }, { id: 'PR-1-AAAAAA', name: 'dupe', cents: 100, programme: 'jfp' }, { id: 'nope', name: 'B', cents: 100, programme: 'jfp' }, { id: 'PR-2-BBBBBB', name: '', cents: 100, programme: 'jfp' }, null])
  assert.deepEqual(list.map((p) => p.name), ['A'])
  assert.deepEqual(cleanCustomPrices('junk'), [])
  assert.equal(config.customPrices.length, 3)
  assert.deepEqual(config.prices, DEFAULT_PRICES, 'the term fee, half term, sibling and the rest are untouched')
  const saved = normaliseConfig({ ...config, prices: { ...config.prices, trial: 9000 } })
  assert.equal(saved.prices.trial, 9000)
  assert.equal(saved.customPrices.length, 3, 'a settings save keeps them')
})

await test('one list: the JFP price list first (amount only), then Lee\'s own prices', () => {
  const b = builtinPrices(config)
  assert.deepEqual(b.map((p) => p.id), ['jfp:group', 'jfp:halfTerm', 'jfp:twoAWeek', 'jfp:sibling', 'jfp:oneToOneTerm', 'jfp:pathway', 'jfp:pathwayOneToOne', 'jfp:trial', 'jfp:oneToOne'])
  assert.ok(b.every((p) => p.builtin && p.programme === 'jfp' && p.cents === config.prices[p.key]))
  assert.equal(b.find((p) => p.key === 'trial').perSession, true)
  assert.equal(allPrices(config).length, 12)
  assert.equal(priceById(config, 'jfp:halfTerm').cents, 42500)
  assert.equal(priceById(config, 'PR-2-BBBBBB').name, 'Kit fee')
  assert.equal(priceById(config, 'PR-404-XXXXXX'), null)
})

await test('a quick link from a price: per session times the sessions, its programme, its name as what it is for', () => {
  const p = priceById(config, 'PR-1-AAAAAA')
  const r = quickLinkInput({ priceId: p.id, sessions: 3 }, { price: p, today: '2026-10-13', now: NOW })
  assert.equal(r.ok, true)
  const l = r.link
  assert.deepEqual([l.amountCents, l.programme, l.forText, l.unitCents, l.sessions, l.holidayPeriod], [19500, 'holiday', 'Holiday camp day, 3 sessions', 6500, 3, '2026-summer'], 'no holiday picked: the next one')
  assert.deepEqual([l.quick, l.reason, l.status, l.email, l.term4Ids, l.playerNames], [true, 'quick', 'open', '', [], []])
  assert.equal(l.expiresAt, new Date(NOW + 30 * 86400000).toISOString(), 'works for 30 days')
  const typed = quickLinkInput({ amountCents: 4321, forText: 'Two hours', programme: 'other' }, { today: '2026-10-13', now: NOW }).link
  assert.deepEqual([typed.amountCents, typed.programme, typed.priceId], [4321, 'other', ''])
  const hol = quickLinkInput({ priceId: p.id, holidayPeriod: '2026-summer' }, { price: p, today: '2026-10-13' }).link
  assert.equal(hol.holidayPeriod, '2026-summer')
  assert.equal(quickLinkInput({ priceId: p.id, sessions: 0 }, { price: p, today: '2026-10-13' }).ok, false)
  assert.equal(quickLinkInput({ priceId: p.id, sessions: 41 }, { price: p, today: '2026-10-13' }).ok, false)
})

await test('a player on a JFP link records on their row; on any other programme only their name goes on it', () => {
  const jfp = quickLinkInput({ amountCents: 8500, forText: 'Trial', programme: 'jfp' }, { row, today: '2026-10-13' }).link
  assert.deepEqual([jfp.term4Ids, jfp.rowId, jfp.groupId, jfp.playerNames, jfp.email, jfp.parentName], [[row.id], row.id, 'g-1', ['Ivy Test'], row.email, 'Pat Test'])
  for (const programme of ['juniors', 'holiday', 'other']) {
    const l = quickLinkInput({ amountCents: 8500, forText: 'x', programme }, { row, today: '2026-10-13' }).link
    assert.deepEqual([l.term4Ids, l.groupId, l.playerNames, l.rowId], [[], '', ['Ivy Test'], row.id], programme)
  }
  const other = quickLinkInput({ amountCents: 8500, forText: 'x', programme: 'jfp', email: 'Other.Parent@Example.com ' }, { row, today: '2026-10-13' }).link
  assert.equal(other.email, 'other.parent@example.com', 'an email typed in wins')
})

await test('a quick link is refused without an amount, a programme, what it is for, or with a bad email', () => {
  const t = { today: '2026-10-13' }
  assert.match(quickLinkInput({ forText: 'x', programme: 'jfp' }, t).error, /Choose a price or type an amount/)
  assert.match(quickLinkInput({ amountCents: 99, forText: 'x', programme: 'jfp' }, t).error, /A\$1 to A\$20,000/)
  assert.match(quickLinkInput({ amountCents: 2000001, forText: 'x', programme: 'jfp' }, t).error, /A\$1 to A\$20,000/)
  assert.match(quickLinkInput({ amountCents: 500, forText: 'x' }, t).error, /Pick the program/)
  assert.match(quickLinkInput({ amountCents: 500, programme: 'jfp' }, t).error, /what it is for/)
  assert.match(quickLinkInput({ amountCents: 500, forText: 'x', programme: 'jfp', email: 'not an email' }, t).error, /email/)
  const big = priceById(config, 'PR-1-AAAAAA')
  assert.match(quickLinkInput({ sessions: 40 }, { price: { ...big, cents: 60000 }, today: '2026-10-13' }).error, /more than A\$20,000/)
})

await test('where a quick link stands: not sent, emailed, opened, paying, paid, expired, cancelled', () => {
  const q = { status: 'open', expiresAt: new Date(NOW + 86400000).toISOString() }
  assert.equal(quickStatus(q, { nowMs: NOW }), 'made')
  assert.equal(quickStatus(q, { nowMs: NOW, emailedAt: '2026-10-13T00:00:00Z' }), 'sent')
  assert.equal(quickStatus(q, { nowMs: NOW, views: 2, emailedAt: 'x' }), 'opened')
  assert.equal(quickStatus({ ...q, status: 'checkout' }, { nowMs: NOW }), 'paying')
  assert.equal(quickStatus({ ...q, status: 'paid' }, { nowMs: NOW + 9e10 }), 'paid', 'paid stays paid')
  assert.equal(quickStatus(q, { nowMs: NOW + 2 * 86400000 }), 'expired')
  assert.equal(quickOpen(q, NOW + 2 * 86400000), false)
  assert.equal(quickStatus({ ...q, status: 'cancelled' }, { nowMs: NOW }), 'cancelled')
  assert.equal(quickToCheck({ quick: true, id: 'PAY-1', status: 'paid', playerNames: [] }), true)
  assert.equal(quickToCheck({ quick: true, id: 'PAY-1', status: 'paid', playerNames: [] }, { 'PAY-1': 'x' }), false, 'ticked Checked')
  assert.equal(quickToCheck({ quick: true, id: 'PAY-1', status: 'paid', playerNames: ['A'] }), false)
  assert.ok(QUICK_ID.test('PAY-1791853923170-676C2E'))
  assert.ok(!QUICK_ID.test('JFP-1791853923170-676C2E') && !QUICK_ID.test('PAY-1/../x'))
  assert.equal(quickUrl('https://jonerfootball.com', { id: 'PAY-1-ABC' }), 'https://jonerfootball.com/jfp-pay/?q=PAY-1-ABC')
  assert.deepEqual(quickHolidayPeriods('2026-10-13').map((p) => p.id), ['2026-summer', '2027-autumn', '2027-winter', '2026-spring'])
})

await test('the Stripe page: jfpBookingId and the programme on it; Juniors carries its own tag; no email asked for unless given', () => {
  const q = { id: 'PAY-1791853923170-676C2E', forText: 'Holiday camp day', amountCents: 6500, programme: 'holiday', email: '', afterpay: true, playerNames: [] }
  const b = quickCheckoutBody(q, 'https://jonerfootball.com', NOW)
  assert.equal(b['metadata[jfpBookingId]'], q.id)
  assert.equal(b['payment_intent_data[metadata][jfpBookingId]'], q.id, 'refunds find it')
  assert.equal(b['metadata[jfpProgramme]'], 'holiday')
  assert.equal(b['metadata[source]'], 'quick')
  assert.equal(b['line_items[0][price_data][unit_amount]'], '6500')
  assert.equal(b['line_items[0][price_data][product_data][name]'], 'Joner Football: Holiday camp day')
  assert.equal(b.customer_email, undefined)
  assert.equal(b['payment_method_types[0]'], undefined)
  assert.equal(b.success_url, `https://jonerfootball.com/jfp-pay/?q=${q.id}&session_id={CHECKOUT_SESSION_ID}`)
  const j = quickCheckoutBody({ ...q, programme: 'juniors', email: 'a@example.com', afterpay: false, playerNames: ['Jun Test'] }, 'https://x.test', NOW)
  assert.deepEqual([j['payment_intent_data[metadata][programme]'], j['payment_intent_data[metadata][player]'], j['metadata[programme]'], j.customer_email, j['payment_method_types[0]']], ['Joners Juniors', 'Jun Test', 'Joners Juniors', 'a@example.com', 'card'])
  const pub = JSON.stringify(publicQuick({ ...q, email: 'secret@example.com', parentName: 'Secret Parent', playerNames: ['Secret Kid'], status: 'open', expiresAt: new Date(NOW + 1e6).toISOString() }, NOW))
  assert.ok(!/secret/i.test(pub), 'the public page never gets a name or an email')
  assert.equal(JSON.parse(pub).status, 'open')
})

await test('only a JFP quick link is JFP term income; holiday links go with holiday money, the rest are other', () => {
  const s = (m) => ({ metadata: m })
  assert.equal(classifySession(s({ jfpBookingId: 'PAY-1', jfpProgramme: 'jfp' })), 'jfp')
  assert.equal(classifySession(s({ jfpBookingId: 'PAY-1', jfpProgramme: 'holiday' })), 'holiday')
  assert.equal(classifySession(s({ jfpBookingId: 'PAY-1', jfpProgramme: 'juniors', programme: 'Joners Juniors' })), 'other')
  assert.equal(classifySession(s({ jfpBookingId: 'PAY-1', jfpProgramme: 'other' })), 'other')
  assert.equal(classifySession(s({ jfpBookingId: 'PAY-1' })), 'jfp', 'every older link is JFP, as before')
})

await test('a paid quick link with no player: staff told, nothing to enrol, so the webhook does not retry', () => {
  assert.deepEqual(payEffectsFor({ quick: true, term4Ids: [] }), QUICK_EFFECTS)
  assert.deepEqual(payEffectsFor({ quick: true, term4Ids: ['rec1'] }), PAY_EFFECTS)
  assert.deepEqual(payEffectsFor({ term4Ids: [] }), PAY_EFFECTS)
  assert.equal(enrolled({ quick: true, term4Ids: [] }), true)
  assert.equal(enrolled({ quick: true, term4Ids: ['rec1'], effects: {} }), false, 'a JFP player link waits for its row')
  assert.equal(enrolled({ term4Ids: ['rec1'], effects: { airtable: { status: 'done' } } }), true)
})

// ---------- holiday money ----------
const hq = (id, x = {}) => ({ id, quick: true, programme: 'holiday', status: 'paid', forText: 'Camp day', amountCents: 6500, paidCents: 6500, playerNames: [], payerName: 'Pat Payer', paidAt: '2026-12-21T01:00:00.000Z', createdAt: '2026-12-01T00:00:00.000Z', holidayPeriod: '2026-summer', stripeFeeCents: 150, ...x })
const HOLIDAY = (x = {}) => holidayMoneyView({
  bookings: [], slots: [], config: { coaches: [] }, bankLines: [], locationOf: () => ({ id: 'belrose', name: 'Belrose HQ' }), today: '2026-12-30', period: '2026-summer',
  stripe: { error: '', at: '2026-12-30T00:00:00Z', payments: [{ id: 'cs_q1', intentId: 'pi_q1', bookingId: 'PAY-1-AAAAAA', at: '2026-12-21T01:00:00.000Z', amountCents: 6500, refundedCents: 500, feeCents: 160, feeGstCents: 15, feeKnown: true, payMethod: 'card' }] },
  quickLinks: [hq('PAY-1-AAAAAA'), hq('PAY-2-BBBBBB', { playerNames: ['Kid Test'], paidCents: 13000, amountCents: 13000 }), hq('PAY-3-CCCCCC', { holidayPeriod: '', paidAt: '2026-07-08T01:00:00.000Z' })],
  ...x,
})

await test('holiday money: quick links for holiday training, with Stripe\'s own figures, the ones to check listed', () => {
  const v = HOLIDAY()
  const l1 = v.lines.find((x) => x.id === 'PAY-1-AAAAAA')
  assert.deepEqual([l1.kind, l1.link, l1.status, l1.takenCents, l1.refundedCents, l1.feeCents, l1.keptCents, l1.note, l1.who], ['stripe', true, 'link-check', 6500, 500, 160, 6500 - 500 - 160, 'Camp day', 'Pat Payer'], 'Stripe\'s list wins over the record')
  const l2 = v.lines.find((x) => x.id === 'PAY-2-BBBBBB')
  assert.deepEqual([l2.status, l2.feeCents, l2.stripeFound, l2.players], ['link', 150, false, ['Kid Test']], 'not in Stripe\'s list yet: what the link recorded')
  assert.ok(!v.lines.some((x) => x.id === 'PAY-3-CCCCCC'), 'no holiday picked: the holiday its payment date is in (winter)')
  assert.equal(HOLIDAY({ period: '2026-winter' }).lines[0].id, 'PAY-3-CCCCCC')
  assert.deepEqual(v.toCheck.map((x) => x.id), ['PAY-1-AAAAAA', 'PAY-3-CCCCCC'], 'every holiday')
  assert.deepEqual(HOLIDAY({ checked: { 'PAY-1-AAAAAA': 'x' } }).toCheck.map((x) => x.id), ['PAY-3-CCCCCC'])
  assert.equal(v.totals.stripe.count, 2)
  assert.equal(v.totals.keptCents, (6500 - 500 - 160) + (13000 - 150))
  assert.deepEqual(v.byType.map((g) => g.label).sort(), ['Payment link · A$130', 'Payment link · A$65'])
})

// ---------- the pages ----------
const PRICING = () => {
  const list = allPrices(config).map((p) => ({ ...p, amountLabel: `A$${p.cents / 100}`, programmeLabel: Object.fromEntries(PROGRAMMES)[p.programme] }))
  return { success: true, weeks: 10, today: '2026-10-13', prices: config.prices, products: [{ key: 'group', label: 'Term, small group', type: 'JFP 10 weeks', proRata: true, perPlaces: 1, cents: 85000 }, { key: 'trial', label: 'Trial session', type: 'JFP Trial', proRata: false, perPlaces: 1, cents: 8500 }], datesByDay: {}, priceList: list, programmes: PROGRAMMES.map(([id, label]) => ({ id, label })), holidayPeriods: quickHolidayPeriods('2026-10-13') }
}
const BOARD = { success: true, groups: [{ id: 'g-1', day: 'Monday', time: '4:20pm', coachName: 'Coach Test', players: [{ rowId: row.id, name: 'Ivy Test', parent: 'Pat Test', email: row.email, paymentStatus: 'Unpaid', type: 'JFP 10 weeks' }] }], unassigned: [] }
const setValue = (p, sel, v, ev = 'input') => { const el = p.$(sel); el.value = v; el.dispatchEvent(new p.w.Event(ev, { bubbles: true })) }

await test('Prices: Lee\'s own prices and the JFP price list in one place, each with Create link', async () => {
  const p = await openPortal({ hash: '#prices', onPost: (b) => (b.action === 'pricing' ? PRICING() : null) })
  const own = [...p.d.querySelectorAll('#pr-own-list [data-price-id]')]
  assert.deepEqual(own.map((li) => li.dataset.priceId), ['PR-1-AAAAAA', 'PR-2-BBBBBB'], 'archived prices are folded away')
  assert.match(own[0].textContent.replace(/\s+/g, ' '), /Holiday camp day ?Holiday training A\$65 a session · Full day/)
  assert.ok(p.$('#pr-archived [data-price-id="PR-3-CCCCCC"] [data-restore-price]'))
  assert.ok(p.$('#pr-jfp [data-price-id="jfp:group"] [data-quick-price]'))
  assert.ok(p.$('#pr-jfp [data-price="group"]'), 'the term prices are still edited in place')
  assert.ok(p.d.querySelectorAll('[data-quick-price]').length >= 4)
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Prices: add, edit and archive a price', async () => {
  const p = await openPortal({ hash: '#prices', onPost: (b) => (b.action === 'pricing' ? PRICING() : ['savePrice', 'archivePrice'].includes(b.action) ? { success: true } : null) })
  await p.click('#pr-add')
  setValue(p, '#pm-name', 'Pro session')
  setValue(p, '#pm-amt', '95.50')
  setValue(p, '#pm-prog', 'other', 'change')
  p.$('#pm-session').checked = true
  await p.click('#pm-go')
  assert.deepEqual(p.posts.find((b) => b.action === 'savePrice'), { action: 'savePrice', price: { id: '', name: 'Pro session', amountCents: 9550, programme: 'other', description: '', perSession: true } })
  await p.click('[data-price-id="PR-2-BBBBBB"] [data-edit-price]')
  assert.equal(p.$('#pm-name').value, 'Kit fee')
  assert.equal(p.$('#pm-amt').value, '60')
  setValue(p, '#pm-amt', '65')
  await p.click('#pm-go')
  assert.deepEqual(p.posts.filter((b) => b.action === 'savePrice').at(-1).price, { id: 'PR-2-BBBBBB', name: 'Kit fee', amountCents: 6500, programme: 'other', description: '', perSession: false })
  await p.click('[data-price-id="PR-2-BBBBBB"] [data-archive-price]')
  await p.click('#jp-modal [data-yes]')
  assert.deepEqual(p.posts.find((b) => b.action === 'archivePrice'), { action: 'archivePrice', id: 'PR-2-BBBBBB', undo: false })
  await p.click('[data-price-id="PR-3-CCCCCC"] [data-restore-price]')
  assert.deepEqual(p.posts.filter((b) => b.action === 'archivePrice').at(-1), { action: 'archivePrice', id: 'PR-3-CCCCCC', undo: true })
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Create link: the price fills the amount, what it is for and the programme; a player and email are optional; the link comes back with Copy, Open and Email it', async () => {
  const copied = []
  const LINK = { id: 'PAY-1791853923170-676C2E', url: 'http://localhost/jfp-pay/?q=PAY-1791853923170-676C2E', amountLabel: 'A$130', forText: 'Holiday camp day, 2 sessions', programme: 'holiday', programmeLabel: 'Holiday training', email: 'pat.test@example.com', players: ['Ivy Test'] }
  const p = await openPortal({ hash: '#prices', onPost: (b) => (b.action === 'pricing' ? PRICING() : b.action === 'board' ? BOARD : b.action === 'quickLink' ? { success: true, link: LINK } : b.action === 'emailQuickLink' ? { success: true } : null) })
  Object.defineProperty(p.w.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t) } } })
  await p.click('[data-price-id="PR-1-AAAAAA"] [data-quick-price]')
  assert.equal(p.$('#ql-price').value, 'PR-1-AAAAAA')
  assert.deepEqual([p.$('#ql-amt').value, p.$('#ql-for').value, p.$('#ql-prog').value, p.$('#ql-sess-wrap').hidden, p.$('#ql-hol-wrap').hidden], ['65', 'Holiday camp day', 'holiday', false, false])
  setValue(p, '#ql-sess', '2')
  assert.deepEqual([p.$('#ql-amt').value, p.$('#ql-for').value], ['130', 'Holiday camp day, 2 sessions'])
  assert.match(p.text('#ql-note'), /waits on Money > Holiday training/)
  setValue(p, '#ql-q', 'ivy')
  await p.settle()
  await p.click('#ql-res [data-i="0"]')
  assert.match(p.text('#ql-chosen'), /Ivy Test/)
  assert.equal(p.$('#ql-email').value, row.email, 'the family email fills in')
  assert.match(p.text('#ql-note'), /name goes on the link\. Nothing is written to their JFP row/)
  setValue(p, '#ql-prog', 'jfp', 'change')
  assert.match(p.text('#ql-note'), /recorded on Ivy Test's Term 4 row/)
  setValue(p, '#ql-prog', 'holiday', 'change')
  await p.click('#ql-go')
  assert.deepEqual(p.posts.find((b) => b.action === 'quickLink'), { action: 'quickLink', priceId: 'PR-1-AAAAAA', amountCents: 13000, sessions: 2, forText: 'Holiday camp day, 2 sessions', programme: 'holiday', holidayPeriod: '2026-summer', rowId: row.id, email: row.email, afterpay: true, replace: false })
  assert.equal(p.$('#qr-url').value, LINK.url)
  assert.equal(p.$('#qr-open').getAttribute('href'), LINK.url)
  assert.match(p.text('#qr-note'), /Email it sends the link to pat\.test@example\.com\. Nothing has been sent yet\./)
  assert.ok(!p.posts.some((b) => b.action === 'emailQuickLink'), 'nothing sent without the tap')
  await p.click('#qr-copy')
  assert.deepEqual(copied, [LINK.url])
  await p.click('#qr-email')
  assert.deepEqual(p.posts.find((b) => b.action === 'emailQuickLink'), { action: 'emailQuickLink', id: LINK.id })
  assert.equal(p.text('#qr-email'), 'Emailed')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Quick link with a typed amount and no email: no Email it button; a refused link says why', async () => {
  let n = 0
  const p = await openPortal({ hash: '#prices', onPost: (b) => (b.action === 'pricing' ? PRICING() : b.action === 'quickLink' ? (n++ ? { success: true, link: { id: 'PAY-1-X', url: 'http://localhost/jfp-pay/?q=PAY-1-X', amountLabel: 'A$12', forText: 'Ball', programme: 'other', programmeLabel: 'Other', email: '', players: [] } } : { status: 400, success: false, error: 'Say what it is for.' }) : null) })
  await p.click('[data-price-id="jfp:group"] [data-quick-price]')
  setValue(p, '#ql-price', '', 'change')
  setValue(p, '#ql-amt', '12')
  setValue(p, '#ql-for', 'Ball')
  setValue(p, '#ql-prog', 'other', 'change')
  // No player and no reason: refused in the page (14 Oct 2026), nothing posted.
  await p.click('#ql-go')
  assert.equal(p.text('#ql-err'), 'Choose the player this link is for, or say why there is no player.')
  assert.equal(p.posts.filter((b) => b.action === 'quickLink').length, 0)
  setValue(p, '#ql-np', 'A ball for the shop')
  await p.click('#ql-go')
  assert.equal(p.text('#ql-err'), 'Say what it is for.')
  await p.click('#ql-go')
  assert.deepEqual((({ priceId, amountCents, programme, rowId, email }) => ({ priceId, amountCents, programme, rowId, email }))(p.posts.filter((b) => b.action === 'quickLink').at(-1)), { priceId: '', amountCents: 1200, programme: 'other', rowId: '', email: '' })
  assert.equal(p.posts.filter((b) => b.action === 'quickLink').at(-1).noPlayerReason, 'A ball for the shop')
  assert.equal(p.$('#qr-email'), null)
  assert.match(p.text('#qr-note'), /Nothing has been sent\. Copy it/)
  assert.deepEqual(p.errors, [])
  p.close()
})

const link = (id, x = {}) => ({ id, kind: 'balance', status: 'open', createdAt: '2026-10-12T00:00:00Z', paidAt: '', group: 'Monday 4:20pm', players: ['Ivy Test'], amountCents: 85000, productLabel: '', startDate: '', trialDate: '', emailedAt: '', views: 0, lastViewedAt: '', expiresAt: '', afterpay: true, term4Ids: [row.id], parentName: 'Pat Test', email: row.email, amountLabel: 'A$850', feeLabel: '', url: `http://localhost/jfp-account/?pay=${id}`, stripeUrl: '', effects: null, createdBy: 'staff@example.com', needsAttention: '', unexpected: [], programme: 'jfp', ...x })
const quick = (id, x = {}) => link(id, { kind: 'quick', quick: true, players: [], term4Ids: [], parentName: '', email: '', group: '', forText: 'Kit fee', priceName: 'Kit fee', programme: 'other', programmeLabel: 'Other', quickStatus: 'made', quickStatusLabel: 'Not sent yet', url: `http://localhost/jfp-pay/?q=${id}`, amountLabel: 'A$60', expiresAt: '2026-11-12T00:00:00Z', toCheck: false, ...x })
const PAYMENTS = { success: true, bookings: [], payreqs: [
  link('PAY-1-AAAAAA'),
  quick('PAY-2-BBBBBB', { email: 'pat.test@example.com', quickStatus: 'sent', quickStatusLabel: 'Emailed', emailedAt: '2026-10-12T01:00:00Z' }),
  quick('PAY-3-CCCCCC', { programme: 'holiday', programmeLabel: 'Holiday training', forText: 'Camp day', quickStatus: 'opened', quickStatusLabel: 'Opened', views: 2 }),
  quick('PAY-4-DDDDDD', { status: 'paid', paidAt: '2026-10-12T02:00:00Z', quickStatus: 'paid', quickStatusLabel: 'Paid', toCheck: true, payerName: 'Pat Payer', payerEmail: 'payer@example.com', effects: { ok: true, pending: [], failed: [], uncertain: [] } }),
  quick('PAY-5-EEEEEE', { status: 'expired', quickStatus: 'expired', quickStatusLabel: 'Expired', programme: 'juniors', programmeLabel: 'Joners Juniors' }),
] }

await test('Payment links: quick links in the list with what they are for, programme and status; chips by programme', async () => {
  const p = await openPortal({ hash: '#payments', onPost: (b) => (b.action === 'payments' ? structuredClone(PAYMENTS) : b.action === 'board' ? BOARD : null) })
  assert.deepEqual([...p.d.querySelectorAll('#pl-prog [data-prog]')].map((b) => b.textContent), ['All 5', 'JFP 1', 'Pro sessions 0', 'Joners Juniors 1', 'Holiday training 1', 'Other 2'])
  assert.deepEqual([...p.d.querySelectorAll('#pl-list tr[data-link]')].map((tr) => tr.dataset.link), ['PAY-1-AAAAAA', 'PAY-2-BBBBBB', 'PAY-3-CCCCCC'], 'open ones first')
  const two = p.$('tr[data-link="PAY-2-BBBBBB"]')
  const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim())
  assert.deepEqual(cells(two).slice(0, 3), ['No playerpat.test@example.com', 'Kit feeOther Quick link', 'A$60'])
  assert.match(cells(two)[3], /^EmailedEmailed 12 Oct, .* · works until 12 Nov$/)
  assert.ok(two.querySelector('[data-email-quick]') && two.querySelector('a[href="http://localhost/jfp-pay/?q=PAY-2-BBBBBB"]'), 'Email it and Open')
  assert.equal(two.querySelector('[data-copy]').dataset.copy, 'http://localhost/jfp-pay/?q=PAY-2-BBBBBB', 'Copy gives the pay page, not the account')
  assert.equal(p.$('tr[data-link="PAY-3-CCCCCC"] [data-email-quick]'), null, 'no email, no Email it')
  assert.match(p.text('tr[data-link="PAY-3-CCCCCC"]'), /Opened ?Made .*opened 2 times/)
  await p.click('#pl-prog [data-prog="holiday"]')
  assert.deepEqual([...p.d.querySelectorAll('#pl-list tr[data-link]')].map((tr) => tr.dataset.link), ['PAY-3-CCCCCC'])
  await p.click('#pl-f [data-f="closed"]')
  assert.equal(p.$('#pl-list'), null)
  await p.click('#pl-prog [data-prog="juniors"]')
  assert.match(p.text('tr[data-link="PAY-5-EEEEEE"]'), /Expired/)
  await p.click('#pl-prog [data-prog="other"]')
  await p.click('#pl-f [data-f="paid"]')
  assert.match(p.text('tr[data-link="PAY-4-DDDDDD"]'), /No player ?Pat Payer · payer@example\.com.*Paid.*No player: waiting on Payment links, Other payments to check ?Staff emailed/)
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Payment links: Other payments to check, ticked Checked; Email it asks first; Quick link opens the form', async () => {
  const p = await openPortal({ hash: '#payments', onPost: (b) => (b.action === 'payments' ? structuredClone(PAYMENTS) : b.action === 'pricing' ? PRICING() : ['quickLinkChecked', 'emailQuickLink'].includes(b.action) ? { success: true } : null) })
  assert.match(p.text('#pl-other-check'), /^Other payments to check: 1 ?Quick links for Pro sessions or Other.*Kit fee ?Pat Payer · payer@example\.com/)
  await p.click('#pl-other-check [data-check-quick="PAY-4-DDDDDD"]')
  assert.deepEqual(p.posts.find((b) => b.action === 'quickLinkChecked'), { action: 'quickLinkChecked', id: 'PAY-4-DDDDDD' })
  await p.click('[data-email-quick="PAY-2-BBBBBB"]')
  assert.match(p.text('#jp-modal'), /Email this link to pat\.test@example\.com\?/)
  assert.ok(!p.posts.some((b) => b.action === 'emailQuickLink'))
  await p.click('#jp-modal [data-yes]')
  assert.deepEqual(p.posts.find((b) => b.action === 'emailQuickLink'), { action: 'emailQuickLink', id: 'PAY-2-BBBBBB' })
  await p.click('#pl-quick')
  assert.ok(p.$('#ql-price') && p.$('#ql-go'))
  assert.equal(p.$('#ql-price').value, '', 'type an amount by default')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Money > Holiday training: quick links show as payment links, the ones to check have Checked', async () => {
  const v = HOLIDAY()
  const p = await openPortal({ money: { kpis: {}, players: [], unmatched: [] }, hash: '#money?programme=holiday&period=2026-summer', onPost: (b) => (b.action === 'holidayMoney' ? { success: true, holiday: v } : b.action === 'quickLinkChecked' ? { success: true } : null) })
  assert.match(p.text('#h-check'), /^Quick links to check: 2 payments/)
  assert.match(p.text('#h-lines [data-hline="PAY-1-AAAAAA"]'), /Payment link · Camp day/)
  assert.match(p.text('#h-lines [data-hline="PAY-1-AAAAAA"]'), /Payment link, to check/)
  assert.match(p.text('#h-lines [data-hline="PAY-2-BBBBBB"]'), /Payment link · Camp day · Kid Test/)
  await p.click('#h-check [data-hcheck="PAY-1-AAAAAA"]')
  assert.deepEqual(p.posts.find((b) => b.action === 'quickLinkChecked'), { action: 'quickLinkChecked', id: 'PAY-1-AAAAAA' })
  assert.deepEqual(p.errors, [])
  p.close()
})


// ---------- the page families open ----------
await test('the pay page: what it is for and the amount, then Stripe; after Stripe, thank you; a closed link says so', async () => {
  const { JSDOM } = await import('jsdom')
  const fs = await import('node:fs')
  const astro = fs.readFileSync(new URL('../src/pages/jfp-pay.astro', import.meta.url), 'utf8')
  const html = astro.slice(astro.indexOf('<div class="jfp" id="jfp-pay">'), astro.indexOf('</BaseLayout>'))
  const { initPay } = await import('../src/scripts/jfp-pay.js')
  const run = async (search, answers) => {
    const dom = new JSDOM(`<body>${html}</body>`)
    globalThis.document = dom.window.document
    const posts = []
    globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); posts.push(b); const a = answers(b); return { ok: (a.status || 200) < 400, status: a.status || 200, json: async () => a.body } }
    const went = []
    await initPay({ search, wait: async () => {}, go: (u) => went.push(u) })
    const d = dom.window.document
    return { d, posts, went, text: (id) => d.getElementById(id).textContent.replace(/\s+/g, ' ').trim(), click: async (id) => { d.getElementById(id).click(); for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) } }
  }
  const LINK = { id: 'PAY-1791853923170-676C2E', forText: 'Holiday camp day', amountCents: 6500, amountLabel: 'A$65', programme: 'Holiday training', status: 'open', afterpay: false }
  let p = await run('?q=PAY-1791853923170-676C2E', (b) => (b.action === 'view' ? { body: { success: true, link: LINK } } : { body: { success: true, url: 'https://checkout.stripe.test/c/1' } }))
  assert.deepEqual(p.posts[0], { action: 'view', id: LINK.id })
  assert.equal(p.text('details'), 'ForHoliday camp dayAmountA$65')
  assert.equal(p.text('pay'), 'Pay A$65')
  assert.equal(p.text('how'), 'Secure payment by Stripe. Card or Apple Pay.')
  await p.click('pay')
  assert.deepEqual(p.posts[1], { action: 'pay', id: LINK.id })
  assert.deepEqual(p.went, ['https://checkout.stripe.test/c/1'])
  p = await run('?q=PAY-1791853923170-676C2E', () => ({ body: { success: true, link: { ...LINK, status: 'expired' } } }))
  assert.equal(p.text('heading'), 'This link has expired')
  assert.ok(p.d.getElementById('pay').hidden)
  p = await run('?q=PAY-1791853923170-676C2E', () => ({ body: { success: true, link: { ...LINK, status: 'paid' } } }))
  assert.equal(p.text('heading'), 'Already paid')
  p = await run('?q=PAY-1791853923170-676C2E', () => ({ status: 404, body: { success: false, error: 'We could not find that payment link.' } }))
  assert.equal(p.text('heading'), 'Link not found')
  let n = 0
  p = await run('?q=PAY-1791853923170-676C2E&session_id=cs_test_abc', (b) => ({ body: { success: true, status: n++ ? 'paid' : 'pending', link: { ...LINK, status: n > 1 ? 'paid' : 'open' } } }))
  assert.deepEqual(p.posts.map((b) => b.action), ['confirm', 'confirm'], 'checks again until Stripe says paid')
  assert.deepEqual(p.posts[0], { action: 'confirm', id: LINK.id, sessionId: 'cs_test_abc' })
  assert.equal(p.text('heading'), 'Thank you')
  assert.match(p.text('details'), /ReferencePAY-1791853923170-676C2E$/)
  delete globalThis.document
})

console.log(`\n${passed} prices and quick link checks passed`)
