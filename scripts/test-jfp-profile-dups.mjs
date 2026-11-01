// Same child under two spellings (Lee, 1 Nov 2026): old copies must never show
// as a second player, and twins must never be hidden. Pure checks, no server.
import assert from 'node:assert/strict'
import { sameChild } from '../api/_jfp-profiles.js'
import { openPlayers } from '../api/_jfp-account-open.js'
import { duplicateProfiles } from '../api/_jfp-account-admin.js'

let n = 0
const ok = (name, fn) => { fn(); n++; console.log(`ok - ${name}`) }
const kid = (name, dob = '') => ({ name, dob })

ok('the same child under another spelling', () => {
  for (const [a, b] of [['Luciana Massien', 'Lucianna Maslen'], ['Kaleb Yashiki', 'Kaleb Yakishi'], ['Kaleb Yashiki', 'Caleb Yashiki'], ['Joey Doyle', 'Joseph'], ['Josh Cavanna', 'Joshua Cavanna']]) assert.ok(sameChild(kid(a, '2015-04-30'), kid(b, '2015-04-30')), `${a} / ${b}`)
  assert.ok(sameChild(kid('Charlie Roberts'), kid('Charlie Roberte')))
})
ok('twins and siblings stay apart', () => {
  for (const [a, b] of [['Leo Smith', 'Lea Smith'], ['Jack Smith', 'James Smith'], ['Mia Sibling', 'Ava Sibling'], ['Ella Ng', 'Emma Ng']]) assert.ok(!sameChild(kid(a, '2015-01-01'), kid(b, '2015-01-01')), `${a} / ${b}`)
  assert.ok(!sameChild(kid('Laila Maslen', '2013-01-01'), kid('Lucianna Maslen', '2015-04-30')))
  assert.ok(!sameChild(kid('Harry Roberts'), kid('Oliver Roberts')))
})
ok('My account hides an old copy but keeps a sibling who is not booked', () => {
  const fam = { players: [{ key: 'kalebyashiki', name: 'Kaleb Yashiki', term4: [{ id: 'r1' }] }] }
  const profs = [{ name: 'Kaleb Yashiki', key: 'a', rowIds: ['r1'], dob: '2014-02-12' }, { name: 'Kaleb Yakishi', key: 'b', rowIds: [], dob: '2014-02-12' }, { name: 'Mia Yashiki', key: 'c', rowIds: [], dob: '2017-01-01' }]
  assert.deepEqual(openPlayers({ fam, profs, account: null }).map((o) => o.name), ['Mia Yashiki'])
})
ok('the duplicate list keeps the player with a place', () => {
  const p = (id, name, rowIds, extra = {}) => ({ id, name, key: name.toLowerCase(), emails: ['f@x.com'], rowIds, dob: '2014-02-12', ...extra })
  const pairs = duplicateProfiles([p('rec1', 'Kaleb Yakishi', [], { club: 'Hills' }), p('rec2', 'Kaleb Yashiki', ['r1'])])
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].into.id, 'rec2')
  assert.deepEqual(pairs[0].fills, ['club'])
})
console.log(`profile duplicates: ${n} passed`)
