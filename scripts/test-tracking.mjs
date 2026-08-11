import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { extractAttribution, extractMetaIdentity } from '../api/_attribution.js'
import { buildVerifiedMetaEvent, classifyFirstPaidAcquisition, compactBrevoAttributes, isValidUscreenWebhookSecret, mergeStoredAttribution, parseUscreenBody, processUscreenPayload } from '../api/_uscreen-webhook.js'
import { buildLeadAttribution } from '../api/contact-enquiry.js'
import subscribeHandler from '../api/subscribe.js'
import uscreenWebhookHandler from '../api/uscreen-webhook.js'
import { reconcileAuthoritativeFirstPaid } from './lib/first-paid-reconciliation.mjs'
import { reconcileAttributedConversions } from './lib/meta-uscreen-reconciliation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browserSource = fs.readFileSync(path.join(root, 'public/tracking-attribution.js'), 'utf8')
const context = { URLSearchParams, window: {} }
vm.createContext(context)
vm.runInContext(browserSource, context)
const browser = context.window.JonerAttribution
assert.ok(browser, 'browser attribution codec must load')

const original = new URLSearchParams({
  utm_source: 'facebook',
  utm_medium: 'paid_social',
  utm_campaign: 'JF Teams - Traffic - Book A Demo',
  utm_content: 'video_ad_alpha',
  fbclid: 'fb-click-123',
  fbp: 'fb.1.browser-123',
  fbc: 'fb.1.1234000.fb-click-123',
  utm_term: 'adset-456',
  utm_id: 'campaign-123',
  campaign_id: 'campaign-123',
  adset_id: 'adset-id-456',
  ad_id: 'ad-id-789',
  placement: 'instagram_reels',
  first_utm_source: 'instagram',
  first_utm_medium: 'paid_social',
  first_utm_campaign: 'first-coach-touch',
  first_utm_content: 'first-video',
  first_utm_term: 'first-coach-adset',
  first_utm_id: 'first-campaign-001',
  first_campaign_id: 'first-campaign-001',
  first_adset_id: 'first-adset-002',
  first_ad_id: 'first-ad-003',
  first_placement: 'facebook_reels',
})
const encoded = browser.encodeForUscreen(original)
assert.equal(encoded.get('utm_campaign'), original.get('utm_campaign'))
assert.equal(encoded.get('utm_medium'), original.get('utm_medium'))
assert.equal(encoded.get('utm_content'), original.get('utm_content'))
assert.equal(encoded.get('fbclid'), original.get('fbclid'))
assert.match(encoded.get('utm_source'), /^facebook__jfa1__/)

const browserDecoded = browser.decodeUscreenSource(encoded.get('utm_source'))
assert.deepEqual(JSON.parse(JSON.stringify(browserDecoded)), {
  utm_source: 'facebook',
  utm_medium: 'paid_social',
  utm_campaign: 'JF Teams - Traffic - Book A Demo',
  utm_content: 'video_ad_alpha',
  utm_term: 'adset-456',
  utm_id: 'campaign-123',
  campaign_id: 'campaign-123',
  adset_id: 'adset-id-456',
  ad_id: 'ad-id-789',
  placement: 'instagram_reels',
  fbp: 'fb.1.browser-123',
  fbc: 'fb.1.1234000.fb-click-123',
  first_utm_source: 'instagram',
  first_utm_medium: 'paid_social',
  first_utm_campaign: 'first-coach-touch',
  first_utm_content: 'first-video',
  first_utm_term: 'first-coach-adset',
  first_utm_id: 'first-campaign-001',
  first_campaign_id: 'first-campaign-001',
  first_adset_id: 'first-adset-002',
  first_ad_id: 'first-ad-003',
  first_placement: 'facebook_reels',
  encoded_source: encoded.get('utm_source'),
})

const serverDecoded = extractAttribution({ utm_source: encoded.get('utm_source') })
assert.equal(serverDecoded.utm_source, 'facebook')
assert.equal(serverDecoded.utm_medium, 'paid_social')
assert.equal(serverDecoded.utm_campaign, 'JF Teams - Traffic - Book A Demo')
assert.equal(serverDecoded.utm_content, 'video_ad_alpha')
assert.equal(serverDecoded.utm_term, 'adset-456')
assert.equal(serverDecoded.utm_id, 'campaign-123')
assert.equal(serverDecoded.campaign_id, 'campaign-123')
assert.equal(serverDecoded.adset_id, 'adset-id-456')
assert.equal(serverDecoded.ad_id, 'ad-id-789')
assert.equal(serverDecoded.placement, 'instagram_reels')
assert.equal(serverDecoded.first_utm_campaign, 'first-coach-touch')
assert.equal(serverDecoded.first_campaign_id, 'first-campaign-001')
assert.equal(serverDecoded.first_adset_id, 'first-adset-002')
assert.equal(serverDecoded.first_ad_id, 'first-ad-003')
const encodedIdentity = extractMetaIdentity({ utm_source: encoded.get('utm_source') })
assert.equal(encodedIdentity.fbp, 'fb.1.browser-123')
assert.equal(encodedIdentity.fbc, 'fb.1.1234000.fb-click-123')

