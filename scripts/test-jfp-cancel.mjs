// "Can't make a session", end to end. Starts its own copy of the local harness
// (scripts/holiday-local.mjs: fake Airtable, fake Brevo, fake Telegram, in
// memory KV) on a free port, so nothing real is ever emailed, texted or written.
//   node scripts/test-jfp-cancel.mjs
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const B = `http://localhost:${port}`
const harness = spawn(process.execPath, [path.join(HERE, 'holiday-local.mjs')], {
  // A clean environment: no real tokens can leak into the harness.
  env: { PATH: process.env.PATH, HOME: process.env.HOME, HOLIDAY_LOCAL_PORT: String(port), JFP_CANCEL_RATE_LIMIT: '6' },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let ready
const up = new Promise((resolve, reject) => { ready = resolve; harness.on('exit', (c) => reject(new Error(`harness exited ${c}`))) })
harness.stdout.on('data', (d) => { if (String(d).includes('holiday local harness on')) ready() })
process.on('exit', () => harness.kill())
await up

let passed = 0
let ipSeq = 1
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

function client() {
  const jar = new Map()
  const ip = `10.9.0.${ipSeq++}`
  async function call(p, body) {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
  return { call }
}
const j = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => j('/__emails')
const telegrams = () => j('/__telegram')
const airtable = () => j('/__airtable')
const kv = async (cmd) => { const t = await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text(); try { return JSON.parse(t) } catch { return t } }

async function signIn(c, email, audience) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const mail = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1)
  assert.ok(mail, `a code email went to ${email}`)
  const v = await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: mail.subject.match(/(\d{6})/)[1] })
  assert.equal(v.status, 200, JSON.stringify(v.data))
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const acct = (c, action, body = {}) => c.call('/api/jfp-account', { action, ...body })

// ---------- time, in Sydney, independent of the code under test ----------
const sydney = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
const ymd = (ms) => { const s = sydney(ms); return `${s.year}-${s.month}-${s.day}` }
const day = 86400000
// A Monday two to three weeks ago, so the term is under way: early weeks are
// past, later ones are still to come.
let mon = Date.now() - 14 * day
while (sydney(mon).weekday !== 'Monday') mon -= day
const TERM_START = ymd(mon)
const to12 = (h, m) => `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`

// ---------- setup: Lee signs in, sets the term, coaches and groups ----------
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const settings = (await portal(lee, 'getSettings')).data.config
const withPhone = (phones) => settings.coaches.map((c) => ({ ...c, phone: phones[c.id] || '' }))

await test('Settings > Coaches: a bad mobile is refused, a good one is saved and normalised', async () => {
  const bad = await portal(lee, 'saveSettings', { config: { coaches: withPhone({ sam: 'call me maybe' }) } })
  assert.equal(bad.status, 400)
  assert.match(bad.data.error, /mobile/)
  const good = await portal(lee, 'saveSettings', { config: { termStart: TERM_START, weeks: 10, coaches: withPhone({ sam: '0411 222 333' }) } })
  assert.equal(good.status, 200, JSON.stringify(good.data))
  const sam = good.data.config.coaches.find((c) => c.id === 'sam')
  assert.equal(sam.phone, '0411222333')
  assert.equal(good.data.config.coaches.find((c) => c.id === 'dean').phone, '')
  assert.equal(good.data.config.termStart, TERM_START)
})

