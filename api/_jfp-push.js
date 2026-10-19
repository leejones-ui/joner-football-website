// Push notifications for My account (Lee, 17 Oct 2026). Web Push with VAPID,
// no third-party service and no new package: the payload is encrypted here
// (RFC 8291, aes128gcm) and posted straight to the phone's push service.
//
//   JFP_VAPID_PUBLIC   base64url, 65 byte P-256 public key (also sent to the page)
//   JFP_VAPID_PRIVATE  base64url, 32 byte private key
// With either missing, nothing is offered and nothing is sent.
//
// KV:
//   jfp:push-subs    hash subId -> JSON {email, endpoint, keys:{p256dh,auth}, at, ua}
//   jfp:push-prefs   hash email -> JSON {reminder, changes, payments, news, notes} (missing = on)
//   jfp:push-sent:*  one-off claims so a nightly run never sends the same thing twice
// Kinds: reminder (night before a session), changes (no session or a
// different coach tomorrow), payments (a new payment to make), news (an
// announcement), notes (a note from the coach).
import crypto from 'node:crypto'
import { kvCommand, clean, claimOnce, rowEmails, sydneyToday, dateLabel, locationFor, getConfig, listGroups } from './_jfp-store.js'

const SUBS = 'jfp:push-subs'
const PREFS = 'jfp:push-prefs'
export const PUSH_KINDS = ['reminder', 'changes', 'payments', 'news', 'notes']
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
const b64u = (buf) => Buffer.from(buf).toString('base64url')
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url')

export function pushPublicKey() { return process.env.JFP_VAPID_PUBLIC && process.env.JFP_VAPID_PRIVATE ? process.env.JFP_VAPID_PUBLIC : '' }

// ---------- encryption (RFC 8291) and VAPID (RFC 8292) ----------

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
export function encryptPayload(payload, { p256dh, auth }, { serverKeys, salt } = {}) {
  const ua = unb64u(p256dh), secret = unb64u(auth)
  if (ua.length !== 65 || secret.length !== 16) throw new Error('bad subscription keys')
  const ecdh = crypto.createECDH('prime256v1')
  if (serverKeys) ecdh.setPrivateKey(serverKeys); else ecdh.generateKeys()
  const asPub = ecdh.getPublicKey()
  const shared = ecdh.computeSecret(ua)
  const ikm = hmac(hmac(secret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub, Buffer.from([1])]))
  const s = salt || crypto.randomBytes(16)
  const prk = hmac(s, ikm)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12)
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce)
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()])
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096)
  return Buffer.concat([s, rs, Buffer.from([65]), asPub, body])
}