const stitched = mergeStoredAttribution({
  event: 'order.paid',
  email: 'tracking-test@example.com',
  utm_source: 'Not available',
  user_id: 'user-123',
  order_id: 'order-123',
  event_date: '2026-07-29T01:02:03Z',
  offer_id: 230698,
  total: 59,
}, {
  UTM_SOURCE: 'facebook',
  UTM_MEDIUM: 'paid_social',
  UTM_CAMPAIGN: 'coaches_pro',
  UTM_CONTENT: 'comment_coach',
  UTM_TERM: 'adset-456',
  UTM_ID: 'campaign-123',
  META_CAMPAIGN_ID: 'campaign-123',
  META_ADSET_ID: 'adset-id-456',
  META_AD_ID: 'ad-id-789',
  UTM_PLACEMENT: 'instagram_reels',
  META_FBP: 'fb.1.browser-123',
  META_FBC: 'fb.1.1234000.fb-click-123',
})
const verifiedPaid = buildVerifiedMetaEvent('JF_First_Paid_Membership', stitched, stitched.email, stitched.total)
assert.equal(verifiedPaid.event_name, 'JF_First_Paid_Membership')
assert.equal(verifiedPaid.event_id, 'JF_First_Paid_Membership.order-123')
assert.equal(verifiedPaid.event_time, 1785286923)
assert.equal(verifiedPaid.custom_data.utm_campaign, 'coaches_pro')
assert.equal(verifiedPaid.custom_data.campaign_id, 'campaign-123')
assert.equal(verifiedPaid.custom_data.adset_id, 'adset-id-456')
assert.equal(verifiedPaid.custom_data.ad_id, 'ad-id-789')
assert.equal(verifiedPaid.custom_data.placement, 'instagram_reels')
assert.equal(verifiedPaid.custom_data.value, 59)
assert.equal(verifiedPaid.user_data.fbp, 'fb.1.browser-123')
assert.equal(verifiedPaid.user_data.fbc, 'fb.1.1234000.fb-click-123')
assert.equal(verifiedPaid.user_data.external_id.length, 1)
assert.match(verifiedPaid.user_data.external_id[0], /^[a-f0-9]{64}$/)
const noCurrencyCandidate = buildVerifiedMetaEvent('JF_First_Paid_Membership', {
  ...stitched, currency: undefined, localized_amounts: undefined,
}, stitched.email, stitched.total)
assert.equal(noCurrencyCandidate.custom_data.currency, undefined, 'purchase currency must never default to AUD')

const firstPaidBase = {
  eventType: 'order.paid', offerId: 230698, total: 59, transactionId: 'ch_first_paid_123',
}
assert.deepEqual(classifyFirstPaidAcquisition({
  ...firstPaidBase,
  contactSnapshot: { status: 'not_found', listIds: [], attributes: {} },
}), { eligible: true, reason: 'first-paid-membership' })
assert.deepEqual(classifyFirstPaidAcquisition({
  ...firstPaidBase,
  contactSnapshot: { status: 'found', listIds: [21], attributes: {} },
}), { eligible: true, reason: 'trial-converted-first-paid' })
for (const priorListId of [22, 23, 24, 30, 31, 32, 57, 58, 59]) {
  assert.equal(classifyFirstPaidAcquisition({
    ...firstPaidBase,
    contactSnapshot: { status: 'found', listIds: [priorListId], attributes: {} },
  }).eligible, false)
}
assert.equal(classifyFirstPaidAcquisition({
  ...firstPaidBase,
  contactSnapshot: { status: 'found', listIds: [21], attributes: { JF_FIRST_PAID_TRANSACTION_ID: 'ch_prior' } },
}).eligible, false)
assert.equal(classifyFirstPaidAcquisition({
  ...firstPaidBase,
  transactionId: 'iap_apple_123',
  contactSnapshot: { status: 'not_found', listIds: [], attributes: {} },
}).reason, 'unreconciled-payment-channel')
for (const origin of ['external_apple', 'external_google', 'app_store', 'play_store']) {
  assert.equal(classifyFirstPaidAcquisition({
    ...firstPaidBase,
    origin,
    contactSnapshot: { status: 'not_found', listIds: [], attributes: {} },
  }).reason, 'non-web-payment-origin')
}
assert.equal(classifyFirstPaidAcquisition({
  ...firstPaidBase,
  contactSnapshot: { status: 'error', listIds: [], attributes: {} },
}).reason, 'paid-history-unavailable')
assert.equal(classifyFirstPaidAcquisition({
  ...firstPaidBase, total: 0,
  contactSnapshot: { status: 'not_found', listIds: [], attributes: {} },
}).reason, 'not-positive-paid-order')

