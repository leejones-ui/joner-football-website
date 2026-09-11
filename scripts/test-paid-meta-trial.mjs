import assert from 'node:assert/strict'
import { isPaidMetaTrial } from '../api/_uscreen-webhook.js'
assert.equal(isPaidMetaTrial({ utm_source: 'fb', utm_medium: 'paid_social' }), true)
assert.equal(isPaidMetaTrial({ utm_source: 'ig', utm_medium: 'social', ad_id: '120249785829800035' }), true)
assert.equal(isPaidMetaTrial({ utm_source: 'ig', utm_medium: 'social' }), false)          // organic Instagram
assert.equal(isPaidMetaTrial({ utm_source: 'google', utm_medium: 'paid' }), false)          // paid, not Meta
assert.equal(isPaidMetaTrial({ utm_source: 'brevo', utm_medium: 'email', first_utm_source: 'fb', first_utm_medium: 'paid_social' }), true) // first touch was the ad
assert.equal(isPaidMetaTrial({}), false)
console.log('paid meta trial tests passed')
