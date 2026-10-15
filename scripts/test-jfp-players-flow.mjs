// Players, end to end against the local harness (Lee, 13 Oct 2026): a player
// who is their own contact, the detailed Add forms (profile in the same
// request), Pro sessions, account invites for a player with no group, the
// email log, and double-add safety. Fake Airtable, fake Stripe, captured email.
//   npm run build && HOLIDAY_LOCAL_PORT=4581 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-players-flow.mjs 4581                              (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'

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
const emails = async () => (await fetch(`${B}/__emails`)).json()
const at = async () => (await fetch(`${B}/__airtable`)).json()
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
const fault = (what, on) => fetch(`${B}/__fail?what=${what}&on=${on ? 1 : 0}`)
async function signIn(c, email, audience = 'staff') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const row = async (id) => (await at()).term4.find((r) => r.id === id)
const since = async () => (await emails()).length
const newMail = async (n) => (await emails()).slice(n)

const PRO = { name: 'Kai Sampleton', email: 'kai.sampleton@example.com', mobile: '0400 111 222', dob: '1999-04-02' }

let proRow = ''
await test('Players tab add: own contact, profile in the same request, Pro sessions, sign-in invite to the player', async () => {
  const n = await since()
  const r = await ok('addPlayerNoGroup', {
    player: { name: PRO.name, dob: PRO.dob }, parent: { name: 'Should Be Ignored', email: PRO.email, mobile: PRO.mobile },
    ownContact: true, payment: 'pro', perSessionCents: 6000, sendEmail: true, note: 'automated test',
    profile: { club: 'Test Valley FC', level: 'NPL', positions: ['Winger', 'Striker'], foot: 'Left', emergencyName: 'Em Contact', emergencyPhone: '0400 333 444', parentName: 'Should Be Ignored' },
  })
  proRow = r.rowId
  assert.ok(r.rowId && r.ownContact === true && r.profileSaved === true, JSON.stringify(r))
  assert.equal(r.emailed, true); assert.equal(r.emailTo, PRO.email)
  assert.equal(r.words.addAndEmail, 'Add and email Kai')
  const f = (await row(r.rowId)).fields
  assert.equal(f['Parent Name'], undefined, 'no parent name written for an own contact')
  assert.equal(f['Term 4 Payment Type'], 'JFP Pro sessions')
  assert.equal(f['Term 4 Fee'], 0, 'nothing owing until sessions are billed')
  assert.match(f['Term 4 Notes'], /\[CONTACT:self\]/); assert.match(f['Term 4 Notes'], /\[PERSESSION:6000\]/); assert.match(f['Term 4 Notes'], /Pro sessions at A\$60/)
  const prof = (await at()).profiles.find((p) => p.fields['Term 4 Record IDs'] === r.rowId)
  assert.ok(prof, 'player information saved in the same request')
  assert.equal(prof.fields.Club, 'Test Valley FC'); assert.equal(prof.fields['Date of Birth'], PRO.dob, 'an adult date of birth is accepted')
  assert.deepEqual(prof.fields.Positions, ['Winger', 'Striker'])
  assert.equal(prof.fields['Parent Name'], undefined, 'no parent saved on the profile either')
  const mail = await newMail(n)
  assert.equal(mail.length, 1)
  assert.deepEqual(mail[0].to, [PRO.email])
  assert.equal(mail[0].subject, 'Action needed: sign in to your JFP account')
  assert.match(mail[0].html, /Hi Kai,/); assert.match(mail[0].html, /you already have an account/)
  assert.doesNotMatch(mail[0].html, /parent|Should Be Ignored|Kai already has/i)
})

await test('the same player twice with no group is refused, with the existing row', async () => {
  const r = await portal('addPlayerNoGroup', { player: { name: PRO.name }, parent: { email: PRO.email }, ownContact: true })
  assert.equal(r.status, 409); assert.equal(r.data.code, 'duplicate'); assert.equal(r.data.rowId, proRow)
  assert.match(r.data.error, /already in Term 4 Players with no group/)
  const n = (await at()).term4.filter((x) => x.fields['Player Name'] === PRO.name).length
  assert.equal(n, 1)
})

