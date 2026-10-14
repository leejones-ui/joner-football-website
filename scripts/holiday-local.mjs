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
// Telegram is faked too (captured at /__telegram): the real bot is never called.
process.env.JFP_TELEGRAM_BOT_TOKEN = 'local'
process.env.JFP_TELEGRAM_CHAT_ID = 'local'
delete process.env.JFP_TELEGRAM_THREAD_ID
process.env.PUBLIC_SITE_URL = `http://localhost:${PORT}`
process.env.JFP_BOOKING_PASSWORD = process.env.JFP_BOOKING_PASSWORD || 'term4'
process.env.JFP_PORTAL_ENABLED = 'true'
process.env.JFP_RELAY_TOKEN = process.env.JFP_RELAY_TOKEN || 'local-relay-token-0123456789abcdef0123'
process.env.JFP_TEXT_ANYTIME = process.env.JFP_TEXT_ANYTIME || '1'
process.env.CRON_SECRET = process.env.CRON_SECRET || 'local-cron-secret'
// Coach alerts tests move the clock forward (?now= on the coach tick).
process.env.JFP_TEST_CLOCK = '1'
process.env.JFP_SETTLE_SECONDS = process.env.JFP_SETTLE_SECONDS ?? '0'
process.env.JFP_PORTAL_ORIGIN = `http://localhost:${PORT}`
process.env.JFP_BOOTSTRAP_SECRET = 'boot'
process.env.AIRTABLE_API_TOKEN = 'local'
process.env.AIRTABLE_BASE_ID = 'apphU4R0BtVIu5YqT'
delete process.env.RECAPTCHA_SECRET_KEY
// Joners Juniors website sign-up: its sheet tab and its Stripe webhook secret.
process.env.JUNIORS_SHEET_ID = 'local-jj-sheet'
process.env.STRIPE_JUNIORS_WEBHOOK_SECRET = 'whsec_local_juniors'
delete process.env.JUNIORS_AIRTABLE_TABLE
// The sign-up checks the parent email's domain has mail: no real DNS here.
{
  const dnsp = (await import('node:dns/promises')).default
  dnsp.resolveMx = async (domain) => (/\.invalid$/.test(domain) ? [] : [{ exchange: 'mx.local', priority: 10 }])
}
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
    case 'SREM': { const e = live(args[0]); let n = 0; if (e) for (const m of args.slice(1)) if (e.value.delete(m)) n++; return n }
    case 'INCR': { const e = live(args[0]); const n = Number(e?.value || 0) + 1; store.set(args[0], { type: 's', value: String(n), expiresAt: e?.expiresAt || 0 }); return n }
    case 'TTL': { const e = live(args[0]); return e ? (e.expiresAt ? Math.ceil((e.expiresAt - Date.now()) / 1000) : -1) : -2 }
    case 'HSET': { const h = hash(args[0]); h.set(args[1], args[2]); return 1 }
    case 'HSETNX': { const h = hash(args[0]); if (h.has(args[1])) return 0; h.set(args[1], args[2]); return 1 }
    case 'HINCRBY': { const h = hash(args[0]); const n = Number(h.get(args[1]) || 0) + Number(args[2]); h.set(args[1], String(n)); return n }
    case 'HGET': return live(args[0])?.value.get(args[1]) ?? null
    case 'HEXISTS': return live(args[0])?.value.has(args[1]) ? 1 : 0
    case 'HLEN': return live(args[0])?.value.size ?? 0
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
const telegrams = []

