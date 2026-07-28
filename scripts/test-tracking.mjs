import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { extractAttribution, extractMetaIdentity } from '../api/_attribution.js'
import { buildVerifiedMetaEvent, compactBrevoAttributes, isValidUscreenWebhookSecret, mergeStoredAttribution, parseUscreenBody, processUscreenPayload } from '../api/_uscreen-webhook.js'
import { buildLeadAttribution } from '../api/contact-enquiry.js'
import subscribeHandler from '../api/subscribe.js'
import uscreenWebhookHandler from '../api/uscreen-webhook.js'

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
  fbp: 'fb.1.browser-123',
  fbc: 'fb.1.1234000.fb-click-123',
  encoded_source: encoded.get('utm_source'),
})

const serverDecoded = extractAttribution({ utm_source: encoded.get('utm_source') })
assert.equal(serverDecoded.utm_source, 'facebook')
assert.equal(serverDecoded.utm_medium, 'paid_social')
assert.equal(serverDecoded.utm_campaign, 'JF Teams - Traffic - Book A Demo')
assert.equal(serverDecoded.utm_content, 'video_ad_alpha')
assert.equal(serverDecoded.utm_term, 'adset-456')
assert.equal(serverDecoded.utm_id, 'campaign-123')
const encodedIdentity = extractMetaIdentity({ utm_source: encoded.get('utm_source') })
assert.equal(encodedIdentity.fbp, 'fb.1.browser-123')
assert.equal(encodedIdentity.fbc, 'fb.1.1234000.fb-click-123')

const stitched = mergeStoredAttribution({
  event: 'order.paid',
  email: 'tracking-test@example.com',
  utm_source: 'Not available',
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
  META_FBP: 'fb.1.browser-123',
  META_FBC: 'fb.1.1234000.fb-click-123',
})
const verifiedPaid = buildVerifiedMetaEvent('JF_Paid_Purchase', stitched, stitched.email, stitched.total)
assert.equal(verifiedPaid.event_name, 'JF_Paid_Purchase')
assert.equal(verifiedPaid.event_id, 'JF_Paid_Purchase.order-123')
assert.equal(verifiedPaid.event_time, 1785286923)
assert.equal(verifiedPaid.custom_data.utm_campaign, 'coaches_pro')
assert.equal(verifiedPaid.custom_data.value, 59)
assert.equal(verifiedPaid.user_data.fbp, 'fb.1.browser-123')
assert.equal(verifiedPaid.user_data.fbc, 'fb.1.1234000.fb-click-123')

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
      kvStore.set(command[1], command[2])
      return { ok: true, status: 200, async json() { return { result: 'OK' } } }
    }
    if (command[0] === 'GET') {
      return { ok: true, status: 200, async json() { return { result: kvStore.get(command[1]) || null } } }
    }
  }
  if (target.includes('/contacts/') && (!options.method || options.method === 'GET')) {
    return {
      ok: true,
      status: 200,
      async json() {
        return { attributes: {
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
  await processUscreenPayload({
    event: 'order.paid', email: 'tracking-test@example.com', order_id: 'paid-123',
    event_date: '2026-07-29T01:02:03Z', offer_id: 230698, offer_title: 'Max', total: 59,
    currency: 'AUD', utm_source: 'Not available',
  })
  assert.equal(metaBodies.at(-1).data[0].event_name, 'JF_Paid_Purchase')
  assert.equal(metaBodies.at(-1).data[0].custom_data.utm_campaign, 'coaches_pro')
  assert.equal(metaBodies.at(-1).data[0].user_data.fbc, 'fb.1.1234000.fb-click-123')

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

  await processUscreenPayload({
    event: 'order.paid', email: 'tracking-new@example.com', order_id: 'paid-from-kv-123',
    event_date: '2026-07-29T02:02:03Z', offer_id: 230698, offer_title: 'Max', total: 59,
    currency: 'AUD',
  })
  assert.equal(metaBodies.at(-1).data[0].event_name, 'JF_Paid_Purchase')
  assert.equal(metaBodies.at(-1).data[0].custom_data.utm_campaign, 'JF Teams - Traffic - Book A Demo')
  assert.equal(metaBodies.at(-1).data[0].user_data.fbc, 'fb.1.1234000.fb-click-123')
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
}

const baseLayout = fs.readFileSync(path.join(root, 'src/layouts/BaseLayout.astro'), 'utf8')
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
assert.ok(publicWebhook.includes("export { default } from './_uscreen-webhook.js'"), 'configured Uscreen webhook URL must resolve to the real handler')
assert.ok(webhook.includes("'JF_Paid_Purchase'"), 'paid orders need a dedicated verified Meta event')
assert.ok(webhook.includes("'JF_Trial_Started'"), 'zero-value trial orders need a dedicated verified Meta event')
assert.ok(webhook.includes("'JF_Account_Created'"), 'new accounts need a dedicated verified Meta event')
assert.ok(webhook.includes('extractMetaIdentity'))
assert.ok(webhook.includes('utm_campaign: attribution.utm_campaign'))

console.log('tracking regression tests passed')