await test('Players list and Edit carry the flag; Edit can turn it off and on', async () => {
  const p = (await ok('playersList')).players.find((x) => x.rowId === proRow)
  assert.equal(p.ownContact, true); assert.equal(p.pro, true); assert.equal(p.perSessionCents, 6000); assert.equal(p.inGroup, false)
  const g = await ok('getProfile', { rowId: proRow })
  assert.equal(g.row.ownContact, true); assert.ok(g.row.paymentTypes.includes('JFP Pro sessions'))
  await ok('editPlayer', { rowId: proRow, fields: { ownContact: false } })
  assert.doesNotMatch((await row(proRow)).fields['Term 4 Notes'], /\[CONTACT:/)
  await ok('editPlayer', { rowId: proRow, fields: { ownContact: true, perSessionAud: 65 } })
  const notes = (await row(proRow)).fields['Term 4 Notes']
  assert.match(notes, /\[CONTACT:self\]/); assert.match(notes, /\[PERSESSION:6500\]/)
  assert.equal((notes.match(/\[CONTACT:self\]/g) || []).length, 1)
})

await test('account invite for one player with no place: "Sent to", logged with Brevo\'s id; a failure says why', async () => {
  const n = await since()
  const r = await ok('inviteAccount', { rowId: proRow })
  assert.equal(r.sentTo, PRO.email)
  assert.equal((await newMail(n)).length, 1)
  const again = await portal('inviteAccount', { rowId: proRow })
  assert.equal(again.status, 409, 'a double tap sends one email'); assert.match(again.data.error, /less than a minute ago/)
  await kv(['DEL', `jfp:acct-one-lock:${PRO.email}`])
  await fault('email', true)
  const bad = await portal('inviteAccount', { rowId: proRow })
  await fault('email', false)
  assert.equal(bad.status, 502); assert.match(bad.data.error, new RegExp(`Not sent to ${PRO.email.replace('.', '\\.')}\\. Brevo refused it`))
  const log = await ok('emailLog', { rowId: proRow })
  assert.deepEqual(log.emails.map((e) => e.status).slice(0, 3), ['failed', 'sent', 'sent'])
  assert.equal(log.emails[1].messageId, 'local'); assert.equal(log.emails[1].kind, 'account invite')
  assert.match(log.emails[0].error, /Brevo 401/)
  const noMail = (await ok('playersList')).players.find((x) => !x.email)
  if (noMail) { const e = await portal('inviteAccount', { rowId: noMail.rowId }); assert.equal(e.status, 400); assert.equal(e.data.code, 'no_email') }
})

await test('Account invites page: every family asked for gets an answer, and own contacts are worded for the player', async () => {
  const plan = await ok('familyInvites')
  const fam = plan.list.find((f) => f.email === PRO.email)
  assert.equal(fam.self, true)
  const r = await ok('familyInvites', { send: true, mode: 'account', emails: [PRO.email, 'nobody.here@example.com'] })
  assert.deepEqual(r.sent, [])
  assert.deepEqual(r.skipped.map((x) => x.email).sort(), ['nobody.here@example.com', PRO.email].sort())
  assert.match(r.skipped.find((x) => x.email === PRO.email).why, /Already sent this invite/)
  assert.match(r.skipped.find((x) => x.email !== PRO.email).why, /Not found/)
})

await test('a payment link for a player with no group is emailed now (it used to send nothing), to the player', async () => {
  await ok('editPlayer', { rowId: proRow, fields: { feeAud: 120 } })
  const n = await since()
  const r = await ok('sendPaymentLink', { rowId: proRow, sendEmail: true })
  assert.equal(r.emailed, true); assert.equal(r.emailTo, PRO.email)
  const m = (await newMail(n))[0]
  assert.equal(m.subject, 'Your Term 4 2026 place')
  assert.match(m.html, /Hi Kai, you have a place/); assert.match(m.html, /We will confirm the group/)
  assert.doesNotMatch(m.html, /another child/)
  const q = JSON.parse(await kv(['GET', `jfp:payreq:${r.payreq.id}`]))
  assert.equal(q.programme, 'pro'); assert.equal(q.ownContact, true)
  await ok('cancelPayreq', { id: r.payreq.id })
})

await test('Pro sessions billing: the link says Pro; the family page talks to the player; Stripe carries jfpProduct pro', async () => {
  const s = await ok('sessionInvoice', { rows: [{ rowId: proRow, sessions: 2, perSessionCents: 6500 }], what: 'Pro sessions', sendEmail: true })
  const q = JSON.parse(await kv(['GET', `jfp:payreq:${s.payreq.id}`]))
  assert.equal(q.programme, 'pro')
  const links = (await ok('payments')).payreqs
  assert.equal(links.find((x) => x.id === s.payreq.id).programme, 'pro', 'shows under the Pro sessions chip')
  const fam = client()
  await signIn(fam, PRO.email, 'parent')
  const acct = (await fam.call('/api/jfp-account', {})).data
  assert.equal(acct.self, true, 'the family page knows the player is the contact')
  assert.equal(acct.players[0].ownContact, true)
  const w = await fam.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: acct.players[0].key, dob: PRO.dob, emergencyName: 'Em Contact', emergencyPhone: '0400 333 444' }], waiver: { accepted: { terms: true, makeups: true, payment: true, emergency: true, adult: true }, kind: 'adult', signature: PRO.name }, parentName: PRO.name, mobile: PRO.mobile })
  assert.equal(w.status, 200, JSON.stringify(w.data))
  const pay = await fam.call('/api/jfp-account', { action: 'pay', payreqId: s.payreq.id })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  const cs = pay.data.url.split('cs=')[1]
  const sess = (await (await fetch(`${B}/__sessions`)).json()).find((x) => x.id === cs)
  assert.equal(sess.metadata.jfpProduct, 'pro'); assert.equal(sess.metadata.jfpProgramme, undefined, 'stays a JFP link for the webhook and Money until Money splits it')
})