const webEvidence = {
  history_complete: true,
  next_cursor: null,
  user: {
    id: 32584033,
    plan_history: [{ plan_id: 230698, origin: 'web' }],
  },
  payments: [{
    id: 57806670,
    amount: 3999,
    currency: 'USD',
    status: 'paid',
    paid_at: '2026-08-10T11:05:21.000-04:00',
    kind: 'subscription',
    source_id: 230698,
    provider: 'stripe',
    provider_invoice_id: 'in_1U2ulLCXA04kVlYCrb4mvvHR',
  }],
}
assert.deepEqual(reconcileAuthoritativeFirstPaid({
  expectedUserId: 32584033,
  invoiceId: 'in_1U2ulLCXA04kVlYCrb4mvvHR',
  evidence: webEvidence,
}), {
  eligible: true,
  reason: 'verified-first-paid-web',
  userId: '32584033',
  invoiceId: 'in_1U2ulLCXA04kVlYCrb4mvvHR',
  paymentId: '57806670',
  offerId: '230698',
  channel: 'web',
  provider: 'stripe',
  currency: 'USD',
  value: 39.99,
  paidAt: '2026-08-10T11:05:21.000-04:00',
})
assert.equal(reconcileAuthoritativeFirstPaid({
  expectedUserId: 32584033,
  invoiceId: 'in_1U2ulLCXA04kVlYCrb4mvvHR',
  evidence: { ...webEvidence, history_complete: false },
}).reason, 'payment-history-incomplete')
assert.equal(reconcileAuthoritativeFirstPaid({
  expectedUserId: 32584033,
  invoiceId: 'in_renewal',
  evidence: {
    ...webEvidence,
    payments: [
      webEvidence.payments[0],
      { ...webEvidence.payments[0], id: 2, provider_invoice_id: 'in_renewal', paid_at: '2026-09-10T11:05:21.000-04:00' },
    ],
  },
}).reason, 'renewal-not-first-paid')
for (const origin of ['external_apple', 'external_google', 'admin', 'manual']) {
  assert.equal(reconcileAuthoritativeFirstPaid({
    expectedUserId: 32584033,
    invoiceId: 'in_1U2ulLCXA04kVlYCrb4mvvHR',
    evidence: { ...webEvidence, user: { ...webEvidence.user, plan_history: [{ plan_id: 230698, origin }] } },
  }).reason, 'non-web-purchase')
}
assert.equal(reconcileAuthoritativeFirstPaid({
  expectedUserId: 32584033,
  invoiceId: 'in_1U2ulLCXA04kVlYCrb4mvvHR',
  evidence: {
    ...webEvidence,
    payments: [webEvidence.payments[0], { ...webEvidence.payments[0], id: 3, status: 'refunded' }],
  },
}).reason, 'invoice-refunded')
assert.equal(reconcileAuthoritativeFirstPaid({
  expectedUserId: 32584033,
  invoiceId: 'in_free',
  evidence: {
    ...webEvidence,
    payments: [{ ...webEvidence.payments[0], id: 4, amount: 0, provider_invoice_id: 'in_free' }],
  },
}).reason, 'not-positive-paid-invoice')
assert.equal(reconcileAuthoritativeFirstPaid({
  expectedUserId: 32584033,
  invoiceId: 'in_1U2ulLCXA04kVlYCrb4mvvHR',
  evidence: {
    ...webEvidence,
    user: {
      ...webEvidence.user,
      plan_history: [
        { plan_id: 230698, origin: 'external_apple', started_at: '2025-01-01T00:00:00Z', ended_at: '2025-02-01T00:00:00Z' },
        { plan_id: 230698, origin: 'web', started_at: '2026-08-10T11:03:00-04:00', ended_at: null },
      ],
    },
  },
}).channel, 'web', 'same-plan history must select the channel active at invoice time')
assert.equal(reconcileAuthoritativeFirstPaid({
  expectedUserId: 32584033,
  invoiceId: 'in_1U2ulLCXA04kVlYCrb4mvvHR',
  evidence: {
    ...webEvidence,
    user: { ...webEvidence.user, plan_history: Array.from({ length: 50 }, () => ({ plan_id: 230698, origin: 'web' })) },
  },
}).reason, 'plan-history-may-be-truncated')

