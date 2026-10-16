// JFP round 3 (Lee, 14 Oct 2026): Fees as the clear place to pay (cards with
// one big amount and one button, the same component on Home), "Pay ahead and
// save" with the best value marked, Paid in full, the next term deposit card
// (only while staff have it open), Can't make it telling the coach and Ligia
// with Call and Text for both, the side bar's dropdown sections, Waivers, and
// the two new pages: Book extra sessions and Book game analysis. Units, then
// the pages in jsdom. Every name, email and amount here is invented.
//   node scripts/test-jfp-round3.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM, VirtualConsole } from 'jsdom'
import { cleanExtra, analysisPrice, submitExtra } from '../api/_jfp-extras.js'
import { normaliseConfig } from '../api/_jfp-store.js'
import { aheadOptions } from '../src/scripts/jfp-account-pay.js'
import { openPortal } from './jfp-portal-dom.mjs'

let passed = 0
const test = async (n, fn) => { await fn(); passed += 1; console.log(`ok - ${n}`) }

// ---------- units ----------

await test('next term: the "held until" date is kept when it is a date, blank otherwise', () => {
  assert.equal(normaliseConfig({ nextTerm: { name: 'Term 1 2027', holdCents: 10000, open: false, holdUntil: '2026-12-04' } }).nextTerm.holdUntil, '2026-12-04')
  assert.equal(normaliseConfig({ nextTerm: { holdUntil: 'next week' } }).nextTerm.holdUntil, '')
  assert.equal(normaliseConfig({}).nextTerm.open, false, 'off unless staff turn it on')
})

await test('extra session and game analysis requests: checked before anything is saved', () => {
  const players = ['Ari Family', 'Bea Family']
  assert.equal(cleanExtra('nope', {}).ok, false)
  assert.match(cleanExtra('extra', { player: '' }, { players }).error, /Choose the player/)
  assert.match(cleanExtra('extra', { player: 'Ari Family' }, { players }).error, /days or times/)
  const x = cleanExtra('extra', { player: 'ari family', days: ['Monday', 'Funday'], times: ['After school'], type: 'Small group' }, { players })
  assert.deepEqual([x.value.player, x.value.days, x.value.times, x.value.type], ['Ari Family', ['Monday'], ['After school'], 'Small group'])
  assert.equal(cleanExtra('analysis', { player: 'Ari Family' }, { players }).ok, true)
  assert.match(cleanExtra('analysis', { player: 'Ari Family', video: 'not a link' }, { players }).error, /video link/)
  assert.match(cleanExtra('analysis', { player: 'Ari Family', video: 'https://video.example.com/m1', matchDate: '2999-01-01' }, { players, today: '2026-10-14' }).error, /date of the match/)
  const a = cleanExtra('analysis', { player: 'Bea Family', matchDate: '2026-10-11' }, { players, today: '2026-10-14' })
  assert.deepEqual([a.value.video, a.value.sendLater, a.value.matchDate], ['', true, '2026-10-11'])
})

await test('game analysis price: a live price named game analysis, else none ("Ask us")', () => {
  assert.equal(analysisPrice({ customPrices: [] }), null)
  assert.equal(analysisPrice({ customPrices: [{ name: 'Game analysis', cents: 12000, archived: true }] }), null)
  assert.equal(analysisPrice({ customPrices: [{ name: 'Match analysis, one game', cents: 12000 }] }).label, 'A$120')
})

