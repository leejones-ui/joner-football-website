// My account > Book extra sessions: the sessions to book now, a private link,
// Book (choose the player, waiver first) then Book and pay, in jsdom
// (money engineer, 14 Oct 2026). Every name and amount here is invented.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM, VirtualConsole } from 'jsdom'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
const root = fileURLToPath(new URL('../', import.meta.url))
const bundled = (await build({ entryPoints: [path.join(root, 'src/scripts/jfp-account.js')], bundle: true, write: false, format: 'iife', target: 'es2022', logLevel: 'silent' })).outputFiles[0].text
const astro = fs.readFileSync(path.join(root, 'src/pages/jfp-account.astro'), 'utf8')
const markup = astro.slice(astro.indexOf('<div class="jfp ja" id="jfp-account"'), astro.lastIndexOf('</BaseLayout>'))

async function openAccount(overview, { onPost = () => null, hash = '' } = {}) {
  const errors = [], posts = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => { if (!/Not implemented: navigation/.test(e.message)) errors.push(e) })
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, { url: `http://localhost/jfp-account/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  const w = dom.window
  w.scrollTo = () => {}
  w.requestAnimationFrame = (f) => setTimeout(f, 0)
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
    return reply({ success: true })
  }
  w.eval(bundled)
  const d = w.document
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 4)) }
  await settle()
  const $ = (s) => d.querySelector(s)
  const text = (s) => ($(s)?.textContent || '').replace(/\s+/g, ' ').trim()
  const click = async (s) => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error(`Nothing to click: ${s}`); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await settle() }
  return { w, d, $, text, click, settle, posts, errors, close: () => w.close() }
}

const slot = (id, x = {}) => ({ id, date: '2026-10-20', dateLabel: 'Tue 20 Oct', time: '7:30am', durationMin: 60, location: 'Belrose HQ', address: '', capacity: 2, placesLeft: 2, priceCents: 7000, priceLabel: 'A$70', label: 'Extra 1 on 1', visibility: 'public', note: '', ...x })
const BASE = {
  email: 'robin.family@example.com', parentName: 'Robin Family', self: false, nextTerm: null, term: 'Term 4 2026', waiverVersion: 'v1', kitUrl: '', kitPriceLabel: 'A$60',
  keep: { name: 'Term 1 2027', open: false, holdLabel: 'A$100', holdUntil: '', holdUntilLabel: '', players: [] },
  players: [{ key: 'arifamily', name: 'Ari Family', age: 12, needsDob: false, waiver: { onFile: true }, placeNoSession: false, enrolments: [] }, { key: 'beafamily', name: 'Bea Family', age: 9, needsDob: false, waiver: { onFile: false }, placeNoSession: false, enrolments: [] }],
  todo: [], owed: [], reasons: [], noteMax: 500, paid: [], requests: [], bookings: [], juniors: null,
  extras: { analysisPriceLabel: '', holidaySlots: 0, slots: [], bookable: [slot('XS-1-AAAAAA'), slot('XS-2-BBBBBB', { placesLeft: 0 })], days: ['Monday'], times: ['After school'], types: ['1 on 1'], mine: [] },
}

await test('the sessions to book now: date, time, place, price and places left, never a coach; Book, the waiver first, then Book and pay', async () => {
  let n = 0
  const p = await openAccount(BASE, { hash: '#extra', onPost: (b) => (b.action === 'bookExtra' ? (n++ ? { success: true, url: 'http://localhost/mock-stripe/?cs=cs_test_x' } : { status: 409, success: false, error: 'That session is full.', code: 'slot' }) : null) })
  const box = p.text('#x-bookable')
  assert.match(box, /Sessions you can book now/)
  assert.match(box, /Tue 20 Oct · 7:30am/)
  assert.match(box, /Belrose HQ · 60 min · A\$70/)
  assert.match(box, /2 places left/)
  assert.match(box, /Full/)
  assert.ok(!/coach/i.test(box), 'no coach names for families')
  assert.equal(p.d.querySelectorAll('#x-bookable [data-xbook]').length, 1, 'no Book on a full session')
  await p.click('[data-xbook="XS-1-AAAAAA"]')
  const sel = p.$('[data-xbook-player]')
  sel.value = 'beafamily'
  await p.click('[data-xbook-go="XS-1-AAAAAA"]')
  assert.match(p.text('[data-xslot="XS-1-AAAAAA"] [data-xslot-err]'), /Sign Bea Family's waiver first/)
  assert.equal(p.posts.filter((b) => b.action === 'bookExtra').length, 0, 'nothing is held without the waiver')
  sel.value = 'arifamily'
  await p.click('[data-xbook-go="XS-1-AAAAAA"]')
  assert.equal(p.text('[data-xslot="XS-1-AAAAAA"] [data-xslot-err]'), 'That session is full.')
  assert.deepEqual(p.posts.filter((b) => b.action === 'bookExtra').at(-1), { action: 'bookExtra', slotId: 'XS-1-AAAAAA', k: '', playerKey: 'arifamily' })
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('a private session link (#extra?slot=&k=) shows that session first, and books with its key', async () => {
  const p = await openAccount(BASE, { hash: '#extra?slot=XS-9-CCCCCC&k=secretkey', onPost: (b) => (b.action === 'extraSlot' ? (b.slotId === 'XS-9-CCCCCC' && b.k === 'secretkey' ? { success: true, slot: slot('XS-9-CCCCCC', { visibility: 'private', time: '9:00am', priceLabel: 'A$65' }) } : { status: 404, success: false }) : b.action === 'bookExtra' ? { success: true, paid: true } : null) })
  await p.settle()
  assert.match(p.text('[data-xslot="XS-9-CCCCCC"]'), /Your session.*9:00am.*A\$65/)
  await p.click('[data-xbook="XS-9-CCCCCC"]')
  await p.click('[data-xbook-go="XS-9-CCCCCC"]')
  assert.deepEqual(p.posts.filter((b) => b.action === 'bookExtra').at(-1), { action: 'bookExtra', slotId: 'XS-9-CCCCCC', k: 'secretkey', playerKey: 'arifamily' })
  assert.match(p.text('[data-xslot="XS-9-CCCCCC"] [data-xslot-err]'), /Already booked and paid/)
  const gone = await openAccount(BASE, { hash: '#extra?slot=XS-8-DDDDDD&k=bad', onPost: (b) => (b.action === 'extraSlot' ? { status: 404, success: false } : null) })
  await gone.settle()
  assert.match(gone.text('#x-bookable'), /not open any more/)
  assert.deepEqual([...p.errors, ...gone.errors], [])
  p.close(); gone.close()
})

console.log(`\n${passed} book extra sessions page checks passed`)
