import crypto from 'node:crypto'

export const LEDGER_TTL_SECONDS = 90 * 24 * 60 * 60
export const MAX_SALES = 50
export const JOURNEY_COOKIE = 'jfa_journey'
export const ATTRIBUTION_CLASSES = new Set(['exact_paid_meta', 'email', 'organic', 'direct', 'referral', 'apple', 'google', 'unknown'])
export const FIRST_PARTY_TRACKING_KEYS = ['gclid', 'ttclid', 'msclkid', 'ga_client_id', 'ga_session_id', 'source_detail', 'link_token', 'source_taxonomy']

const MAX = { journey: 80, event: 80, text: 240, url: 1000 }
const TRACKING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'fbc', 'fbp', 'gclid', 'ttclid', 'msclkid', 'ga_client_id', 'ga_session_id', 'source_detail', 'link_token', 'source_taxonomy', 'campaign', 'campaign_id', 'adset', 'adset_id', 'ad', 'ad_id', 'placement']
const EVENT_NAMES = new Set(['page_view', 'cta_click', 'checkout_click', 'checkout_bridge', 'checkout_identity', 'form_start', 'form_submit', 'purchase', 'subscription', 'refund', 'renewal'])

export function clean(value, max = MAX.text) {
  if (value === undefined || value === null) return undefined
  const s = String(value).trim().slice(0, max)
  return s || undefined
}

export function sha256(value) {
  const s = clean(value, 500)?.toLowerCase()
  return s ? crypto.createHash('sha256').update(s).digest('hex') : undefined
}

export function createJourneyId(randomBytes = crypto.randomBytes) {
  return `jfy_${randomBytes(18).toString('base64url')}`
}

export function normalizeJourneyId(value) {
  const s = clean(value, MAX.journey)
  return s && /^jfy_[A-Za-z0-9_-]{20,80}$/.test(s) ? s : undefined
}

export function extractTracking(input = {}, referrer = '') {
  const source = input instanceof URLSearchParams ? Object.fromEntries(input.entries()) : input
  const out = {}
  for (const key of TRACKING_KEYS) {
    const value = clean(source?.[key], key === 'utm_campaign' || key === 'campaign' ? 240 : 180)
    if (value) out[key] = value
  }
  const ref = clean(referrer || source?.referrer, MAX.url)
  if (ref) out.referrer = ref
  return out
}

export function mergeTouch(record, touch, now = new Date().toISOString()) {
  const safeTouch = sanitizeTouch(touch)
  const next = { ...(record || {}) }
  if (!next.first_touch) next.first_touch = { ...safeTouch, at: now }
  next.last_touch = { ...safeTouch, at: now }
  next.updated_at = now
  next.expires_at = new Date(Date.parse(now) + LEDGER_TTL_SECONDS * 1000).toISOString()
  return next
}

export function sanitizeTouch(input = {}) {
  const tracking = extractTracking(input, input.referrer)
  return {
    ...tracking,
    path: clean(input.path, MAX.url),
    page_title: clean(input.page_title, 160),
    landing_url: clean(input.landing_url || input.url, MAX.url),
    journey_id: normalizeJourneyId(input.journey_id),
  }
}

export function sanitizeEvent(input = {}) {
  const name = clean(input.event_name || input.name, MAX.event)
  if (!name || !EVENT_NAMES.has(name)) throw new Error('Unsupported attribution event')
  const journeyId = normalizeJourneyId(input.journey_id)
  if (!journeyId) throw new Error('Valid journey_id is required')
  const event = {
    event_id: clean(input.event_id, 120) || crypto.randomUUID(),
    event_name: name,
    journey_id: journeyId,
    occurred_at: clean(input.occurred_at, 40) || new Date().toISOString(),
    path: clean(input.path, MAX.url),
    destination_url: clean(input.destination_url, MAX.url),
    cta: clean(input.cta, 180),
    checkout_url: clean(input.checkout_url, MAX.url),
    offer_id: clean(input.offer_id, 80),
    attribution: extractTracking(input.attribution || input),
  }
  return JSON.parse(JSON.stringify(event))
}

