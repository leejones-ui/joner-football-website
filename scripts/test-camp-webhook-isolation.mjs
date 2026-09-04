import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

// Routing isolation for the camp payment webhook.
//
// Stripe delivers an event to EVERY endpoint subscribed to that event type,
// account-wide. There is no way to filter by product or metadata at the
// endpoint level. So this endpoint receives download sales, WooCommerce orders
// and JF Teams subscriptions as well as camp bookings.
//
// It used to throw on any checkout session without a registrationId, which
// returned HTTP 400. Stripe reads sustained non-2xx as a broken endpoint: it
// retries for days and eventually disables it, which would take real camp
// bookings down as collateral damage from an unrelated product's sale.
//
// These are source assertions rather than an invocation because the handler
// reaches Sanity, Google Sheets and Stripe on import. The property being
// guarded is structural, so structure is a fair thing to assert.

const source = fs.readFileSync(
  path.join(process.cwd(), 'api', 'camp-payment-webhook.js'),
  'utf8',
)

// 1. A session that is not a camp booking must not throw.
assert.doesNotMatch(
  source,
  /if \(!registrationId\) throw new Error\('Stripe session missing registrationId metadata\.'\)/,
  'the session branch must not throw on a foreign checkout session: that returns 400 and puts the endpoint at risk of being disabled',
)

// 2. Both branches must reach the same "not ours" outcome.
const ignoredMatches = source.match(/reason: 'missing-registrationId-metadata'/g) || []
assert.equal(
  ignoredMatches.length,
  2,
  'both the payment_intent and the checkout.session branches must ignore a missing registrationId, not just one',
)

// 3. The handler still answers 200 on the happy path out.
assert.match(
  source,
  /return res\.status\(200\)\.json\(\{ received: true, result \}\)/,
  'an ignored event must still be acknowledged with 200 so Stripe stops retrying it',
)

// 4. A genuine camp booking must still be confirmed.
assert.match(
  source,
  /result = await confirmPaidRegistration\(registrationId, \{/,
  'a session WITH a registrationId must still confirm the camp registration',
)

// 5. The retirement flag is a temporary mask, not the fix. If it is ever the
//    only thing standing between a foreign event and a 400, this test should
//    fail rather than pass quietly.
assert.match(
  source,
  /CAMP_WEBHOOKS_RETIRED/,
  'the retirement short-circuit is expected to still exist, but it must not be what makes this safe',
)

console.log('camp webhook isolation: ok')
