import assert from 'node:assert/strict'
import handler from '../api/go.js'
import { TRACKING_LINK_BANK } from '../api/_tracking-link-bank.js'

process.env.KV_REST_API_URL = 'https://kv.test.invalid'
process.env.KV_REST_API_TOKEN = 'test-token'
process.env.JOURNEY_SIGNING_SECRET = 'test-signing-secret'
const kv = new Map()
globalThis.fetch = async (_url, options) => {
  const [command, key, value] = JSON.parse(options.body)
  if (command === 'GET') return { ok: true, json: async () => ({ result: kv.get(key) || null }) }
  if (command === 'SET') { kv.set(key, value); return { ok: true, json: async () => ({ result: 'OK' }) } }
  throw new Error(`Unexpected KV command: ${command}`)
}

function request(token, extra = {}) { return { method: 'GET', query: { token, ...extra } } }
function response() {
  return {
    statusCode: 200, headers: {}, location: '', body: null,
    status(code) { this.statusCode = code; return this },
    setHeader(key, value) { this.headers[key] = value },
    redirect(code, location) { this.statusCode = code; this.location = location; return this },
    json(body) { this.body = body; return this },
  }
}

for (const token of Object.keys(TRACKING_LINK_BANK)) {
  const res = response()
  await handler(request(token), res)
  assert.equal(res.statusCode, 302, token)
  const url = new URL(res.location)
  assert.equal(url.hostname, 'jonerfootball.com')
  assert.equal(url.pathname, '/join')
  assert.equal(url.searchParams.get('link_token'), token)
  assert.ok(url.searchParams.get('utm_source'))
  assert.ok(url.searchParams.get('utm_campaign'))
  assert.ok(url.searchParams.get('utm_content'))
  assert.match(String(res.headers['Set-Cookie'] || ''), /^jf_journey_id=[^;]+; Max-Age=15552000;/)
}

const lee = response()
await handler(request('lee-email'), lee)
const leeUrl = new URL(lee.location)
assert.equal(leeUrl.searchParams.get('utm_source'), 'lee_manual_email')
assert.equal(leeUrl.searchParams.get('source_taxonomy'), 'lee_manual_email')

const custom = response()
await handler(request('brevo', { campaign: 'aug18-pro-training', content: 'button-a', to: 'free-watch' }), custom)
const customUrl = new URL(custom.location)
assert.equal(customUrl.searchParams.get('utm_campaign'), 'aug18-pro-training')
assert.equal(customUrl.searchParams.get('utm_content'), 'button-a')
assert.equal(customUrl.pathname, '/free-bundle/watch')
assert.equal(customUrl.searchParams.get('destination_token'), 'free-watch')

const deepVideo = response()
await handler(request('brevo', { campaign: 'updated-free-videos', content: 'video-vini-dribble', to: 'free-video-vini-explosive-dribble' }), deepVideo)
const deepVideoUrl = new URL(deepVideo.location)
assert.equal(deepVideoUrl.hostname, 'app.jonerfootball.com')
assert.equal(deepVideoUrl.pathname, '/programs/how-to-do-vini-jr-explosive-dribble')
assert.equal(deepVideoUrl.searchParams.get('destination_token'), 'free-video-vini-explosive-dribble')
assert.equal(deepVideoUrl.searchParams.get('utm_source'), 'brevo/email')

const loyalty = response()
await handler(request('brevo', { campaign: 'loyalmax', content: 'email-reply', to: 'loyalmax-checkout' }), loyalty)
const loyaltyUrl = new URL(loyalty.location)
assert.equal(loyaltyUrl.hostname, 'app.jonerfootball.com')
assert.equal(loyaltyUrl.pathname, '/checkout/new')
assert.equal(loyaltyUrl.searchParams.get('o'), '202578')
assert.equal(loyaltyUrl.searchParams.get('d'), 'LOYALMAX')
assert.equal(loyaltyUrl.searchParams.get('destination_token'), 'loyalmax-checkout')

const unsafeDestination = response()
await handler(request('x-post', { to: 'https://evil.example' }), unsafeDestination)
assert.equal(new URL(unsafeDestination.location).pathname, '/join')
assert.equal(new URL(unsafeDestination.location).searchParams.get('destination_token'), 'join')

const destinations = {
  home: '/', 'football-training-app': '/football-training-app', 'free-bundle': '/free-bundle',
  'free-watch': '/free-bundle/watch', 'hub-resources': '/hub/resources', programmes: '/programmes',
  training: '/training', 'professional-training': '/training/professional-training',
  'game-analysis': '/training/game-analysis', 'jfp-programme': '/training/jfp-program',
  'technique-test': '/technique-test', shop: '/shop', 'training-programs': '/shop/training-programs',
  books: '/books', teams: '/teams', camps: '/camps', workshops: '/workshops',
  'coaches-course': '/workshops/coaches-course', contact: '/contact',
}
for (const [to, path] of Object.entries(destinations)) {
  const res = response()
  await handler(request('instagram-post', { to, campaign: 'destination-test' }), res)
  const url = new URL(res.location)
  assert.equal(url.pathname, path, to)
  assert.equal(url.searchParams.get('destination_token'), to)
}

const unknown = response()
await handler(request('not-real'), unknown)
assert.equal(unknown.statusCode, 404)

console.log('Tracking link bank tests passed')