const reconciliationRecord = {
  status: 'sent',
  eventId: 'JF_First_Paid_Membership.stable-user-hash',
  reconciliation: {
    historyComplete: true,
    invoiceId: 'in_verified',
    value: 39.99,
    currency: 'USD',
  },
}
assert.deepEqual(reconcileAttributedConversions({
  metaReport: {
    spend: 33,
    spend_currency: 'AUD',
    conversions: [{
      event_id: reconciliationRecord.eventId,
      campaign_id: 'campaign-1', adset_id: 'adset-1', ad_id: 'ad-1',
      value: 39.99, currency: 'USD', value_in_spend_currency: 61.25,
    }],
  },
  uscreenRecords: { records: [reconciliationRecord] },
}), {
  ok: true,
  conversionCount: 1,
  sourceRevenue: { USD: 39.99 },
  spend: 33,
  spendCurrency: 'AUD',
  cpa: 33,
  roas: 1.8561,
  roasBlockedReason: undefined,
})
assert.equal(reconcileAttributedConversions({
  metaReport: { conversions: [{ event_id: reconciliationRecord.eventId, value: 39.99, currency: 'USD' }] },
  uscreenRecords: { records: [reconciliationRecord] },
}).failures[0].reason, 'meta-attribution-identity-incomplete')
assert.equal(reconcileAttributedConversions({
  metaReport: { conversions: [{
    event_id: reconciliationRecord.eventId,
    campaign_id: 'campaign-1', adset_id: 'adset-1', ad_id: 'ad-1', value: 39.99, currency: 'AUD',
  }] },
  uscreenRecords: { records: [reconciliationRecord] },
}).failures[0].reason, 'value-or-currency-mismatch')

const existingDestination = browser.encodeForUscreen(new URLSearchParams({
  utm_source: 'free_bundle',
  utm_medium: 'paid social',
  utm_campaign: 'Coaches & Players – July',
  utm_content: 'session plan / video',
}))
const existingDecoded = extractAttribution({ utm_source: existingDestination.get('utm_source') })
assert.equal(existingDecoded.utm_source, 'free_bundle')
assert.equal(existingDecoded.utm_medium, 'paid social')
assert.equal(existingDecoded.utm_campaign, 'Coaches & Players – July')
assert.equal(existingDecoded.utm_content, 'session plan / video')

const noCampaign = browser.encodeForUscreen(new URLSearchParams({ utm_source: 'organic', utm_medium: 'social' }))
assert.equal(noCampaign.get('utm_source'), 'organic')

const nestedDecoded = extractAttribution({
  metadata: {
    utm_source: encoded.get('utm_source'),
    utm_campaign: 'Direct webhook campaign wins',
    utm_term: 'coach-session-plans',
  },
})
assert.equal(nestedDecoded.utm_campaign, 'Direct webhook campaign wins')
assert.equal(nestedDecoded.utm_term, 'coach-session-plans')

const envelopeDecoded = extractAttribution({
  payload: {
    event_data: {
      query_params: {
        utm_source: existingDestination.get('utm_source'),
        utm_term: 'nested-term',
      },
    },
  },
})
assert.equal(envelopeDecoded.utm_campaign, 'Coaches & Players – July')
assert.equal(envelopeDecoded.utm_term, 'nested-term')

const identity = extractMetaIdentity({ metadata: { fbclid: 'fb-click-123', fbp: 'fb.1.browser' } }, 1234)
assert.equal(identity.fbp, 'fb.1.browser')
assert.equal(identity.fbc, 'fb.1.1234000.fb-click-123')

const teamLeadAttribution = buildLeadAttribution({
  utm_source: 'facebook',
  utm_medium: 'paid_social',
  utm_campaign: 'Teams Demo July',
  utm_content: 'Coach Testimonial Video',
  utm_term: 'Academy Owners',
  fbclid: 'fb-click-team-123',
  campaign_id: 'cmp-123',
  adset_id: 'set-456',
  ad_id: 'ad-789',
  placement: 'instagram_reels',
  landing_page: 'https://jonerfootball.com/teams?utm_source=facebook',
  referrer: 'https://l.facebook.com/',
}, '2026-07-23T04:00:00.000Z')
assert.deepEqual(teamLeadAttribution, {
  trafficSource: 'Facebook / Instagram Ads',
  utmSource: 'facebook',
  utmMedium: 'paid_social',
  campaign: 'Teams Demo July',
  campaignId: 'cmp-123',
  adSet: 'Academy Owners',
  adSetId: 'set-456',
  ad: 'Coach Testimonial Video',
  adId: 'ad-789',
  placement: 'instagram_reels',
  fbclid: 'fb-click-team-123',
  landingPage: 'https://jonerfootball.com/teams?utm_source=facebook',
  referrer: 'https://l.facebook.com/',
})
assert.equal(buildLeadAttribution({ utm_source: 'instagram', utm_medium: 'organic_social' }).trafficSource, 'Facebook / Instagram Organic')
assert.equal(buildLeadAttribution({ fbclid: 'click-only' }).trafficSource, 'Facebook / Instagram Ads')

assert.deepEqual(parseUscreenBody('{"event":"user.created","utm_campaign":"json-body"}'), {
  event: 'user.created',
  utm_campaign: 'json-body',
})
assert.throws(() => parseUscreenBody('{invalid'), /Invalid JSON webhook body/)
assert.throws(() => parseUscreenBody('[]'), /JSON object/)