// ---------- mock airtable ----------
// A pretend JFP roster: realistic groups, invented players. Set JFP_SEED to a
// JSON file ({ term4, term3, waiver, ledger } record arrays) to load another,
// for example an anonymised copy of the real roster for screenshots.
const airtable = { term4: [], ledger: [], term3: [], waiver: [], attendance: [], dropped: [], nextHolds: [], master: [], juniors3: [], juniors4: [], juniorsNext: [], venueHistory: [], profiles: [], camps: [] }
// JFP Camps, as the Mac import writes it: invented camps, no names (Money > Camps).
{
  let n = 0
  const camp = (key, camp, year, location, start, end, players, gross, refunds, costs, net, extra = {}) => ({ id: `recCAMP${String(++n).padStart(10, '0')}`, fields: { Key: key, Camp: camp, Year: year, Location: location, 'Start Date': start, 'End Date': end, Players: players, Gross: gross, Refunds: refunds, Costs: costs, Net: net, Currency: 'AUD', 'Source Sheet': 'Test camps sheet', 'Source Tab': camp, 'Imported At': '2026-10-13', Notes: 'net from sheet', ...extra } })
  airtable.camps.push(
    camp('2026 | Test | Autumn', 'Testville Autumn Camp', 2026, 'Testville', '2026-04-14', '2026-04-16', 40, 12000, 0, 3000, 9000),
    camp('2026 | Test | Winter', 'Sampleton Winter Camp', 2026, 'Sampleton', '2026-07-07', '2026-07-09', 30, 9000, 500, 2500, 6000),
    camp('2026 | Test | Spring', 'Testville Spring Camp', 2026, 'Testville', '', '', null, null, null, null, null, { Notes: 'tab empty' }),
    camp('2025 | Test | Autumn', 'Testville Autumn Camp', 2025, 'Testville', '2025-04-15', '2025-04-17', 35, 10000, 0, 2800, 7200),
  )
}
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
  const t3pay = (id, name, amount, method, source, extra = {}) => airtable.ledger.push({ id: recId(), fields: { 'Payment ID': id, 'Term': 'Term 3 2026', 'Player Name': name, 'Amount Paid': amount, 'Payment Method': method, 'Payment Status': 'Paid', 'Payment Date': '2026-07-20', 'Source Table': 'Term 3 Players', 'Source Record ID': source, ...extra } })
  // Term 3 Stripe lines carry their fee (an invented one here).
  t3pay('T3-SEED-1', 'Riley Returning', 850, 'Stripe', riley3.id, { 'Term 3 Stripe Fee AUD': 17.2 })
  t3pay('T3-SEED-2', 'Sasha Returning', 765, 'Bank Transfer', sasha3.id)
  t3pay('T3-SEED-3', 'Gone Player', 300, 'Cash', 'recDROPPEDSEED001')
  // Joners Juniors, Saturday at HQ: Term 3 paid; Term 4 one paid, one on last term's credit, one not yet.
  const jj = (key, term, status, via) => airtable[key].push({ id: recId(), fields: { 'Player Full Name': `Junior ${recSeq}`, 'Term': term, 'Location': 'Belrose HQ', 'Session Day': 'Saturday', 'Session Time': '9:15am', 'Fee': 220, 'Payment Status': status, ...(via ? { 'Paid Via': via } : {}) } })
  jj('juniors3', 'Term 3 2026', 'Paid', 'Stripe'); jj('juniors3', 'Term 3 2026', 'Paid', 'Stripe')
  // Older terms copied from the Money Register (JFP Venue History).
  const hist = (term, kind, venue, session, revenue, extra = {}) => airtable.venueHistory.push({ id: recId(), fields: { 'Key': `${term} | ${venue} | ${session}`, 'Term': term, 'Kind': kind, 'Venue': venue, 'Session': session, 'Revenue': revenue, 'Imported At': '2026-10-07', ...extra } })
  hist('Term 2 2026', 'payments', 'Belrose HQ', 'Monday Afternoon (HQ)', 6120, { 'Bank Transfer': 4000, 'Cash': 2120, 'Payments': 9 })
  hist('Term 2 2026', 'payments', 'Rydalmere', 'Friday Morning (Ryd)', 15300, { 'Bank Transfer': 15300, 'Payments': 18 })
  hist('Term 2 2026', 'register total', 'Belrose HQ', 'Total typed in the register', 9000)
  hist('Term 1 2024', 'payments', 'NTRA', 'Thursday Morning (NTRA)', 6400, { 'Cash': 6400, 'Payments': 8 })
  // Two whole years for Money by year (all invented): typed totals that match,
  // a grand total and a fields total typed more than the payments listed, a
  // term with nothing typed, and Joners Juniors under HQ as the register has it.
  const typed = (term, venue, revenue) => hist(term, 'register total', venue, 'Total typed in the register', revenue)
  hist('Term 1 2025', 'payments', 'Belrose HQ', 'Monday Afternoon (HQ)', 5525, { 'Bank Transfer': 3825, 'Cash': 1700, 'Payments': 6 })
  hist('Term 1 2025', 'payments', 'Belrose HQ', 'JONERS JUNIORS', 660, { 'Other': 660, 'Payments': 3 })
  hist('Term 1 2025', 'payments', 'NTRA', 'Wednesday Morning NTRA', 3400, { 'Bank Transfer': 3400, 'Payments': 4 })
  hist('Term 1 2025', 'payments', 'Rydalmere', 'Friday Morning (Ryd)', 2550, { 'Cash': 2550, 'Payments': 3 })
  typed('Term 1 2025', 'Belrose HQ', 6185); typed('Term 1 2025', 'Fields', 5950); typed('Term 1 2025', 'All', 12135)
  hist('Term 2 2025', 'payments', 'Belrose HQ', 'Tuesday Afternoon (HQ)', 6800, { 'Bank Transfer': 6800, 'Payments': 8 })
  hist('Term 2 2025', 'payments', 'NTRA', 'Thursday Morning (NTRA)', 1700, { 'Bank Transfer': 1700, 'Payments': 2 })
  typed('Term 2 2025', 'All', 8750)
  hist('Term 3 2025', 'payments', 'Belrose HQ', 'Wednesday Afternoon (HQ)', 4250, { 'Bank Transfer': 3400, 'Cash': 850, 'Payments': 5 })
  hist('Term 3 2025', 'payments', 'Rydalmere', 'Friday Morning (Ryd)', 2550, { 'Bank Transfer': 2550, 'Payments': 3 })
  typed('Term 3 2025', 'Belrose HQ', 4250); typed('Term 3 2025', 'Fields', 3000); typed('Term 3 2025', 'All', 7250)
  hist('Term 4 2025', 'payments', 'Belrose HQ', 'Monday Afternoon (HQ)', 5950, { 'Bank Transfer': 5950, 'Payments': 7 })
  hist('Term 4 2025', 'payments', 'NTRA', 'Wednesday Morning NTRA', 2550, { 'Cash': 2550, 'Payments': 3 })
  hist('Term 1 2026', 'payments', 'Belrose HQ', 'Monday Afternoon (HQ)', 4675, { 'Bank Transfer': 3825, 'Other': 850, 'Payments': 6 })
  hist('Term 1 2026', 'payments', 'NTRA', 'Wednesday Morning NTRA', 1700, { 'Bank Transfer': 1700, 'Payments': 2 })
  typed('Term 1 2026', 'All', 6375)
  jj('juniors4', 'Term 4 2026', 'Paid', 'Stripe'); jj('juniors4', 'Term 4 2026', 'Paid', 'Term 3 credit'); jj('juniors4', 'Term 4 2026', 'Unpaid')
}

