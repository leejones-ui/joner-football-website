// Local harness for the school holiday booking system.
//
// Serves the built site from dist/ and mounts the real /api/holiday-* handlers
// against an in-memory Redis emulation and a mock Stripe, so the whole flow
// (gate, slots, hold, checkout, webhook, confirm, admin) runs with no secrets
// and no network. Run `npm run build` first, then:
//
//   node scripts/holiday-local.mjs            # http://localhost:4321
//   HOLIDAY_LOCAL_PORT=5000 node scripts/holiday-local.mjs
//
// Admin secret: "admin". Parent password: "holiday".
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = Number(process.env.HOLIDAY_LOCAL_PORT || 4321)
const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const DIST = path.join(ROOT, 'dist')

process.env.KV_REST_API_URL = 'http://kv.local'
process.env.KV_REST_API_TOKEN = 'local'
process.env.HOLIDAY_BOOKING_PASSWORD = process.env.HOLIDAY_BOOKING_PASSWORD || 'holiday'
process.env.HOLIDAY_SIGNING_SECRET = process.env.HOLIDAY_SIGNING_SECRET || 'local-signing-secret'
process.env.HOLIDAY_ADMIN_SECRET = process.env.HOLIDAY_ADMIN_SECRET || 'admin'
process.env.STRIPE_SECRET_KEY_SYDNEY = 'sk_test_local'
process.env.BREVO_API_KEY = 'local'
process.env.PUBLIC_SITE_URL = `http://localhost:${PORT}`
delete process.env.RECAPTCHA_SECRET_KEY
// The Sheets client signs a service-account JWT before it calls Google. A
// throwaway RSA key keeps that code path real while the network is mocked.
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'local@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) })

// ---------- in-memory redis ----------
const store = new Map()   // key -> { type, value, expiresAt }
function live(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (entry.expiresAt && entry.expiresAt < Date.now()) { store.delete(key); return null }
  return entry
}
function zset(key) { const e = live(key); if (e) return e.value; const m = new Map(); store.set(key, { type: 'z', value: m }); return m }
function hash(key) { const e = live(key); if (e) return e.value; const m = new Map(); store.set(key, { type: 'h', value: m }); return m }

function redis(cmd) {
  const [name, ...args] = cmd
  switch (String(name).toUpperCase()) {
    case 'GET': return live(args[0])?.value ?? null
    case 'SET': {
      const [key, value, ...opts] = args
      const nx = opts.includes('NX')
      const exIdx = opts.indexOf('EX')
      if (nx && live(key)) return null
      store.set(key, { type: 's', value, expiresAt: exIdx >= 0 ? Date.now() + Number(opts[exIdx + 1]) * 1000 : 0 })
      return 'OK'
    }
    case 'TTL': { const e = live(args[0]); return e ? (e.expiresAt ? Math.ceil((e.expiresAt - Date.now()) / 1000) : -1) : -2 }
    case 'HSET': { const h = hash(args[0]); h.set(args[1], args[2]); return 1 }
    case 'HGET': return live(args[0])?.value.get(args[1]) ?? null
    case 'HGETALL': { const h = live(args[0]); return h ? [...h.value.entries()].flat() : [] }
    case 'ZADD': { const z = zset(args[0]); let n = 0; for (let i = 1; i < args.length; i += 2) { if (!z.has(args[i + 1])) n++; z.set(args[i + 1], Number(args[i])) } return n }
    case 'ZREM': { const z = zset(args[0]); let n = 0; for (const m of args.slice(1)) if (z.delete(m)) n++; return n }
    case 'ZCARD': return zset(args[0]).size
    case 'ZREMRANGEBYSCORE': { const z = zset(args[0]); const max = Number(args[2]); let n = 0; for (const [m, s] of z) if (s <= max) { z.delete(m); n++ } return n }
    case 'ZREVRANGE': { const z = zset(args[0]); return [...z.entries()].sort((a, b) => b[1] - a[1]).slice(Number(args[1]), Number(args[2]) + 1).map(([m]) => m) }
    case 'EVAL': {
      // Only the hold script exists. Emulate it exactly.
      const [, , seatsKey, typeKey, now, capacity, want, expiry, bookingId, type] = args
      const z = zset(seatsKey)
      for (const [m, s] of z) if (s <= Number(now)) z.delete(m)
      const current = live(typeKey)?.value
      if (z.size > 0 && current && current !== type) return -1
      if (z.size + Number(want) > Number(capacity)) return 0
      store.set(typeKey, { type: 's', value: type, expiresAt: 0 })
      for (let i = 1; i <= Number(want); i++) z.set(`${bookingId}#${i}`, Number(expiry))
      return 1
    }
    default: throw new Error(`mock redis: unsupported ${name}`)
  }
}

// ---------- mock stripe ----------
const sessions = new Map()
function stripeSession(body) {
  const id = `cs_test_${crypto.randomBytes(12).toString('hex')}`
  const params = new URLSearchParams(body)
  const metadata = {}
  for (const [k, v] of params) { const m = k.match(/^metadata\[(.+)\]$/); if (m) metadata[m[1]] = v }
  const session = {
    id, object: 'checkout.session', status: 'open', payment_status: 'unpaid', metadata,
    amount_total: Number(params.get('line_items[0][price_data][unit_amount]')) * Number(params.get('line_items[0][quantity]')),
    currency: 'aud', customer_email: params.get('customer_email'),
    success_url: params.get('success_url'), cancel_url: params.get('cancel_url'),
    expires_at: Number(params.get('expires_at')), payment_intent: null,
    url: `http://localhost:${PORT}/mock-stripe/?cs=${id}`,
    product_name: params.get('line_items[0][price_data][product_data][name]'),
  }
  sessions.set(id, session)
  return session
}

