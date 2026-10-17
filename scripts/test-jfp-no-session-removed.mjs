// "No session yet" leaves out removed players (Lee, 18 Oct 2026). Unit check.
//   node scripts/test-jfp-no-session-removed.mjs
import assert from 'node:assert/strict'
import { accountsWithNoSession } from '../api/_jfp-account-open.js'

const prof = (id, name, email, rowIds = []) => ({ id, key: `${name}|${email}`, name, emails: [email], rowIds, updatedAt: '2026-10-18' })
const profiles = [prof('p1', 'Kip New', 'kip@example.com'), prof('p2', 'Rem Row', 'rem@example.com', ['recREMOVED000001']), prof('p3', 'Nam Match', 'nam@example.com'), prof('p4', 'Held Place', 'held@example.com', ['recHELD000000001'])]
const removed = [{ rowIds: ['recREMOVED000001'], name: 'Someone', email: 'x@example.com' }, { rowIds: [''], name: 'Nam  Match', email: 'NAM@example.com' }]
const names = accountsWithNoSession(profiles, ['recHELD000000001'], {}, removed).map((x) => x.name)
assert.deepEqual(names, ['Kip New'], 'only the genuinely unplaced account; removed by row or by name and email are left out; a held place is left out')
assert.equal(accountsWithNoSession(profiles, [], {}).length, 4, 'with nothing removed and no places held, everyone shows')
console.log('ok - No session yet leaves out removed players (2 checks)')