const mk = async (group) => { const r = await portal(lee, 'saveGroup', { group }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.group.id }
const TUE420 = await mk({ day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct', minAge: 7, maxAge: 18 })
const TUE525 = await mk({ day: 'Tuesday', time: '5:25pm', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'direct', minAge: 7, maxAge: 18 })
const WED420 = await mk({ day: 'Wednesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct', minAge: 7, maxAge: 18 })

const rows = (await airtable()).term4
const pick = (d, t) => rows.find((r) => r.fields['Term 3 Day'] === d && r.fields['Term 3 Time'] === t)
const RILEY = rows.find((r) => r.fields['Player Name'] === 'Riley Returning') // Tue 4:20pm, Sam, returning@example.com
const OTHER = pick('Tuesday', '5:25pm') // another family, Dean's group
const THIRD = pick('Wednesday', '4:20pm') // a third family, Sam's group
const LATE = pick('Monday', '5:25pm') // moved to a session about 95 minutes away
const mailOf = (r) => r.fields.Email
assert.ok(RILEY && OTHER && THIRD && LATE)
const parentRiley = client(); await signIn(parentRiley, 'returning@example.com', 'parent')
const parentOther = client(); await signIn(parentOther, mailOf(OTHER), 'parent')
const parentThird = client(); await signIn(parentThird, mailOf(THIRD), 'parent')

// A session about 95 minutes away, in its own group with Ruby as coach.
let soon = Date.now() + 95 * 60000
// Never land on one of the groups made above, by the same minute.
const taken = new Set(['Tuesday 4:20pm', 'Tuesday 5:25pm', 'Wednesday 4:20pm'])
const slot = (ms) => { const x = sydney(ms); return `${x.weekday} ${to12(Number(x.hour), Number(x.minute))}` }
while (taken.has(slot(soon))) soon += 60000
const ss = sydney(soon)
const LATE_DATE = `${ss.year}-${ss.month}-${ss.day}`
const LATE_DAY = ss.weekday
const LATE_TIME = to12(Number(ss.hour), Number(ss.minute))
await fetch(`${B}/__patch?table=term4&id=${LATE.id}&fields=${encodeURIComponent(JSON.stringify({ 'Term 3 Day': LATE_DAY, 'Term 3 Time': LATE_TIME, 'Term 3 Location': 'Belrose HQ' }))}`)
const NEAR = await mk({ day: LATE_DAY, time: LATE_TIME, location: 'Belrose HQ', coachId: 'ruby', capacity: 6, mode: 'direct', minAge: 7, maxAge: 18 })
const parentLate = client(); await signIn(parentLate, mailOf(LATE), 'parent')

// Dates for Riley's group, as the server offers them.
const overview = async (c) => (await acct(c, 'overview')).data
const enrol = (o, rowId) => o.players.flatMap((p) => p.enrolments).find((e) => e.rowId === rowId)
const ov = await overview(parentRiley)
const rileyEn = enrol(ov, RILEY.id)
assert.ok(rileyEn.sessions.length >= 4, 'several sessions still to come')
const [D1, D2, D3] = rileyEn.sessions.map((s) => s.iso)
const PAST = ymd(mon + 1 * day) // the first Tuesday of term
const atBefore = JSON.stringify((await airtable()).term4)

await test('the account page offers upcoming sessions only, with the coach mobile and never an email', async () => {
  assert.ok(rileyEn.sessions.every((s) => s.startMs > Date.now() && !s.iso.startsWith('2020')))
  assert.ok(!rileyEn.sessions.some((s) => s.iso === PAST), 'a past session is not offered')
  assert.deepEqual(rileyEn.contacts, [{ name: 'Coach Sam York', phone: '0411 222 333', tel: '0411222333' }])
  const all = JSON.stringify(ov)
  assert.ok(!/jonerfootballsam@|jonerfootballdean@|leejones@/.test(all), 'no coach email reaches a parent')
  assert.deepEqual(ov.reasons.map((r) => r.label), ['Sick or injured', 'School or exams', 'Family or travel', 'Other'])
  // Dean has no mobile yet, so another family sees no contact for him.
  assert.deepEqual(enrol(await overview(parentOther), OTHER.id).contacts, [])
})

let first
await test('a signed-in parent cancels a valid session: saved, notice worked out, coach + staff emailed, Telegram sent', async () => {
  const before = Date.now()
  const r = await acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: D1, reason: 'sick', note: 'Hamstring <b>tight</b>' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.already, false)
  assert.deepEqual(r.data.told, [{ name: 'Coach Sam York', phone: '0411 222 333', tel: '0411222333' }])
  first = r.data.cancellation
  // The record, as staff see it.
  const list = (await portal(lee, 'cancellations', { when: 'all' })).data
  const rec = list.cancellations.find((c) => c.id === first.id)
  assert.equal(rec.player, 'Riley Returning')
  assert.equal(rec.date, D1)
  assert.equal(rec.group, 'Tuesday 4:20pm')
  assert.deepEqual(rec.coaches, ['Coach Sam York'])
  assert.equal(rec.reason, 'Sick or injured')
  assert.equal(rec.note, 'Hamstring <b>tight</b>')
  assert.equal(rec.parentName, 'Rita Returning')
  assert.equal(rec.email, 'returning@example.com')
  assert.deepEqual(rec.notFullySent, [])
  // Notice: session start (4:20pm Sydney) minus the moment of sending.
  const startMs = Date.parse((await kv(['HGET', 'jfp:cancels', first.id])).startAt)
  const s = sydney(startMs)
  assert.equal(`${s.year}-${s.month}-${s.day} ${s.hour}:${s.minute}`, `${D1} 16:20`, 'start time is 4:20pm Sydney time')
  assert.ok(Math.abs(rec.noticeMinutes - Math.floor((startMs - before) / 60000)) <= 1, `notice ${rec.noticeMinutes} min`)
  assert.match(rec.noticeLabel, rec.noticeMinutes >= 1440 ? /^\d+ h notice$/ : /^late: /)
  // Emails: one to the staff (Lee and Ligia), one to Sam; none to anyone else.
  const mail = (await emails()).filter((e) => /Can't make it/.test(e.subject))
  assert.equal(mail.length, 2)
  const staff = mail.find((e) => e.to.includes('leejones@jonerfootball.com'))
  const coach = mail.find((e) => e.to.includes('jonerfootballsam@gmail.com'))
  assert.deepEqual(staff.to.sort(), ['leejones@jonerfootball.com', 'ligia@jonerfootball.com'])
  assert.deepEqual(coach.to, ['jonerfootballsam@gmail.com'])
  for (const m of [staff, coach]) {
    assert.match(m.subject, /Riley Returning, Tuesday 4:20pm/)
    assert.ok(m.html.includes('Sick or injured'))
    assert.ok(m.html.includes('Hamstring &lt;b&gt;tight&lt;/b&gt;'), 'the note is escaped')
    assert.ok(!m.html.includes('<b>tight</b>'))
    assert.ok(!/[—–]/.test(m.html + m.subject), 'no dashes')
    assert.ok(!/credit|refund|make-up|makeup/i.test(m.html), 'no make-up, credit or refund policy')
  }
  assert.ok(staff.html.includes('returning@example.com'), 'staff see the family')
  assert.ok(!coach.html.includes('returning@example.com') && !coach.html.includes('Rita'), 'the coach is not given the family contact')
  // Telegram: names and the session, no contact details, no free text.
  const tg = await telegrams()
  assert.equal(tg.length, 1)
  assert.match(tg[0].text, /Riley Returning/)
  assert.match(tg[0].text, /Tuesday 4:20pm/)
  assert.ok(!/@|Hamstring|0411|returning@/.test(tg[0].text))
})

await test('Airtable was not touched by any of this', async () => {
  assert.equal(JSON.stringify((await airtable()).term4), atBefore)
})

await test('submitting the same session again is idempotent: no second record, email or alert', async () => {
  const again = await acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: D1, reason: 'school', note: 'different' })
  assert.equal(again.status, 200)
  assert.equal(again.data.already, true)
  assert.equal(again.data.cancellation.id, first.id)
  const list = (await portal(lee, 'cancellations', { when: 'all' })).data.cancellations.filter((c) => c.player === 'Riley Returning' && c.date === D1)
  assert.equal(list.length, 1)
  assert.equal(list[0].reason, 'Sick or injured', 'the first answer stands')
  assert.equal((await emails()).filter((e) => /Can't make it/.test(e.subject)).length, 2)
  assert.equal((await telegrams()).length, 1)
})

await test('a double tap (two at once) makes one record and one set of messages', async () => {
  const [a, b] = await Promise.all([
    acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: D2, reason: 'family', note: '' }),
    acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: D2, reason: 'family', note: '' }),
  ])
  assert.equal(a.status, 200, JSON.stringify(a.data))
  assert.equal(b.status, 200, JSON.stringify(b.data))
  assert.equal(a.data.cancellation.id, b.data.cancellation.id)
  assert.equal([a, b].filter((r) => r.data.already === false).length, 1, 'exactly one of them did the work')
  const mail = (await emails()).filter((e) => /Can't make it/.test(e.subject) && e.html.includes(`Riley Returning`))
  assert.equal(mail.length, 4, 'two more emails (staff + Sam), not four')
  assert.equal((await telegrams()).length, 2)
  const recs = (await kv(['HGETALL', 'jfp:cancels']))
  assert.equal(recs.filter((x) => typeof x === 'string' && x.startsWith('CXL-')).length, 2)
})