export function sanitizeIdentity(input = {}) {
  const email = clean(input.email, 320)?.toLowerCase()
  return {
    journey_id: normalizeJourneyId(input.journey_id),
    email_hash: sha256(email),
    identity_source: clean(input.identity_source || 'checkout', 80),
  }
}

export function classifyAttribution({ journey, payment = {}, now = Date.now() } = {}) {
  const touch = journey?.last_touch || journey?.first_touch || {}
  // Uscreen's live order.paid webhook uses event_date, while authoritative
  // payment reconciliation uses paid_at/created_at. Date.parse(0) resolves to
  // 1999 rather than an invalid date, so the previous fallback incorrectly
  // rejected a current signed journey as older than 90 days whenever the live
  // webhook omitted paid_at and created_at.
  const rawOccurredAt = payment.paid_at || payment.event_date || payment.occurred_at || payment.created_at
  const occurredAt = rawOccurredAt ? Date.parse(rawOccurredAt) : NaN
  const within90 = !Number.isFinite(occurredAt)
    || (occurredAt <= now && now - occurredAt <= LEDGER_TTL_SECONDS * 1000)
  const explicitJourney = clean(payment.journey_id || payment.jf_journey_id, MAX.journey)
  if (explicitJourney && explicitJourney === journey?.journey_id && within90) {
    const paidMeta = isExactPaidMeta(touch)
    return { classification: paidMeta ? 'exact_paid_meta' : classifyTouch(touch), confidence: paidMeta ? 'high' : 'high', evidence: ['explicit_journey_id', 'touch_within_90_days'] }
  }
  if (payment.email_hash && journey?.email_hash && payment.email_hash === journey.email_hash && within90) {
    return { classification: classifyTouch(touch), confidence: 'medium', evidence: ['hashed_email_time_bounded_fallback', 'touch_within_90_days'] }
  }
  return { classification: 'unknown', confidence: 'none', evidence: ['no_safe_join'] }
}

export function isExactPaidMeta(touch = {}) {
  const source = String(touch.utm_source || touch.source || '').toLowerCase()
  const medium = String(touch.utm_medium || '').toLowerCase().replace(/[- ]/g, '_')
  const clickIdentity = Boolean(touch.fbclid || touch.fbc)
  const campaignId = touch.campaign_id || touch.campaign
  const adsetId = touch.adset_id || touch.adset
  const adId = touch.ad_id || touch.ad
  return Boolean(clickIdentity && campaignId && adsetId && adId && (medium === 'paid_social' || medium === 'paidsocial' || source === 'facebook' || source === 'instagram' || source === 'meta'))
}

function classifyTouch(touch = {}) {
  const source = String(touch.utm_source || touch.source || '').toLowerCase()
  if (touch.apple || source.includes('apple')) return 'apple'
  if (isExactPaidMeta(touch)) return 'exact_paid_meta'
  if (touch.utm_medium === 'organic' || source.includes('organic')) return 'organic'
  if (source.includes('google') || touch.gclid) return 'google'
  if (source === 'email' || source.includes('newsletter') || source.includes('brevo')) return 'email'
  if (source === 'referral' || touch.utm_medium === 'referral' || touch.referrer) return 'referral'
  if (source === 'direct' || touch.utm_medium === 'direct') return 'direct'
  if (source || touch.utm_campaign) return 'unknown'
  return 'direct'
}

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('Attribution KV is not configured')
  return { url: url.replace(/\/$/, ''), token }
}

export async function kvCommand(command, fetchImpl = fetch) {
  const { url, token } = getKvConfig()
  const response = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(command) })
  if (!response.ok) throw new Error(`KV request failed: ${response.status}`)
  return response.json()
}

