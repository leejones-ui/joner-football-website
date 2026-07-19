import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { extractAttribution, extractMetaIdentity } from '../api/_attribution.js'
import { compactBrevoAttributes, parseUscreenBody } from '../api/_uscreen-webhook.js'

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
  encoded_source: encoded.get('utm_source'),
})

const serverDecoded = extractAttribution({ utm_source: encoded.get('utm_source') })
assert.equal(serverDecoded.utm_source, 'facebook')
assert.equal(serverDecoded.utm_medium, 'paid_social')
assert.equal(serverDecoded.utm_campaign, 'JF Teams - Traffic - Book A Demo')
assert.equal(serverDecoded.utm_content, 'video_ad_alpha')

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

const baseLayout = fs.readFileSync(path.join(root, 'src/layouts/BaseLayout.astro'), 'utf8')
const teamsPage = fs.readFileSync(path.join(root, 'src/pages/teams.astro'), 'utf8')
const webhook = fs.readFileSync(path.join(root, 'api/_uscreen-webhook.js'), 'utf8')
assert.equal(baseLayout.includes("trackEvent('team_subscription_interest'"), false, 'global raw submit/click tracking must be removed')
assert.equal(baseLayout.includes('appendUscreenTrackingParams'), true)
assert.equal(teamsPage.match(/trackEvent\('team_subscription_interest'/g)?.length, 1, 'success event must occur exactly once')
assert.ok(teamsPage.indexOf("if (!data || !data.success)") < teamsPage.indexOf("trackEvent('team_subscription_interest'"), 'event must follow success gate')
assert.ok(teamsPage.includes("persistence_status: 'confirmed'"))
assert.ok(webhook.includes("event_name: 'CompleteRegistration'"), 'do not create a duplicate Purchase stream')
assert.equal(webhook.includes("event_name: 'Purchase'"), false, 'webhook must not add a second Purchase stream')
assert.ok(webhook.includes('extractMetaIdentity'))
assert.ok(webhook.includes('utm_campaign: attribution.utm_campaign'))

console.log('tracking regression tests passed')
