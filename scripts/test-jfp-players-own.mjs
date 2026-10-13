// Players (Lee, 13 Oct 2026): the player as their own contact, Pro sessions,
// the email log, and the Add and Edit forms in jsdom (as detailed as Edit,
// own contact wording, double-add safety, account invite, the Emails check).
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'
import { openPortal } from './jfp-portal-dom.mjs'
import { contactWords, withOwnContact, isOwnContactNotes, isAdult, ageFrom } from '../api/_jfp-contact.js'
import { PRO_TYPE, isProType, isSessionType, withPerSession } from '../api/_jfp-store.js'
import { PROGRAMMES, isProgramme, programmeLabel } from '../api/_jfp-prices.js'
import { cleanProfile } from '../api/_jfp-profiles.js'
import { emailErrorText } from '../api/_jfp-email-log.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

await test('own contact: a tag on the notes, added once, removed cleanly, next to the per-session price', () => {
  const a = withOwnContact('Added by Lee. [PERSESSION:6000]', true)
  assert.equal(a, 'Added by Lee. [PERSESSION:6000] [CONTACT:self]')
  assert.equal(withOwnContact(a, true), a, 'never twice')
  assert.ok(isOwnContactNotes(a))
  assert.equal(withOwnContact(a, false), 'Added by Lee. [PERSESSION:6000]')
  assert.equal(withPerSession(a, 6500), 'Added by Lee. [CONTACT:self] [PERSESSION:6500]', 'the price tag keeps the contact tag')
  assert.ok(!isOwnContactNotes('Parent said [CONTACT:parent]'))
})

await test('adults (18 or over on the day) are suggested as their own contact', () => {
  assert.equal(ageFrom('2008-10-13', '2026-10-13'), 18)
  assert.equal(isAdult('2008-10-13', '2026-10-13'), true)
  assert.equal(isAdult('2008-10-14', '2026-10-13'), false, 'the day before their 18th')
  assert.equal(isAdult('', '2026-10-13'), false)
})

await test('one helper picks the player or the family wording', () => {
  const self = contactWords({ self: true, players: ['Kai Sampleton'], parent: 'Old Parent' })
  assert.deepEqual([self.emailWho, self.textWho, self.addAndEmail, self.hi, self.toName, self.sessionsOf, self.emailLabel], ['Email Kai', 'Text Kai', 'Add and email Kai', 'Kai', 'Kai Sampleton', 'Your sessions', "Player's email (they sign in with this)"])
  const fam = contactWords({ self: false, players: ['Ivy Sample', 'Ned Sample'], parent: 'Pat Sample' })
  assert.deepEqual([fam.emailWho, fam.textWho, fam.addAndEmail, fam.hi, fam.toName, fam.sessionsOf, fam.has], ['Email the family', 'Text Pat', 'Add and email the family', 'Pat', 'Pat Sample', "Ivy and Ned's sessions", 'Ivy Sample and Ned Sample have'])
  const none = contactWords({ self: false, players: ['Ivy Sample'], parent: '' })
  assert.equal(none.hi, 'there', 'no parent name: "Hi there", never "Hi ,"')
  assert.equal(none.toName, '', 'and no empty name for Brevo')
})

await test('Pro sessions: a programme, a payment type, and paid session by session', () => {
  assert.deepEqual(PROGRAMMES.map(([id]) => id), ['jfp', 'pro', 'juniors', 'holiday', 'other'])
  assert.ok(isProgramme('pro')); assert.equal(programmeLabel('pro'), 'Pro sessions')
  assert.equal(PRO_TYPE, 'JFP Pro sessions')
  assert.ok(isProType(PRO_TYPE) && isSessionType(PRO_TYPE))
  assert.ok(!isProType('JFP Session by session') && isSessionType('JFP Session by session'))
})

await test('an adult date of birth is accepted on player information; the future is not', () => {
  assert.deepEqual(cleanProfile({ dob: '1990-05-01' }), { values: { dob: '1990-05-01' }, errors: [] })
  assert.match(cleanProfile({ dob: '2999-01-01' }).errors[0], /date of birth/)
})