function vapidKey() {
  const pub = unb64u(process.env.JFP_VAPID_PUBLIC)
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64u(unb64u(process.env.JFP_VAPID_PRIVATE)), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' })
}
export function vapidHeader(endpoint, nowMs = Date.now()) {
  const aud = new URL(endpoint).origin
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: process.env.JFP_VAPID_SUBJECT || 'mailto:ligia@jonerfootball.com' }))
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key: vapidKey(), dsaEncoding: 'ieee-p1363' })
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${process.env.JFP_VAPID_PUBLIC}`
}

// Only the big browser push services: a subscription naming anything else is refused.
const PUSH_HOSTS = /(^|\.)(push\.services\.mozilla\.com|fcm\.googleapis\.com|googleapis\.com|push\.apple\.com|notify\.windows\.com)$/
export function allowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint)
    if (process.env.JFP_PUSH_TEST_HOST && u.host === process.env.JFP_PUSH_TEST_HOST) return true
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname)
  } catch { return false }
}

async function sendOne(sub, message) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: vapidHeader(sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
    body: encryptPayload(JSON.stringify(message), sub.keys),
  })
  // Gone (the phone turned it off or the app was removed): forget it.
  if (res.status === 404 || res.status === 410) await kvCommand(['HDEL', SUBS, sub.id])
  return res.status
}

// ---------- subscriptions and switches ----------

const subId = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32)
export async function allSubs() {
  const raw = (await kvCommand(['HGETALL', SUBS])) || []
  const out = []
  if (Array.isArray(raw)) { for (let i = 0; i + 1 < raw.length; i += 2) { const s = parse(raw[i + 1]); if (s) out.push({ ...s, id: raw[i] }) } }
  else for (const [k, v] of Object.entries(raw)) { const s = parse(v); if (s) out.push({ ...s, id: k }) }
  return out
}
export async function saveSub(email, sub, ua = '') {
  const endpoint = String(sub?.endpoint || '')
  const p256dh = clean(sub?.keys?.p256dh, 200), auth = clean(sub?.keys?.auth, 60)
  if (!allowedEndpoint(endpoint) || endpoint.length > 1000) return { error: 'That device cannot get notifications.' }
  if (unb64u(p256dh).length !== 65 || unb64u(auth).length !== 16) return { error: 'That device cannot get notifications.' }
  const id = subId(endpoint)
  await kvCommand(['HSET', SUBS, id, JSON.stringify({ email: String(email).toLowerCase(), endpoint, keys: { p256dh, auth }, at: new Date().toISOString(), ua: clean(ua, 120) })])
  return { id }
}
export async function dropSub(email, endpoint) {
  const id = subId(endpoint)
  const was = parse(await kvCommand(['HGET', SUBS, id]))
  if (was && was.email === String(email).toLowerCase()) await kvCommand(['HDEL', SUBS, id])
  return true
}
export async function prefsOf(email) {
  const p = parse(await kvCommand(['HGET', PREFS, String(email).toLowerCase()])) || {}
  return Object.fromEntries(PUSH_KINDS.map((k) => [k, p[k] !== false]))
}
export async function setPrefs(email, input = {}) {
  const now = await prefsOf(email)
  for (const k of PUSH_KINDS) if (typeof input[k] === 'boolean') now[k] = input[k]
  await kvCommand(['HSET', PREFS, String(email).toLowerCase(), JSON.stringify(now)])
  return now
}
// What the page needs: is it set up, is this device on, and the switches.
export async function pushView(email, endpoint = '') {
  const key = pushPublicKey()
  if (!key) return { available: false }
  const subs = (await allSubs()).filter((s) => s.email === String(email).toLowerCase())
  return { available: true, key, devices: subs.length, thisDevice: endpoint ? subs.some((s) => s.endpoint === endpoint) : false, prefs: await prefsOf(email) }
}

// Send one kind of message to every device of these emails that has it on.
// `claim` (optional) makes it once only per email.
export async function pushTo(emails, kind, message, claim = '') {
  if (!pushPublicKey()) return { sent: 0 }
  const want = new Set([...emails].map((e) => String(e || '').toLowerCase()).filter(Boolean))
  if (!want.size) return { sent: 0 }
  const subs = (await allSubs()).filter((s) => want.has(s.email))
  let sent = 0
  const prefCache = new Map()
  for (const s of subs) {
    if (!prefCache.has(s.email)) prefCache.set(s.email, await prefsOf(s.email))
    if (!prefCache.get(s.email)[kind]) continue
    if (claim && !(await claimOnce(`jfp:push-sent:${claim}:${s.id}`, 60 * 60 * 24 * 40))) continue
    try { const st = await sendOne(s, { ...message, tag: message.tag || kind }); if (st >= 200 && st < 300) sent += 1 } catch (error) { console.error('jfp push send failed', error.message) }
  }
  return { sent }
}

// ---------- who gets what ----------

// Player logins (12+) linked to a row's family get the same notes and reminders.
async function withPlayerLogins(rows) {
  const { loginsForRows } = await import('./_jfp-player-logins.js')
  return loginsForRows(rows)
}
const first = (n) => String(n || '').split(' ')[0]

export async function pushFamilyNote(rec, row) {
  const emails = new Set([...rowEmails(row), ...(await withPlayerLogins([row]))])
  return pushTo(emails, 'notes', { title: `${rec.kind === 'homework' ? 'Homework' : 'Note'} from ${first(row.player)}'s coach`, body: rec.text.slice(0, 140), url: '/jfp-account/#notes', tag: `note-${rec.id}` })
}

export async function pushAnnouncement(a) {
  if (!pushPublicKey() || a.from > sydneyToday()) return { sent: 0 }
  const { loadRoster } = await import('./_jfp-airtable.js')
  const config = await getConfig()
  const rows = (await loadRoster()).players.filter((r) => r.holdsPlace && (a.audience?.type === 'all' || (a.audience?.type === 'group' && r.groupId === a.audience.id) || (a.audience?.type === 'location' && locationFor(config, r.location).id === a.audience.id)))
  const emails = new Set([...rows.flatMap(rowEmails), ...(await withPlayerLogins(rows))])
  return pushTo(emails, 'news', { title: a.title, body: a.body.slice(0, 140), url: '/jfp-account/#news', tag: `news-${a.id}` }, `news-${a.id}`)
}

