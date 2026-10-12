// Which group a Term 4 row lands in. A session can have several groups, one
// per coach; the row's Coach decides, whatever the group ids look like
// (Dean's Wednesday group, added 12 Oct 2026, swallowed everyone).
import assert from 'node:assert/strict'
import { placeInGroups } from '../api/_jfp-airtable.js'
import { normaliseConfig } from '../api/_jfp-store.js'
const config = normaliseConfig({})
const G = (id, coachId, extra = {}) => ({ id, day: 'Wednesday', time: '6:30am', location: 'NTRA', coachId, ...extra })
const row = (id, coach, extra = {}) => ({ id, player: id, day: 'Wednesday', time: '6:30am', location: 'NTRA', coach, sessionId: 'wed-0630-ntra', groupId: 'wed-0630-ntra', ...extra })
const place = async (rows, groups) => Object.fromEntries((await placeInGroups({ players: rows }, groups, config)).players.map((p) => [p.id, p.groupId]))
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('ok -', name) }
const split = [G('wed-0630-ntra-lee', 'lee'), G('wed-0630-ntra-sam', 'sam'), G('wed-0630-ntra', 'dean')]
await t('a new coach group with a plain id does not take the other coaches players', async () => {
  const r = await place([row('a', 'Lee Jones'), row('b', 'Sam Yorks'), row('c', 'Dean Mac')], split)
  assert.deepEqual(r, { a: 'wed-0630-ntra-lee', b: 'wed-0630-ntra-sam', c: 'wed-0630-ntra' })
})
await t('no coach on a split session: not in a group, for staff to place', async () => {
  const r = await place([row('d', '')], split)
  assert.ok(!split.some((g) => g.id === r.d))
})
await t('a coach with no group at that session: not in a group', async () => {
  const r = await place([row('e', 'Ruby Fanoosh')], split)
  assert.ok(!split.some((g) => g.id === r.e))
})
await t('one group at a session takes every row there, whatever its coach', async () => {
  const r = await place([row('f', 'Sam Yorks'), row('g', '')], [G('wed-0630-ntra', 'dean')])
  assert.deepEqual(r, { f: 'wed-0630-ntra', g: 'wed-0630-ntra' })
})
await t('rows typed loosely still find their group', async () => {
  const r = await place([row('h', 'Dean Mac', { day: 'wednesday ', time: '6.30am', location: 'ntra ', sessionId: 'x', groupId: 'x' })], split)
  assert.equal(r.h, 'wed-0630-ntra')
})
await t('a row with no session stays with no group', async () => {
  const r = await place([{ id: 'i', player: 'i', day: '', time: '', location: '', coach: '', sessionId: '', groupId: '' }], split)
  assert.equal(r.i, '')
})
console.log(`${n} placement checks passed`)
