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
process.env.JFP_BOOKING_PASSWORD = process.env.JFP_BOOKING_PASSWORD || 'term4'
process.env.JFP_PORTAL_ENABLED = 'true'
process.env.JFP_PORTAL_ORIGIN = `http://localhost:${PORT}`
process.env.JFP_BOOTSTRAP_SECRET = 'boot'
process.env.AIRTABLE_API_TOKEN = 'local'
process.env.AIRTABLE_BASE_ID = 'apphU4R0BtVIu5YqT'
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
      const keep = opts.includes('KEEPTTL') ? live(key)?.expiresAt || 0 : 0
      store.set(key, { type: 's', value, expiresAt: exIdx >= 0 ? Date.now() + Number(opts[exIdx + 1]) * 1000 : keep })
      return 'OK'
    }
    case 'GETDEL': { const v = live(args[0])?.value ?? null; store.delete(args[0]); return v }
    case 'DEL': { let n = 0; for (const k of args) if (store.delete(k)) n++; return n }
    case 'SADD': { const e = live(args[0]) || { type: 'set', value: new Set() }; store.set(args[0], e); let n = 0; for (const m of args.slice(1)) if (!e.value.has(m)) { e.value.add(m); n++ } return n }
    case 'SMEMBERS': return [...(live(args[0])?.value || [])]
    case 'INCR': { const e = live(args[0]); const n = Number(e?.value || 0) + 1; store.set(args[0], { type: 's', value: String(n), expiresAt: e?.expiresAt || 0 }); return n }
    case 'TTL': { const e = live(args[0]); return e ? (e.expiresAt ? Math.ceil((e.expiresAt - Date.now()) / 1000) : -1) : -2 }
    case 'HSET': { const h = hash(args[0]); h.set(args[1], args[2]); return 1 }
    case 'HGET': return live(args[0])?.value.get(args[1]) ?? null
    case 'HGETALL': { const h = live(args[0]); return h ? [...h.value.entries()].flat() : [] }
    case 'ZADD': { const z = zset(args[0]); let n = 0; for (let i = 1; i < args.length; i += 2) { if (!z.has(args[i + 1])) n++; z.set(args[i + 1], Number(args[i])) } return n }
    case 'ZREM': { const z = zset(args[0]); let n = 0; for (const m of args.slice(1)) if (z.delete(m)) n++; return n }
    case 'ZCARD': return zset(args[0]).size
    case 'ZREMRANGEBYSCORE': { const z = zset(args[0]); const max = Number(args[2]); let n = 0; for (const [m, s] of z) if (s <= max) { z.delete(m); n++ } return n }
    case 'ZREVRANGE': { const z = zset(args[0]); return [...z.entries()].sort((a, b) => b[1] - a[1]).slice(Number(args[1]), Number(args[2]) + 1).map(([m]) => m) }
    case 'ZRANGE': { const z = zset(args[0]); return [...z.entries()].sort((a, b) => a[1] - b[1]).slice(Number(args[1]), Number(args[2]) + 1).map(([m]) => m) }
    case 'EVAL': {
      const script = args[0]
      if (script.includes('INCR')) {
        // JFP sign-in throttle
        const [, , key, ttl] = args
        const n = redis(['INCR', key]); if (n === 1) live(key).expiresAt = Date.now() + Number(ttl) * 1000
        return n
      }
      if (script.includes('taken + want')) {
        // JFP hold: places, not a whole slot
        const [, , key, now, available, want, expiry, id] = args
        const z = zset(key)
        for (const [m, sc] of z) if (sc <= Number(now)) z.delete(m)
        if (z.size + Number(want) > Number(available)) return 0
        for (let i = 1; i <= Number(want); i++) z.set(`${id}#${i}`, Number(expiry))
        return 1
      }
      if (script.includes("ARGV[3] .. '#' .. i")) {
        // JFP extend: every place must still be ours and live
        const [, , key, now, expiry, id, want] = args
        const z = zset(key)
        for (let i = 1; i <= Number(want); i++) { const sc = z.get(`${id}#${i}`); if (sc === undefined || sc <= Number(now)) return 0 }
        for (let i = 1; i <= Number(want); i++) z.set(`${id}#${i}`, Number(expiry))
        return 1
      }
      // Holiday scripts. The hold now also takes the slots hash (2 keys) and
      // refuses a slot that is not open.
      const two = String(args[1]) === '2'
      const [, , seatsKey] = args
      const [now, expiry, bookingId, holdSlotId] = two ? args.slice(4) : args.slice(3)
      if (two && !script.includes('ZSCORE')) {
        const raw = live(args[3])?.value.get(holdSlotId)
        if (!raw || JSON.parse(raw).status !== 'open') return 0
      }
      const z = zset(seatsKey)
      if (script.includes('ZSCORE')) {
        // extend: only if this booking still owns a live hold
        const score = z.get(bookingId)
        if (score === undefined || score <= Number(now)) return 0
        z.set(bookingId, Number(expiry))
        return 1
      }
      for (const [m, s] of z) if (s <= Number(now)) z.delete(m)
      if (z.size > 0) return 0
      z.set(bookingId, Number(expiry))
      return 1
    }
    default: throw new Error(`mock redis: unsupported ${name}`)
  }
}

