import assert from 'node:assert/strict'
import handler from '../api/go.js'
import { TRACKING_LINK_BANK } from '../api/_tracking-link-bank.js'

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
  handler(request(token), res)
  assert.equal(res.statusCode, 302, token)
  const url = new URL(res.location)
  assert.equal(url.hostname, 'jonerfootball.com')
  assert.equal(url.pathname, '/join')
  assert.equal(url.searchParams.get('link_token'), token)
  assert.ok(url.searchParams.get('utm_source'))
  assert.ok(url.searchParams.get('utm_campaign'))
  assert.ok(url.searchParams.get('utm_content'))
}

const lee = response()
handler(request('lee-email'), lee)
const leeUrl = new URL(lee.location)
assert.equal(leeUrl.searchParams.get('utm_source'), 'lee_manual_email')
assert.equal(leeUrl.searchParams.get('source_taxonomy'), 'lee_manual_email')

const custom = response()
handler(request('brevo', { campaign: 'aug18-pro-training', content: 'button-a', to: 'free-watch' }), custom)
const customUrl = new URL(custom.location)
assert.equal(customUrl.searchParams.get('utm_campaign'), 'aug18-pro-training')
assert.equal(customUrl.searchParams.get('utm_content'), 'button-a')
assert.equal(customUrl.pathname, '/free-bundle/watch')
assert.equal(customUrl.searchParams.get('destination_token'), 'free-watch')

const unsafeDestination = response()
handler(request('x-post', { to: 'https://evil.example' }), unsafeDestination)
assert.equal(new URL(unsafeDestination.location).pathname, '/join')
assert.equal(new URL(unsafeDestination.location).searchParams.get('destination_token'), 'join')

const unknown = response()
handler(request('not-real'), unknown)
assert.equal(unknown.statusCode, 404)

console.log('Tracking link bank tests passed')