const fallback = compactBrevoAttributes({
  FIRSTNAME: 'Test',
  UTM_SOURCE: 'facebook',
  UTM_MEDIUM: 'paid_social',
  UTM_CAMPAIGN: 'coaches',
  UTM_CONTENT: 'video',
  UTM_TERM: 'coach',
  USCREEN_OFFER_ID: 'rejected-field',
})
assert.deepEqual(fallback, {
  FIRSTNAME: 'Test',
  UTM_SOURCE: 'facebook',
  UTM_MEDIUM: 'paid_social',
  UTM_CAMPAIGN: 'coaches',
  UTM_CONTENT: 'video',
  UTM_TERM: 'coach',
})

function mockResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; return this },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
    end() { return this },
  }
}

const healthEnv = {
  USCREEN_WEBHOOK_SECRET: process.env.USCREEN_WEBHOOK_SECRET,
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  META_CAPI_TOKEN: process.env.META_CAPI_TOKEN,
}
process.env.USCREEN_WEBHOOK_SECRET = 'health-secret'
process.env.KV_REST_API_URL = 'https://kv.health.test'
process.env.KV_REST_API_TOKEN = 'health-token'
process.env.META_CAPI_TOKEN = 'meta-health-token'
const healthResponse = mockResponse()
await uscreenWebhookHandler({ method: 'GET', query: {}, headers: {} }, healthResponse)
assert.equal(healthResponse.statusCode, 200)
assert.deepEqual(healthResponse.payload?.configured, {
  secureWebhook: true,
  attributionStore: true,
  metaCapi: true,
})
for (const [key, value] of Object.entries(healthEnv)) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

const invalidWebhookResponse = mockResponse()
await subscribeHandler(
  { method: 'POST', query: { uscreen_webhook: '1' }, body: '{invalid' },
  invalidWebhookResponse,
)
assert.equal(invalidWebhookResponse.statusCode, 400)
assert.equal(invalidWebhookResponse.payload?.error, 'Invalid webhook JSON')

const validWebhookResponse = mockResponse()
await subscribeHandler(
  {
    method: 'POST',
    query: { uscreen_webhook: '1' },
    body: '{"event":"tracking.qa","email":"tracking-test@example.com"}',
  },
  validWebhookResponse,
)
assert.equal(validWebhookResponse.statusCode, 200)
assert.equal(validWebhookResponse.payload?.reason, 'unhandled-event-type')

const originalWebhookSecret = process.env.USCREEN_WEBHOOK_SECRET
process.env.USCREEN_WEBHOOK_SECRET = 'test-secret-123'
assert.equal(isValidUscreenWebhookSecret({ query: {}, headers: {} }), false)
assert.equal(isValidUscreenWebhookSecret({ query: { secret: 'test-secret-123' }, headers: {} }), true)
if (originalWebhookSecret === undefined) delete process.env.USCREEN_WEBHOOK_SECRET
else process.env.USCREEN_WEBHOOK_SECRET = originalWebhookSecret