// ---------- mock stripe ----------
const sessions = new Map()
const emails = []

// ---------- mock airtable ----------
// Pretend Term 4 roster: realistic groups, invented players.
const airtable = { term4: [], ledger: [] }
let recSeq = 1
function seedRow(day, time, location, coach, type = 'JFP 10 weeks', confirmation = 'Confirmed', extra = {}) {
  airtable.term4.push({ id: `rec${String(recSeq++).padStart(6, '0')}`, fields: { 'Player Name': `Player ${recSeq}`, 'Parent Name': `Parent ${recSeq}`, 'Email': `parent${recSeq}@example.com`, 'Phone': '0400000000', 'Term 3 Day': day, 'Term 3 Time': time, 'Term 3 Location': location, 'Coach': coach, 'Term 4 Confirmation': confirmation, 'Term 4 Payment Type': type, 'Term 4 Fee': 850, 'Term 4 Amount Paid': extra.paid ?? 850, 'Term 4 Balance': 850 - (extra.paid ?? 850), 'Term 4 Payment Status': (extra.paid ?? 850) >= 850 ? 'Paid' : (extra.paid ? 'Partially Paid' : 'Unpaid') } })
}
for (let i = 0; i < 4; i++) seedRow('Monday', '5:25pm', 'Belrose HQ', 'Dean Mac', 'JFP 10 weeks', 'Confirmed', { paid: i === 0 ? 400 : 850 })
for (let i = 0; i < 5; i++) seedRow('Tuesday', '5:25pm', 'Belrose HQ', 'Dean Mac')
for (let i = 0; i < 6; i++) seedRow('Wednesday', '4:20pm', 'Belrose HQ', 'Sam Yorks')
seedRow('Wednesday', '5:25pm', 'Belrose HQ', 'Sam Yorks', 'JFP 10 weeks', 'Awaiting Reply', { paid: 0 })
for (let i = 0; i < 3; i++) seedRow('Friday', '4pm', 'Belrose HQ', 'Dean Mac', 'JFP Pathway 10 weeks')
for (let i = 0; i < 3; i++) seedRow('Friday', '6:30am', 'Rydalmere', i ? 'Luke Bakos' : 'Lee Jones')
seedRow('Monday', '1pm', 'Belrose HQ', 'Dean Mac', 'JFP 1 on 1, 10 weeks')
seedRow('Thursday', '4:20pm', 'Belrose HQ', 'Dean Mac', 'JFP 10 weeks', 'Dropped')