await test('a request is saved, Lee and Ligia are emailed, Telegram hears; a failed email is recorded, not lost', async () => {
  // KV in memory for this one check.
  const store = new Map()
  process.env.KV_REST_API_URL = 'http://kv.unit'
  process.env.KV_REST_API_TOKEN = 'unit'
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const cmd = JSON.parse(init.body)
    const [op, key, ...rest] = Array.isArray(cmd[0]) ? cmd[0] : cmd
    let result = null
    if (op === 'HSET') { const h = store.get(key) || new Map(); h.set(rest[0], rest[1]); store.set(key, h); result = 1 }
    else if (op === 'HGET') result = store.get(key)?.get(rest[0]) ?? null
    else if (op === 'HGETALL') result = [...(store.get(key) || new Map())].flat()
    else if (op === 'EVAL') result = 1
    else if (op === 'LPUSH' || op === 'LTRIM') result = 1
    return { ok: true, json: async () => (Array.isArray(cmd[0]) ? cmd.map(() => ({ result })) : { result }), text: async () => '' }
  }
  try {
    const sent = []
    const out = await submitExtra({ config: normaliseConfig({}), parent: { email: 'robin.family@example.com' }, players: ['Ari Family'], kind: 'extra', body: { player: 'Ari Family', days: ['Monday'] }, notify: { email: async ({ rec }) => { sent.push(rec.id) }, telegram: async () => 'sent' } })
    assert.equal(out.ok, true)
    assert.deepEqual(sent, [out.record.id])
    assert.deepEqual(out.record.deliveries, { staff: 'sent', telegram: 'sent' })
    const bad = await submitExtra({ config: normaliseConfig({}), parent: { email: 'robin.family@example.com' }, players: ['Ari Family'], kind: 'analysis', body: { player: 'Ari Family', sendLater: true }, notify: { email: async () => { throw new Error('Brevo 500') }, telegram: async () => 'off' } })
    assert.equal(bad.ok, true, 'the family request is kept')
    assert.deepEqual(bad.record.deliveries, { staff: 'failed', telegram: 'off' })
  } finally { globalThis.fetch = realFetch }
})