// Joners Juniors demo (JFP_JUNIORS_DEMO=1): invented children and Stripe
// payments with IDs, emails and a payment link, for the Juniors Money view.
const JLINK = 'https://buy.stripe.com/test_juniors_t4'
const juniorsSessions = []
if (process.env.JFP_JUNIORS_DEMO === '1') {
  const r = (fields) => ({ id: `rec${crypto.randomBytes(7).toString('hex')}`, createdTime: '2026-07-01T00:00:00Z', fields: { Term: 'Term 3 2026', Location: 'Belrose HQ', 'Session Day': 'Saturday', 'Session Time': '9:15am', Fee: 220, ...fields } })
  airtable.juniors3.splice(0, Infinity,
    r({ 'Player Full Name': 'Jun Alpha', 'Parent Name': 'Ann Alpha', 'Parent Email': 'alpha@example.com', 'Date of Birth': '05/03/2021', 'Payment Status': 'Paid', 'Paid Via': 'Stripe', 'Stripe Checkout Session ID': 'cs_jun_a', 'Stripe PaymentIntent ID': 'pi_jun_a' }),
    r({ 'Player Full Name': 'Jun Beta', 'Parent Name': 'Bo Beta', 'Parent Email': 'beta@example.com', 'Date of Birth': '11/09/2020', 'Payment Status': 'Paid', 'Paid Via': 'stripe' }),
    r({ 'Player Full Name': 'Jun Gamma', 'Parent Name': 'Gil Gamma', 'Parent Email': 'gamma@example.com', 'Date of Birth': '23/01/2022', 'Payment Status': 'Paid', 'Paid Via': 'stripe' }),
  )
  const t4 = (fields) => r({ Term: 'Term 4 2026', 'Stripe Payment Link': JLINK, 'Payment Status': 'Unpaid', ...fields })
  airtable.juniors4.splice(0, Infinity,
    t4({ 'Player Full Name': 'Jun Alpha', 'Parent Name': 'Ann Alpha', 'Parent Email': 'alpha@example.com', 'Parent Mobile': '0400000101', 'Payment Status': 'Paid', 'Paid Via': 'Term 3 credit', 'Waiver Status': 'Needed' }),
    t4({ 'Player Full Name': 'Jun Delta', 'Parent Name': 'Di Delta', 'Parent Email': 'delta@example.com', 'Parent Mobile': '0400000102', 'Waiver Status': 'Needed', Notes: '2026-10-06: Invented note for the demo.' }),
    // Echo's family also has a JFP player (Riley Returning): one family account.
    t4({ 'Player Full Name': 'Jun Echo', 'Parent Name': 'Rita Returning', 'Parent Email': 'returning@example.com', 'Parent Mobile': '0400000103', 'Waiver Status': 'Needed' }),
    t4({ 'Player Full Name': 'Jun Foxtrot', 'Parent Name': 'Fay Foxtrot', 'Parent Email': 'fox@example.com', 'Waiver Status': 'Completed' }),
  )
  // One family waiver (the JFP waiver table) covers a Juniors child too.
  airtable.waiver.push({ id: recId(), fields: { 'Player Full Name': 'Jun Alpha', 'Parent Email': 'alpha@example.com', 'Date of Birth': '2021-03-05', 'Term': 'Term 3 2026', 'Signed Date': '2026-07-20', 'Programme': 'Joners Juniors', 'Waiver Accepted - Full Terms': true } })
  const js = (id, x) => ({ id, object: 'checkout.session', status: 'complete', payment_status: 'paid', amount_total: 22000, currency: 'aud', created: 1790000000, metadata: {}, payment_intent: `pi_${id.slice(3)}`, ...x })
  juniorsSessions.push(
    js('cs_jun_a', { customer_details: { email: 'alpha@example.com' }, metadata: { programme: 'Joners Juniors' } }),
    js('cs_jun_b', { customer_details: { email: 'beta@example.com' }, metadata: { programme: 'Joners Juniors' } }),
    js('cs_jun_d', { customer_details: { email: 'delta@example.com' }, payment_link: 'plink_juniors_t4', created: 1791500000 }),
    js('cs_jun_x', { customer_details: { email: 'someone@example.com' }, payment_link: 'plink_juniors_t4', created: 1791600000 }),
  )
}
// The real Joners Juniors columns (13 Oct 2026). Unlike the other pretend
// tables, these refuse a column they do not have, the way Airtable does, so
// the portal and the webhook are tested against the tables as they are.
const JJ_SCHEMA = {
  juniors3: ['Player Full Name', 'Date of Birth', 'Parent Name', 'Parent Email', 'Parent Mobile', 'Class', 'Session Day', 'Session Time', 'Location', 'Term', 'Fee', 'Payment Status', 'Paid Via', 'Paid At', 'Registration ID', 'Stripe Checkout Session ID', 'Stripe PaymentIntent ID', 'Heard About Us', 'Confirmation Email Status', 'Internal Notes', 'Source Term 3 Record ID', 'Moved From Term 3 At', 'Coach', 'Parent Email 2', 'Parent Mobile 2', 'Waiver Status', 'Waiver Requested At'],
  juniors4: ['Player Full Name', 'Payment Status', 'Parent Name', 'Parent Email', 'Parent Mobile', 'Date of Birth', 'Term', 'Session Day', 'Session Time', 'Location', 'Coach', 'Fee', 'Paid Via', 'Confirmation Status', 'Confirmation Date', 'Waiver Status', 'Source Term 3 Record ID', 'Stripe Payment Link', 'Notes'],
}
// A pretend next-term Juniors table (stage 2 re-enrolment), made the way
// staff would: a copy of the Term 4 table's columns. Tests point
// config.juniors.tables at it.
JJ_SCHEMA.juniorsNext = [...JJ_SCHEMA.juniors4]
function jjUnknown(key, names) {
  const have = JJ_SCHEMA[key]
  const bad = have && names.find((n) => !have.includes(n))
  return bad ? { status: 422, body: { error: { type: 'UNKNOWN_FIELD_NAME', message: `Unknown field name: "${bad}"` } } } : null
}
const TABLE_KEYS = { tbl6OIjkU6UsQCeZV: 'term4', tblfrXQLMhOcE2PWH: 'ledger', 'Term 3 Players': 'term3', tblF25gfo0fZcqdPT: 'term3', tblLziUfKOv1N0f40: 'waiver', tblfwc1VO3ind7cVk: 'attendance', tblLa3AFkRvlUEQEI: 'dropped', tblahicOyFRUCf7bL: 'nextHolds', 'Joner Football Master Database': 'master', tblMLhYQ126P5uKLB: 'juniors3', tblVzW8E9qumQEtXx: 'juniors4', tblJJNextTerm0001: 'juniorsNext', tblgss68pIVTUOttE: 'venueHistory', tblTt7jWK3s2me45B: 'profiles', tblrELWFdVouAn5FB: 'camps' }
function airtableResponse(url, init) {
  const u = new URL(url)
  const parts = u.pathname.split('/').slice(3).map(decodeURIComponent) // [table, recordId?]
  const key = TABLE_KEYS[parts[0]]
  if (!key) return { status: 404, body: { error: { type: 'TABLE_NOT_FOUND' } } }
  if (faults.has('airtable') || faults.has(`airtable-${key}`)) return { status: 422, body: { error: { type: 'INVALID_VALUE_FOR_COLUMN', message: 'fault injected' } } }
  const rows = airtable[key]
  const method = (init.method || 'GET').toUpperCase()
  if (JJ_SCHEMA[key]) {
    const named = method === 'POST' || method === 'PATCH' ? JSON.parse(init.body).records.flatMap((r) => Object.keys(r.fields || {})) : u.searchParams.getAll('fields[]')
    const refused = jjUnknown(key, named)
    if (refused) return refused
    const inFormula = [...(u.searchParams.get('filterByFormula') || '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
    if (inFormula.some((n) => !JJ_SCHEMA[key].includes(n))) return { status: 422, body: { error: { type: 'INVALID_FILTER_BY_FORMULA', message: `Unknown field names: ${inFormula.filter((n) => !JJ_SCHEMA[key].includes(n)).join(', ').toLowerCase()}` } } }
  }
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
  const pre = formula.match(/^OR\(\{Payment ID\} = "(.+)", LEFT\(\{Payment ID\}, \d+\) = "(.+)#"\)$/)
  if (pre) out = rows.filter((r) => r.fields['Payment ID'] === pre[1] || String(r.fields['Payment ID'] || '').startsWith(`${pre[2]}#`))
  const size = Number(u.searchParams.get('pageSize') || 100)
  const offset = Number(u.searchParams.get('offset') || 0)
  const page = out.slice(offset, offset + size)
  return { status: 200, body: { records: page, ...(offset + size < out.length ? { offset: String(offset + size) } : {}) } }
}
const sheetRows = []
const brevoContacts = []
// Row 1 is the live 15 column header of the Joners Juniors tab.
const juniorsSheet = [['Paid At', 'Registration ID', 'Payment Status', 'Player Full Name', 'Date of Birth', 'Parent Name', 'Parent Email', 'Parent Mobile', 'Medical History / Allergies', 'Heard About Us', 'Class', 'Amount Paid', 'Stripe Checkout Session ID', 'Stripe PaymentIntent ID / Refund Link', 'Confirmation Email Status']]
const SHEET_HEADERS = ['Updated At', 'Status', 'Date', 'Start', 'End', 'Coach', 'Session Type', 'Players', 'Player Ages', 'Parent Name', 'Mobile', 'Email', 'Notes', 'Location', 'Booking ID', 'Needs Attention']
function stripeSession(body) {
  const id = `cs_test_${crypto.randomBytes(12).toString('hex')}`
  const params = new URLSearchParams(body)
  const metadata = {}, piMetadata = {}
  for (const [k, v] of params) { const m = k.match(/^metadata\[(.+)\]$/); if (m) metadata[m[1]] = v; const pm = k.match(/^payment_intent_data\[metadata\]\[(.+)\]$/); if (pm) piMetadata[pm[1]] = v }
  const session = {
    id, object: 'checkout.session', status: 'open', payment_status: 'unpaid', metadata, piMetadata, created: Math.floor(Date.now() / 1000),
    amount_total: [...params.keys()].filter((k) => /^line_items\[\d+\]\[quantity\]$/.test(k)).reduce((t, k) => { const i = k.match(/\d+/)[0]; return t + Number(params.get(`line_items[${i}][price_data][unit_amount]`)) * Number(params.get(k)) }, 0),
    line_count: [...params.keys()].filter((k) => /^line_items\[\d+\]\[quantity\]$/.test(k)).length,
    currency: 'aud', customer_email: params.get('customer_email'),
    success_url: params.get('success_url'), cancel_url: params.get('cancel_url'),
    expires_at: Number(params.get('expires_at')), payment_intent: null,
    url: `http://localhost:${PORT}/mock-stripe/?cs=${id}`,
    product_name: params.get('line_items[0][price_data][product_data][name]'),
  }
  sessions.set(id, session)
  return session
}

// Pretend Stripe fees. Invented rules, not real rates: card (and anything
// else) 2% + 20c, Afterpay 7% + 40c, GST one eleventh of the fee. A session
// with btLate has no balance transaction in the list yet (just paid); it is
// there when the payment intent is read on its own.
function mockBalance(s) {
  const amount = s.amount_total || 0
  const fee = s.payMethod === 'afterpay_clearpay' ? Math.round(amount * 0.07) + 40 : Math.round(amount * 0.02) + 20
  const gst = Math.round(fee / 11)
  return { id: `txn_${String(s.payment_intent).slice(3)}`, object: 'balance_transaction', amount, fee, net: amount - fee, fee_details: [{ type: 'stripe_fee', amount: fee - gst }, { type: 'tax', amount: gst }] }
}
function mockCharge(s, { expandBalance = false, late = false } = {}) {
  const id = `ch_${String(s.payment_intent).slice(3)}`
  return { id, receipt_url: `http://localhost:${PORT}/mock-stripe/receipt/${id}`, amount_refunded: (s.refunds || []).reduce((t, r) => t + r.amount, 0), payment_method_details: { type: s.payMethod || 'card' }, balance_transaction: late ? null : expandBalance ? mockBalance(s) : `txn_${String(s.payment_intent).slice(3)}` }
}
const paidSession = (pi) => [...sessions.values(), ...stripeSeeded, ...juniorsSessions].find((x) => x.payment_intent === pi)
// Juniors payments: the invented ones, and website sign-ups paid on the mock checkout.
const allJuniors = () => [...juniorsSessions, ...[...sessions.values()].filter((x) => (x.status === 'complete' || x.payment_status === 'paid') && (x.metadata?.programme === 'Joners Juniors' || x.piMetadata?.programme === 'Joners Juniors'))]

const realFetch = globalThis.fetch
// Speed checks (13 Oct 2026): HARNESS_LATENCY="airtable=250,stripe=300,kv=8"
// makes each pretend call wait like the real one does, and /__calls counts
// the calls by service (?reset=1 starts again), so a view's fan-out shows.
const LATENCY = Object.fromEntries(String(process.env.HARNESS_LATENCY || '').split(',').map((x) => x.split('=')).filter(([k, v]) => k && Number(v) >= 0).map(([k, v]) => [k.trim(), Number(v)]))
const calls = {}
const serviceOf = (u) => (u.startsWith('http://kv.local') ? 'kv' : u.startsWith('https://api.airtable.com/') ? 'airtable' : u.startsWith('https://api.stripe.com/') ? 'stripe' : 'other')
const innerFetch = async (url, init = {}) => {
  const u = String(url)
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  if (u.startsWith('http://kv.local')) {
    const payload = JSON.parse(init.body)
    if (u.endsWith('/pipeline')) return json(payload.map((c) => ({ result: redis(c) })))
    return json({ result: redis(payload) })
  }
  // Airtable's upload API (player photos): adds the file to the record's attachment field.
  const up = /^https:\/\/content\.airtable\.com\/v0\/[^/]+\/(rec\w+)\/([^/]+)\/uploadAttachment$/.exec(u)
  if (up) {
    const rec = Object.values(airtable).flat().find((r) => r.id === up[1])
    if (!rec) return json({ error: { type: 'NOT_FOUND' } }, 404)
    const b = JSON.parse(init.body)
    const field = decodeURIComponent(up[2])
    const n = (rec.fields[field] || []).length + 1
    rec.fields[field] = [...(rec.fields[field] || []), { id: `att${rec.id}${n}`, url: `https://dl.airtable.local/${rec.id}-${n}.jpg`, filename: b.filename, type: b.contentType, size: b.file.length, thumbnails: { large: { url: `https://dl.airtable.local/${rec.id}-${n}-large.jpg` } } }]
    return json({ id: rec.id, fields: rec.fields })
  }
  if (u.startsWith('https://api.airtable.com/v0/')) {
    const r = airtableResponse(u, init)
    return json(r.body, r.status)
  }
  if (u.startsWith('https://api.stripe.com/v1/account')) return json({ id: 'acct_1QyPm0EwxK4ojTS1' })
  // Juniors reads its tag from the payment intent: seeded Juniors payments, Juniors payment requests, and quick links made for Juniors.
  if (u.startsWith('https://api.stripe.com/v1/payment_intents/search')) return json({ data: allJuniors().filter((x) => (x.metadata?.programme || x.piMetadata?.programme) === 'Joners Juniors').map((x) => ({ id: x.payment_intent, status: 'succeeded' })), has_more: false })
  if (u.startsWith('https://api.stripe.com/v1/payment_links?')) return json({ data: juniorsSessions.length ? [{ id: 'plink_juniors_t4', url: JLINK, active: true }] : [], has_more: false })
  if (u.startsWith('https://api.stripe.com/v1/payment_intents/')) {
    const pi = decodeURIComponent(u.split('/payment_intents/')[1].split('?')[0])
    const s = paidSession(pi)
    if (!s) return json({ error: { message: 'No such payment_intent' } }, 404)
    log('stripe', `retrieve ${pi}`)
    return json({ id: pi, metadata: { ...(s.metadata || {}), ...(s.piMetadata || {}) }, latest_charge: mockCharge(s, { expandBalance: new URL(u).searchParams.getAll('expand[]').includes('latest_charge.balance_transaction') }) })
  }
  if (u.startsWith('https://api.stripe.com/v1/charges/')) {
    const ch = decodeURIComponent(u.split('/charges/')[1].split('?')[0])
    const s = [...sessions.values(), ...stripeSeeded].find((x) => x.payment_intent && `ch_${x.payment_intent.slice(3)}` === ch)
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
    // Juniors reads by payment link or payment intent.
    if (q.get('payment_link') || q.get('payment_intent')) {
      const hit = (q.get('payment_intent') ? [...juniorsSessions, ...sessions.values()] : allJuniors()).filter((x) => (q.get('payment_link') ? x.payment_link === q.get('payment_link') : x.payment_intent === q.get('payment_intent')))
      const bt = q.getAll('expand[]').includes('data.payment_intent.latest_charge.balance_transaction')
      return json({ data: hit.map((x) => ({ ...x, payment_intent: { id: x.payment_intent, latest_charge: mockCharge(x, { expandBalance: bt }) } })), has_more: false })
    }
    const gte = Number(q.get('created[gte]') || 0)
    const all = [...sessions.values(), ...stripeSeeded].filter((s) => s.status === 'complete' && (s.created || 0) >= gte)
    const expandBalance = q.getAll('expand[]').includes('data.payment_intent.latest_charge.balance_transaction')
    return json({ data: all.map((s) => ({ ...s, payment_intent: s.payment_intent ? { id: s.payment_intent, latest_charge: mockCharge(s, { expandBalance, late: s.btLate }) } : null })), has_more: false })
  }
  if (u.startsWith('https://api.stripe.com/v1/checkout/sessions')) {
    if (init.method === 'POST' && u.endsWith('/expire')) {
      const s = sessions.get(decodeURIComponent(u.split('/').slice(-2)[0]))
      if (!s || s.status !== 'open') return json({ error: { message: 'Only open sessions can be expired' } }, 400)
      s.status = 'expired'; log('stripe', `expired ${s.id}`); return json(s)
    }
    if (init.method === 'POST') return json(stripeSession(init.body))
    const id = decodeURIComponent(u.split('/').pop().split('?')[0])
    const j = juniorsSessions.find((x) => x.id === id)
    if (j) return json({ ...j, payment_intent: { id: j.payment_intent, latest_charge: mockCharge(j, { expandBalance: new URL(u).searchParams.getAll('expand[]').includes('payment_intent.latest_charge.balance_transaction') }) } })
    const s = sessions.get(id) || stripeSeeded.find((x) => x.id === id)
    return s ? json(s) : json({ error: { message: 'No such checkout session' } }, 404)
  }
  if (u.startsWith('https://api.brevo.com/v3/contacts')) {
    const payload = JSON.parse(init.body)
    brevoContacts.push({ email: payload.email, listIds: payload.listIds })
    log('brevo', `contact ${payload.listIds}`)
    return json({ id: brevoContacts.length })
  }
  if (u.startsWith('https://api.brevo.com')) {
    if (faults.has('email')) return new Response('{"code":"unauthorized"}', { status: 401 })
    const payload = JSON.parse(init.body)
    const id = (payload.htmlContent.match(/(?:HOL|JFP|APP|PAY|WAIT|ENQ)-[0-9A-Z-]+/) || [''])[0]
    log('brevo', `${payload.subject} [${id}]`)
    emails.push({ at: Date.now(), to: payload.to.map((t) => t.email), replyTo: payload.replyTo?.email || '', subject: payload.subject, html: payload.htmlContent, attachments: (payload.attachment || []).map((a) => ({ name: a.name, content: Buffer.from(a.content, 'base64').toString('utf8') })) })
    return json({ messageId: 'local' })
  }
  if (u.startsWith('https://api.telegram.org/')) {
    if (faults.has('telegram')) return new Response('{"ok":false}', { status: 502 })
    const payload = JSON.parse(init.body)
    log('telegram', String(payload.text).split('\n')[0])
    telegrams.push({ at: Date.now(), text: payload.text })
    return json({ ok: true })
  }
  if (u.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'local', expires_in: 3600 })
  // The Joners Juniors sign-up tab: its own pretend sheet.
  if (u.includes('sheets.googleapis.com') && u.includes('/local-jj-sheet')) {
    if (faults.has('sheet')) return new Response('{"error":{"message":"The caller does not have permission"}}', { status: 403 })
    if (u.includes('?fields=sheets')) return json({ sheets: [{ properties: { title: 'Joners Juniors', sheetId: 7 } }] })
    if (u.includes(':batchUpdate')) return json({})
    if (u.includes(':append')) { juniorsSheet.push(JSON.parse(init.body).values[0].map((c) => String(c ?? ''))); log('sheet', 'juniors row appended'); return json({}) }
    const cell = decodeURIComponent(u).match(/!([A-Z])(\d+):[A-Z]\d+\?/)
    if (init.method === 'PUT' && cell) {
      const [, col, n] = cell
      const row = Number(n) - 1
      if (row === 0) return json({})
      while (juniorsSheet.length <= row) juniorsSheet.push([])
      const r = juniorsSheet[row]
      while (r.length <= col.charCodeAt(0) - 65) r.push('')
      r[col.charCodeAt(0) - 65] = String(JSON.parse(init.body).values[0][0] ?? '')
      return json({})
    }
    return json({ values: juniorsSheet })
  }
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

globalThis.fetch = async (url, init = {}) => {
  const k = serviceOf(String(url))
  calls[k] = (calls[k] || 0) + 1
  if (LATENCY[k]) await new Promise((r) => setTimeout(r, LATENCY[k]))
  return innerFetch(url, init)
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
for (const name of ['holiday-access', 'holiday-slots', 'holiday-book', 'holiday-confirm', 'holiday-payment-webhook', 'holiday-admin', 'jfp-access', 'jfp-groups', 'jfp-book', 'jfp-confirm', 'jfp-auth', 'jfp-account', 'jfp-portal-data', 'jfp-messages', 'jfp-messages-relay', 'jfp-pay', 'jfp-admin', 'juniors-info', 'juniors-registration', 'juniors-payment-webhook']) {
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
    // Webhooks check the signature on the raw body.
    if (!['holiday-payment-webhook', 'juniors-payment-webhook'].includes(name) && raw && (req.headers['content-type'] || '').includes('json')) { try { body = JSON.parse(raw) } catch {} }
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
    const s = sessions.get(url.searchParams.get('cs')) || stripeSeeded.find((x) => x.id === url.searchParams.get('cs'))
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
      // Stripe asks for an email when the page did not give one (&email= and &name= in tests).
      s.customer_details = { email: url.searchParams.get('email') || s.customer_email || '', name: url.searchParams.get('name') || '' }
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
    // method: how it was paid (card, afterpay_clearpay...); btLate: Stripe has no fee for it in the list yet.
    stripeSeeded.push({ id: `cs_test_seed_${n}`, object: 'checkout.session', status: 'complete', payment_status: 'paid', created: Math.floor(Date.parse(p.at || new Date().toISOString()) / 1000), amount_total: p.cents, currency: 'aud', customer_details: { email: p.email, name: p.name || '' }, payment_link: p.link || 'plink_jfp850', payment_intent: `pi_seed_${n}`, metadata: p.metadata || {}, payMethod: p.method || 'card', btLate: Boolean(p.btLate) })
    // fire: the Stripe webhook arrives for it, like a real payment link payment.
    if (p.fire) await fireWebhook('checkout.session.completed', stripeSeeded.at(-1))
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, id: `cs_test_seed_${n}` }))
  }
  if (url.pathname === '/__emails') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(emails)) }
  if (url.pathname === '/__telegram') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(telegrams)) }
  if (url.pathname === '/__airtable') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(airtable)) }
  if (url.pathname === '/__juniors-sheet') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(juniorsSheet)) }
  if (url.pathname === '/__brevo-contacts') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(brevoContacts)) }
  if (url.pathname === '/__sheet') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(sheetRows)) }
  // Test-only: add rows to a pretend Airtable table (Pro rows for Money > Pro sessions).
  if (url.pathname === '/__airtable-add') {
    const p = JSON.parse(await readBody(req) || '{}')
    if (!airtable[p.table]) { res.writeHead(400); return res.end('no such table') }
    const made = (p.rows || []).map((fields) => ({ id: recId(), fields }))
    airtable[p.table].push(...made)
    redis(['SET', 'jfp:roster-cleared', String(Date.now())]); redis(['DEL', 'jfp:roster-cache'])
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ids: made.map((r) => r.id) }))
  }
  if (url.pathname === '/__calls') {
    const out = { ...calls }
    if (url.searchParams.get('reset') === '1') for (const k of Object.keys(calls)) delete calls[k]
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out))
  }
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

