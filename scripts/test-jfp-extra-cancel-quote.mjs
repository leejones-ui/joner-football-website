// Extra session cancel rule (Lee, 5 Nov 2026): 24 hours or more, back less A$5; under, nothing.
//   node scripts/test-jfp-extra-cancel-quote.mjs
import assert from 'node:assert/strict'
const { cancelQuote } = await import('../api/_jfp-extra-cancel.js')
const { sydneyWallToUtcMs } = await import('../api/_jfp-cancel.js')
const slot = { date: '2026-11-08', time: '10:00am' }
const start = sydneyWallToUtcMs('2026-11-08', '10:00')
const H = 3600000
let q = cancelQuote({ slot, paidCents: 12000, nowMs: start - 25 * H })
assert.deepEqual([q.late, q.refundCents], [false, 11500])
q = cancelQuote({ slot, paidCents: 12000, nowMs: start - 24 * H })
assert.deepEqual([q.late, q.refundCents], [false, 11500], 'exactly 24 hours counts')
q = cancelQuote({ slot, paidCents: 12000, nowMs: start - 23 * H })
assert.deepEqual([q.late, q.refundCents], [true, 0])
assert.ok(cancelQuote({ slot, paidCents: 12000, nowMs: start + 60000 }).error, 'started')
assert.equal(cancelQuote({ slot, paidCents: 0, nowMs: start - 48 * H }).refundCents, 0, 'unpaid')
console.log('5 passed')