const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  if (u.startsWith('http://kv.local')) {
    const payload = JSON.parse(init.body)
    if (u.endsWith('/pipeline')) return json(payload.map((c) => ({ result: redis(c) })))
    return json({ result: redis(payload) })
  }
  if (u.startsWith('https://api.stripe.com/v1/checkout/sessions')) {
    if (init.method === 'POST') return json(stripeSession(init.body))
    const id = decodeURIComponent(u.split('/').pop())
    const s = sessions.get(id)
    return s ? json(s) : json({ error: { message: 'No such checkout session' } }, 404)
  }
  if (u.startsWith('https://api.brevo.com')) { log('brevo', JSON.parse(init.body).subject); return json({ messageId: 'local' }) }
  if (u.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'local', expires_in: 3600 })
  if (u.includes('sheets.googleapis.com')) {
    if (u.includes(':append')) { log('sheet', 'row appended'); return json({}) }
    if (u.includes('/values/')) return json({ values: [[]] })
    return json({ sheets: [{ properties: { title: 'Holiday Bookings' } }] })
  }
  return realFetch(url, init)
}

const events = []
function log(kind, detail) { events.push({ at: new Date().toISOString(), kind, detail }); console.log(`[${kind}] ${detail}`) }

// ---------- request shim ----------
async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}
function shimRes(res) {
  const out = { statusCode: 200, headers: {} }
  const api = {
    status(code) { out.statusCode = code; return api },
    setHeader(k, v) { out.headers[k] = v; return api },
    json(data) { res.writeHead(out.statusCode, { ...out.headers, 'content-type': 'application/json' }); res.end(JSON.stringify(data)) },
    end(data) { res.writeHead(out.statusCode, out.headers); res.end(data) },
  }
  return api
}

const handlers = {}
for (const name of ['holiday-access', 'holiday-slots', 'holiday-book', 'holiday-confirm', 'holiday-payment-webhook', 'holiday-admin']) {
  handlers[name] = (await import(`../api/${name}.js`)).default
}

async function fireWebhook(type, session) {
  const body = JSON.stringify({ type, data: { object: { id: session.id } } })
  const req = Object.assign(new (await import('node:stream')).Readable({ read() { this.push(body); this.push(null) } }), { method: 'POST', headers: { 'content-type': 'application/json' }, url: '/api/holiday-payment-webhook' })
  await new Promise((resolve) => handlers['holiday-payment-webhook'](req, shimRes({ writeHead() {}, end() { resolve() } })))
  log('webhook', `${type} ${session.id}`)
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.xml': 'application/xml', '.txt': 'text/plain' }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\/$/, '')
    const handler = handlers[name]
    if (!handler) { res.writeHead(404); return res.end('no such api') }
    const raw = await readBody(req)
    let body = raw
    if (name !== 'holiday-payment-webhook' && raw && (req.headers['content-type'] || '').includes('json')) { try { body = JSON.parse(raw) } catch {} }
    const shimReq = { method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body, url: req.url, socket: req.socket }
    try { await handler(shimReq, shimRes(res)) } catch (error) { console.error(error); res.writeHead(500); res.end(error.message) }
    return
  }

  if (url.pathname === '/mock-stripe/') {
    const s = sessions.get(url.searchParams.get('cs'))
    if (!s) { res.writeHead(404); return res.end('no session') }
    const action = url.searchParams.get('action')
    if (action === 'pay') {
      s.payment_status = 'paid'; s.status = 'complete'; s.payment_intent = `pi_test_${crypto.randomBytes(8).toString('hex')}`
      log('stripe', `paid ${s.id}`)
      if (url.searchParams.get('webhook') !== 'off') await fireWebhook('checkout.session.completed', s)
      res.writeHead(302, { location: s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id) }); return res.end()
    }
    if (action === 'cancel') { res.writeHead(302, { location: s.cancel_url }); return res.end() }
    if (action === 'expire') { s.status = 'expired'; await fireWebhook('checkout.session.expired', s); res.writeHead(302, { location: s.cancel_url }); return res.end() }
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#f6f9fc;padding:40px;max-width:480px;margin:auto">
      <h2 style="color:#635bff">Mock Stripe Checkout</h2>
      <p><strong>${s.product_name}</strong></p><p>Total: A$${(s.amount_total / 100).toFixed(2)} &middot; ${s.customer_email}</p>
      <p><a href="?cs=${s.id}&action=pay" style="display:block;background:#635bff;color:#fff;padding:14px;text-align:center;border-radius:6px;text-decoration:none">Pay (webhook fires)</a></p>
      <p><a href="?cs=${s.id}&action=pay&webhook=off">Pay but webhook never arrives (success page must self-heal)</a></p>
      <p><a href="?cs=${s.id}&action=expire">Let the session expire</a></p>
      <p><a href="?cs=${s.id}&action=cancel">Cancel and go back</a></p></body>`)
  }

  if (url.pathname === '/__events') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(events)) }
  if (url.pathname === '/__sessions') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([...sessions.values()])) }

  let file = path.join(DIST, decodeURIComponent(url.pathname))
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file)) { file = path.join(DIST, '404.html'); if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found') } }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

server.listen(PORT, () => console.log(`holiday local harness on http://localhost:${PORT}  (parent password "holiday", admin secret "admin")`))