const originalFetch = globalThis.fetch
const originalBrevoKey = process.env.BREVO_API_KEY
const originalMetaToken = process.env.META_CAPI_TOKEN
const originalKvUrl = process.env.KV_REST_API_URL
const originalKvToken = process.env.KV_REST_API_TOKEN
const metaBodies = []
const brevoBodies = []
const kvStore = new Map()
process.env.BREVO_API_KEY = 'test-brevo-key'
process.env.META_CAPI_TOKEN = 'test-meta-token'
process.env.KV_REST_API_URL = 'https://kv.test'
process.env.KV_REST_API_TOKEN = 'test-kv-token'
globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  if (target === 'https://kv.test') {
    const command = JSON.parse(options.body)
    if (command[0] === 'SET') {
      if (command.includes('NX') && kvStore.has(command[1])) {
        return { ok: true, status: 200, async json() { return { result: null } } }
      }
      kvStore.set(command[1], command[2])
      return { ok: true, status: 200, async json() { return { result: 'OK' } } }
    }
    if (command[0] === 'GET') {
      return { ok: true, status: 200, async json() { return { result: kvStore.get(command[1]) || null } } }
    }
    if (command[0] === 'DEL') {
      const deleted = kvStore.delete(command[1]) ? 1 : 0
      return { ok: true, status: 200, async json() { return { result: deleted } } }
    }
  }
  if (target.includes('/contacts/') && (!options.method || options.method === 'GET')) {
    if (target.includes('brand-new')) {
      return { ok: false, status: 404, async json() { return {} } }
    }
    const listIds = target.includes('existing-renewer') ? [22] : [21]
    return {
      ok: true,
      status: 200,
      async json() {
        return { listIds, attributes: {
          UTM_SOURCE: 'facebook', UTM_MEDIUM: 'paid_social', UTM_CAMPAIGN: 'coaches_pro',
          UTM_CONTENT: 'comment_coach', UTM_TERM: 'adset-456', UTM_ID: 'campaign-123',
          META_FBP: 'fb.1.browser-123', META_FBC: 'fb.1.1234000.fb-click-123',
        } }
      },
    }
  }
  if (target.includes('graph.facebook.com')) {
    metaBodies.push(JSON.parse(options.body))
    return { ok: true, status: 200, async text() { return '{"events_received":1}' } }
  }
  if (target === 'https://api.brevo.com/v3/contacts' && options.method === 'POST') {
    brevoBodies.push(JSON.parse(options.body))
    return { ok: true, status: 204, async text() { return '' } }
  }
  throw new Error(`Unexpected test fetch: ${target}`)
}
try {
  const metaBeforeFirstPaid = metaBodies.length
  await processUscreenPayload({
    event: 'order.paid', email: 'tracking-test@example.com', user_id: 'user-paid-123',
    order_id: 'paid-123', transaction_id: 'ch_paid_123',
    event_date: '2026-07-29T01:02:03Z', offer_id: 230698, offer_title: 'Max', total: 59,
    currency: 'AUD', utm_source: 'Not available',
  })
  assert.equal(metaBodies.length, metaBeforeFirstPaid, 'webhook must never send the canonical first-paid event')
  const firstPaidKey = [...kvStore.keys()].find((key) => key.startsWith('jf:meta:first-paid:'))
  assert.ok(firstPaidKey, 'first-paid candidate must be stored in KV')
  const firstPaidRecord = JSON.parse(kvStore.get(firstPaidKey))
  assert.equal(firstPaidRecord.status, 'candidate')
  assert.equal(firstPaidRecord.metaEvent.event_name, 'JF_First_Paid_Membership')
  assert.equal(firstPaidRecord.metaEvent.custom_data.utm_campaign, 'coaches_pro')
  assert.equal(firstPaidRecord.metaEvent.user_data.fbc, 'fb.1.1234000.fb-click-123')
  assert.equal(brevoBodies.at(-1).attributes.JF_FIRST_PAID_CANDIDATE_TRANSACTION_ID, 'ch_paid_123')
  assert.equal(JSON.stringify(firstPaidRecord.metaEvent).includes('user-paid-123'), false, 'raw Uscreen user ID must not appear in the Meta payload')
  const firstPaidEventId = firstPaidRecord.eventId

  await processUscreenPayload({
    event: 'order.paid', email: 'tracking-test@example.com', user_id: 'user-paid-123',
    order_id: 'paid-renewal-different-order', transaction_id: 'ch_paid_renewal_different_order',
    event_date: '2026-08-29T01:02:03Z', offer_id: 230698, offer_title: 'Max', total: 59,
    currency: 'AUD',
  })
  assert.equal(metaBodies.length, metaBeforeFirstPaid, 'a later order for the same stable user must not emit')
  assert.equal(JSON.parse(kvStore.get(firstPaidKey)).eventId, firstPaidEventId, 'canonical identity must remain stable across order IDs')

  await processUscreenPayload({
    event: 'order.paid', email: 'existing-renewer@example.com', user_id: 'existing-user-1',
    order_id: 'renewal-123', transaction_id: 'ch_renewal_123',
    event_date: '2026-07-30T01:02:03Z', offer_id: 230698, offer_title: 'Max', total: 59,
    currency: 'AUD',
  })
  assert.equal(metaBodies.length, metaBeforeFirstPaid, 'renewals must not emit the canonical acquisition event')

  await processUscreenPayload({
    event: 'order.paid', email: 'tracking-test@example.com', order_id: 'trial-123',
    event_date: '2026-07-29T01:02:03Z', offer_id: 230698, offer_title: 'Max', total: 0,
    currency: 'AUD',
  })
  assert.equal(metaBodies.at(-1).data[0].event_name, 'JF_Trial_Started')
  assert.equal(metaBodies.at(-1).data[0].custom_data.utm_campaign, 'coaches_pro')

  await processUscreenPayload({
    event: 'user.created', email: 'tracking-new@example.com', user_id: 'user-123',
    event_date: '2026-07-29T01:02:03Z', utm_source: encoded.get('utm_source'),
  })
  assert.equal(metaBodies.at(-1).data[0].event_name, 'JF_Account_Created')
  assert.equal(brevoBodies.at(-1).attributes.UTM_CAMPAIGN, 'JF Teams - Traffic - Book A Demo')
  assert.equal(brevoBodies.at(-1).attributes.META_FBC, 'fb.1.1234000.fb-click-123')

  const beforeKvFirstPaid = metaBodies.length
  await processUscreenPayload({
    event: 'order.paid', email: 'tracking-new@example.com', user_id: 'user-123',
    order_id: 'paid-from-kv-123', transaction_id: 'ch_paid_from_kv_123',
    event_date: '2026-07-29T02:02:03Z', offer_id: 230698, offer_title: 'Max', total: 59,
    currency: 'AUD',
  })
  assert.equal(metaBodies.length, beforeKvFirstPaid, 'first-paid webhook must remain candidate-only even when an enable flag is set')
  const kvCandidate = [...kvStore.values()].map((value) => JSON.parse(value)).find((value) => value.uscreenUserId === 'user-123' && value.status === 'candidate')
  assert.equal(kvCandidate.metaEvent.custom_data.utm_campaign, 'JF Teams - Traffic - Book A Demo')
  assert.equal(kvCandidate.metaEvent.user_data.fbc, 'fb.1.1234000.fb-click-123')

  process.env.META_FIRST_PAID_ENABLED = 'true'
  const beforeFlaggedRetry = metaBodies.length
  await processUscreenPayload({
    event: 'order.paid', email: 'tracking-new@example.com', user_id: 'user-123',
    order_id: 'paid-from-kv-retry', transaction_id: 'ch_paid_from_kv_retry',
    event_date: '2026-07-29T02:03:03Z', offer_id: 230698, offer_title: 'Max', total: 59,
    currency: 'AUD',
  })
  assert.equal(metaBodies.length, beforeFlaggedRetry, 'META_FIRST_PAID_ENABLED must not create an automatic send path')
  delete process.env.META_FIRST_PAID_ENABLED
  const beforeShadow = metaBodies.length
  await processUscreenPayload({
    event: 'order.paid', email: 'brand-new@example.com', user_id: 'shadow-user-1',
    order_id: 'shadow-paid-123', transaction_id: 'ch_shadow_paid_123',
    event_date: '2026-08-10T03:30:00Z', offer_id: 230699, offer_title: 'Plus', total: 29,
    currency: 'AUD', utm_source: 'facebook', utm_campaign: 'app-buyers',
  })
  assert.equal(metaBodies.length, beforeShadow, 'shadow mode must not send the canonical event before verification')
  assert.equal(brevoBodies.at(-1).attributes.JF_FIRST_PAID_CANDIDATE_TRANSACTION_ID, 'ch_shadow_paid_123')
  await assert.rejects(
    processUscreenPayload({
      event: 'order.paid', email: 'brand-new-no-id@example.com',
      order_id: 'missing-user-id', transaction_id: 'ch_missing_user_id',
      event_date: '2026-08-10T03:35:00Z', offer_id: 230699, offer_title: 'Plus', total: 29,
      currency: 'AUD',
    }),
    /Stable first-paid identity unavailable/,
    'a canonical candidate must fail closed without a stable Uscreen user ID',
  )
} finally {
  globalThis.fetch = originalFetch
  if (originalBrevoKey === undefined) delete process.env.BREVO_API_KEY
  else process.env.BREVO_API_KEY = originalBrevoKey
  if (originalMetaToken === undefined) delete process.env.META_CAPI_TOKEN
  else process.env.META_CAPI_TOKEN = originalMetaToken
  if (originalKvUrl === undefined) delete process.env.KV_REST_API_URL
  else process.env.KV_REST_API_URL = originalKvUrl
  if (originalKvToken === undefined) delete process.env.KV_REST_API_TOKEN
  else process.env.KV_REST_API_TOKEN = originalKvToken
  delete process.env.META_FIRST_PAID_ENABLED
}