let groupRow = ''
// A group of our own: a fresh harness has none.
const GID = (await ok('saveGroup', { group: { day: 'Thursday', time: '7:15pm', location: 'NTRA', coachId: 'lee', capacity: 12, mode: 'direct' } })).group.id
await test('Timetable add: as detailed as Edit, own contact, a custom price in Paying for; wording for the player', async () => {
  const g = { id: GID }
  const price = (await ok('savePrice', { price: { name: 'Pro term test', amountCents: 50000, programme: 'pro' } })).price
  const n = await since()
  const r = await ok('addPlayer', {
    groupId: g.id, player: { name: 'Ari Sampleby', dob: '1995-01-20' }, parent: { email: 'adult.test@example.com', mobile: '0400 555 666' },
    ownContact: true, profile: { club: 'Test Hills FC', positions: ['Goalkeeper'] }, payment: 'link', priceId: price.id, sendEmail: true, force: true,
  })
  groupRow = r.rowId
  assert.equal(r.payreq.amountLabel, 'A$500')
  assert.equal(r.profileSaved, true)
  const f = (await row(r.rowId)).fields
  assert.equal(f['Term 4 Payment Type'], 'JFP Pro sessions'); assert.equal(f['Term 4 Fee'], 500); assert.match(f['Term 4 Notes'], /\[CONTACT:self\]/)
  const q = JSON.parse(await kv(['GET', `jfp:payreq:${r.payreq.id}`]))
  assert.equal(q.programme, 'pro'); assert.equal(q.productLabel, 'Pro term test')
  const m = (await newMail(n))[0]
  assert.deepEqual(m.to, ['adult.test@example.com'])
  assert.match(m.html, /Hi Ari, you have a place/); assert.equal(m.subject, 'Your Term 4 2026 place')
  // Twice into the same group: refused, nothing added.
  const twice = await portal('addPlayer', { groupId: g.id, player: { name: 'Ari Sampleby' }, parent: { email: 'adult.test@example.com' }, ownContact: true, payment: 'none', force: true })
  assert.equal(twice.status, 409); assert.equal(twice.data.code, 'duplicate'); assert.equal(twice.data.rowId, groupRow)
})

await test('an email that fails after the add is reported, the player stays added, and the log shows it', async () => {
  const g = { id: GID }
  await fault('email', true)
  const r = await ok('addPlayer', { groupId: g.id, player: { name: 'Milo Mailfail' }, parent: { name: '', email: 'mailfail.test@example.com' }, payment: 'none', sendEmail: true, force: true })
  await fault('email', false)
  assert.equal(r.emailed, false); assert.match(r.emailError, /was added, but the email to mailfail\.test@example\.com did not send\. Brevo refused it/)
  assert.ok(await row(r.rowId))
  const log = await ok('emailLog', { rowId: r.rowId })
  assert.equal(log.emails[0].status, 'failed')
})

