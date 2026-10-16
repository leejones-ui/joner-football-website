// "Check payments from the bank" on Money (Lee, 15 Oct 2026), end to end
// against the local harness (fake KV). The Mac side is played by the test: it
// writes jfp:bank-feed-status and the feed the way jfp_bank_feed.py does.
//   npm run build && HOLIDAY_LOCAL_PORT=4795 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-bank-refresh-flow.mjs 4795                          (another)
// Every name and amount here is invented.
import assert from 'node:assert/strict'
import { loadBank, bankPanel, bankFreshness, checkBank, bankLink, bankSummary } from '../src/scripts/jfp-portal-bank.js'
import { money } from '../src/scripts/jfp-common.js'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

function client() {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
async function signIn(c, email) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience: 'staff' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(Date.now() - n * 86400000))
// The Mac's side: what jfp_bank_feed.py writes after a run.
const macStatus = (s) => kv(['SET', 'jfp:bank-feed-status', JSON.stringify(s)])
const setFeedDates = async (date, extra = []) => {
  const feed = JSON.parse(await kv(['GET', 'jfp:xero-bank-in']))
  feed.items = [...extra, ...feed.items.map((x) => ({ ...x, date: x.date > date ? date : x.date }))]
  feed.at = new Date().toISOString()
  await kv(['SET', 'jfp:xero-bank-in', JSON.stringify(feed)])
}
// The Money page's ui, for the real panel code.
const toasts = []
const ui = { post: async (action, body = {}) => portal(action, body), toast: (m) => toasts.push(m), redraw: () => {} }
const panel = async () => { await loadBank(ui, () => {}, { force: true }); return bankPanel('') }

await test('a coach cannot press it or read its status (403)', async () => {
  const coach = client()
  await signIn(coach, 'jonerfootballsam@gmail.com')
  for (const action of ['bankRefresh', 'bankRefreshStatus', 'bankCheck']) assert.equal((await coach.call('/api/jfp-portal-data', { action })).status, 403, action)
  assert.equal(await kv(['GET', 'jfp:bank-refresh-req']), 'null', 'no request written by a coach')
})

let asked
await test('pressing it writes the request for the Mac, and a second press while waiting reuses it', async () => {
  const r = await portal('bankRefresh')
  assert.equal(r.status, 200, JSON.stringify(r.data))
  asked = r.data.request.at
  const req = JSON.parse(await kv(['GET', 'jfp:bank-refresh-req']))
  assert.equal(req.at, asked)
  assert.equal(req.by, 'leejones@jonerfootball.com')
  assert.ok(Number(await kv(['TTL', 'jfp:bank-refresh-req'])) > 0, 'the request expires')
  const again = await portal('bankRefresh')
  assert.equal(again.data.request.at, asked, 'same request')
  assert.equal(again.data.reused, true)
  const st = (await portal('bankRefreshStatus')).data
  assert.equal(st.done, false, 'not done before the Mac answers')
  assert.equal(st.request.at, asked)
})

await test('the status the Mac writes is read back, and done once its run started after the request', async () => {
  await macStatus({ at: new Date(Date.parse(asked) - 60000).toISOString(), ok: true, latestLineDate: day(15), count: 4 })
  assert.equal((await portal('bankRefreshStatus')).data.done, false, 'a run from before the press does not count')
  await macStatus({ at: new Date(Date.parse(asked) + 1000).toISOString(), finishedAt: new Date().toISOString(), ok: true, latestLineDate: day(15), count: 4, trigger: 'requested' })
  const st = (await portal('bankRefreshStatus')).data
  assert.equal(st.done, true)
  assert.equal(st.status.ok, true)
  assert.equal(st.status.latestLineDate, day(15))
  assert.equal(st.status.count, 4)
  assert.ok(!('error' in st.status))
})