await test('another family cannot cancel (or withdraw) this player\'s sessions', async () => {
  const before = (await kv(['HGETALL', 'jfp:cancels'])).length
  const r = await acct(parentOther, 'cancelSession', { rowId: RILEY.id, date: D3, reason: 'sick', note: '' })
  assert.equal(r.status, 404)
  assert.ok(!JSON.stringify(r.data).includes('Riley'), 'nothing about the other family leaks')
  assert.equal((await kv(['HGETALL', 'jfp:cancels'])).length, before)
  const w = await acct(parentOther, 'withdrawCancel', { id: first.id })
  assert.equal(w.status, 404)
  // Nor does the other family see it on their page.
  assert.ok(!JSON.stringify(await overview(parentOther)).includes(first.id))
  // And a made up row id finds nothing.
  assert.equal((await acct(parentRiley, 'cancelSession', { rowId: 'recNOPE', date: D3, reason: 'sick', note: '' })).status, 404)
})

await test('a past date, a non-session date, a bad reason and an empty Other are refused', async () => {
  const past = await acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: PAST, reason: 'sick', note: '' })
  assert.equal(past.status, 400)
  assert.equal(past.data.code, 'past')
  const wed = ymd(Date.parse(`${D3}T00:00:00Z`) + day) // the Wednesday after a Tuesday session
  const off = await acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: wed, reason: 'sick', note: '' })
  assert.equal(off.status, 400)
  assert.equal(off.data.code, 'not_a_session')
  assert.equal((await acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: D3, reason: 'nope', note: '' })).status, 400)
  assert.equal((await acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: D3, reason: 'other', note: '' })).status, 400)
  assert.equal((await acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: '2030-01-01', reason: 'sick', note: '' })).status, 400)
  assert.equal((await acct(parentRiley, 'cancelSession', { rowId: RILEY.id, reason: 'sick' })).status, 400)
  const recs = (await portal(lee, 'cancellations', { when: 'all' })).data.cancellations.filter((c) => c.player === 'Riley Returning')
  assert.equal(recs.length, 2, 'none of the refused ones were saved')
})

