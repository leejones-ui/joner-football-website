// Parent emails as Airtable holds them: "a@x.com <a@x.com>", two addresses,
// capitals. A family signs in with the bare address and must see their rows.
import assert from 'node:assert/strict'
import { emailsIn, rowEmails } from '../api/_jfp-store.js'
import { familyFor } from '../api/_jfp-airtable.js'

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('ok -', name) }

ok('mail-app style cell gives the bare address', () => assert.deepEqual(emailsIn('Ed.A.Cav@gmail.com <ed.a.cav@gmail.com>'), ['ed.a.cav@gmail.com']))
ok('two addresses in one cell', () => assert.deepEqual(emailsIn('mum@x.com; dad@y.com.au'), ['mum@x.com', 'dad@y.com.au']))
ok('blank cell', () => assert.deepEqual(emailsIn(''), []))
ok('older cached rows without .emails still work', () => assert.deepEqual(rowEmails({ email: 'a@b.com <a@b.com>' }), ['a@b.com']))

const row = (id, player, emails, extra = {}) => ({ id, player, email: emails[0], emails, phone: '', day: 'Friday', time: '6:30am', location: 'Rydalmere', groupId: 'fri-0630', holdsPlace: true, term4: [], ...extra })
const roster = {
  players: [row('r1', 'Josh Test', ['ed@gmail.com', 'mum@gmail.com']), row('r2', 'Other Kid', ['other@x.com'])],
  term3: [], waivers: [{ id: 'w1', player: 'Josh Test', email: 'mum@gmail.com', mobile: '', dob: '', signedDate: '2026-07-01', accepted: true }],
}
ok('signing in with the bare address finds the session', () => {
  const fam = familyFor('ED@gmail.com', roster, '2026-10-13')
  assert.equal(fam.players.length, 1)
  assert.equal(fam.players[0].term4[0].id, 'r1')
})
ok('second parent sees the same family, and the waiver under either address counts', () => {
  const fam = familyFor('mum@gmail.com', roster, '2026-10-13')
  assert.equal(fam.players[0].name, 'Josh Test')
  assert.ok(fam.players[0].waiver)
})
ok('another family never appears', () => assert.ok(!familyFor('ed@gmail.com', roster, '2026-10-13').players.some((p) => p.name === 'Other Kid')))
console.log(`${n} email checks passed`)