// Bank money in, as the Mac job writes it from Xero: invented payers, none of
// them on the roster until a test names a row after one.
if (!process.env.JFP_SEED) {
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
  const x = (n, date, cents, payer, description, reference = '') => ({ id: `XERO-0000000${n}-aaaa-4bbb-8ccc-00000000000${n}`, date, cents, payer, description, reference, reconciled: true })
  redis(['SET', 'jfp:xero-bank-in', JSON.stringify({ at: new Date(Date.now() - 3600000).toISOString(), source: 'xero', since: day(30), account: 'Business account', items: [
    x(1, day(2), 85000, 'M FEATHERSTONE', 'Fast Transfer From M Featherstone', 'JFP term 4'),
    x(2, day(3), 42500, 'Q Zanzibarre', 'Transfer from Q Zanzibarre'),
    x(3, day(4), 12000, 'Stripe Payments Australia', 'Stripe payout'),
    x(4, day(5), 85000, 'K Wolstenholme', 'Fast Transfer From K Wolstenholme'),
  ] })])
}

if (process.env.JFP_GROUPS && fs.existsSync(process.env.JFP_GROUPS)) {
  for (const g of JSON.parse(fs.readFileSync(process.env.JFP_GROUPS, 'utf8'))) redis(['HSET', 'jfp:groups', g.id, JSON.stringify(g)])
  console.log('loaded JFP groups from', process.env.JFP_GROUPS)
}

server.keepAliveTimeout = 65000 // long waits in tests (the text helper reads Messages back) must not drop sockets
server.listen(PORT, () => console.log(`holiday local harness on http://localhost:${PORT}  (parent password "holiday", admin secret "admin")`))