await test('an over long note is cut to 500 characters', async () => {
  const r = await acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: D3, reason: 'other', note: 'y'.repeat(2000) })
  assert.equal(r.status, 200)
  const rec = await kv(['HGET', 'jfp:cancels', r.data.cancellation.id])
  assert.equal(rec.note.length, 500)
  // Put it back for the later checks.
  assert.equal((await acct(parentRiley, 'withdrawCancel', { id: rec.id })).status, 200)
})

await test('late notice is flagged in the subject and the body, and the cover coach is told', async () => {
  // Ruby runs the group, Sage covers it for this date.
  await kv(['HSET', 'jfp:cover', 'COV-test', JSON.stringify({ id: 'COV-test', groupId: NEAR, date: LATE_DATE, coachId: 'ruby', coverCoachId: 'sage', status: 'active', createdAt: new Date().toISOString() })])
  const mailBefore = (await emails()).length
  const r = await acct(parentLate, 'cancelSession', { rowId: LATE.id, date: LATE_DATE, reason: 'school', note: '' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.cancellation.noticeLevel, 'very-late')
  assert.match(r.data.cancellation.noticeLabel, /^late: \d+ min$/)
  const mail = (await emails()).slice(mailBefore).filter((e) => /Can't make it/.test(e.subject))
  assert.equal(mail.length, 3, 'staff, Ruby and the cover coach Sage')
  assert.deepEqual(mail.flatMap((m) => m.to).filter((t) => !/jonerfootball\.com/.test(t)).sort(), ['jonerfootballruby@gmail.com', 'sagemelhem@icloud.com'])
  for (const m of mail) {
    assert.match(m.subject, /^VERY LATE: Can't make it/)
    assert.ok(m.html.includes('VERY LATE NOTICE (under 2 hours)'))
  }
  const list = (await portal(lee, 'cancellations', { when: 'upcoming' })).data
  const rec = list.cancellations.find((c) => c.date === LATE_DATE && c.player === LATE.fields['Player Name'])
  assert.equal(rec.noticeLevel, 'very-late')
  assert.ok(rec.noticeMinutes >= 80 && rec.noticeMinutes <= 96, `about 95 minutes, got ${rec.noticeMinutes}`)
  assert.ok(list.summary.under2 >= 1 && list.summary.under24 >= 1)
  const tg = (await telegrams()).at(-1).text
  assert.match(tg, /VERY LATE/)
})

await test('the parent sees what they told us, and can withdraw it before the session', async () => {
  let en = enrol(await overview(parentRiley), RILEY.id)
  assert.deepEqual(en.cancelled.map((c) => c.date), [D1, D2])
  assert.equal(en.sessions.find((s) => s.iso === D1).cancelled, first.id)
  const mailBefore = (await emails()).length
  const w = await acct(parentRiley, 'withdrawCancel', { id: first.id })
  assert.equal(w.status, 200)
  en = enrol(await overview(parentRiley), RILEY.id)
  assert.deepEqual(en.cancelled.map((c) => c.date), [D2])
  const back = (await emails()).slice(mailBefore)
  assert.equal(back.filter((e) => /^Back on: Riley Returning/.test(e.subject)).length, 2, 'staff and Sam are told he is coming')
  // A second tap on Undo does nothing more.
  assert.equal((await acct(parentRiley, 'withdrawCancel', { id: first.id })).data.already, true)
  assert.equal((await emails()).slice(mailBefore).length, back.length)
  // And the family can cancel that date again; the team is told again.
  const re = await acct(parentRiley, 'cancelSession', { rowId: RILEY.id, date: D1, reason: 'family', note: '' })
  assert.equal(re.status, 200)
  assert.equal(re.data.already, false)
  assert.equal(re.data.cancellation.id, first.id)
  assert.equal((await emails()).slice(mailBefore).filter((e) => /Can't make it/.test(e.subject)).length, 2)
  // Once the session has started it cannot be withdrawn.
  const rec = await kv(['HGET', 'jfp:cancels', first.id])
  await kv(['HSET', 'jfp:cancels', first.id, JSON.stringify({ ...rec, startMs: Date.now() - 60000 })])
  const late = await acct(parentRiley, 'withdrawCancel', { id: first.id })
  assert.equal(late.status, 400)
  await kv(['HSET', 'jfp:cancels', first.id, JSON.stringify(rec)])
})

await test('an email or Telegram failure never loses the cancellation, and the retry sends only what is missing', async () => {
  await fetch(`${B}/__fail?what=email&on=1`)
  await fetch(`${B}/__fail?what=telegram&on=1`)
  const mailBefore = (await emails()).length
  const tgBefore = (await telegrams()).length
  const r = await acct(parentThird, 'cancelSession', { rowId: THIRD.id, date: rileyEnDates(THIRD, await overview(parentThird))[0], reason: 'sick', note: '' })
  assert.equal(r.status, 200, 'the family still gets their confirmation')
  const id = r.data.cancellation.id
  let rec = (await portal(lee, 'cancellations', { when: 'all' })).data.cancellations.find((c) => c.id === id)
  assert.ok(rec.notFullySent.length >= 2, `flagged for staff: ${rec.notFullySent}`)
  assert.equal((await emails()).length, mailBefore)
  assert.equal((await telegrams()).length, tgBefore)
  await fetch(`${B}/__fail?what=email&on=0`)
  await fetch(`${B}/__fail?what=telegram&on=0`)
  const again = await acct(parentThird, 'cancelSession', { rowId: THIRD.id, date: rec.date, reason: 'sick', note: '' })
  assert.equal(again.data.already, true)
  const sent = (await emails()).slice(mailBefore).filter((e) => /Can't make it/.test(e.subject))
  assert.equal(sent.length, 2, 'staff and Sam, once each')
  assert.equal((await telegrams()).length, tgBefore + 1)
  rec = (await portal(lee, 'cancellations', { when: 'all' })).data.cancellations.find((c) => c.id === id)
  assert.deepEqual(rec.notFullySent, [])
  await acct(parentThird, 'cancelSession', { rowId: THIRD.id, date: rec.date, reason: 'sick', note: '' })
  assert.equal((await emails()).slice(mailBefore).filter((e) => /Can't make it/.test(e.subject)).length, 2, 'a third tap sends nothing')
})
function rileyEnDates(row, o) { return enrol(o, row.id).sessions.map((s) => s.iso) }

await test('the cancellations are rate limited per family', async () => {
  // THIRD has used 1 of 6. Five more fit, the next is refused.
  const dates = rileyEnDates(THIRD, await overview(parentThird))
  let ok = 0
  let refused
  for (const d of dates.slice(1)) {
    const r = await acct(parentThird, 'cancelSession', { rowId: THIRD.id, date: d, reason: 'school', note: '' })
    if (r.status === 200) ok += 1; else { refused = r; break }
  }
  assert.equal(ok, 5)
  assert.equal(refused.status, 429)
})

await test('staff: Lee sees every cancellation, a coach only those of their own groups', async () => {
  const all = (await portal(lee, 'cancellations', { when: 'all' })).data
  assert.equal(all.admin, true)
  const names = new Set(all.cancellations.map((c) => c.player))
  assert.ok(names.has('Riley Returning') && names.has(THIRD.fields['Player Name']) && names.has(LATE.fields['Player Name']))
  // Newest first.
  const times = all.cancellations.map((c) => c.submittedAt)
  assert.deepEqual([...times].sort().reverse(), times)
  // Dean's group has none yet: add one for the other family.
  const od = enrol(await overview(parentOther), OTHER.id).sessions[0].iso
  assert.equal((await acct(parentOther, 'cancelSession', { rowId: OTHER.id, date: od, reason: 'family', note: 'Away' })).status, 200)

  const sam = client(); await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  const dean = client(); await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
  const s = (await portal(sam, 'cancellations', { when: 'all' })).data
  assert.equal(s.admin, false)
  const sNames = new Set(s.cancellations.map((c) => c.player))
  assert.ok(sNames.has('Riley Returning') && sNames.has(THIRD.fields['Player Name']))
  assert.ok(!sNames.has(OTHER.fields['Player Name']), 'Sam does not see Dean\'s group')
  assert.ok(!sNames.has(LATE.fields['Player Name']), 'nor Ruby\'s')
  const d = (await portal(dean, 'cancellations', { when: 'all' })).data
  assert.deepEqual([...new Set(d.cancellations.map((c) => c.player))], [OTHER.fields['Player Name']])
  // A coach never gets the family's contact details.
  assert.ok(s.cancellations.every((c) => !('email' in c) && !('parentName' in c)))
  assert.ok(!JSON.stringify(s).includes('returning@example.com'))
  // Filters.
  const up = (await portal(lee, 'cancellations', { when: 'upcoming' })).data
  const past = (await portal(lee, 'cancellations', { when: 'past' })).data
  const everything = (await portal(lee, 'cancellations', { when: 'all' })).data
  assert.equal(up.counts.all, everything.counts.all)
  assert.equal(up.cancellations.length + past.cancellations.length, everything.cancellations.length)
  assert.ok(up.cancellations.every((c) => c.upcoming))
  // Once a session is over its cancellation moves from Upcoming to Past.
  const lateRec = everything.cancellations.find((c) => c.player === LATE.fields['Player Name'])
  const stored = await kv(['HGET', 'jfp:cancels', lateRec.id])
  await kv(['HSET', 'jfp:cancels', lateRec.id, JSON.stringify({ ...stored, startMs: Date.now() - 3 * 3600000 })])
  assert.deepEqual((await portal(lee, 'cancellations', { when: 'past' })).data.cancellations.map((c) => c.id), [lateRec.id])
  assert.ok(!(await portal(lee, 'cancellations', { when: 'upcoming' })).data.cancellations.some((c) => c.id === lateRec.id))
  // The register marks the player on that date, and attendance still saves as before.
  const reg = (await portal(sam, 'coachSessions', {})).data
  const tue = reg.sessions.find((x) => x.id === TUE420)
  assert.deepEqual(Object.keys(tue.cancelledBy[D1]), [RILEY.id])
  assert.equal(tue.cancelledBy[D1][RILEY.id].reason, 'Family or travel')
  assert.equal(tue.cancelledBy[D3], undefined, 'the withdrawn one is not marked')
  const mark = await portal(sam, 'markAttendance', { groupId: TUE420, date: D1, rowId: RILEY.id, status: 'Absent' })
  assert.equal(mark.status, 200, JSON.stringify(mark.data))
  assert.equal(JSON.stringify((await airtable()).term4), atBefore, 'the roster is still untouched')
  // Someone who is not staff, or not signed in, gets nothing.
  assert.equal((await portal(client(), 'cancellations')).status, 401)
  assert.equal((await portal(parentRiley, 'cancellations')).status, 401)
  assert.equal((await acct(client(), 'cancelSession', { rowId: RILEY.id, date: D1, reason: 'sick' })).status, 401)
})

await test('a coach without a phone is simply not listed to families, and the public timetable shows no contact', async () => {
  const o = await overview(parentThird)
  const en = enrol(o, THIRD.id)
  assert.deepEqual(en.contacts.map((c) => c.name), ['Coach Sam York'])
  const public_ = JSON.stringify((await client().call('/api/jfp-groups')).data)
  assert.ok(!/0411|jonerfootballsam/.test(public_), 'the public timetable shows neither phone nor email')
})

console.log(`${passed} passed`)
harness.kill()
process.exit(0)