await test('email errors read plainly for staff', () => {
  assert.match(emailErrorText(new Error('Brevo 400: {"message":"name is missing"}')), /^Brevo refused it: \{"message":"name is missing"\}/)
  assert.match(emailErrorText(new Error('BREVO_API_KEY is not configured.')), /not set up/)
  assert.match(emailErrorText(new Error('Brevo 502: x')), /may not have gone/)
})

// ---------- emails: worded for the player, never an empty name, every send logged ----------

const kvList = []
const brevo = []
let brevoFails = false
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  const body = init.body ? JSON.parse(init.body) : null
  if (u.startsWith('http://kv.test')) {
    const [cmd, key, ...args] = body
    if (cmd === 'LPUSH') { kvList.unshift(...args.reverse()); return new Response(JSON.stringify({ result: kvList.length })) }
    if (cmd === 'LTRIM') return new Response(JSON.stringify({ result: 'OK' }))
    if (cmd === 'LRANGE') return new Response(JSON.stringify({ result: kvList.slice() }))
    return new Response(JSON.stringify({ result: null }))
  }
  if (u.startsWith('https://api.brevo.com')) {
    brevo.push(body)
    if (brevoFails) return new Response('{"code":"invalid_parameter","message":"to.name is missing"}', { status: 400 })
    return new Response(JSON.stringify({ messageId: `<msg-${brevo.length}@test>` }))
  }
  throw new Error(`unexpected fetch ${u}`)
}
process.env.KV_REST_API_URL = 'http://kv.test'
process.env.KV_REST_API_TOKEN = 'test'
process.env.BREVO_API_KEY = 'test'
const { accountInvite, sendFamilyInvite, sendAccountInvite, sendFamilyInvoice } = await import('../api/_jfp-email.js')
const { emailsTo } = await import('../api/_jfp-email-log.js')
const config = { term: 'Term 4 2026', kitUrl: '', locations: [], coaches: [] }

await test('the account invite talks to the player when they are their own contact', () => {
  const self = accountInvite({ parentName: '', players: [{ name: 'Kai Sampleton', group: 'Group to be confirmed' }], config, signInUrl: 'https://x.test/jfp-account/', money: false, email: 'kai@example.com', self: true })
  assert.equal(self.subject, 'Action needed: sign in to your JFP account')
  assert.match(self.html, /Hi Kai,/); assert.match(self.html, /you already have an account/); assert.match(self.html, /Your group, coach, location/)
  assert.doesNotMatch(self.html, /parent|Kai already has|your players/i)
  const fam = accountInvite({ parentName: 'Pat Sample', players: [{ name: 'Ivy Sample', group: 'Tue 4:20pm' }], config, signInUrl: 'https://x.test/jfp-account/', money: false, email: 'pat@example.com' })
  assert.equal(fam.subject, "Action needed: sign in to Ivy's JFP account")
  assert.match(fam.html, /Hi Pat,/); assert.match(fam.html, /Ivy already has an account/)
})

await test('an invite with no group (Players tab add) sends, names the player, and has no empty name for Brevo', async () => {
  const r = await sendFamilyInvite({ to: 'kai@example.com', parentName: '', playerNames: ['Kai Sampleton'], group: null, config, url: 'https://x.test/p', needs: { details: false, waiver: true, payment: true }, amountCents: 12000, self: true })
  assert.equal(r.ok, true); assert.equal(r.messageId, '<msg-1@test>')
  const b = brevo.at(-1)
  assert.deepEqual(b.to, [{ email: 'kai@example.com', name: 'Kai Sampleton' }], 'to the player by name')
  assert.equal(b.subject, 'Your Term 4 2026 place')
  assert.match(b.htmlContent, /Hi Kai, you have a place in Term 4 2026/); assert.match(b.htmlContent, /sign your waiver and pay A\$120/)
  await sendFamilyInvoice({ to: 'pat@example.com', parentName: '', places: [{ name: 'Ivy Sample', label: '2 sessions', owingCents: 10000 }], config, url: 'https://x.test/p', amountCents: 10000, sessions: true })
  assert.deepEqual(brevo.at(-1).to, [{ email: 'pat@example.com' }], 'no parent name: no name at all, never an empty one')
})