const lbl = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00Z`)).replace(',', '')
const DAY = 86400000
const future = Array.from({ length: 8 }, (_, i) => new Date(Date.now() + (i + 1) * 7 * DAY).toISOString().slice(0, 10))
const dates = future.map((iso) => ({ iso, label: lbl(iso) }))
const QUOTE = { options: [
  { key: 'one', n: 1, perCents: 10000, totalCents: 10000, saveCents: 0, dates: dates.slice(0, 1) },
  { key: 'commit:6', n: 6, perCents: 9500, totalCents: 57000, saveCents: 3000, commit: true, dates: dates.slice(0, 6) },
  { key: 'commit:8', n: 8, perCents: 9200, totalCents: 73600, saveCents: 6400, commit: true, rest: true, dates },
], commitment: { sessions: 2, left: 1, leftDates: [] } }

await test('pay ahead: the best value is the biggest saving; no saving, no "best value"', () => {
  const opts = aheadOptions({ perCents: 10000, dates, max: 8, quote: QUOTE })
  assert.deepEqual(opts.map((x) => [x.key, x.best]), [['one', false], ['commit:6', false], ['commit:8', true]])
  const plain = aheadOptions({ perCents: 8000, dates, max: 8, rest: { n: 8, perCents: 8000, totalCents: 64000 } })
  assert.deepEqual(plain.map((x) => x.key), ['one', 'count', 'rest'])
  assert.ok(plain.every((x) => !x.best))
})

// ---------- the pages in jsdom ----------

const root = fileURLToPath(new URL('../', import.meta.url))
const bundled = (await build({ entryPoints: [path.join(root, 'src/scripts/jfp-account.js')], bundle: true, write: false, format: 'iife', target: 'es2022', logLevel: 'silent' })).outputFiles[0].text
const astro = fs.readFileSync(path.join(root, 'src/pages/jfp-account.astro'), 'utf8')
const markup = astro.slice(astro.indexOf('<div class="jfp ja" id="jfp-account"'), astro.lastIndexOf('</BaseLayout>'))
const FEES0 = { term: 'Term 4 2026', places: [], totals: [], paidCents: 0, paidLabel: 'A$0', records: [] }

async function openAccount(overview, { onPost = () => null, fees = FEES0, store = {} } = {}) {
  const errors = [], posts = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => { if (!/Not implemented: navigation/.test(e.message)) errors.push(e) })
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, { url: 'http://localhost/jfp-account/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  const w = dom.window
  for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v)
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
    if (body.action === 'fees') return reply({ success: true, fees })
    if (body.action === 'payOwed' || body.action === 'pay') return reply({ success: false, error: 'Not in this test.' }, 400)
    return reply({ success: true })
  }
  w.eval(bundled)
  const d = w.document
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 4)) }
  await settle()
  const $ = (s) => d.querySelector(s)
  const $$ = (s) => [...d.querySelectorAll(s)]
  const text = (s) => ($(s)?.textContent || '').replace(/\s+/g, ' ').trim()
  const click = async (s) => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error(`Nothing to click: ${s}`); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle() }
  return { w, d, $, $$, text, click, settle, posts, errors, close: () => w.close() }
}

const enrol = (x = {}) => ({
  rowId: 'recTRM00000000001', day: 'Wednesday', time: '7:30am', location: 'North Turramurra', address: '', maps: '', status: 'Confirmed', durationMin: 60,
  dates: future.map(lbl), firstDate: lbl(future[0]), payment: { state: 'due', label: 'A$850 to pay' },
  sessions: future.map((iso, i) => ({ iso, label: lbl(iso), startMs: Date.now() + (i + 1) * 7 * DAY, cancelled: '' })),
  contacts: [{ name: 'Coach', phone: '0400 000 111', tel: '0400000111' }], cancelled: [], ...x,
})
const BASE = {
  email: 'robin.family@example.com', parentName: 'Robin Family', self: false, nextTerm: null, term: 'Term 4 2026', waiverVersion: 'v1', kitUrl: '', kitPriceLabel: 'A$60',
  keep: { name: 'Term 1 2027', open: false, holdLabel: 'A$100', holdUntil: '', holdUntilLabel: '', players: [{ rowId: 'recTRM00000000001', player: 'Ari Family', group: 'Wednesday 7:30am, North Turramurra', status: '', interested: false }] },
  players: [{ key: 'ari family', name: 'Ari Family', age: 12, needsDob: false, waiver: { onFile: true, signedDate: '2026-10-01', kind: 'guardian' }, placeNoSession: false, enrolments: [enrol()] }],
  todo: [], owed: [{ rowId: 'recTRM00000000001', playerKey: 'ari family', player: 'Ari Family', group: 'Wednesday 7:30am, North Turramurra', needsWaiver: false, kind: 'term', amountCents: 85000, amountLabel: 'A$850', title: 'Pay A$850' }],
  reasons: [{ key: 'sick', label: 'Sick or injured' }], noteMax: 500, paid: [], requests: [], bookings: [], juniors: null,
  extras: { analysisPriceLabel: '', holidaySlots: 0, slots: [], days: ['Monday', 'Tuesday', 'Wednesday'], times: ['School hours (about 7:30am to 2pm)', 'After school'], types: ['1 on 1', 'Small group', 'Either'], mine: [] },
}

await test('Fees, a term fee owing: one card, a big A$850 and one "Pay A$850"; Home draws the same card', async () => {
  const p = await openAccount(BASE)
  await p.click('#ja-tabs [data-go="fees"]')
  const card = p.$('[data-pane="fees"] [data-pay-card="owed:recTRM00000000001"]')
  assert.ok(card, 'the pay card on Fees')
  assert.match(card.textContent.replace(/\s+/g, ' '), /Term fee to pay.*Ari Family.*Wednesday 7:30am, North Turramurra.*A\$850 to pay.*Pay A\$850/)
  assert.equal(card.querySelectorAll('.ja-btn-red').length, 1, 'one primary button')
  // Redesign (17 Oct 2026): Home's "to sort" line opens the same card in a sheet.
  await p.click('[data-pane="home"] [data-todo-open]')
  assert.ok(p.$('.j-sheet [data-pay-card="owed:recTRM00000000001"]'), 'the same card from Home')
  p.$('.j-sheet .j-close').click(); await p.settle()
  await p.click(card.querySelector('[data-owed]'))
  assert.deepEqual(p.posts.filter((b) => b.action === 'payOwed').map((b) => [b.rowId, b.option ?? null, b.sessions ?? null]), [['recTRM00000000001', null, null]])
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Fees, paid in full: a green "Paid in full" with the amount, the date and the receipt; the history list below', async () => {
  const fees = { term: 'Term 4 2026', paidCents: 85000, paidLabel: 'A$850', totals: [{ label: 'JFP', cents: 85000, amountLabel: 'A$850' }],
    places: [{ rowId: 'recTRM00000000001', player: 'Ari Family', group: 'Wednesday 7:30am, North Turramurra', kind: 'term', feeCents: 85000, paidCents: 85000, owingCents: 0, paidLabel: 'A$850', feeLabel: 'A$850' }],
    records: [{ id: 'PAY-1', date: '2026-10-02', dateLabel: 'Fri 2 Oct', programme: 'JFP', what: 'Term 4 2026 fee', players: ['Ari Family'], method: 'Card', amountCents: 85000, amountLabel: 'A$850', receiptUrl: 'https://pay.example.com/receipt/1' }] }
  const p = await openAccount({ ...BASE, owed: [], players: [{ ...BASE.players[0], enrolments: [enrol({ payment: { state: 'paid', label: 'Paid' } })] }] }, { fees })
  await p.click('#ja-tabs [data-go="fees"]')
  assert.match(p.text('[data-pane="fees"]'), /Nothing owing\s*You are all paid up/)
  assert.match(p.text('#fees-places .ja-place.is-paid'), /Ari Family.*Paid in full\s*A\$850\s*Paid Fri 2 Oct · Card\s*Receipt/)
  assert.equal(p.$('#fees-places .ja-place.is-paid a').href, 'https://pay.example.com/receipt/1')
  assert.equal(p.$$('#fees-body [data-fee-record]').length, 1)
  assert.match(p.text('#fees-body'), /A\$850 paid so far/)
  p.close()
})

const PRO = {
  ...BASE, owed: [{ rowId: 'recPRO00000000001', playerKey: 'ari family', player: 'Ari Family', group: 'Wednesday 7:30am, North Turramurra', needsWaiver: false, kind: 'prepay', title: 'Pay for your sessions', perCents: 10000, perLabel: 'A$100', max: 8, left: 8, leftCents: 80000, leftLabel: 'A$800', dates, rest: { key: 'commit:8', n: 8, totalCents: 73600, totalLabel: 'A$736', perCents: 9200, commit: true }, quote: QUOTE }],
  players: [{ ...BASE.players[0], enrolments: [enrol({ rowId: 'recPRO00000000001', sessionPay: true, isoDates: future, paidDates: [future[0]], openDates: [], payment: { state: 'sessions', label: 'Pro sessions, paid by the session' } })] }],
}

await test('Pay ahead and save: a card each (next session, 6 in a row, rest of term), the best value marked, dates covered, already paid', async () => {
  const p = await openAccount(PRO)
  await p.click('#ja-tabs [data-go="fees"]')
  const box = p.$('[data-pane="fees"] [data-fees-owed="recPRO00000000001"]')
  const cards = [...box.querySelectorAll('.ja-opt-card')]
  assert.deepEqual(cards.map((c) => c.dataset.opt), ['one', 'commit:6', 'commit:8'])
  const t = (c) => c.textContent.replace(/\s+/g, ' ').trim()
  assert.match(t(cards[0]), /Next session A\$100/)
  assert.match(t(cards[1]), /6 in a row A\$570 A\$95 each, save A\$30 Dates covered \(6\).*Pay A\$570 Missed sessions are not refunded/)
  assert.match(t(cards[2]), /Best value Rest of term, 8 in a row A\$736 A\$92 each, save A\$64/)
  assert.ok(cards[2].classList.contains('is-best') && !cards[1].classList.contains('is-best'))
  assert.equal(cards.filter((c) => c.querySelector('.ja-btn-red')).length, 1, 'the best value is the red button')
  assert.match(t(box), /Already paid: 1 session to come/)
  assert.match(t(box), /Sessions you do not pay ahead are billed after they happen/)
  await p.click(cards[1].querySelector('[data-owed]'))
  assert.equal(p.posts.find((b) => b.action === 'payOwed').option, 'commit:6')
  // Home: the same cards, the next session and the best value, then all the ways.
  await p.click('[data-pane="home"] [data-todo-open]')
  const home = p.$('.j-sheet [data-todo-owed="recPRO00000000001"]')
  assert.deepEqual([...home.querySelectorAll('.ja-opt-card')].map((c) => c.dataset.opt), ['one', 'commit:8'])
  await p.click(home.querySelector('[data-go-pay]'))
  assert.equal(p.$('[data-pane="fees"]').hidden, false)
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('session by session with no quote: Choose how many has its own number, total and dates', async () => {
  const o = { ...PRO.owed[0], quote: null, perCents: 8000, perLabel: 'A$80', rest: { key: 'rest', n: 8, totalCents: 64000, totalLabel: 'A$640', perCents: 8000 } }
  const p = await openAccount({ ...PRO, owed: [o] })
  await p.click('#ja-tabs [data-go="fees"]')
  const card = p.$('[data-pane="fees"] [data-opt="count"]')
  const sel = card.querySelector('[data-owed-n]')
  sel.value = '3'; sel.dispatchEvent(new p.w.Event('change', { bubbles: true })); await p.settle()
  assert.match(card.textContent.replace(/\s+/g, ' '), /Choose how many A\$240 .*Pay A\$240/)
  assert.equal(card.querySelector('[data-count-dates]').textContent, dates.slice(0, 3).map((x) => x.label).join(', '))
  await p.click(card.querySelector('[data-owed]'))
  assert.deepEqual(p.posts.filter((b) => b.action === 'payOwed').map((b) => [b.sessions, b.option ?? null]), [[3, null]])
  p.close()
})

const OPEN = { ...BASE, owed: [], keep: { ...BASE.keep, open: true, holdUntil: '2026-12-04', holdUntilLabel: 'Fri 4 Dec' }, nextTerm: { name: 'Term 1 2027', players: [{ rowId: 'recTRM00000000001', player: 'Ari Family', group: 'Wednesday 7:30am, North Turramurra', dayTime: 'Wednesday 7:30am', status: 'invited', holdLabel: 'A$100', fullLabel: 'A$850', afterHoldLabel: 'A$750', openPayreqId: '' }] } }

await test('next term deposit: nothing while it is off; when on, "Keep your spot for Term 1 2027" on Fees and Home, then "is held"', async () => {
  const off = await openAccount(BASE)
  await off.click('#ja-tabs [data-go="fees"]')
  assert.equal(off.$('[data-deposit]'), null, 'no deposit card while staff have it off')
  off.close()
  const p = await openAccount(OPEN, { onPost: (b) => (b.action === 'nextTermChoice' ? { success: true, payreqId: 'PAY-NEXT-1' } : null) })
  await p.click('#ja-tabs [data-go="fees"]')
  const card = p.$('[data-pane="fees"] [data-deposit="recTRM00000000001"]')
  assert.match(card.textContent.replace(/\s+/g, ' '), /Keep your spot for Term 1 2027 Ari's Wednesday 7:30am place is held for current players until Fri 4 Dec\. Pay a A\$100 deposit to lock it in\..*A\$100 deposit.*Pay A\$100 deposit/)
  await p.click('[data-pane="home"] [data-todo-open]')
  assert.ok(p.$('.j-sheet [data-deposit="recTRM00000000001"]'), 'from Home too')
  p.$('.j-sheet .j-close').click(); await p.settle()
  assert.ok(p.$('#ja-nav [data-go="keep"] .dot'), 'Keep my spot is marked')
  await p.click(card.querySelector('[data-next="hold"]'))
  assert.deepEqual(p.posts.filter((b) => ['nextTermChoice', 'pay'].includes(b.action)).map((b) => [b.action, b.choice || b.payreqId]), [['nextTermChoice', 'hold'], ['pay', 'PAY-NEXT-1']])
  p.close()
  const held = await openAccount({ ...OPEN, nextTerm: { ...OPEN.nextTerm, players: [{ ...OPEN.nextTerm.players[0], status: 'held' }] } })
  await held.click('#ja-tabs [data-go="fees"]')
  assert.match(held.text('[data-pane="fees"] [data-deposit]'), /Ari's spot for Term 1 2027 is held.*Pay the rest \(A\$750\)/)
  held.close()
})

await test("Can't make it: Coach and Ligia, each with Call and Text (the message written for the date), and the thank you says both were told", async () => {
  const p = await openAccount({ ...BASE, owed: [] }, { onPost: (b) => (b.action === 'cancelSession' ? { success: true, already: false, cancellation: { id: 'CXL-1', rowId: b.rowId, date: b.date, label: lbl(b.date), time: '7:30am', noticeLevel: 'ok' }, told: [{ name: 'Your coach', phone: '0400 000 111', tel: '0400000111' }], toldWho: { coach: true, staff: true } } : null) })
  await p.click('[data-pane="home"] [data-cancel-open]')
  const rows = p.$$('.j-sheet [data-reach] .ja-reach-row')
  assert.deepEqual(rows.map((r) => r.querySelector('b').textContent), ['Coach', 'Ligia'])
  assert.deepEqual(rows.map((r) => r.querySelector('a[href^="tel:"]').getAttribute('href')), ['tel:0400000111', 'tel:+61456361962'])
  const sms = rows[0].querySelector('[data-sms]').getAttribute('href')
  assert.equal(decodeURIComponent(sms.split('body=')[1]), `Ari Family can't make ${lbl(future[0])} 7:30am`)
  // Another date: the text follows it.
  const sel = p.$('#cx-date'); sel.value = future[1]; sel.dispatchEvent(new p.w.Event('change', { bubbles: true })); await p.settle()
  assert.match(decodeURIComponent(p.$('.j-sheet [data-sms]').getAttribute('href')), new RegExp(`can't make ${lbl(future[1])} 7:30am`))
  assert.doesNotMatch(p.text('.j-sheet'), /Coach [A-Z][a-z]+/, 'no coach name')
  await p.click('.j-sheet [data-reason="sick"]')
  await p.click('#cx-go')
  assert.match(p.text('.j-sheet [data-cx-done]'), new RegExp(`We have told the coach and Ligia that Ari Family cannot make ${lbl(future[1])}, 7:30am`))
  assert.equal(p.$$('.j-sheet [data-reach] .ja-reach-row').length, 2, 'both numbers on the thank you too')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('side bar: dropdown sections that open, close and are remembered; the open page keeps its section open', async () => {
  // Redesign (Lee, 17 Oct 2026): My JFP (the four main pages), My family, Explore Joner.
  const p = await openAccount(BASE)
  const groups = p.$$('#ja-nav [data-navgrp]').map((g) => [g.dataset.navgrp, g.classList.contains('is-shut')])
  assert.deepEqual(groups, [['My JFP', false], ['My family', false], ['Explore Joner', true]])
  await p.click('#ja-nav [data-navsec="Explore Joner"]')
  assert.equal(p.$('#ja-nav [data-navgrp="Explore Joner"]').classList.contains('is-shut'), false)
  assert.equal(JSON.parse(p.w.localStorage.getItem('ja-nav-open'))['Explore Joner'], true)
  await p.click('#ja-nav [data-navsec="My family"]')
  assert.equal(p.$('#ja-nav [data-navgrp="My family"]').getAttribute('class').includes('is-shut'), true)
  // Going to a page in a shut section opens it.
  await p.click('#ja-tabs [data-more]')
  await p.click('.j-sheet [data-go="waivers"]')
  assert.equal(p.$('#ja-nav [data-navgrp="My family"]').classList.contains('is-shut'), false)
  p.close()
  const again = await openAccount(BASE, { store: { 'ja-nav-open': JSON.stringify({ 'Explore Joner': true, 'My family': false }) } })
  assert.equal(again.$('#ja-nav [data-navgrp="Explore Joner"]').classList.contains('is-shut'), false, 'remembered open')
  assert.equal(again.$('#ja-nav [data-navgrp="My family"]').classList.contains('is-shut'), true, 'remembered shut')
  again.close()
})

