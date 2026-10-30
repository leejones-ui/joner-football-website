// Follow ups and the end of term question (Lee, 30 Oct 2026): the daily
// Telegram brief, offer reminders, finish-setting-up emails for empty accounts,
// and "How likely are you to recommend JFP to a friend?" answered in My account.
// Pure checks of the words, then end to end on the harness.
//   npx astro build && node scripts/holiday-local.mjs 4814 (another terminal), then
//   node scripts/test-jfp-followups.mjs 4814
// Every name here is invented.
import assert from 'node:assert/strict'
import { normaliseConfig } from '../api/_jfp-store.js'
import { offerReminderWords, followUpWords } from '../api/_jfp-admin-brief.js'
import { nudgeWords, profileGap } from '../api/_jfp-profile-nudge.js'
import { surveyWords, surveyRecipients, band, npsOf } from '../api/_jfp-feedback.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
const flat = (w) => [w.subject, w.heading, ...w.paras, w.cta?.label].join('\n')
const noDash = (s) => assert.ok(!/—|–/.test(s), `no dashes: ${s}`)

// ---------- pure ----------

await test('the switches: brief on, family emails off, question closed', async () => {
  const c = normaliseConfig({})
  assert.equal(c.dailyBrief, true)
  assert.equal(c.offerReminders, false)
  assert.equal(c.accountFollowUps, false)
  assert.equal(c.feedback.open, false)
  assert.equal(normaliseConfig({ dailyBrief: false }).dailyBrief, false)
})
await test('offer reminder words: the group, the date, no em dashes', async () => {
  const w = offerReminderWords({ parentName: 'Kim Lane', players: ['Rio Lane'], group: 'Wednesday 7:30am, North Turramurra', expiresAt: '2026-10-31T05:38:00Z', url: 'https://x' })
  assert.match(w.subject, /Wednesday 7:30am/)
  assert.match(w.paras[0], /^Hi Kim\. .*Rio Lane/)
  noDash(flat(w))
})
await test('follow up words: Sydney books a group, away goes to the app', async () => {
  const s = followUpWords({ away: false, name: 'Kim Lane' }), a = followUpWords({ away: true, country: 'the UK', coach: true })
  assert.equal(s.subject, 'Finish setting up your JFP account')
  assert.match(a.paras.join(' '), /the UK/)
  assert.match(a.cta.url, /\/app\//)
  noDash(flat(s)); noDash(flat(a))
})
await test('survey words, one email per family, test and staff emails left out', async () => {
  noDash(flat(surveyWords({ parentName: 'Kim Lane', term: 'Term 4 2026' })))
  const rows = [
    { player: 'Rio Lane', parent: 'Kim Lane', holdsPlace: true, e: ['kim@example.com', 'sam@example.com'] },
    { player: 'Ava Lane', parent: 'Kim Lane', holdsPlace: true, e: ['kim@example.com'] },
    { player: 'Gone Kid', parent: 'X', holdsPlace: false, e: ['gone@example.com'] },
    { player: 'Staff Kid', parent: 'Y', holdsPlace: true, e: ['coach@jonerfootball.com'] },
  ]
  const r = surveyRecipients(rows, (x) => x.e)
  assert.deepEqual(r.map((x) => x.email), ['kim@example.com', 'sam@example.com'])
  assert.deepEqual(r[0].players, ['Rio Lane', 'Ava Lane'])
})
await test('score bands and the net score', async () => {
  assert.deepEqual([10, 9, 8, 7, 6, 0].map(band), ['promoter', 'promoter', 'passive', 'passive', 'detractor', 'detractor'])
  assert.equal(npsOf([]), null)
  assert.equal(npsOf([{ score: 10 }, { score: 9 }, { score: 7 }, { score: 3 }]), 25)
})

await test('profile reminder words: one player, two players, the player themself', async () => {
  const one = nudgeWords({ parentName: 'Kim Lane', players: ['Rio Lane'] })
  assert.equal(one.subject, "Fill in Rio's player profile")
  assert.match(one.text, /what Rio wants to work on and develop in their game/)
  const two = nudgeWords({ parentName: 'Kim Lane', players: ['Rio Lane', 'Ava Lane'] })
  assert.match(two.paras[0], /the player profiles for Rio and Ava/)
  const me = nudgeWords({ parentName: 'Will Pez', players: ['Will Pez'], self: true })
  assert.match(me.text, /your player profile.*what you want to work on and develop in your game/)
  for (const w of [one, two, me]) { noDash(flat(w)); noDash(w.text); assert.ok(w.text.length <= 640) }
  assert.equal(profileGap(null), 'none')
  assert.equal(profileGap({ club: 'A', team: 'B', level: 'C', positions: ['Winger'] }), 'photo')
  assert.equal(profileGap({ club: 'A', photo: 'x' }), 'thin')
  assert.equal(profileGap({ club: 'A', team: 'B', level: 'C', positions: ['Winger'], photo: 'x' }), '')
})

// ---------- end to end on the harness ----------

const B = `http://localhost:${process.argv[2] || 4321}`
let ipSeq = 10
function client(ip = `10.9.8.${ipSeq++}`) {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const telegrams = async () => (await fetch(`${B}/__telegram`)).json()
const tgText = (t) => (typeof t === 'string' ? t : t.text || JSON.stringify(t))
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  return c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const ok = async (c, action, body) => { const r = await portal(c, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const acct = (c, action, body = {}) => c.call('/api/jfp-account', { action, ...body })
const sweep = async (nowMs) => (await fetch(`${B}/api/jfp-groups?sweep=1&now=${nowMs}`, { headers: { authorization: 'Bearer local-cron-secret' } })).json()

const lee = client(), sam = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')

const base = { 'Term 3 Day': 'Monday', 'Term 3 Time': '3:05pm', 'Term 3 Location': 'Belrose HQ', 'Coach': 'Dean Mac', 'Term 4 Confirmation': 'Confirmed', 'Term 4 Payment Type': 'JFP 10 weeks', 'Term 4 Fee': 850, 'Term 4 Amount Paid': 850, 'Term 4 Payment Status': 'Paid' }
await fetch(`${B}/__airtable-add`, { method: 'POST', body: JSON.stringify({ table: 'term4', rows: [{ ...base, 'Player Name': 'Fia Feedback', 'Email': 'fia.fam@example.com', 'Parent Name': 'Gail Feedback' }] }) })

await test('Follow ups page: switches off for family emails, the words, the brief', async () => {
  const d = await ok(lee, 'followUps')
  assert.deepEqual(d.switches, { dailyBrief: true, offerReminders: false, accountFollowUps: false })
  assert.match(d.brief, /^JFP daily brief, /)
  assert.match(d.brief, /Requests waiting: \d+/)
  assert.match(d.brief, /jfp-portal/)
  noDash(d.brief)
  for (const w of Object.values(d.words)) noDash(flat(w))
  assert.ok(Array.isArray(d.offers) && Array.isArray(d.accounts))
})
await test('a coach cannot see Follow ups or Feedback', async () => {
  assert.equal((await portal(sam, 'followUps')).status, 403)
  assert.equal((await portal(sam, 'feedbackPage')).status, 403)
})
await test('a reminder for an offer that does not exist is refused, nothing sent', async () => {
  const before = (await emails()).length
  assert.equal((await portal(lee, 'remindOffer', { id: 'nope' })).status, 409)
  assert.equal((await emails()).length, before)
})

await test('the daily brief goes to Telegram once a day from 7am Sydney', async () => {
  const at = (iso) => Date.parse(iso)
  const count = async () => (await telegrams()).filter((t) => /^JFP daily brief/.test(tgText(t))).length
  const start = await count()
  await sweep(at('2026-11-01T19:30:00Z')) // 6:30am Monday 2 Nov Sydney: not yet
  assert.equal(await count(), start)
  await sweep(at('2026-11-01T20:30:00Z')) // 7:30am
  assert.equal(await count(), start + 1)
  await sweep(at('2026-11-01T22:30:00Z')) // 9:30am, same day
  assert.equal(await count(), start + 1)
})
await test('the brief can be switched off', async () => {
  await ok(lee, 'followUpsSwitch', { which: 'dailyBrief', on: false })
  const before = (await telegrams()).length
  await sweep(Date.parse('2026-11-02T20:30:00Z'))
  assert.equal((await telegrams()).length, before)
  await ok(lee, 'followUpsSwitch', { which: 'dailyBrief', on: true })
  assert.equal((await portal(lee, 'followUpsSwitch', { which: 'nope', on: true })).status, 400)
})

const fam = client()
await signIn(fam, 'fia.fam@example.com')
await test('the question shows in My account only while it is open', async () => {
  assert.equal((await acct(fam, 'overview')).data.feedback, null)
  assert.equal((await acct(fam, 'feedbackSave', { score: 9 })).status, 400)
  await ok(lee, 'feedbackOpen', { open: true })
  const f = (await acct(fam, 'overview')).data.feedback
  assert.equal(f.question, 'How likely are you to recommend JFP to a friend?')
  assert.equal(f.mine, null)
})
await test('a family answers, Lee sees it on Feedback, and a low score comes to Telegram', async () => {
  assert.equal((await acct(fam, 'feedbackSave', { score: 11 })).status, 400)
  const r = await acct(fam, 'feedbackSave', { score: 4, comment: 'More shooting please', share: true })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.deepEqual(r.data.mine, { score: 4, comment: 'More shooting please', share: true })
  const t = (await telegrams()).map(tgText).filter((x) => /JFP feedback/.test(x)).at(-1)
  assert.match(t, /^LOW SCORE: JFP feedback 4\/10 from Gail Feedback \(Fia Feedback\)/)
  const p = await ok(lee, 'feedbackPage')
  const mine = p.answers.find((a) => a.email === 'fia.fam@example.com')
  assert.equal(mine.score, 4)
  assert.equal(mine.band, 'detractor')
  assert.equal(p.totals.answers, 1)
  assert.equal(p.nps, -100)
  assert.equal((await acct(fam, 'overview')).data.feedback.mine.score, 4)
})
await test('Send asks for the family count first and sends nothing without it', async () => {
  const before = (await emails()).length
  const r = await portal(lee, 'feedbackSend', {})
  assert.equal(r.status, 409)
  assert.ok(Number.isInteger(r.data.count) && r.data.count >= 1, JSON.stringify(r.data))
  assert.equal((await emails()).length, before)
})
await test('closing hides the question again', async () => {
  await ok(lee, 'feedbackOpen', { open: false })
  assert.equal((await acct(fam, 'overview')).data.feedback, null)
})

await test('profile reminders: count first, one email per family, never twice', async () => {
  const p = await ok(lee, 'profileNudge')
  assert.ok(p.count >= 1 && p.families.some((f) => f.email === 'fia.fam@example.com'), JSON.stringify(p).slice(0, 300))
  const before = (await emails()).length
  assert.equal((await portal(lee, 'profileNudge', { confirm: p.count + 1 })).status, 409)
  assert.equal((await emails()).length, before)
  const r = await ok(lee, 'profileNudge', { confirm: p.count })
  assert.equal(r.sent, p.count)
  const fia = (await emails()).filter((e) => e.to.includes('fia.fam@example.com') && /player profile/.test(e.subject))
  assert.equal(fia.length, 1)
  assert.equal((await ok(lee, 'profileNudge')).count, 0)
  assert.equal((await portal(sam, 'profileNudge')).status, 403)
})

console.log(`\n${passed} follow up and feedback checks passed`)