const baseLayout = fs.readFileSync(path.join(root, 'src/layouts/BaseLayout.astro'), 'utf8')
const coachesPage = fs.readFileSync(path.join(root, 'src/pages/app/for-coaches.astro'), 'utf8')
const joinPage = fs.readFileSync(path.join(root, 'src/pages/join.astro'), 'utf8')
const trackEventApi = fs.readFileSync(path.join(root, 'api/track-event.js'), 'utf8')
const teamsPage = fs.readFileSync(path.join(root, 'src/pages/teams.astro'), 'utf8')
const webhook = fs.readFileSync(path.join(root, 'api/_uscreen-webhook.js'), 'utf8')
const publicWebhook = fs.readFileSync(path.join(root, 'api/uscreen-webhook.js'), 'utf8')
assert.equal(baseLayout.includes("trackEvent('team_subscription_interest'"), false, 'global raw submit/click tracking must be removed')
assert.equal(baseLayout.includes('appendUscreenTrackingParams'), true)
assert.equal(teamsPage.match(/trackEvent\('team_subscription_interest'/g)?.length, 1, 'success event must occur exactly once')
assert.ok(teamsPage.indexOf("if (!data || !data.success)") < teamsPage.indexOf("trackEvent('team_subscription_interest'"), 'event must follow success gate')
assert.ok(teamsPage.includes("persistence_status: 'confirmed'"))
assert.ok(teamsPage.includes('payload.landing_page = window.location.href'))
assert.ok(teamsPage.includes('window.JonerTracking.collectTrackingParams()'))
assert.ok(baseLayout.includes("'campaign_id', 'adset_id', 'ad_id'"))
assert.ok(baseLayout.includes("joner_tracking_first_touch"), 'first-touch attribution must persist beyond one browser session')
assert.ok(baseLayout.includes("joner_tracking_last_touch"), 'last-touch attribution must persist beyond one browser session')
assert.ok(baseLayout.includes('window.localStorage'), 'campaign attribution must survive the 7-14 day buyer journey')
assert.ok(baseLayout.includes("trackEvent('CoachesPageVideoPlay'"), 'the coaches intro video play needs a journey event')
assert.ok(baseLayout.includes("trackEvent('CoachesPagePricingView'"), 'the coaches pricing section needs a journey event')
for (const eventName of [
  'CoachesPageFreeBundleClick', 'CoachesPageFreeSessionClick', 'CoachesPageJoinClick',
  'CoachesPageVideoPlay', 'CoachesPagePricingView',
]) assert.ok(trackEventApi.includes(`'${eventName}'`), `CAPI allow-list must include ${eventName}`)
for (const eventName of [
  'JoinBillingToggle', 'JoinClubPricingClick', 'JoinPlanAnchorClick', 'JoinFaqOpen',
]) assert.ok(trackEventApi.includes(`'${eventName}'`), `CAPI allow-list must include ${eventName}`)
for (const eventName of ['join_starter_click', 'join_plus_click', 'join_max_click']) {
  assert.ok(trackEventApi.includes(`'${eventName}'`), `CAPI allow-list must include ${eventName}`)
}
assert.ok(coachesPage.includes('data-ga-event="CoachesPageJoinClick"'), 'hero and sticky join hops must be measured')
assert.ok(coachesPage.includes('data-ga-event="CoachesPageFreeSessionClick"'), 'free session exits must be measured')
assert.ok(coachesPage.includes('data-coaches-pricing'), 'pricing visibility must be observable')
assert.ok(webhook.includes('226775: [LISTS.coachesFreeBundleUsers, LISTS.freeSessionLeads]'), 'coach free-bundle claims must enter Brevo coach and free-session lists')
for (const mapping of [
  "'183083': 'monthly'", "'230697': 'annual'", "'230699': 'monthly'",
  "'183092': 'annual'", "'230698': 'monthly'", "'202578': 'annual'",
]) assert.ok(baseLayout.includes(mapping), `missing checkout mapping ${mapping}`)
for (const offerId of ['183083', '230697', '230699', '183092', '230698', '202578']) {
  assert.ok(joinPage.includes(`o=${offerId}`), `join page must expose tracked offer ${offerId}`)
}
assert.ok(joinPage.includes('data-ga-event="JoinClubPricingClick"'), 'club pricing CTA must be measured')
assert.ok(joinPage.includes('data-ga-event="JoinPlanAnchorClick"'), 'internal plan anchors must be measured')
assert.ok(joinPage.includes("trackEvent('JoinBillingToggle'"), 'monthly and annual toggle intent must be measured')
assert.ok(joinPage.includes("trackEvent('JoinFaqOpen'"), 'FAQ opens must be measured')
assert.ok(joinPage.includes('appendUscreenTrackingParams(href, tracking)'), 'billing toggles must not strip checkout attribution')
assert.equal(baseLayout.includes("href.indexOf('o=202578') !== -1) return 'CoachesPageClickToCheckout'"), false, 'Max annual on /join must not be classified as a coach-page checkout')
assert.ok(publicWebhook.includes("import uscreenWebhookHandler from './_uscreen-webhook.js'"), 'configured Uscreen webhook URL must import the real handler')
assert.ok(publicWebhook.includes('return uscreenWebhookHandler(req, res)'), 'public webhook wrapper must invoke the real handler')
assert.ok(webhook.includes("'JF_First_Paid_Membership'"), 'first verified paid memberships need one dedicated canonical Meta event')
assert.equal(webhook.includes("'JF_Paid_Purchase'"), false, 'legacy renewal-contaminated paid event must be retired')
assert.ok(webhook.includes("'JF_Trial_Started'"), 'zero-value trial orders need a dedicated verified Meta event')
assert.ok(webhook.includes("'JF_Account_Created'"), 'new accounts need a dedicated verified Meta event')
assert.ok(webhook.includes('extractMetaIdentity'))
assert.ok(webhook.includes('utm_campaign: attribution.utm_campaign'))
assert.equal(webhook.includes('META_FIRST_PAID_ENABLED'), false, 'webhook must have no automatic canonical first-paid release flag')
assert.equal(webhook.includes('sendMetaEventPayload(metaEvent'), false, 'webhook must never send a first-paid candidate directly')
const replayScript = fs.readFileSync(path.join(root, 'scripts/first-paid-candidate.mjs'), 'utf8')
assert.ok(replayScript.includes("EXPECTED_META_PIXEL_ID = '232666285545279'"), 'manual replay must target the production pixel')
assert.ok(replayScript.includes("'NX', 'EX', SEND_LOCK_SECONDS"), 'manual replay must take an atomic send lock')
assert.ok(replayScript.includes('Stored candidate event ID is not tied to the Uscreen user ID'), 'manual replay must verify stable user-based identity')

console.log('tracking regression tests passed')