await test('every send is in the email log: sent with Brevo\'s id, failed with why, and the error reaches the caller', async () => {
  brevoFails = true
  await assert.rejects(sendAccountInvite({ to: 'kai@example.com', parentName: '', players: [{ name: 'Kai Sampleton', group: '' }], config, signInUrl: 'https://x.test/', money: false, email: 'kai@example.com', self: true }), /Brevo 400/)
  brevoFails = false
  const log = await emailsTo(['KAI@example.com'])
  assert.deepEqual(log.map((e) => e.status), ['failed', 'sent'])
  assert.equal(log[0].kind, 'account invite'); assert.match(log[0].error, /to\.name is missing/)
  assert.equal(log[1].messageId, '<msg-1@test>'); assert.equal(log[1].kind, 'place and payment link')
  assert.deepEqual((await emailsTo(['pat@example.com'])).map((e) => e.kind), ['sessions invoice'])
  assert.deepEqual(await emailsTo([]), [])
})

// ---------- the pages ----------

const PRICING = {
  success: true, weeks: 10, today: '2026-10-13', prices: { group: 85000, trial: 8500 },
  products: [{ key: 'group', label: 'Term, small group', type: 'JFP 10 weeks', proRata: true, perPlaces: 1, cents: 85000 }, { key: 'trial', label: 'Trial session', type: 'JFP Trial', proRata: false, perPlaces: 1, cents: 8500 }],
  datesByDay: { Tuesday: [{ iso: '2026-10-20', label: 'Tue 20 Oct', past: false }] },
  priceList: [{ id: 'PR-1-AAAAAA', name: 'Pro session', cents: 6500, amountLabel: 'A$65', programme: 'pro', programmeLabel: 'Pro sessions', perSession: true }, { id: 'PR-2-BBBBBB', name: 'Kit fee', cents: 6000, amountLabel: 'A$60', programme: 'other', programmeLabel: 'Other' }, { id: 'PR-3-CCCCCC', name: 'Old', cents: 100, amountLabel: 'A$1', programme: 'jfp', archived: true }],
  programmes: PROGRAMMES.map(([id, label]) => ({ id, label })), holidayPeriods: [],
}
const PLAYERS = {
  success: true,
  players: [
    { rowId: 'recSELF0000000001', name: 'Kai Sampleton', dob: '1999-04-02', age: 27, club: '', profile: null, parent: '', email: 'kai@example.com', phone: '0400 111 222', ownContact: true, pro: true, perSessionCents: 6500, groupId: '', groupLabel: '', day: '', time: '', location: '', coach: '', coachId: '', confirmation: 'Awaiting Reply', paymentStatus: 'Unpaid', paymentType: 'JFP Pro sessions', feeAud: 0, paidAud: 0, balanceAud: 0, kit: '', waiver: { onFile: false }, notes: '', inGroup: false, holdsPlace: true, trial: false },
    { rowId: 'recFAM00000000002', name: 'Ivy Sample', dob: '', age: 11, club: '', profile: null, parent: 'Pat Sample', email: 'pat@example.com', phone: '0400 333 444', ownContact: false, pro: false, groupId: 'g1', groupLabel: 'Tuesday 4:20pm, Belrose HQ', day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', coach: 'Sam', coachId: 'sam', confirmation: 'Confirmed', paymentStatus: 'Paid', paymentType: 'JFP 10 weeks', feeAud: 850, paidAud: 850, balanceAud: 0, kit: '', waiver: { onFile: true }, notes: '', inGroup: true, holdsPlace: true, trial: false },
  ],
  groups: [{ id: 'g1', label: 'Tuesday 4:20pm, Belrose HQ', coachId: 'sam' }], coaches: [{ id: 'sam', name: 'Sam' }], locations: [],
}
const LOG = { success: true, addresses: ['kai@example.com'], emails: [{ at: '2026-10-13T03:00:00Z', to: ['kai@example.com'], subject: 'Action needed: sign in to your JFP account', kind: 'account invite', status: 'sent', messageId: '<abc@brevo>' }, { at: '2026-10-13T02:00:00Z', to: ['kai@example.com'], subject: 'Your Term 4 2026 place', kind: 'place invite', status: 'failed', error: 'Brevo 400: bad' }] }
let hold = null
const answers = (b) => {
  if (b.action === 'playersList') return structuredClone(PLAYERS)
  if (b.action === 'pricing') return PRICING
  if (b.action === 'emailLog') return LOG
  if (b.action === 'inviteAccount') return { success: true, sentTo: 'kai@example.com', at: '2026-10-13T03:00:00Z', signedInBefore: false }
  if (b.action === 'addPlayerNoGroup') return hold ? hold(b) : { success: true, rowId: 'recNEW00000000003', emailed: true, emailTo: b.parent?.email || '', payreq: null }
  if (b.action === 'getProfile') return { success: true, row: { rowId: b.rowId, name: 'Kai Sampleton', parent: '', email: 'kai@example.com', phone: '0400 111 222', ownContact: true, paymentType: 'JFP Pro sessions', feeAud: 0, paidAud: 0, perSessionCents: 6500, paymentTypes: ['JFP Session by session', 'JFP Pro sessions', 'JFP 10 weeks'] }, profile: null, prefill: { dob: '1999-04-02' }, options: { levels: ['NPL'], playingUp: ['Own age'], positions: ['Winger'], feet: ['Left'], years: ['5 or more years'], clubs: ['Test Valley FC'] } }
  if (['editPlayer', 'saveProfile'].includes(b.action)) return { success: true, openLinks: [], profile: {} }
  return null
}

await test('Players tab: an own contact shows as one, with Text Kai, Account invite and the Emails check', async () => {
  const p = await openPortal({ hash: '#families', onPost: answers })
  assert.match(p.text('tr[data-pl="recSELF0000000001"]'), /Kai Sampleton \(27\) ?Pro ?Own contact/)
  await p.click('tr[data-pl="recSELF0000000001"]')
  assert.match(p.text('#jp-modal'), /Contact \(the player\).*The player is their own contact/)
  assert.equal(p.text('#pd-text'), 'Text Kai')
  assert.match(p.text('#pd-emails'), /Action needed: sign in to your JFP account.*account invite · Brevo abc@brevo ?Sent.*Your Term 4 2026 place.*Brevo 400: bad ?Failed/)
  await p.click('#pd-invite')
  assert.deepEqual(p.posts.filter((b) => b.action === 'inviteAccount'), [{ action: 'inviteAccount', rowId: 'recSELF0000000001' }])
  assert.match(p.text('#pd-invite-out'), /^Sent to kai@example\.com\./)
  // and the same invite can go by text (Lee, 13 Oct 2026), when there is a mobile
  if (/Text/.test(p.text('#pd-invite-out'))) assert.match(p.text('#pd-invite-out'), /Text them too$/)
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Players tab Add: as detailed as Edit; own contact hides the parent and renames the fields; an adult is ticked for you', async () => {
  const p = await openPortal({ hash: '#families', onPost: answers })
  await p.click('#pl-add')
  for (const id of ['pa-club', 'pa-team', 'pa-level', 'pa-pos', 'pa-foot', 'pa-ename', 'pa-med', 'pa-goals', 'pa-p2name', 'pa-own', 'pa-pay', 'pa-note']) assert.ok(p.$(`#${id}`), `has ${id}`)
  assert.deepEqual([...p.d.querySelectorAll('#pa-pay option')].map((o) => o.value), ['none', 'link', 'offline', 'sessions', 'pro'])
  assert.deepEqual([...p.d.querySelectorAll('#pa-prod optgroup')].map((g) => `${g.label}: ${g.textContent}`), ['JFP price list: Term, small group · A$850', 'Pro sessions: Pro session · A$65 a session', 'Other: Kit fee · A$60'], 'Lee\'s own prices in Paying for, by programme')
  assert.doesNotMatch(p.text('#pa-prod'), /Old/, 'archived prices are not offered')
  const set = (id, v) => { const el = p.$(`#${id}`); el.value = v; el.dispatchEvent(new p.w.Event('input', { bubbles: true })); el.dispatchEvent(new p.w.Event('change', { bubbles: true })) }
  set('pa-name', 'Kai Sampleton')
  assert.equal(p.$('#pa-parent-wrap').hidden, false)
  set('pa-dob', '1999-04-02')
  assert.equal(p.$('#pa-own').checked, true, '18 or over: own contact ticked')
  assert.equal(p.$('#pa-parent-wrap').hidden, true); assert.equal(p.$('#pa-p2').hidden, true)
  assert.equal(p.text('#pa-email-l'), "Player's email (they sign in with this)")
  p.$('#pa-send').checked = true; p.$('#pa-send').dispatchEvent(new p.w.Event('change'))
  assert.equal(p.text('#pa-go'), 'Add and email Kai')
  assert.match(p.text('#pa-send-l'), /Email Kai a sign-in invite/)
  p.$('#pa-own').checked = false; p.$('#pa-own').dispatchEvent(new p.w.Event('change'))
  assert.equal(p.text('#pa-go'), 'Add and email the family')
  assert.equal(p.$('#pa-parent-wrap').hidden, false)
  p.close()
})

await test('Players tab Add: the button stays off until the server answers, so a double tap adds once; the profile goes in the same request', async () => {
  let release
  hold = () => new Promise(() => {})
  const p = await openPortal({ hash: '#families', onPost: (b) => (b.action === 'addPlayerNoGroup' ? null : answers(b)) })
  // A slow server: the add waits until we let it go.
  const realFetch = p.w.fetch
  p.w.fetch = async (url, init = {}) => { const b = init.body ? JSON.parse(init.body) : {}; if (b.action === 'addPlayerNoGroup') { p.posts.push(b); await new Promise((r) => { release = r }); return { ok: true, status: 200, json: async () => ({ success: true, rowId: 'recNEW00000000003', emailed: false, payreq: null }) } } return realFetch(url, init) }
  await p.click('#pl-add')
  const set = (id, v) => { const el = p.$(`#${id}`); el.value = v; el.dispatchEvent(new p.w.Event('input', { bubbles: true })); el.dispatchEvent(new p.w.Event('change', { bubbles: true })) }
  set('pa-name', 'Kai Sampleton'); set('pa-dob', '1999-04-02'); set('pa-email', 'kai@example.com'); set('pa-club', 'Test Valley FC')
  set('pa-pay', 'pro'); set('pa-per', '65')
  p.$('#pa-pos [data-pos="Winger"]').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }))
  const go = p.$('#pa-go')
  go.dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }))
  go.dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }))
  await p.settle()
  assert.equal(go.disabled, true, 'off while saving'); assert.equal(go.textContent, 'Adding')
  const adds = p.posts.filter((b) => b.action === 'addPlayerNoGroup')
  assert.equal(adds.length, 1, 'one request for two taps')
  assert.deepEqual([adds[0].ownContact, adds[0].payment, adds[0].perSessionCents, adds[0].player, adds[0].parent.name], [true, 'pro', 6500, { name: 'Kai Sampleton', dob: '1999-04-02' }, ''])
  assert.deepEqual(adds[0].profile, { dob: '1999-04-02', club: 'Test Valley FC', positions: ['Winger'] }, 'player information in the same request, no parent fields')
  release()
  await p.settle()
  assert.equal(p.$('#pa-go'), null, 'closed once it answered')
  hold = null
  p.close()
})

