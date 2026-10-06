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
process.env.JFP_RELAY_TOKEN = process.env.JFP_RELAY_TOKEN || 'local-relay-token-0123456789abcdef0123'
process.env.JFP_TEXT_ANYTIME = process.env.JFP_TEXT_ANYTIME || '1'
process.env.JFP_SETTLE_SECONDS = process.env.JFP_SETTLE_SECONDS ?? '0'
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
    case 'HINCRBY': { const h = hash(args[0]); const n = Number(h.get(args[1]) || 0) + Number(args[2]); h.set(args[1], String(n)); return n }
    case 'HGET': return live(args[0])?.value.get(args[1]) ?? null
    case 'HGETALL': { const h = live(args[0]); return h ? [...h.value.entries()].flat() : [] }
    case 'ZADD': {
      const z = zset(args[0]); let i = 1; let xx = false
      if (String(args[1]).toUpperCase() === 'XX') { xx = true; i = 2 }
      let n = 0
      for (; i < args.length; i += 2) { if (xx && !z.has(args[i + 1])) continue; if (!z.has(args[i + 1])) n++; z.set(args[i + 1], Number(args[i])) }
      return n
    }
    case 'HDEL': { const h = live(args[0]); let n = 0; if (h) for (const f of args.slice(1)) if (h.value.delete(f)) n++; return n }
    case 'LPUSH': { const e = live(args[0]) || { type: 'l', value: [] }; store.set(args[0], e); e.value.unshift(...args.slice(1).reverse()); return e.value.length }
    case 'LTRIM': { const e = live(args[0]); if (e) e.value = e.value.slice(Number(args[1]), Number(args[2]) + 1); return 'OK' }
    case 'LRANGE': { const e = live(args[0]); const end = Number(args[2]); return e ? e.value.slice(Number(args[1]), end === -1 ? undefined : end + 1) : [] }
    case 'EXPIRE': { const e = live(args[0]); if (!e) return 0; e.expiresAt = Date.now() + Number(args[1]) * 1000; return 1 }
    case 'ZREM': { const z = zset(args[0]); let n = 0; for (const m of args.slice(1)) if (z.delete(m)) n++; return n }
    case 'ZCARD': return zset(args[0]).size
    case 'ZREMRANGEBYSCORE': { const z = zset(args[0]); const max = Number(args[2]); let n = 0; for (const [m, s] of z) if (s <= max) { z.delete(m); n++ } return n }
    case 'ZREVRANGE': { const z = zset(args[0]); return [...z.entries()].sort((a, b) => b[1] - a[1]).slice(Number(args[1]), Number(args[2]) + 1).map(([m]) => m) }
    case 'ZRANGE': { const z = zset(args[0]); const end = Number(args[2]); return [...z.entries()].sort((a, b) => a[1] - b[1]).slice(Number(args[1]), end === -1 ? undefined : end + 1).map(([m]) => m) }
    case 'EVAL': {
      const script = args[0]
      if (script.includes('INCR')) {
        // JFP sign-in throttle
        const [, , key, ttl] = args
        const n = redis(['INCR', key]); if (n === 1) live(key).expiresAt = Date.now() + Number(ttl) * 1000
        return n
      }
      if (script.includes("redis.call('GET', KEYS[1]) == ARGV[1]")) {
        // Lease release: delete only if we still hold it
        const [, , key, token] = args
        if (live(key)?.value === token) { store.delete(key); return 1 }
        return 0
      }
      if (script.includes('c.tries')) {
        // JFP sign-in code check: count, compare and consume in one step
        const [, , key, codeDigest, maxTries] = args
        const e = live(key)
        if (!e) return null
        const c = JSON.parse(e.value)
        if (c.tries >= Number(maxTries)) { store.delete(key); return null }
        if (c.code !== codeDigest) { c.tries += 1; e.value = JSON.stringify(c); return null }
        store.delete(key)
        return e.value
      }
      if (script.includes("ARGV[5] .. '#' .. i")) {
        // JFP hold: counted places, resized atomically for the same booking
        const [, , key, now, available, want, expiry, id] = args
        const z = zset(key)
        for (const [m, sc] of z) if (sc <= Number(now)) z.delete(m)
        const own = [...z.keys()].filter((m) => m.startsWith(`${id}#`))
        if (z.size - own.length + Number(want) > Number(available)) return 0
        own.forEach((m) => z.delete(m))
        for (let i = 1; i <= Number(want); i++) z.set(`${id}#${i}`, Number(expiry))
        return 1
      }
      if (script.includes('seatMode')) {
        // Holiday hold: exclusive hour, or counted places on a trial slot
        const [, , seatsKey, slotsKey, now, expiry, bookingId, holdSlotId, want] = args
        const raw = live(slotsKey)?.value.get(holdSlotId)
        if (!raw) return 0
        const slot = JSON.parse(raw)
        if (slot.status !== 'open') return 0
        const z = zset(seatsKey)
        for (const [m, sc] of z) if (sc <= Number(now)) z.delete(m)
        if (slot.seatMode === 'shared') {
          const mine = [...z.keys()].filter((m) => m.startsWith(`${bookingId}#`))
          if (z.size - mine.length + Number(want || 1) > (Number(slot.capacity) || 6)) return 0
          mine.forEach((m) => z.delete(m))
          for (let i = 1; i <= Number(want || 1); i++) z.set(`${bookingId}#${i}`, Number(expiry))
          return 1
        }
        if (z.size > 0) return 0
        z.set(bookingId, Number(expiry))
        return 1
      }
      if (script.includes("ARGV[2] .. '#' .. i")) {
        // Holiday trial confirm: keep our places or take them if still free
        const [, , seatsKey, now, bookingId, want, cap, score] = args
        const z = zset(seatsKey)
        for (const [m, sc] of z) if (sc <= Number(now)) z.delete(m)
        const own = [...z.keys()].filter((m) => m.startsWith(`${bookingId}#`)).length
        if (own < Number(want) && z.size - own + Number(want) > Number(cap)) return 0
        for (let i = 1; i <= Number(want); i++) z.set(`${bookingId}#${i}`, Number(score))
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
// A pretend JFP roster: realistic groups, invented players. Set JFP_SEED to a
// JSON file ({ term4, term3, waiver, ledger } record arrays) to load another,
// for example an anonymised copy of the real roster for screenshots.
const airtable = { term4: [], ledger: [], term3: [], waiver: [], attendance: [], dropped: [], nextHolds: [], master: [], juniors3: [], juniors4: [], venueHistory: [] }
let recSeq = 1
const recId = () => `rec${String(recSeq++).padStart(14, '0')}`
function seedRow(day, time, location, coach, type = 'JFP 10 weeks', confirmation = 'Confirmed', extra = {}) {
  const n = recSeq
  const paid = extra.paid ?? 850
  airtable.term4.push({ id: recId(), fields: { 'Player Name': extra.name || `Player ${n}`, 'Parent Name': extra.parent || `Parent ${n}`, 'Email': extra.email || `parent${n}@example.com`, 'Phone': '0400000000', 'Term 3 Day': day, 'Term 3 Time': time, 'Term 3 Location': location, 'Coach': coach, 'Term 4 Confirmation': confirmation, 'Term 4 Payment Type': type, 'Term 4 Fee': 850, 'Term 4 Amount Paid': paid, 'Term 4 Balance': 850 - paid, 'Term 4 Payment Status': paid >= 850 ? 'Paid' : (paid ? 'Partially Paid' : 'Unpaid'), 'Term 4 Notes': extra.notes || '' } })
}
if (process.env.JFP_SEED && fs.existsSync(process.env.JFP_SEED)) {
  const seed = JSON.parse(fs.readFileSync(process.env.JFP_SEED, 'utf8'))
  for (const k of Object.keys(airtable)) if (Array.isArray(seed[k])) airtable[k] = seed[k]
  recSeq = 90000
} else {
  for (let i = 0; i < 4; i++) seedRow('Monday', '5:25pm', 'Belrose HQ', 'Dean Mac', 'JFP 10 weeks', 'Confirmed', { paid: i === 0 ? 400 : 850 })
  for (let i = 0; i < 5; i++) seedRow('Tuesday', '5:25pm', 'Belrose HQ', 'Dean Mac')
  for (let i = 0; i < 6; i++) seedRow('Wednesday', '4:20pm', 'Belrose HQ', 'Sam Yorks')
  seedRow('Wednesday', '5:25pm', 'Belrose HQ', 'Sam Yorks', 'JFP 10 weeks', 'Awaiting Reply', { paid: 0 })
  for (let i = 0; i < 3; i++) seedRow('Friday', '4pm', 'Belrose HQ', 'Dean Mac', 'JFP Pathway 10 weeks')
  for (let i = 0; i < 3; i++) seedRow('Friday', '6:30am', 'Rydalmere', i ? 'Luke Bakos' : 'Lee Jones')
  seedRow('Monday', '1pm', 'Belrose HQ', 'Dean Mac', 'JFP 1 on 1, 10 weeks')
  seedRow('Thursday', '4:20pm', 'Belrose HQ', 'Dean Mac', 'JFP 10 weeks', 'Dropped')
  // A returning family with a waiver on file, and one without.
  seedRow('Tuesday', '4:20pm', 'Belrose HQ', 'Sam Yorks', 'JFP 10 weeks', 'Confirmed', { name: 'Riley Returning', parent: 'Rita Returning', email: 'returning@example.com', paid: 850 })
  airtable.term3.push({ id: recId(), fields: { 'Player Name': 'Riley Returning', 'Email': 'returning@example.com', 'Parent Name': 'Rita Returning', 'Date of Birth': '2015-03-02', 'Coach': 'Sam Yorks', 'Session Day': 'Tuesday', 'Session Time': '4:20pm', 'Session Location': 'Belrose HQ' } })
  airtable.term3.push({ id: recId(), fields: { 'Player Name': 'Sasha Returning', 'Email': 'returning@example.com', 'Parent Name': 'Rita Returning', 'Date of Birth': '2016-06-10', 'Coach': 'Sam Yorks', 'Session Day': 'Wednesday', 'Session Time': '4:20pm', 'Session Location': 'Belrose HQ' } })
  airtable.waiver.push({ id: recId(), fields: { 'Player Full Name': 'Riley Returning', 'Parent Email': 'returning@example.com', 'Date of Birth': '2015-03-02', 'Term': 'Term 3 2026', 'Signed Date': '2026-07-14', 'Waiver Accepted - Full Terms': true } })
  airtable.waiver.push({ id: recId(), fields: { 'Player Full Name': 'Sasha Returning', 'Parent Email': 'returning@example.com', 'Date of Birth': '2016-06-10', 'Term': 'Term 3 2026', 'Signed Date': '2026-07-14', 'Waiver Accepted - Full Terms': true } })
  // Term 3 money for revenue by venue: two payments on Term 3 rows, one from a player no longer listed.
  const [riley3, sasha3] = airtable.term3
  const t3pay = (id, name, amount, method, source) => airtable.ledger.push({ id: recId(), fields: { 'Payment ID': id, 'Term': 'Term 3 2026', 'Player Name': name, 'Amount Paid': amount, 'Payment Method': method, 'Payment Status': 'Paid', 'Payment Date': '2026-07-20', 'Source Table': 'Term 3 Players', 'Source Record ID': source } })
  t3pay('T3-SEED-1', 'Riley Returning', 850, 'Stripe', riley3.id)
  t3pay('T3-SEED-2', 'Sasha Returning', 765, 'Bank Transfer', sasha3.id)
  t3pay('T3-SEED-3', 'Gone Player', 300, 'Cash', 'recDROPPEDSEED001')
  // Joners Juniors, Saturday at HQ: Term 3 paid; Term 4 one paid, one on last term's credit, one not yet.
  const jj = (key, term, status, via) => airtable[key].push({ id: recId(), fields: { 'Player Full Name': `Junior ${recSeq}`, 'Term': term, 'Location': 'Belrose HQ', 'Session Day': 'Saturday', 'Session Time': '9:15am', 'Fee': 220, 'Payment Status': status, ...(via ? { 'Paid Via': via } : {}) } })
  jj('juniors3', 'Term 3 2026', 'Paid', 'Stripe'); jj('juniors3', 'Term 3 2026', 'Paid', 'Stripe')
  // Older terms copied from the Money Register (JFP Venue History).
  const hist = (term, kind, venue, session, revenue, extra = {}) => airtable.venueHistory.push({ id: recId(), fields: { 'Key': `${term} | ${venue} | ${session}`, 'Term': term, 'Kind': kind, 'Venue': venue, 'Session': session, 'Revenue': revenue, 'Imported At': '2026-10-07', ...extra } })
  hist('Term 2 2026', 'payments', 'Belrose HQ', 'Monday Afternoon (HQ)', 7795, { 'Bank Transfer': 5000, 'Cash': 2795, 'Payments': 11 })
  hist('Term 2 2026', 'payments', 'Rydalmere', 'Friday Morning (Ryd)', 19396, { 'Bank Transfer': 19396, 'Payments': 23 })
  hist('Term 2 2026', 'register total', 'Belrose HQ', 'Total typed in the register', 9000)
  hist('Term 1 2024', 'payments', 'NTRA', 'Thursday Morning (NTRA)', 7525, { 'Cash': 7525, 'Payments': 10 })
  jj('juniors4', 'Term 4 2026', 'Paid', 'Stripe'); jj('juniors4', 'Term 4 2026', 'Paid', 'Term 3 credit'); jj('juniors4', 'Term 4 2026', 'Unpaid')
}

const TABLE_KEYS = { tbl6OIjkU6UsQCeZV: 'term4', tblfrXQLMhOcE2PWH: 'ledger', 'Term 3 Players': 'term3', tblLziUfKOv1N0f40: 'waiver', tblfwc1VO3ind7cVk: 'attendance', tblLa3AFkRvlUEQEI: 'dropped', tblahicOyFRUCf7bL: 'nextHolds', 'Joner Football Master Database': 'master', tblMLhYQ126P5uKLB: 'juniors3', tblVzW8E9qumQEtXx: 'juniors4', tblgss68pIVTUOttE: 'venueHistory' }
function airtableResponse(url, init) {
  const u = new URL(url)
  const parts = u.pathname.split('/').slice(3).map(decodeURIComponent) // [table, recordId?]
  const key = TABLE_KEYS[parts[0]]
  if (!key) return { status: 404, body: { error: { type: 'TABLE_NOT_FOUND' } } }
  if (faults.has('airtable') || faults.has(`airtable-${key}`)) return { status: 422, body: { error: { type: 'INVALID_VALUE_FOR_COLUMN', message: 'fault injected' } } }
  const rows = airtable[key]
  const method = (init.method || 'GET').toUpperCase()
  if (method === 'POST') {
    const body = JSON.parse(init.body)
    const created = body.records.map((r) => ({ id: recId(), fields: { ...r.fields } }))
    rows.push(...created)
    log('airtable', `${key} +${created.length}`)
    return { status: 200, body: { records: created } }
  }
  if (method === 'DELETE') {
    const ids = parts[1] ? [parts[1]] : u.searchParams.getAll('records[]')
    const gone = []
    for (const id of ids) { const i = rows.findIndex((x) => x.id === id); if (i < 0) return { status: 404, body: { error: { type: 'NOT_FOUND' } } }; rows.splice(i, 1); gone.push({ id, deleted: true }) }
    log('airtable', `${key} -${gone.length}`)
    return { status: 200, body: { records: gone } }
  }
  if (method === 'PATCH') {
    const body = JSON.parse(init.body)
    const out = []
    for (const r of body.records) {
      const row = rows.find((x) => x.id === r.id)
      if (!row) return { status: 404, body: { error: { type: 'ROW_DOES_NOT_EXIST' } } }
      Object.assign(row.fields, r.fields)
      if (key === 'term4') row.fields['Term 4 Balance'] = Number(row.fields['Term 4 Fee'] || 0) - Number(row.fields['Term 4 Amount Paid'] || 0)
      out.push(row)
    }
    log('airtable', `${key} ~${out.length}`)
    return { status: 200, body: { records: out } }
  }
  if (parts[1]) {
    const row = rows.find((x) => x.id === parts[1])
    return row ? { status: 200, body: row } : { status: 404, body: { error: { type: 'NOT_FOUND' } } }
  }
  const formula = u.searchParams.get('filterByFormula') || ''
  let out = rows
  const find = formula.match(/^FIND\("(.+)", \{(.+)\}\)$/)
  if (find) { const needle = find[1].replace(/\\(["\\])/g, '$1'); out = rows.filter((r) => String(r.fields[find[2]] || '').includes(needle)) }
  const and = formula.match(/^AND\(\{(.+?)\} = "(.*?)", \{(.+?)\} = "(.*?)"\)$/)
  if (and) out = rows.filter((r) => r.fields[and[1]] === and[2] && r.fields[and[3]] === and[4])
  if (formula === '{Do Not Contact}') out = rows.filter((r) => r.fields['Do Not Contact'])
  const eq = formula.match(/^\{(Payment ID|Attendance ID)\} = "(.+)"$/)
  if (eq) out = rows.filter((r) => r.fields[eq[1]] === eq[2])
  const size = Number(u.searchParams.get('pageSize') || 100)
  const offset = Number(u.searchParams.get('offset') || 0)
  const page = out.slice(offset, offset + size)
  return { status: 200, body: { records: page, ...(offset + size < out.length ? { offset: String(offset + size) } : {}) } }
}
const sheetRows = []
const SHEET_HEADERS = ['Updated At', 'Status', 'Date', 'Start', 'End', 'Coach', 'Session Type', 'Players', 'Player Ages', 'Parent Name', 'Mobile', 'Email', 'Notes', 'Location', 'Booking ID', 'Needs Attention']
function stripeSession(body) {
  const id = `cs_test_${crypto.randomBytes(12).toString('hex')}`
  const params = new URLSearchParams(body)
  const metadata = {}
  for (const [k, v] of params) { const m = k.match(/^metadata\[(.+)\]$/); if (m) metadata[m[1]] = v }
  const session = {
    id, object: 'checkout.session', status: 'open', payment_status: 'unpaid', metadata, created: Math.floor(Date.now() / 1000),
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
    return json({ id: pi, metadata: s.metadata || {}, latest_charge: { balance_transaction: { fee: Math.round(s.amount_total * 0.0175) + 30 } } })
  }
  if (u.startsWith('https://api.stripe.com/v1/charges/')) {
    const ch = decodeURIComponent(u.split('/charges/')[1].split('?')[0])
    const s = [...sessions.values()].find((x) => x.payment_intent && `ch_${x.payment_intent.slice(3)}` === ch)
    if (!s) return json({ error: { message: 'No such charge' } }, 404)
    const refunds = s.refunds || []
    return json({ id: ch, payment_intent: s.payment_intent, amount: s.amount_total, amount_refunded: refunds.reduce((t, r) => t + r.amount, 0), refunds: { data: refunds } })
  }
  if (u.startsWith('https://api.stripe.com/v1/payment_links/')) {
    const id = decodeURIComponent(u.split('/payment_links/')[1].split('/')[0])
    return json({ data: [{ description: stripeLinks[id] || 'Unknown product' }] })
  }
  // The list the Money tab reads: completed sessions, ours and seeded ones.
  if (u.startsWith('https://api.stripe.com/v1/checkout/sessions?') && (init.method || 'GET') === 'GET') {
    const q = new URL(u).searchParams
    const gte = Number(q.get('created[gte]') || 0)
    const all = [...sessions.values(), ...stripeSeeded].filter((s) => s.status === 'complete' && (s.created || 0) >= gte)
    return json({ data: all.map((s) => ({ ...s, payment_intent: s.payment_intent ? { id: s.payment_intent, latest_charge: { id: `ch_${String(s.payment_intent).slice(3)}`, amount_refunded: (s.refunds || []).reduce((t, r) => t + r.amount, 0) } } : null })), has_more: false })
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
    const id = (payload.htmlContent.match(/(?:HOL|JFP|APP|PAY|WAIT|ENQ)-[0-9A-Z-]+/) || [''])[0]
    log('brevo', `${payload.subject} [${id}]`)
    emails.push({ at: Date.now(), to: payload.to.map((t) => t.email), subject: payload.subject, html: payload.htmlContent, attachments: (payload.attachment || []).map((a) => ({ name: a.name, content: Buffer.from(a.content, 'base64').toString('utf8') })) })
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
// Payments made on Stripe payment links outside the site (seeded by tests).
const stripeSeeded = []
const stripeLinks = { plink_jfp850: 'JFP 10 weeks', plink_camp: 'Joner Camp July' }
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
for (const name of ['holiday-access', 'holiday-slots', 'holiday-book', 'holiday-confirm', 'holiday-payment-webhook', 'holiday-admin', 'jfp-access', 'jfp-groups', 'jfp-book', 'jfp-confirm', 'jfp-auth', 'jfp-account', 'jfp-portal-data', 'jfp-messages', 'jfp-messages-relay']) {
  handlers[name] = (await import(`../api/${name}.js`)).default
}

async function fireWebhook(type, session, object) {
  const body = JSON.stringify({ type, data: { object: object || { id: session.id } } })
  const req = Object.assign(new (await import('node:stream')).Readable({ read() { this.push(body); this.push(null) } }), { method: 'POST', headers: { 'content-type': 'application/json' }, url: '/api/holiday-payment-webhook' })
  let status = 200
  await new Promise((resolve) => handlers['holiday-payment-webhook'](req, shimRes({ writeHead(s) { status = s }, end() { resolve() } })))
  log('webhook', `${type} ${session.id} -> ${status}`)
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

  // Change a fake Airtable row as if staff edited it: /__patch?table=term4&id=rec..&fields={json}
  if (url.pathname === '/__patch') {
    const row = (airtable[url.searchParams.get('table')] || []).find((r) => r.id === url.searchParams.get('id'))
    if (!row) { res.writeHead(404); return res.end('no row') }
    Object.assign(row.fields, JSON.parse(url.searchParams.get('fields') || '{}'))
    res.writeHead(200); return res.end('ok')
  }

  // A family marked Do Not Contact in the Master Database: /__dnc?email=
  if (url.pathname === '/__dnc') {
    airtable.master.push({ id: `rec${crypto.randomBytes(7).toString('hex')}`, createdTime: new Date().toISOString(), fields: { 'Emails from Sources': url.searchParams.get('email') || '', 'Mobile Number': url.searchParams.get('phone') || '', 'Do Not Contact': true } })
    res.writeHead(200); return res.end('ok')
  }

  // Pretend Lee refunded in the Stripe dashboard: /__refund?cs=<session>&amount=<cents>
  if (url.pathname === '/__refund') {
    const s = sessions.get(url.searchParams.get('cs'))
    if (!s?.payment_intent) { res.writeHead(404); return res.end('no paid session') }
    s.refunds = [...(s.refunds || []), { id: `re_${crypto.randomBytes(6).toString('hex')}`, amount: Number(url.searchParams.get('amount')) || s.amount_total, status: 'succeeded', created: Math.floor(Date.now() / 1000) }]
    const charge = `ch_${s.payment_intent.slice(3)}`
    await fireWebhook('charge.refunded', s, { id: charge })
    if (url.searchParams.get('twice')) await fireWebhook('charge.refunded', s, { id: charge })
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, refund: s.refunds.at(-1) }))
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
  if (url.pathname === '/__stripe-seed') {
    const p = JSON.parse(await readBody(req) || '{}')
    const n = stripeSeeded.length + 1
    stripeSeeded.push({ id: `cs_seed_${n}`, object: 'checkout.session', status: 'complete', payment_status: 'paid', created: Math.floor(Date.parse(p.at || new Date().toISOString()) / 1000), amount_total: p.cents, currency: 'aud', customer_details: { email: p.email, name: p.name || '' }, payment_link: p.link || 'plink_jfp850', payment_intent: `pi_seed_${n}`, metadata: p.metadata || {} })
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, id: `cs_seed_${n}` }))
  }
  if (url.pathname === '/__emails') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(emails)) }
  if (url.pathname === '/__airtable') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(airtable)) }
  if (url.pathname === '/__sheet') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(sheetRows)) }
  if (url.pathname === '/__events') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(events)) }
  if (url.pathname === '/__kv') {
    // Test-only direct access to the pretend KV, for time travel in tests.
    const out = redis(JSON.parse(url.searchParams.get('cmd')))
    res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(typeof out === 'string' ? out : JSON.stringify(out))
  }
  if (url.pathname === '/__sessions') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([...sessions.values()])) }

  let file = path.join(DIST, decodeURIComponent(url.pathname))
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file)) { file = path.join(DIST, '404.html'); if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found') } }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

if (process.env.JFP_GROUPS && fs.existsSync(process.env.JFP_GROUPS)) {
  for (const g of JSON.parse(fs.readFileSync(process.env.JFP_GROUPS, 'utf8'))) redis(['HSET', 'jfp:groups', g.id, JSON.stringify(g)])
  console.log('loaded JFP groups from', process.env.JFP_GROUPS)
}

server.keepAliveTimeout = 65000 // long waits in tests (the text helper reads Messages back) must not drop sockets
server.listen(PORT, () => console.log(`holiday local harness on http://localhost:${PORT}  (parent password "holiday", admin secret "admin")`))
