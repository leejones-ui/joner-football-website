// Matching a player to their signed waiver (Lee, 12 Oct 2026: "match every
// single waiver"). Invented names; the shapes are the real cases found.
import assert from 'node:assert/strict'
import { waiverFor, sameFirstName, isoDate } from '../api/_jfp-airtable.js'

let passed = 0
const test = (n, fn) => { fn(); passed += 1; console.log(`ok - ${n}`) }
const w = (player, x = {}) => ({ id: `w-${player}`, player, email: 'fam@example.com', mobile: '0400 000 111', dob: '', accepted: true, term: 'Term 3 2026', ...x })
const fam = (x = {}) => ({ emails: ['fam@example.com'], phones: [], ...x })

test('the usual: same name and the family email', () => {
  assert.equal(waiverFor('Ava Stone', fam(), [w('Ava Stone')]).how, 'family email or mobile')
})
test('two close waivers in one family: the exact first name wins (Charlie, not Charlotte)', () => {
  const ws = [w('Charlotte Rowe'), w('Charlie Rowa')]
  assert.equal(waiverFor('Charlie Rowe', fam(), ws).id, 'w-Charlie Rowa')
  assert.equal(waiverFor('Charlotte Rowe', fam(), ws).id, 'w-Charlotte Rowe')
})
test('signed under another email: exact name and the same date of birth', () => {
  const ws = [w('Joe Fenn', { email: 'joe@example.com', mobile: '', dob: '2007-07-01' })]
  assert.equal(waiverFor('Joe Fenn', fam({ dob: '2007-07-01' }), ws).how, 'same name and date of birth')
  assert.equal(waiverFor('Joe Fenn', fam({ dob: '2008-01-01' }), ws), null, 'another Joe Fenn, other family, other birthday')
  assert.equal(waiverFor('Joe Fenn', fam(), ws), null, 'no date of birth: never on name alone')
})
test('same family, written differently: first name only, middle name, short form, nickname', () => {
  assert.equal(waiverFor('Ishaan Sidd', fam({ dob: '2016-02-02' }), [w('Ishaan', { dob: '02/02/2016' })]).how, 'same family and date of birth')
  assert.ok(waiverFor('Kobi Bell', fam(), [w('Kobi David Bell')]))
  assert.ok(waiverFor('Dom Davis', fam(), [w('Dominic Davis')]))
  assert.ok(waiverFor('Joey Doyle', fam(), [w('Joseph')]))
})
test('never a sibling or a stranger', () => {
  assert.equal(waiverFor('Cooper Smith', fam(), [w('Isaac Smith', { email: 'other@example.com', mobile: '' })]), null)
  assert.equal(waiverFor('Cooper Smith', fam(), [w('Isaac Smith')]), null, 'a sibling in the same family')
  assert.equal(waiverFor('Sam Lee', fam(), [w('Samuel Lee'), w('Samantha Lee')]), null, 'two siblings could both fit: neither')
  assert.equal(waiverFor('Ava Stone', fam(), [w('Ava Stone', { accepted: false })]), null, 'terms not accepted')
})
test('helpers', () => {
  assert.equal(isoDate('05/03/2017'), '2017-03-05'); assert.equal(isoDate('2017-03-05T00:00'), '2017-03-05'); assert.equal(isoDate('soon'), '')
  assert.ok(sameFirstName('Benji', 'Benjamin')); assert.ok(!sameFirstName('Charlie', 'Charlotte')); assert.ok(!sameFirstName('Al', 'Alex'))
})
console.log(`\n${passed} waiver matching checks passed`)
