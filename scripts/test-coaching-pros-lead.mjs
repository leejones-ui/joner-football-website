import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import handler, { validLeadBody, validLeadOrigin } from '../api/coaching-pros-lead.js'
import {
  COACHING_PROS_LIST_NAME,
  isEligibleForMarketing,
  normalizeLeadEmail,
  syncCoachingProsLead,
} from '../api/_coaching-pros-brevo.js'

const jsonResponse = (status, body = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
})

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this },
  }
}

test('uses the exact requested Brevo list name as configuration metadata', () => {
  assert.equal(COACHING_PROS_LIST_NAME, 'Dribbling YT video leads')
})

test('normalizes valid email and rejects malformed email', () => {
  assert.equal(normalizeLeadEmail('  Coach@Example.COM '), 'coach@example.com')
  assert.equal(normalizeLeadEmail('not-an-email'), null)
})

test('nonconsent grants access without any Brevo request', async () => {
  let calls = 0
  const result = await syncCoachingProsLead({
    email: 'coach@example.com',
    marketingConsent: false,
    fetchImpl: async () => { calls += 1; throw new Error('must not call Brevo') },
  })
  assert.deepEqual(result, {
    success: true,
    saved: false,
    marketing: false,
    reason: 'no-marketing-consent',
  })
  assert.equal(calls, 0)
})

test('affirmative consent creates a new contact on the exact configured list', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1 ? jsonResponse(404) : jsonResponse(201, { id: 1 })
  }
  const result = await syncCoachingProsLead({
    email: 'coach@example.com', marketingConsent: true, listId: 77, apiKey: 'test-key', fetchImpl,
  })
  assert.equal(result.reason, 'created')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[1].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    email: 'coach@example.com',
    attributes: { NEWS_OPT_IN: true },
    listIds: [77],
    updateEnabled: false,
  })
})

test('existing explicit opt-out is preserved even after affirmative form consent', async () => {
  const calls = []
  const result = await syncCoachingProsLead({
    email: 'coach@example.com', marketingConsent: true, listId: 77, apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return jsonResponse(200, { attributes: { NEWS_OPT_IN: false }, listIds: [] })
    },
  })
  assert.equal(result.reason, 'existing-opt-out-preserved')
  assert.equal(result.marketing, false)
  assert.equal(calls.length, 1)
})

test('blacklisted contacts are never updated or added to the campaign list', async () => {
  assert.equal(isEligibleForMarketing({ emailBlacklisted: true, attributes: {} }), false)
  let calls = 0
  const result = await syncCoachingProsLead({
    email: 'coach@example.com', marketingConsent: true, listId: 77, apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1
      return jsonResponse(200, { emailBlacklisted: true, attributes: {}, listIds: [] })
    },
  })
  assert.equal(result.marketing, false)
  assert.equal(calls, 1)
})

test('duplicate eligible contact already on the list is a no-op', async () => {
  let calls = 0
  const result = await syncCoachingProsLead({
    email: 'coach@example.com', marketingConsent: true, listId: 77, apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1
      return jsonResponse(200, { attributes: { NEWS_OPT_IN: true }, listIds: [77] })
    },
  })
  assert.equal(result.reason, 'already-subscribed')
  assert.equal(result.saved, false)
  assert.equal(calls, 1)
})

test('eligible existing contact is updated without replacing other attributes or lists', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (calls.length === 1) return jsonResponse(200, { attributes: { FIRSTNAME: 'Coach' }, listIds: [12] })
    return jsonResponse(204)
  }
  const result = await syncCoachingProsLead({
    email: 'coach@example.com', marketingConsent: true, listId: 77, apiKey: 'test-key', fetchImpl,
  })
  assert.equal(result.reason, 'updated')
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    attributes: { NEWS_OPT_IN: true },
    listIds: [77],
  })
})

test('duplicate creation race re-reads and safely upserts', async () => {
  const replies = [
    jsonResponse(404),
    jsonResponse(409, { message: 'duplicate' }),
    jsonResponse(200, { attributes: {}, listIds: [] }),
    jsonResponse(204),
  ]
  let calls = 0
  const result = await syncCoachingProsLead({
    email: 'coach@example.com', marketingConsent: true, listId: 77, apiKey: 'test-key',
    fetchImpl: async () => replies[calls++],
  })
  assert.equal(result.reason, 'updated')
  assert.equal(calls, 4)
})

test('Brevo failure is surfaced rather than reported as a successful save', async () => {
  await assert.rejects(
    syncCoachingProsLead({
      email: 'coach@example.com', marketingConsent: true, listId: 77, apiKey: 'test-key',
      fetchImpl: async () => jsonResponse(500, { message: 'unavailable' }),
    }),
    /lookup failed/,
  )
})

test('endpoint requires same-origin requests and rejects oversized bodies', () => {
  const req = { headers: { origin: 'https://jonerfootball.com', host: 'jonerfootball.com' } }
  assert.equal(validLeadOrigin(req), true)
  assert.equal(validLeadOrigin({ headers: { origin: 'https://evil.example', host: 'jonerfootball.com' } }), false)
  assert.equal(validLeadBody({ email: 'coach@example.com' }), true)
  assert.equal(validLeadBody({ email: 'a'.repeat(9000) }), false)
})

test('endpoint allows nonconsent access without configured Brevo or contact writes', async () => {
  const req = {
    method: 'POST',
    headers: { origin: 'https://jonerfootball.com', host: 'jonerfootball.com' },
    body: { email: 'coach@example.com', marketingConsent: false },
    socket: { remoteAddress: 'test-nonconsent' },
  }
  const res = mockRes()
  await handler(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { success: true, marketing: false, saved: false })
  assert.match(res.headers['Cache-Control'], /no-store/)
})

test('endpoint fails honestly when affirmative marketing integration is not enabled', async () => {
  const prior = process.env.COACHING_PROS_BREVO_ENABLED
  delete process.env.COACHING_PROS_BREVO_ENABLED
  const req = {
    method: 'POST',
    headers: { origin: 'https://jonerfootball.com', host: 'jonerfootball.com' },
    body: { email: 'coach@example.com', marketingConsent: true },
    socket: { remoteAddress: 'test-consent-disabled' },
  }
  const res = mockRes()
  await handler(req, res)
  if (prior === undefined) delete process.env.COACHING_PROS_BREVO_ENABLED
  else process.env.COACHING_PROS_BREVO_ENABLED = prior
  assert.equal(res.statusCode, 503)
  assert.equal(res.body.success, false)
})

test('landing page contract is isolated, noindex, single-CTA and exact-destination', async () => {
  const page = await readFile(new URL('../src/pages/coaching-pros-free/index.astro', import.meta.url), 'utf8')
  const config = await readFile(new URL('../astro.config.mjs', import.meta.url), 'utf8')
  assert.match(page, /noindex/)
  assert.match(page, /hideChrome/)
  assert.match(page, /Watch Episode 1 Free/)
  assert.match(page, /marketingConsent/)
  assert.match(page, /type="checkbox"/)
  assert.doesNotMatch(page, /type="checkbox"[^>]*checked/)
  assert.match(page, /https:\/\/app\.jonerfootball\.com\/programs\/coaching-pros-ep-1-e5a655/)
  assert.match(config, /'\/coaching-pros-free\/'/)
})