export const journeyKey = (id) => `jfa:journey:${id}`
export const eventKey = (journey, event) => `jfa:event:${journey}:${event}`
export const emailJourneyKey = (hash) => `jfa:email-journeys:${hash}`
export const salesIndexKey = 'jfa:sales:index'
export const saleKey = (id) => `jfa:sale:${id}`

export async function getJourney(journeyId, fetchImpl = fetch) {
  const result = await kvCommand(['GET', journeyKey(journeyId)], fetchImpl)
  if (!result?.result) return null
  try { return typeof result.result === 'string' ? JSON.parse(result.result) : result.result } catch { return null }
}

export async function upsertJourney(journey, fetchImpl = fetch) {
  await kvCommand(['SET', journeyKey(journey.journey_id), JSON.stringify(journey), 'EX', String(LEDGER_TTL_SECONDS)], fetchImpl)
  return journey
}

export async function claimEvent(journeyId, eventId, fetchImpl = fetch) {
  const result = await kvCommand(['SET', eventKey(journeyId, eventId), '1', 'NX', 'EX', String(LEDGER_TTL_SECONDS)], fetchImpl)
  return result?.result === 'OK'
}

export async function indexEmailJourney(emailHash, journeyId, capturedAt, fetchImpl = fetch) {
  if (!emailHash || !journeyId) return false
  const at = capturedAt || new Date().toISOString()
  await kvCommand(['ZADD', emailJourneyKey(emailHash), String(Date.parse(at) || Date.now()), JSON.stringify({ journey_id: journeyId, captured_at: at })], fetchImpl)
  await kvCommand(['EXPIRE', emailJourneyKey(emailHash), String(LEDGER_TTL_SECONDS)], fetchImpl)
  return true
}

export async function getEmailJourneyCandidates(emailHash, fetchImpl = fetch) {
  if (!emailHash) return []
  const result = await kvCommand(['ZRANGEBYSCORE', emailJourneyKey(emailHash), String(Date.now() - LEDGER_TTL_SECONDS * 1000), String(Date.now())], fetchImpl)
  const map = new Map()
  for (const raw of (Array.isArray(result?.result) ? result.result : [])) {
    try { const item = JSON.parse(raw); if (item?.journey_id) map.set(item.journey_id, item) } catch {}
  }
  return [...map.values()]
}

export async function appendSale(sale, fetchImpl = fetch) {
  const saleId = clean(sale.sale_id, 180)
  if (!saleId) throw new Error('sale_id is required')
  const claimed = await kvCommand(['SET', saleKey(saleId), JSON.stringify(sale), 'NX', 'EX', String(LEDGER_TTL_SECONDS * 4)], fetchImpl)
  if (claimed?.result === 'OK') {
    await kvCommand(['ZADD', salesIndexKey, String(Date.parse(sale.occurred_at) || Date.now()), saleId], fetchImpl)
    const overflow = await kvCommand(['ZRANGE', salesIndexKey, '0', String(-(MAX_SALES + 1))], fetchImpl)
    const staleIds = Array.isArray(overflow?.result) ? overflow.result : []
    if (staleIds.length) {
      await kvCommand(['ZREM', salesIndexKey, ...staleIds], fetchImpl)
      await kvCommand(['DEL', ...staleIds.map(saleKey)], fetchImpl)
    }
  }
  return { ...sale, duplicate: claimed?.result !== 'OK' }
}

export async function listSales(fetchImpl = fetch) {
  const ids = await kvCommand(['ZREVRANGE', salesIndexKey, '0', String(MAX_SALES - 1)], fetchImpl)
  const sales = []
  for (const id of (Array.isArray(ids?.result) ? ids.result : [])) {
    const row = await kvCommand(['GET', saleKey(id)], fetchImpl)
    if (row?.result) { try { sales.push(JSON.parse(row.result)) } catch {} }
  }
  return sales.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at))).slice(0, MAX_SALES)
}
