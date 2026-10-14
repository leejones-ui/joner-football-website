// Coach alerts end to end against the local harness (fake Brevo, fake
// Airtable, the text relay called as the office Mac would):
//   npm run build && node scripts/holiday-local.mjs 4321
//   node scripts/test-jfp-coach-alerts.mjs 4321
import assert from 'node:assert/strict'

const PORT = process.argv[2] || '4321'
const B = `http://localhost:${PORT}`
const TOKEN = 'local-relay-token-0123456789abcdef0123'
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); passed += 1; console.log(`ok - ${name}`) } catch (e) { failed += 1; console.log(`FAIL - ${name}\n  ${e.message}`) } }

function client() {
  const jar = new Map()
  async function call(p, body) {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, ok: res.ok, data }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const telegrams = async () => (await fetch(`${B}/__telegram`)).json()
const relay = async (action, body = {}) => (await fetch(`${B}/api/jfp-messages-relay`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ action, host: 'test', ...body }) })).json()
const tick = async (now) => (await fetch(`${B}/api/jfp-groups?coachTick=1&now=${now}`, { headers: { authorization: 'Bearer local-cron-secret' } })).json()
// Everything the Mac would be handed right now (marked sent, so the next claim moves on).
async function drainTexts() {
  const out = []
  for (let i = 0; i < 20; i += 1) {
    const r = await relay('claim')
    if (!r.message) break
    out.push(r.message)
    await relay('receipt', { id: r.message.id, textHash: r.message.textHash, outcome: 'sent', service: 'iMessage', sender: '+61400000999', readback: { found: true, isFromMe: true } })
  }
  return out
}

