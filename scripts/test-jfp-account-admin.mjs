import assert from 'node:assert/strict'
import {
  accountState, archiveRecord, restoreRecord, accountReferences, canDeleteEmpty,
  mergePreview, playerKeys,
} from '../api/_jfp-account-admin.js'

const emptyRefs = { profiles: [], term4Rows: [], payments: [], waivers: [], sessions: [] }
const empty = { email: 'empty@example.com', players: [] }
const source = { email: 'source@example.com', kind: 'new', players: [{ key: 'alex|source@example.com', name: 'Alex Source' }] }
const target = { email: 'target@example.com', kind: 'new', players: [{ key: 'alex|target@example.com', name: 'Alex Target' }] }

assert.equal(accountState(empty), 'active')
const archived = archiveRecord(empty, 'admin@example.com', '2026-10-28T00:00:00.000Z')
assert.equal(accountState(archived), 'archived')
assert.equal(accountState(restoreRecord(archived)), 'active')

assert.equal(canDeleteEmpty(empty, emptyRefs), true, 'an empty account may be deleted')
assert.equal(canDeleteEmpty(empty, { ...emptyRefs, sessions: [{}] }), false, 'sessions block permanent deletion')
assert.equal(canDeleteEmpty({ ...empty, players: [{ key: 'x' }] }, emptyRefs), false, 'linked players block permanent deletion')

const refs = accountReferences({ email: 'source@example.com' }, {
  profiles: [{ emails: ['source@example.com'], key: 'x' }],
  roster: { players: [{ id: 'rec1', email: 'source@example.com', holdsPlace: true, paymentStatus: 'Paid', waiver: true }] },
})
assert.equal(refs.profiles.length, 1)
assert.equal(refs.term4Rows.length, 1)
assert.ok(refs.payments.length && refs.waivers.length && refs.sessions.length, 'history references are detected conservatively')
assert.equal(canDeleteEmpty(empty, refs), false)

const preview = mergePreview(source, target)
assert.equal(preview.ok, true)
assert.equal(preview.preview.playersAdded, 1)
assert.deepEqual([...playerKeys(target)], ['alex|target@example.com'])
assert.equal(mergePreview(source, source).ok, false, 'merge rejects same account')
assert.equal(mergePreview({ ...source, archivedAt: 'x' }, target).ok, false, 'merge rejects archived source')

console.log('ok - merge safety')
console.log('ok - archive/restore')
console.log('ok - empty-only delete')
console.log('ok - duplicate prevention')
console.log('4 account admin checks passed')
