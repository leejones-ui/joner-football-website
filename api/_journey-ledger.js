import crypto from 'node:crypto'
import { extractAttribution, extractMetaIdentity } from './_attribution.js'

const JOURNEY_TTL_SECONDS = 180 * 24 * 60 * 60
const TOKEN_RE = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,64})$/
const TOUCH_FIELDS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'placement', 'first_utm_source',
  'first_utm_medium', 'first_utm_campaign', 'first_utm_content', 'first_utm_term',
  'first_utm_id', 'first_campaign_id', 'first_adset_id', 'first_ad_id', 'first_placement',
  'fbclid', 'fbc', 'fbp',
]

function signingSecret() {
  return String(process.env.JOURNEY_SIGNING_SECRET || process.env.USCREEN_WEBHOOK_SECRET || '')
}

function clean(value, max = 500) {
  if (value === undefined || value === null) return undefined
  const output = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
  return output || undefined
}

function normalizedEmail(value) {
  const email = clean(value, 220)?.toLowerCase()
  return email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function signatureFor(id) {
  const secret = signingSecret()
  if (!secret) throw new Error('Journey signing is not configured')
  return crypto.createHmac('sha256', secret).update(`jf-journey-v1:${id}`).digest('base64url')
}

export function createJourneyToken(id = crypto.randomUUID()) {
  const cleanId = clean(id, 36)?.toLowerCase()
  if (!cleanId || !/^[0-9a-f-]{36}$/.test(cleanId)) throw new Error('Invalid journey id')
  return `${cleanId}.${signatureFor(cleanId)}`
}

export function verifyJourneyToken(token) {
  const match = clean(token, 160)?.match(TOKEN_RE)
  if (!match || !signingSecret()) return undefined
  const id = match[1].toLowerCase()
  const expected = signatureFor(id)
  const supplied = match[2]
  if (supplied.length !== expected.length) return undefined
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? id : undefined
}

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url: url.replace(/\/$/, ''), token } : undefined
}

async function kvCommand(command) {
  const config = kvConfig()
  if (!config) throw new Error('Journey KV is not configured')
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!response.ok) throw new Error(`Journey KV failed: ${response.status}`)
  return (await response.json())?.result
}

function cleanTouch(input = {}) {
  const attribution = extractAttribution(input)
  const meta = extractMetaIdentity(input)
  const combined = { ...input, ...attribution, ...meta }
  return Object.fromEntries(TOUCH_FIELDS.map((key) => [key, clean(combined[key], key === 'fbc' || key === 'fbclid' ? 500 : 240)]).filter(([, value]) => value))
}

export function mergeJourneyRecord(existing, touch = {}) {
  const touchedAt = clean(touch.touched_at, 40) || new Date().toISOString()
  const attribution = cleanTouch(touch.attribution || {})
  const firstTouch = existing?.first_touch && Object.keys(existing.first_touch).length
    ? existing.first_touch
    : attribution
  return {
    ...(existing || {}),
    id: clean(existing?.id || touch.id, 36),
    created_at: existing?.created_at || touchedAt,
    updated_at: touchedAt,
    first_touch: firstTouch,
    latest_touch: Object.keys(attribution).length ? attribution : (existing?.latest_touch || firstTouch),
    first_page_path: existing?.first_page_path || clean(touch.page_path, 500),
    latest_page_path: clean(touch.page_path, 500) || existing?.latest_page_path,
    first_referrer: existing?.first_referrer || clean(touch.referrer, 800),
    latest_referrer: clean(touch.referrer, 800) || existing?.latest_referrer,
  }
}

async function readJourney(id) {
  if (!id) return undefined
  const raw = await kvCommand(['GET', `jf:journey:${id}`])
  if (!raw) return undefined
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return undefined }
}

async function writeJourney(record) {
  await kvCommand(['SET', `jf:journey:${record.id}`, JSON.stringify(record), 'EX', JOURNEY_TTL_SECONDS])
}

export async function createOrTouchJourney({ token, attribution, page_path, referrer } = {}) {
  let id = verifyJourneyToken(token)
  if (!id) id = crypto.randomUUID()
  const signedToken = createJourneyToken(id)
  const existing = await readJourney(id)
  const record = mergeJourneyRecord(existing, { id, attribution, page_path, referrer })
  await writeJourney(record)
  return { token: signedToken, record }
}

export async function linkJourneyIdentity(token, { email, uscreenUserId } = {}) {
  const id = verifyJourneyToken(token)
  if (!id) return { linked: false, reason: 'invalid-token' }
  const record = await readJourney(id)
  if (!record) return { linked: false, reason: 'journey-not-found' }
  const emailValue = normalizedEmail(email)
  const userId = clean(uscreenUserId, 180)
  const updated = { ...record, updated_at: new Date().toISOString() }
  if (emailValue) {
    updated.email_sha256 = sha256(emailValue)
    await kvCommand(['SET', `jf:journey:index:email:${updated.email_sha256}`, id, 'EX', JOURNEY_TTL_SECONDS])
  }
  if (userId) {
    updated.uscreen_user_id = userId
    await kvCommand(['SET', `jf:journey:index:uscreen:${userId}`, id, 'EX', JOURNEY_TTL_SECONDS])
  }
  await writeJourney(updated)
  return { linked: true, id }
}

// Resolve only a cryptographically valid first-party token. The signed token
// is the public journey identifier; the UUID inside it is only the KV key.
export async function getSignedJourney(token) {
  const id = verifyJourneyToken(token)
  if (!id) return undefined
  const record = await readJourney(id)
  if (!record) return undefined
  return {
    ...record,
    journey_id: token,
    last_touch: record.latest_touch || record.last_touch || record.first_touch || {},
  }
}

async function journeyIdFromIndexes(data, email) {
  const attribution = extractAttribution(data)
  const tokenId = verifyJourneyToken(attribution.jf_journey_id || data?.jf_journey_id)
  if (tokenId) return tokenId
  const userId = clean(data?.user_id || data?.customer_id || data?.customer?.id || data?.user?.id, 180)
  if (userId) {
    const indexed = await kvCommand(['GET', `jf:journey:index:uscreen:${userId}`])
    if (indexed) return clean(indexed, 36)
  }
  const emailValue = normalizedEmail(email)
  if (emailValue) return clean(await kvCommand(['GET', `jf:journey:index:email:${sha256(emailValue)}`]), 36)
  return undefined
}

export async function enrichPayloadFromJourney(data, email) {
  if (!kvConfig()) return data
  try {
    const id = await journeyIdFromIndexes(data, email)
    if (!id) return data
    const record = await readJourney(id)
    if (!record) return data
    const merged = { ...data }
    const storedTouch = { ...record.first_touch, ...record.latest_touch }
    for (const [key, value] of Object.entries(storedTouch)) {
      const current = clean(merged[key], 1200)
      if (!current || /^(not available|unknown|none|null|direct)$/i.test(current)) merged[key] = value
    }
    merged.jf_journey_id = createJourneyToken(id)
    const userId = clean(data?.user_id || data?.customer_id || data?.customer?.id || data?.user?.id, 180)
    await linkJourneyIdentity(merged.jf_journey_id, { email, uscreenUserId: userId })
    return merged
  } catch (error) {
    console.error('Journey enrichment failed (non-fatal)', error?.message || String(error))
    return data
  }
}

export function journeyStoreConfigured() {
  return Boolean(kvConfig() && signingSecret())
}