await test('Waivers: each player, on file or Sign; sign them all at once', async () => {
  const p = await openAccount({ ...BASE, players: [BASE.players[0], { key: 'bea family', name: 'Bea Family', age: 9, needsDob: false, waiver: { onFile: false }, enrolments: [] }, { key: 'cal family', name: 'Cal Family', age: 7, needsDob: false, waiver: { onFile: false }, enrolments: [] }] })
  await p.click('#ja-nav [data-go="waivers"]')
  assert.match(p.text('[data-pane="waivers"]'), /Ari Family\s*Signed 1 Oct 2026, signed by a parent or guardian\s*On file.*Bea Family\s*Not signed yet.*Sign/)
  await p.click('[data-waiver-all]')
  assert.match(p.text('.j-sheet'), /Bea Family.*Cal Family/)
  p.close()
})

await test('Book extra sessions: school hours 1 on 1 in term, holidays, a request with days and times; Book game analysis: Ask us, a link or "I\'ll send it"', async () => {
  const p = await openAccount({ ...BASE, extras: { ...BASE.extras, holidaySlots: 3 } }, { onPost: (b) => (b.action === 'requestExtra' ? { success: true, request: { id: 'XS-1', kind: b.kind, kindLabel: b.kind === 'analysis' ? 'Game analysis' : 'Extra session', player: b.player, status: 'new', createdAt: new Date().toISOString() }, emailed: true } : null) })
  await p.click('#ja-nav [data-go="extra"]')
  const ex = p.text('[data-pane="extra"]')
  assert.match(ex, /1 on 1 sessions run in school hours only, from about 7:30am to 2pm/)
  assert.match(ex, /school holidays/i)
  assert.ok(p.$('[data-pane="extra"] a[href="/holiday-bookings/"]'), 'holiday slots open: the holiday booking page')
  assert.doesNotMatch(ex, /Coach [A-Z][a-z]+/)
  await p.click('[data-pane="extra"] [data-x-send="extra"]')
  assert.match(p.text('#x-err'), /days or times/)
  await p.click('[data-pane="extra"] [data-x-group="days"] [data-x-chip="Tuesday"]')
  await p.click('[data-pane="extra"] [data-x-group="times"] [data-x-chip="After school"]')
  await p.click('[data-pane="extra"] [data-x-group="type"] [data-x-chip="Small group"]')
  await p.click('[data-pane="extra"] [data-x-send="extra"]')
  const sent = p.posts.find((b) => b.action === 'requestExtra')
  assert.deepEqual([sent.kind, sent.player, sent.type, sent.days, sent.times], ['extra', 'Ari Family', 'Small group', ['Tuesday'], ['After school']])
  assert.ok(p.$('[data-pane="extra"] [data-x-sent]'))
  await p.click('#ja-nav [data-go="analysis"]')
  assert.match(p.text('[data-pane="analysis"] .ja-price-card'), /Exclusive discount/)
  assert.doesNotMatch(p.text('[data-pane="analysis"]'), /\bLee\b|\bDean\b/)
  await p.click('[data-pane="analysis"] [data-x-send="analysis"]')
  const ga = p.posts.filter((b) => b.action === 'requestExtra')[1]
  assert.deepEqual([ga.kind, ga.video], ['analysis', ''])
  assert.match(p.text('[data-pane="analysis"] [data-x-sent]'), /reply with the price/)
  assert.deepEqual(p.errors, [])
  p.close()
})

