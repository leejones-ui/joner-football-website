// Extra session cancel rule (Lee, 7 Nov 2026): 48 hours or more, back less A$5;
// 24 to 48 hours, half; under 24 hours, nothing. Bookings made before
// RULE48_FROM keep the 24 hour terms (5 Nov 2026).
//   node scripts/test-jfp-extra-cancel-quote.mjs
import assert from 'node:assert/strict'
const { cancelQuote, ruleFor, RULE48_FROM } = await import('../api/_jfp-extra-cancel.js')
const { sydneyWallToUtcMs } = await import('../api/_jfp-cancel.js')
const slot = { date: '2026-11-08', time: '10:00am' }
const start = sydneyWallToUtcMs('2026-11-08', '10:00')
const H = 3600000
let n = 0
const is = (q, band, cents, msg) => { assert.deepEqual([q.band, q.refundCents], [band, cents], msg); n++ }
is(cancelQuote({ slot, paidCents: 12000, nowMs: start - 49 * H }), 'full', 11500)
is(cancelQuote({ slot, paidCents: 12000, nowMs: start - 48 * H }), 'full', 11500, 'exactly 48 hours counts')
is(cancelQuote({ slot, paidCents: 12000, nowMs: start - 47 * H }), 'half', 6000)
is(cancelQuote({ slot, paidCents: 12000, nowMs: start - 30 * H }), 'half', 6000, "Selma's 30 hours")
is(cancelQuote({ slot, paidCents: 12500, nowMs: start - 30 * H }), 'half', 6250)
is(cancelQuote({ slot, paidCents: 12001, nowMs: start - 30 * H }), 'half', 6000, 'half rounds down to the cent')
is(cancelQuote({ slot, paidCents: 12000, nowMs: start - 24 * H }), 'half', 6000, 'exactly 24 hours is half')
is(cancelQuote({ slot, paidCents: 12000, nowMs: start - 23 * H }), 'late', 0)
assert.equal(cancelQuote({ slot, paidCents: 12000, nowMs: start - 30 * H }).fullCents, 11500); n++
// The 24 hour terms, for bookings made before the change.
is(cancelQuote({ slot, paidCents: 12000, rule: '24h', nowMs: start - 30 * H }), 'full', 11500, 'old terms: 30 hours is a refund less A$5')
is(cancelQuote({ slot, paidCents: 12000, rule: '24h', nowMs: start - 24 * H }), 'full', 11500)
is(cancelQuote({ slot, paidCents: 12000, rule: '24h', nowMs: start - 23 * H }), 'late', 0)
assert.ok(cancelQuote({ slot, paidCents: 12000, nowMs: start + 60000 }).error, 'started'); n++
assert.equal(cancelQuote({ slot, paidCents: 0, nowMs: start - 30 * H }).refundCents, 0, 'unpaid'); n++
assert.equal(ruleFor({ at: '2026-11-05T07:28:24.000Z' }), '24h'); n++
assert.equal(ruleFor({ at: RULE48_FROM }), '48h'); n++
assert.equal(ruleFor({}), '24h', 'no booking time: the older, kinder terms'); n++
console.log(`${n} passed`)