await test('Players tab Add: a duplicate is refused with a link to the existing player', async () => {
  const p = await openPortal({ hash: '#families', onPost: (b) => (b.action === 'addPlayerNoGroup' ? { status: 409, success: false, error: 'Kai Sampleton (kai@example.com) is already in Term 4 Players with no group yet. Open that row instead.', code: 'duplicate', rowId: 'recSELF0000000001', inGroup: false } : answers(b)) })
  await p.click('#pl-add')
  p.$('#pa-name').value = 'Kai Sampleton'
  await p.click('#pa-go')
  assert.match(p.text('#pa-err'), /already in Term 4 Players with no group yet\. Open that row instead\. Open the existing player/)
  assert.equal(p.$('#pa-force'), null, 'no "add anyway" when the twin has no group')
  assert.equal(p.$('#pa-go').disabled, false, 'back on after the answer')
  await p.click('#pa-open-dup')
  assert.match(p.text('#jp-modal h2'), /Kai Sampleton/)
  p.close()
})

await test('Edit: own contact, payment type with Pro sessions, the per-session price, and a fee from a price', async () => {
  const p = await openPortal({ hash: '#families', onPost: answers })
  await p.click('[data-pl-edit="recSELF0000000001"]')
  assert.equal(p.$('#pe-own').checked, true); assert.equal(p.$('#pe-parent-wrap').hidden, true)
  assert.deepEqual([...p.d.querySelectorAll('#pe-type option')].map((o) => o.textContent), ['Not set', 'JFP Session by session', 'JFP Pro sessions', 'JFP 10 weeks'])
  assert.equal(p.$('#pe-type').value, 'JFP Pro sessions'); assert.equal(p.$('#pe-per').value, '65'); assert.equal(p.$('#pe-per-wrap').hidden, false)
  const k = p.$('#pe-price'); k.value = String(6000); k.dispatchEvent(new p.w.Event('change'))
  assert.equal(p.$('#pe-fee').value, '60')
  p.$('#pe-own').checked = false; p.$('#pe-own').dispatchEvent(new p.w.Event('change'))
  await p.click('#pe-save')
  const ed = p.posts.find((b) => b.action === 'editPlayer')
  assert.deepEqual(ed.fields, { ownContact: false, feeAud: 60 })
  assert.ok(p.posts.some((b) => b.action === 'saveProfile'))
  p.close()
})