await test('the newest line is over 2 days old: the amber note says so, with the CSV upload beside it', async () => {
  await setFeedDates(day(15))
  const check = (await portal('bankCheck')).data.bank
  assert.equal(check.feed.latestLineDate, day(15))
  assert.equal(check.feed.status.ok, true)
  assert.equal(bankFreshness(check).oldLines, true)
  const html = await panel()
  assert.match(html, /id="m-bank-refresh"[^>]*>Check bank now</)
  assert.match(html, new RegExp(`Checked [^<]+ · lines to ${new Date(`${day(15)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}<`))
  const note = html.match(/<div class="j-box j-box-amber small jb-note" id="m-bank-old">([\s\S]*?)<\/div><\/div>/)
  assert.ok(note, 'the amber note is there')
  assert.match(note[1], /Xero only has bank lines up to .+\. Payments appear there after they're reconciled in Xero\. For anything newer, upload today's CommBank statement \(CSV\)\./)
  assert.match(note[1], /for="m-bank-file"[^>]*>Upload bank CSV/, 'the upload button sits in the note')
  assert.equal((html.match(/id="m-bank-file"/g) || []).length, 1, 'one upload input only')
  assert.ok(!/—/.test(html), 'no em dashes')
})

await test('the Dashboard link: the same count and A$ total, from the real bank read', async () => {
  const check = (await portal('bankCheck')).data.bank
  await panel()
  const s = bankSummary()
  assert.equal(s.count, check.items.length, 'this term\'s lines')
  assert.equal(s.cents, check.items.reduce((t, x) => t + x.cents, 0))
  // Redesign (16 Oct 2026): one line on the Dashboard; the check is on Money.
  const html = bankLink('d')
  assert.match(html, new RegExp(`id="d-bank-count">${check.items.length}<`))
  assert.match(html, new RegExp(`id="d-bank-total">${money(s.cents).replace('$', '\\$')}<`))
  assert.ok(!/d-bank-refresh|d-bank-old|d-bank-file/.test(html), 'no button, note or upload on the Dashboard')
  assert.ok(!/—/.test(html), 'no em dashes')
})

await test('lines from today: no amber note', async () => {
  await setFeedDates(day(0), [{ id: 'XERO-test-today', date: day(0), cents: 17000, payer: 'Sample Family', description: 'Term fees', reference: '', reconciled: false }])
  const html = await panel()
  assert.ok(!/id="m-bank-old"/.test(html))
  assert.match(html, /for="m-bank-file"/, 'the upload is still there')
})

await test('Xero needs reconnecting: the panel says so', async () => {
  await macStatus({ at: new Date().toISOString(), ok: false, latestLineDate: '', count: 0, error: 'Xero needs reconnecting' })
  const html = await panel()
  assert.match(html, /id="m-bank-err">Xero needs reconnecting\./)
})

await test('the button: asks, polls until the Mac answers, reloads and says how many are new', async () => {
  const before = JSON.parse(await kv(['GET', 'jfp:xero-bank-in']))
  // A line shaped like one the panel already shows (an amount a place costs).
  const like = (await portal('bankCheck')).data.bank.items.find((x) => x.source === 'xero')
  assert.ok(like, 'the harness feed has a line on the list')
  let polls = 0
  const macUi = {
    ...ui,
    post: async (action, body) => {
      if (action === 'bankRefreshStatus' && ++polls === 2) {
        // The Mac picks it up: a new line and a fresh status.
        await kv(['SET', 'jfp:xero-bank-in', JSON.stringify({ ...before, at: new Date().toISOString(), items: [{ id: 'XERO-test-new', date: day(0), cents: like.cents, payer: like.payer, description: 'Fees', reference: '', reconciled: false }, ...before.items] })])
        await macStatus({ at: new Date().toISOString(), ok: true, latestLineDate: day(0), count: before.items.length + 1, trigger: 'requested' })
      }
      return portal(action, body)
    },
  }
  toasts.length = 0
  await kv(['DEL', 'jfp:bank-refresh-req'])
  await panel()
  await checkBank(macUi, { pollMs: 30, maxMs: 5000 })
  assert.ok(polls >= 2)
  assert.deepEqual(toasts, ['Found 1 new payment'])
  assert.match(bankPanel(''), /Check bank now/, 'button back to normal')
  // Pressed again with nothing new.
  toasts.length = 0
  polls = 10
  const quiet = { ...ui, post: async (action, body) => { if (action === 'bankRefreshStatus') await macStatus({ at: new Date().toISOString(), ok: true, latestLineDate: day(0), count: 1 }); return portal(action, body) } }
  await kv(['DEL', 'jfp:bank-refresh-req'])
  await checkBank(quiet, { pollMs: 30, maxMs: 5000 })
  assert.deepEqual(toasts, ['No new payments'])
})

await test('the Mac never answers: it stops waiting and says so plainly', async () => {
  toasts.length = 0
  await kv(['DEL', 'jfp:bank-refresh-req'])
  await checkBank(ui, { pollMs: 30, maxMs: 200 })
  assert.equal(toasts.length, 1)
  assert.match(toasts[0], /taking longer than usual/)
})

console.log(`\n${passed} bank refresh checks passed`)