await test('quick links can be Pro sessions; the Stripe page says jfpProgramme pro', async () => {
  const l = await ok('quickLink', { amountCents: 6500, forText: 'One Pro session', programme: 'pro', noPlayerReason: 'Pro player to match later' })
  assert.equal(l.link.programme, 'pro'); assert.equal(l.link.programmeLabel, 'Pro sessions')
  const p = await client().call('/api/jfp-pay', { action: 'pay', id: l.link.id })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  const sess = (await (await fetch(`${B}/__sessions`)).json()).find((x) => x.id === p.data.url.split('cs=')[1])
  assert.equal(sess.metadata.jfpProgramme, 'pro')
  assert.ok((await ok('pricing')).programmes.some((x) => x.id === 'pro' && x.label === 'Pro sessions'))
})


await test('added with no session on Players, then added on the Timetable: the same row goes into the group, no second row', async () => {
  const before = (await at()).term4.length
  const a = await ok('addPlayerNoGroup', { player: { name: 'Mason Twinrow' }, parent: { name: 'Dana Twinrow', email: 'twinrow@example.com' }, payment: 'none' })
  const b = await ok('addPlayer', { groupId: GID, player: { name: 'Mason Twinrow' }, parent: { name: 'Dana Twinrow', email: 'twinrow@example.com' }, payment: 'none', force: true })
  assert.equal(b.rowId, a.rowId, 'the existing row is used'); assert.equal(b.movedRow, true)
  assert.equal((await at()).term4.length, before + 1, 'one row, not two')
  const f = (await row(a.rowId)).fields
  assert.equal(f['Term 3 Day'], 'Thursday'); assert.equal(f['Term 3 Time'], '7:15pm')
  const board = await ok('board')
  assert.ok(board.groups.find((g) => g.id === GID).players.some((p) => p.rowId === a.rowId), 'in the group on the Timetable')
  assert.ok(!board.unassigned.some((p) => p.rowId === a.rowId), 'not under Not in a group')
  // A different family's child with the same name keeps their own row.
  const x = await ok('addPlayerNoGroup', { player: { name: 'Ruby Twinrow' }, parent: { name: 'Family One', email: 'one.twin@example.com' }, payment: 'none', force: true })
  const y = await ok('addPlayer', { groupId: GID, player: { name: 'Ruby Twinrow' }, parent: { name: 'Family Two', email: 'two.twin@example.com' }, payment: 'none', force: true })
  assert.notEqual(y.rowId, x.rowId); assert.equal(y.movedRow, false)
})


await test('switching a player from a term link to session by session closes the old link; the place stays', async () => {
  const a = await ok('addPlayer', { groupId: GID, player: { name: 'Rory Switchpay' }, parent: { name: 'Sam Switchpay', email: 'switchpay@example.com' }, payment: 'link', force: true })
  assert.ok(a.payreq?.id)
  const e = await ok('editPlayer', { rowId: a.rowId, fields: { paymentType: 'JFP Session by session', feeAud: 0 } })
  assert.equal(e.closedLinks.length, 1); assert.equal(e.openLinks.length, 0)
  const q = JSON.parse(await kv(['GET', `jfp:payreq:${a.payreq.id}`]))
  assert.equal(q.status, 'cancelled')
  const f = (await row(a.rowId)).fields
  assert.equal(f['Term 3 Day'], 'Thursday', 'still in the group'); assert.notEqual(f['Term 4 Confirmation'], 'Not Returning')
  // Editing only the phone leaves a link alone.
  const b = await ok('addPlayer', { groupId: GID, player: { name: 'Remy Keeplink' }, parent: { name: 'K L', email: 'keeplink@example.com' }, payment: 'link', force: true })
  const e2 = await ok('editPlayer', { rowId: b.rowId, fields: { phone: '0400 000 111' } })
  assert.equal(e2.closedLinks.length, 0); assert.equal(e2.openLinks.length, 1)
})

console.log(`\n${passed} players flow checks passed`)