function airtableResponse(url, init) {
  const u = new URL(url)
  const table = decodeURIComponent(u.pathname.split('/').pop())
  const key = table === 'tbl6OIjkU6UsQCeZV' ? 'term4' : table === 'tblfrXQLMhOcE2PWH' ? 'ledger' : table === 'Term 3 Players' ? 'term3' : null
  if (!key) return { status: 404, body: { error: { type: 'TABLE_NOT_FOUND' } } }
  if (faults.has('airtable')) return { status: 503, body: { error: { type: 'SERVICE_UNAVAILABLE' } } }
  const rows = airtable[key] || (airtable[key] = [])
  if ((init.method || 'GET') === 'POST') {
    const body = JSON.parse(init.body)
    const created = body.records.map((r) => ({ id: `rec${String(recSeq++).padStart(6, '0')}`, fields: { ...r.fields } }))
    rows.push(...created)
    log('airtable', `${key} +${created.length}`)
    return { status: 200, body: { records: created } }
  }
  const formula = u.searchParams.get('filterByFormula') || ''
  let out = rows
  const find = formula.match(/^FIND\("(.+)", \{Term 4 Notes\}\)$/)
  if (find) out = rows.filter((r) => String(r.fields['Term 4 Notes'] || '').includes(find[1]))
  const eq = formula.match(/^\{Payment ID\} = "(.+)"$/)
  if (eq) out = rows.filter((r) => r.fields['Payment ID'] === eq[1])
  return { status: 200, body: { records: out } }
}
const sheetRows = []
const SHEET_HEADERS = ['Updated At', 'Status', 'Date', 'Start', 'End', 'Coach', 'Session Type', 'Players', 'Player Ages', 'Parent Name', 'Mobile', 'Email', 'Notes', 'Location', 'Booking ID', 'Needs Attention']
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
  if (u.startsWith('https://api.airtable.com/v0/')) {
    const r = airtableResponse(u, init)
    return json(r.body, r.status)
  }
  if (u.startsWith('https://api.stripe.com/v1/payment_intents/')) {
    const pi = decodeURIComponent(u.split('/payment_intents/')[1].split('?')[0])
    const s = [...sessions.values()].find((x) => x.payment_intent === pi)
    if (!s) return json({ error: { message: 'No such payment_intent' } }, 404)
    return json({ id: pi, latest_charge: { balance_transaction: { fee: Math.round(s.amount_total * 0.0175) + 30 } } })
  }
  if (u.startsWith('https://api.stripe.com/v1/checkout/sessions')) {
    if (init.method === 'POST' && u.endsWith('/expire')) {
      const s = sessions.get(decodeURIComponent(u.split('/').slice(-2)[0]))
      if (!s || s.status !== 'open') return json({ error: { message: 'Only open sessions can be expired' } }, 400)
      s.status = 'expired'; log('stripe', `expired ${s.id}`); return json(s)
    }
    if (init.method === 'POST') return json(stripeSession(init.body))
    const id = decodeURIComponent(u.split('/').pop())
    const s = sessions.get(id)
    return s ? json(s) : json({ error: { message: 'No such checkout session' } }, 404)
  }
  if (u.startsWith('https://api.brevo.com')) {
    if (faults.has('email')) return new Response('{"code":"unauthorized"}', { status: 401 })
    const payload = JSON.parse(init.body)
    const id = (payload.htmlContent.match(/(?:HOL|JFP|APP)-[0-9A-Z-]+/) || [''])[0]
    log('brevo', `${payload.subject} [${id}]`)
    emails.push({ at: Date.now(), to: payload.to.map((t) => t.email), subject: payload.subject, html: payload.htmlContent })
    return json({ messageId: 'local' })
  }
  if (u.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'local', expires_in: 3600 })
  if (u.includes('sheets.googleapis.com')) {
    if (u.includes(':append')) {
      if (faults.has('sheet')) return new Response('{"error":{"message":"The caller does not have permission"}}', { status: 403 })
      const row = JSON.parse(init.body).values[0]
      sheetRows.push(row)
      log('sheet', `row appended [${row.find((c) => String(c).startsWith('HOL-')) || ''}]`)
      return json({})
    }
    if (u.includes(':clear')) {
      if (faults.has('sheet')) return new Response('{"error":{"message":"The caller does not have permission"}}', { status: 403 })
      sheetRows.length = 0
      return json({})
    }
    if (u.includes('/values/') && init.method === 'PUT' && (u.includes('!A2') || u.includes('!A1?'))) {
      if (faults.has('sheet')) return new Response('{"error":{"message":"The caller does not have permission"}}', { status: 403 })
      const rows = JSON.parse(init.body).values
      sheetRows.length = 0; sheetRows.push(...rows)
      log('sheet', `roster rewritten, ${rows.length} rows`)
      return json({})
    }
    if (u.includes('/values/')) {
      if (faults.has('sheet')) return new Response('{"error":{"message":"The caller does not have permission"}}', { status: 403 })
      return json({ values: [SHEET_HEADERS, ...sheetRows] })
    }
    return json({ sheets: [{ properties: { title: 'Holiday Bookings' } }] })
  }
  return realFetch(url, init)
}

const events = []
const faults = new Set()
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
for (const name of ['holiday-access', 'holiday-slots', 'holiday-book', 'holiday-confirm', 'holiday-payment-webhook', 'holiday-admin', 'jfp-access', 'jfp-groups', 'jfp-book', 'jfp-confirm', 'jfp-session', 'jfp-portal-data']) {
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

  if (url.pathname === '/__fail') {
    const what = url.searchParams.get('what')
    if (url.searchParams.get('on') === '1') faults.add(what); else faults.delete(what)
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ faults: [...faults] }))
  }
  if (url.pathname === '/__emails') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(emails)) }
  if (url.pathname === '/__airtable') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(airtable)) }
  if (url.pathname === '/__sheet') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(sheetRows)) }
  if (url.pathname === '/__events') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(events)) }
  if (url.pathname === '/__sessions') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([...sessions.values()])) }

  let file = path.join(DIST, decodeURIComponent(url.pathname))
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file)) { file = path.join(DIST, '404.html'); if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found') } }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

server.listen(PORT, () => console.log(`holiday local harness on http://localhost:${PORT}  (parent password "holiday", admin secret "admin")`))