await test('Timetable Add: the same detailed form, Pro session and Lee\'s prices; a per-session price makes them session by session', async () => {
  const BOARD = { success: true, term: 'Term 4 2026', at: Date.now(), totals: { players: 0, dashboard: 0, awaiting: 0, placesLeft: 8, pendingRequests: 0, waivers: 0 }, groups: [{ id: 'g1', day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', locationId: 'belrose', locationName: 'Belrose HQ', coachId: 'sam', coachName: 'Sam', capacity: 8, mode: 'direct', product: 'group', players: [], taken: 0, holds: 0, placesLeft: 8, confirmed: 0, sortTime: '16:20', period: 'pm', pendingRequests: 0, extraCoachNames: [] }], unassigned: [], coaches: [], locations: [{ id: 'belrose', name: 'Belrose HQ' }] }
  const p = await openPortal({ hash: '#board', onPost: (b) => (b.action === 'board' ? structuredClone(BOARD) : b.action === 'addPlayer' ? { success: true, rowId: 'recNEW00000000004', payreq: null, emailed: true, emailTo: 'kai@example.com', words: { self: true, contact: 'Kai' } } : answers(b)) })
  await p.click('#b-add')
  await p.click('#pg-go')
  for (const id of ['ap-club', 'ap-level', 'ap-pos', 'ap-ename', 'ap-own', 'ap-note', 'ap-search']) assert.ok(p.$(`#${id}`), `has ${id}`)
  assert.deepEqual([...p.d.querySelectorAll('#ap-pay option')].map((o) => o.value), ['link', 'offline', 'sessions', 'pro', 'trial', 'none'])
  assert.deepEqual([...p.d.querySelectorAll('#ap-price-prod optgroup')].map((g) => g.label), ['JFP price list', 'Pro sessions', 'Other'])
  const pick = p.$('#ap-price-prod'); pick.value = 'price:PR-1-AAAAAA'; pick.dispatchEvent(new p.w.Event('change', { bubbles: true }))
  assert.equal(p.$('#ap-pay').value, 'pro', 'a per-session Pro price makes them a Pro session player'); assert.equal(p.$('#ap-per').value, '65')
  const set = (id, v) => { const el = p.$(`#${id}`); el.value = v; el.dispatchEvent(new p.w.Event('input', { bubbles: true })); el.dispatchEvent(new p.w.Event('change', { bubbles: true })) }
  set('ap-name', 'Kai Sampleton'); set('ap-dob', '1999-04-02'); set('ap-email', 'kai@example.com')
  assert.equal(p.text('#ap-go'), 'Add and email Kai')
  await p.click('#ap-go')
  const add = p.posts.find((b) => b.action === 'addPlayer')
  assert.deepEqual([add.groupId, add.ownContact, add.payment, add.perSessionCents, add.parent.email, add.parent.name], ['g1', true, 'pro', 6500, 'kai@example.com', ''])
  assert.deepEqual(p.errors, [])
  p.close()
})

console.log(`\n${passed} players and own contact checks passed`)
