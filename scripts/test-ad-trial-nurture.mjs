import assert from 'node:assert/strict'
import { pickStep, planNurture } from '../api/_ad-trial-nurture.js'
const now = new Date('2026-09-11T12:00:00Z')
const row = (started, status = 'in_trial', channel = 'meta_ads') => ({ uscreen_user_id: started, trial_started_at: started, trial_ends_at: new Date(Date.parse(started) + 7 * 86400000).toISOString(), status, attribution: { channel } })
assert.equal(pickStep(row('2026-09-11T02:00:00Z'), now), undefined)            // 10 hours in: too early
assert.equal(pickStep(row('2026-09-10T06:00:00Z'), now).step, 'day1')          // 1.25 days
assert.equal(pickStep(row('2026-09-08T06:00:00Z'), now).step, 'day3')          // 3.25 days
assert.equal(pickStep(row('2026-09-05T06:00:00Z'), now).step, 'day6')          // 6.25 days, trial still live
assert.equal(pickStep(row('2026-09-04T06:00:00Z'), now), undefined)            // 7.25 days: trial over
assert.equal(pickStep(row('2026-09-08T06:00:00Z', 'converted'), now), undefined) // paid: never nurture
assert.equal(pickStep(row('2026-09-08T06:00:00Z', 'in_trial', 'google'), now), undefined) // not from an ad
const plan = planNurture([row('2026-09-10T06:00:00Z'), row('2026-09-08T06:00:00Z', 'converted'), row('2026-09-05T06:00:00Z')], now)
assert.deepEqual(plan.map((p) => p.step), ['day1', 'day6'])
assert.deepEqual(plan.map((p) => p.templateId), [326, 328])
console.log('ad trial nurture tests passed')
