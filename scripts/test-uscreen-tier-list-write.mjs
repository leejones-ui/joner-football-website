import assert from 'node:assert/strict'

// A transient Brevo READ failure used to abort the whole order.paid handler
// before the tier list write, so a paying member silently never reached their
// Starter/Plus/Max active list. The Meta acquisition signal must still fail
// closed on unverifiable paid history, but the CRM write is the safer and more
// important side of the webhook and must happen first.

const originalFetch = globalThis.fetch
const originalBrevoKey = process.env.BREVO_API_KEY
const originalMetaToken = process.env.META_CAPI_TOKEN
const originalKvUrl = process.env.KV_REST_API_URL
const originalKvToken = process.env.KV_REST_API_TOKEN

process.env.BREVO_API_KEY = 'test-brevo-key'
process.env.META_CAPI_TOKEN = 'test-meta-token'
process.env.KV_REST_API_URL = 'https://kv.test'
process.env.KV_REST_API_TOKEN = 'test-kv-token'

const brevoWrites = []
const metaCalls = []
const kvStore = new Map()

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
      return { ok: true, status: 200, async json() { return { result: kvStore.delete(command[1]) ? 1 : 0 } } }
    }
    if (command[0] === 'MGET') {
      return { ok: true, status: 200, async json() { return { result: command.slice(1).map((key) => kvStore.get(key) || null) } } }
    }
    if (command[0] === 'ZADD' || command[0] === 'ZREM' || command[0] === 'HINCRBY' || command[0] === 'LPUSH' || command[0] === 'EXPIRE') {
      return { ok: true, status: 200, async json() { return { result: command[0] === 'ZADD' ? 1 : 'OK' } } }
    }
    if (command[0] === 'ZRANGE' || command[0] === 'ZREVRANGE' || command[0] === 'ZRANGEBYSCORE' || command[0] === 'SCAN' || command[0] === 'LRANGE' || command[0] === 'HGETALL') {
      return { ok: true, status: 200, async json() { return { result: command[0] === 'SCAN' ? ['0', []] : [] } } }
    }
  }
  if (target.includes('/v3/contacts/') && (!options.method || options.method === 'GET')) {
    // The transient failure at the heart of the bug.
    throw new Error('socket hang up')
  }
  if (target === 'https://api.brevo.com/v3/contacts' && options.method === 'POST') {
    brevoWrites.push(JSON.parse(options.body))
    return { ok: true, status: 204, async text() { return '' } }
  }
  if (target.includes('graph.facebook.com')) {
    metaCalls.push(target)
    return { ok: true, status: 200, async text() { return '{"events_received":1}' } }
  }
  throw new Error(`Unexpected test fetch: ${target}`)
}

try {
  const { processUscreenPayload } = await import('../api/_uscreen-webhook.js')

  await assert.rejects(
    processUscreenPayload({
      event: 'order.paid', email: 'silent-drop@example.com', user_id: 'user-silent-drop',
      order_id: 'order-silent-drop', transaction_id: 'ch_silent_drop',
      event_date: '2026-09-18T04:00:00Z', offer_id: 230698, offer_title: 'Max', total: 59,
      currency: 'AUD',
    }),
    /retry required/,
    'an unverifiable paid history must still surface as a retry to Uscreen',
  )

  // 1. The CRM write happened despite the failed read.
  assert.equal(brevoWrites.length, 1, 'the tier list write must run even when the Brevo read failed')
  assert.ok(brevoWrites[0].listIds.includes(24), 'a paid Max order must land on the Max Active list (24)')
  assert.equal(brevoWrites[0].email, 'silent-drop@example.com')

  // 2. The upgrade cleanup still rides along with that same write.
  assert.ok(brevoWrites[0].unlinkListIds.includes(22), 'the write must still drop the stale Starter Active membership')

  // 3. Meta still fails closed: no conversion on unverified paid history, and
  //    no confirmed first-paid CRM stamp either.
  assert.equal(metaCalls.length, 0, 'the Meta acquisition signal must not fire on unverifiable paid history')
  assert.equal(brevoWrites[0].attributes.JF_FIRST_PAID_TRANSACTION_ID, undefined)
  assert.equal(brevoWrites[0].attributes.JF_FIRST_PAID_EVENT_ID, undefined)

  console.log('uscreen tier list write tests passed')
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