const lee = client()
{
  const s = await lee.call('/api/jfp-auth', { action: 'start', email: 'leejones@jonerfootball.com', audience: 'staff' })
  const code = (await emails()).filter((e) => e.to.includes('leejones@jonerfootball.com') && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await lee.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const msg = (action, body = {}) => lee.call('/api/jfp-messages', { action, ...body })

// Sam and Dean get mobiles; texts are switched on the way Lee does it.
{
  const sd = (await portal('getSettings')).data.config
  const coaches = sd.coaches.map((c) => (c.id === 'sam' ? { ...c, phone: '0400 222 333' } : c.id === 'dean' ? { ...c, phone: '0400 222 444' } : c))
  const r = await portal('saveSettings', { config: { coaches } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const t = await msg('selfTest', { phone: '0400 999 111' })
  assert.equal(t.status, 200, JSON.stringify(t.data))
  await drainTexts()
  assert.equal((await msg('verifyRoute', { id: t.data.message.id, arrived: true })).status, 200)
}
const sam = (await portal('saveGroup', { group: { day: 'Thursday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 12, mode: 'direct', minAge: 7, maxAge: 18 } })).data.group
const dean = (await portal('saveGroup', { group: { day: 'Thursday', time: '5:30pm', location: 'Belrose HQ', coachId: 'dean', capacity: 12, mode: 'direct', minAge: 7, maxAge: 18 } })).data.group
assert.ok(sam?.id && dean?.id)
const add = async (group, name, i) => {
  const r = await portal('addPlayer', { groupId: group.id, force: true, player: { name }, parent: { name: `${name.split(' ')[0]}s Parent`, email: `coach-alert-${i}@example.com`, mobile: `0400 333 00${i}` }, payment: 'none' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return r.data.rowId
}
const T0 = Date.now()

await test('off by default: adding a player tells nobody, and Lee sees the exact words first', async () => {
  const st = await portal('coachAlerts')
  assert.equal(st.data.newPlayer, false); assert.equal(st.data.register, false)
  assert.equal(st.data.textsOn, true)
  assert.ok(st.data.coaches.find((c) => c.id === 'sam').mobile, 'Sam has a mobile')
  assert.ok(!st.data.coaches.some((c) => c.id === 'lee'), 'Lee is never chased')
  const all = JSON.stringify(st.data.samples)
  assert.ok(!/—|–/.test(all), 'no dashes in the words')
  assert.match(st.data.samples.newPlayer.text, /Charlie Roberts \(14\)/)
  await add(sam, 'Charlie Roberts', 1)
  await tick(T0 + 10 * 60000)
  assert.ok(!(await emails()).some((e) => /New player/.test(e.subject)))
  assert.equal((await drainTexts()).length, 0)
})

await test('new players: one email and one text per coach after the moves settle; a player moved straight out is not announced', async () => {
  assert.equal((await portal('setCoachAlerts', { newPlayer: true })).data.newPlayer, true)
  await add(sam, 'Mia Newgirl', 2)
  const ned = await add(dean, 'Ned Mover', 3)
  assert.equal((await portal('movePlayer', { rowId: ned, toGroupId: sam.id, force: true })).status, 200)
  const ollie = await add(sam, 'Ollie Flip', 4)
  assert.equal((await portal('movePlayer', { rowId: ollie, toGroupId: dean.id, force: true })).status, 200)
  const before = (await emails()).length
  await tick(Date.now() + 60000) // too soon: still settling
  assert.equal((await emails()).length, before, 'nothing while the moves settle')
  await tick(Date.now() + 5 * 60000)
  const mail = (await emails()).slice(before)
  const toSam = mail.filter((e) => e.to.includes('jonerfootballsam@gmail.com'))
  assert.equal(toSam.length, 1, 'one email to Sam')
  assert.match(toSam[0].subject, /2 new players/)
  const toDean = mail.filter((e) => e.to.includes('jonerfootballdean@gmail.com'))
  assert.equal(toDean.length, 1, 'Dean hears about Ollie')
  const texts = await drainTexts()
  const samText = texts.find((t) => t.to === '+61400222333')
  assert.ok(samText, 'a text to Sam')
  assert.match(samText.text, /Mia Newgirl/); assert.match(samText.text, /Ned Mover/)
  assert.ok(!/Ollie/.test(samText.text), 'Ollie moved out again')
  assert.match(texts.find((t) => t.to === '+61400222444').text, /Ollie Flip/)
  // Told once.
  await tick(Date.now() + 15 * 60000)
  assert.equal((await emails()).length, before + 2)
  assert.equal((await drainTexts()).length, 0)
})

await test('register: 30 minutes after the session a reminder, 4 hours after a second and a Telegram; never twice; a marked register is left alone', async () => {
  assert.equal((await portal('setCoachAlerts', { register: true })).data.register, true)
  const cs = (await portal('coachSessions', { coachId: 'sam' })).data.sessions.find((s) => s.id === sam.id)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
  const dates = cs.dates.map((d) => d.iso).filter((d) => d > today)
  assert.ok(dates.length >= 2, 'two sessions still to come')
  // Thu 4:20pm Sydney (AEDT, +11) ends 5:20pm local = 06:20 UTC.
  const endOf = (d) => Date.parse(`${d}T06:20:00Z`)
  const before = (await emails()).length
  await tick(endOf(dates[0]) + 10 * 60000)
  assert.equal((await emails()).length, before, 'not before 30 minutes')
  await tick(endOf(dates[0]) + 35 * 60000)
  const mine = (e) => e.to.includes('jonerfootballsam@gmail.com') && e.subject.includes('Thu 4:20pm')
  let mail = (await emails()).slice(before).filter(mine)
  assert.equal(mail.length, 1, JSON.stringify((await emails()).slice(before).map((e) => [e.to, e.subject]))); assert.match(mail[0].subject, /Register not done/)
  const t1 = (await drainTexts()).filter((t) => t.text.includes('Thu 4:20pm'))
  assert.equal(t1.length, 1); assert.match(t1[0].text, /register .* is not filled in yet/)
  await tick(endOf(dates[0]) + 40 * 60000)
  assert.equal((await emails()).slice(before).filter(mine).length, 1, 'once')
  const tg = (await telegrams()).length
  await tick(endOf(dates[0]) + 4 * 3600000 + 5 * 60000)
  mail = (await emails()).slice(before).filter(mine)
  assert.equal(mail.length, 2); assert.match(mail[1].subject, /Still not done/)
  assert.equal((await drainTexts()).filter((t) => t.text.includes('Thu 4:20pm')).length, 1)
  assert.ok((await telegrams()).slice(tg).some((t) => /Register still empty: Coach Sam, Thu 4:20pm/.test(JSON.stringify(t))), 'Lee hears on Telegram')
  // The next week Sam marks it: no reminder.
  const row = cs.players[0]?.rowId || (await portal('coachSessions', { coachId: 'sam' })).data.sessions.find((s) => s.id === sam.id).players[0].rowId
  assert.equal((await portal('markAttendance', { groupId: sam.id, date: dates[1], rowId: row, status: 'Present' })).status, 200)
  const n = (await emails()).length
  await tick(endOf(dates[1]) + 35 * 60000)
  assert.ok(!(await emails()).slice(n).some(mine), 'a marked register is not chased')
})

await test('a player starting in week 3: the row carries the start and the coach alert names that first session', async () => {
  const cs = (await portal('coachSessions', { coachId: 'sam' })).data.sessions.find((x) => x.id === sam.id)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
  const later = cs.dates.map((d) => d.iso).filter((d) => d > today)[2]
  assert.ok(later, 'a session three weeks out')
  const r = await portal('addPlayer', { groupId: sam.id, force: true, player: { name: 'Lou Later' }, parent: { name: 'Lou Parent', email: 'coach-alert-9@example.com', mobile: '0400 333 009' }, payment: 'pro', perSessionCents: 10000, startsFrom: later })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const row = (await (await fetch(`${B}/__airtable`)).json()).term4.find((x) => x.id === r.data.rowId)
  assert.match(row.fields['Term 4 Notes'], new RegExp(`\\[STARTS:${later}\\]`))
  const before = (await emails()).length
  await tick(Date.now() + 5 * 60000)
  const t = (await drainTexts()).find((x) => /Lou Later/.test(x.text))
  assert.ok(t, 'Sam is told')
  assert.ok(!/it's Lee/.test(t.text), 'no sign-off name')
  assert.match(t.text, /^Hi Sam, new player in your Thu 4:20pm/)
  assert.match(t.text, /first session \w{3} \d+ \w{3}/)
  assert.ok((await emails()).length > before)
})

await test('a coach mobile changed after the text was written: the text is not sent to the old number', async () => {
  await add(sam, 'Pia Late', 5)
  await tick(Date.now() + 5 * 60000)
  const sd = (await portal('getSettings')).data.config
  await portal('saveSettings', { config: { coaches: sd.coaches.map((c) => (c.id === 'sam' ? { ...c, phone: '0400 555 666' } : c)) } })
  assert.equal((await drainTexts()).filter((t) => t.to === '+61400222333').length, 0)
})

console.log(`\n${failed ? `${failed} FAILED, ` : ''}${passed} coach alert checks passed`)
process.exit(failed ? 1 : 0)