// The nightly run (cron, about 6pm Sydney): for every device that is on,
// tomorrow's sessions (or "no session" / "different coach"), and any new
// payment to make. Each is claimed so a second run sends nothing.
export async function pushTick(nowMs = Date.now()) {
  if (!pushPublicKey()) return { skipped: 'not set up' }
  const subs = await allSubs()
  if (!subs.length) return { sent: 0 }
  const { loadRoster, familyFor } = await import('./_jfp-airtable.js')
  const { rowSessionDates, rowTime, listCancels } = await import('./_jfp-cancel.js')
  const { sessionOffMap } = await import('./_jfp-makeups.js')
  const offMap = await sessionOffMap()
  const { listPayreqs } = await import('./_jfp-store.js')
  const { playerLoginOf } = await import('./_jfp-player-logins.js')
  const { skippedDates } = await import('./_jfp-store.js')
  const [config, roster, groups, cancels, payreqs, covers] = await Promise.all([getConfig(), loadRoster(), listGroups(), listCancels(), listPayreqs(), coversList()])
  // Announcements set to start on a later day go out the evening they start.
  try {
    const { allAnnouncements } = await import('./_jfp-announce.js')
    const today = sydneyToday(nowMs)
    for (const a of (await allAnnouncements()).filter((a) => a.from <= today && (!a.until || a.until >= today))) await pushAnnouncement(a)
  } catch (error) { console.error('jfp push announcements failed', error) }
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, g]))
  const tomorrow = sydneyToday(nowMs + 24 * 3600 * 1000)
  let sent = 0
  for (const email of new Set(subs.map((s) => s.email))) {
    const login = await playerLoginOf(email)
    const famEmail = login ? login.parentEmail : email
    const fam = familyFor(famEmail, roster, config.termStart)
    const players = login ? fam.players.filter((p) => p.key === login.playerKey) : fam.players
    const rows = players.flatMap((p) => p.term4).filter((r) => r.holdsPlace && r.groupId)
    const told = new Set(cancels.filter((c) => c.status === 'active' && c.email === famEmail).map((c) => `${c.rowId}|${c.date}`))
    for (const r of rows) {
      const g = byGroup[r.groupId] || null
      const where = locationFor(config, r.location).name
      const who = login ? 'You have' : `${first(r.player)} has`
      if (rowSessionDates(config, r, g).includes(tomorrow) && !offMap.has(`${r.groupId}|${tomorrow}`)) {
        if (told.has(`${r.id}|${tomorrow}`)) continue
        const cover = covers.find((c) => c.status === 'active' && c.groupId === r.groupId && c.date === tomorrow)
        if (cover) sent += (await pushTo([email], 'changes', { title: 'Different coach tomorrow', body: `${who} JFP at ${rowTime(r, g)}, ${where}. Another Joner coach is running it.`, url: '/jfp-account/#sessions' }, `cover-${r.id}-${tomorrow}`)).sent
        sent += (await pushTo([email], 'reminder', { title: 'JFP tomorrow', body: `${who} JFP at ${rowTime(r, g)}, ${where}.`, url: '/jfp-account/#sessions' }, `rem-${r.id}-${tomorrow}`)).sent
      } else if (g && skippedDates(config, g.day).some((x) => x.date === tomorrow)) {
        sent += (await pushTo([email], 'changes', { title: 'No JFP tomorrow', body: `No session on ${dateLabel(tomorrow)} (${skippedDates(config, g.day).find((x) => x.date === tomorrow).reason}).`, url: '/jfp-account/#sessions' }, `off-${r.id}-${tomorrow}`)).sent
      }
    }
    // Payments: a parent only, never a player login (no money for players).
    if (!login) {
      const ids = new Set(fam.players.flatMap((p) => p.term4.map((r) => r.id)))
      for (const q of payreqs.filter((q) => ['open', 'checkout'].includes(q.status) && (q.term4Ids || []).some((id) => ids.has(id)))) {
        sent += (await pushTo([email], 'payments', { title: 'Payment to make', body: 'There is a JFP payment waiting in your account.', url: '/jfp-account/#fees' }, `pay-${q.id}`)).sent
      }
    }
  }
  return { sent }
}
async function coversList() {
  const raw = (await kvCommand(['HGETALL', 'jfp:cover'])) || []
  const out = []
  for (let i = 0; i + 1 < raw.length; i += 2) { const c = parse(raw[i + 1]); if (c) out.push(c) }
  return out
}