// ---------- the staff portal ----------

await test('portal Next term: a note says what turning it on does (the deposit card in every family\'s Fees and Home); it stays off', async () => {
  const p = await openPortal({ hash: '#next', onPost: (b) => (b.action === 'nextTerm' ? { success: true, nextTerm: { name: 'Term 1 2027', holdCents: 10000, open: false, holdUntil: '2026-12-04' }, prices: { fullLabel: 'A$850', afterHoldLabel: 'A$750' }, players: [], totals: { players: 0, invited: 0, held: 0, paid: 0, no: 0, interested: 0, none: 0 } } : null) })
  assert.match(p.text('#nt-note'), /turning it on shows a "Keep your spot for Term 1 2027" deposit card at the top of every current family's Fees and Home/)
  assert.match(p.text('#nt-note'), /until Fri 4 Dec\. Pay a A\$100 deposit/)
  assert.equal(p.$('#nt-open').checked, false)
  assert.equal(p.$('#nt-until').value, '2026-12-04')
  p.close()
})

await test('portal Requests: extra sessions and game analysis listed first, Mark done', async () => {
  const list = [{ id: 'GA-1', kind: 'analysis', kindLabel: 'Game analysis', player: 'Bea Family', status: 'new', email: 'robin.family@example.com', parentName: 'Robin Family', matchDate: '2026-10-11', video: '', sendLater: true, notes: 'Number 7', createdAt: new Date().toISOString(), deliveries: { staff: 'sent' } },
    { id: 'XS-1', kind: 'extra', kindLabel: 'Extra session', player: 'Ari Family', status: 'done', email: 'robin.family@example.com', type: '1 on 1', days: ['Monday'], times: [], notes: '', createdAt: new Date().toISOString(), deliveries: { staff: 'sent' } }]
  const p = await openPortal({ hash: '#requests', onPost: (b) => (b.action === 'extraRequests' ? { success: true, requests: list } : b.action === 'board' ? { success: true, groups: [] } : null) })
  assert.match(p.text('#view') || p.d.body.textContent, /Extra sessions and game analysis/)
  assert.match(p.d.body.textContent.replace(/\s+/g, ' '), /Game analysis Bea Family.*they will send it.*Number 7/)
  await p.click('[data-xr-id="GA-1"]')
  assert.deepEqual(p.posts.filter((b) => b.action === 'extraRequestStatus').map((b) => [b.id, b.status]), [['GA-1', 'done']])
  p.close()
})

console.log(`\n${passed} round 3 checks passed`)
