import crypto from 'node:crypto'
import { extractAttribution, extractMetaIdentity } from './_attribution.js'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Dedicated verified events are intentionally separate from Uscreen's noisy
// built-in Purchase stream. Meta custom conversions can count these exact
// server-side events without mixing them with duplicated browser events.
const META_PIXEL_ID = '232666285545279'
const META_EVENTS = {
  accountCreated: 'JF_Account_Created',
  trialStarted: 'JF_Trial_Started',
  paidPurchase: 'JF_Paid_Purchase',
}

function sha256Hex(value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return undefined
  return crypto.createHash('sha256').update(v).digest('hex')
}

function parseEventTime(data) {
  const raw = data.event_time || data.created_at || data.created || data.timestamp || data.event_date
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw)
  const parsed = raw ? Date.parse(String(raw)) : NaN
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000)
}

function stableEventKey(eventName, data, email) {
  const direct = data.order_id || data.transaction_id || data.user_id || data.id
  if (direct) return `${eventName}.${String(direct).slice(0, 180)}`
  const seed = [eventName, email, data.event_date, data.created_at, data.offer_id, data.total].join('|')
  return `${eventName}.${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`
}

export function buildVerifiedMetaEvent(eventName, data, email, total) {
  const em = sha256Hex(email)
  if (!em) return undefined
  const eventTime = parseEventTime(data)
  const attribution = extractAttribution(data)
  const metaIdentity = extractMetaIdentity(data, eventTime)
  const userData = { em: [em] }
  if (metaIdentity.fbc) userData.fbc = metaIdentity.fbc
  if (metaIdentity.fbp) userData.fbp = metaIdentity.fbp
  const value = Number.isFinite(Number(total)) ? Number(total) : undefined
  return {
    event_name: eventName,
    event_time: eventTime,
    event_id: stableEventKey(eventName, data, email),
    action_source: 'website',
    event_source_url: 'https://app.jonerfootball.com/checkout/success',
    user_data: userData,
    custom_data: {
      currency: String(data.currency || data.localized_amounts?.currency || 'AUD').trim().toUpperCase().slice(0, 10),
      value,
      subscription_plan: String(data.offer_title || data.subscription_title || data.title || '').slice(0, 120) || undefined,
      conversion_stage: eventName === META_EVENTS.paidPurchase ? 'paid' : eventName === META_EVENTS.trialStarted ? 'trial' : 'account_created',
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      utm_content: attribution.utm_content,
      utm_term: attribution.utm_term,
      utm_id: attribution.utm_id,
      placement: attribution.placement,
    },
  }
}

async function sendVerifiedConversionToMeta(eventName, data, email, total) {
  const token = process.env.META_CAPI_TOKEN
  if (!token) return { skipped: 'no-capi-token' }
  const event = buildVerifiedMetaEvent(eventName, data, email, total)
  if (!event) return { skipped: 'no-email' }
  const payload = { data: [event] }
  const testEventCode = cleanValue(data.meta_test_event_code || data.test_event_code, 100)
  if (testEventCode) payload.test_event_code = testEventCode
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await r.text().catch(() => '')
    return { ok: r.ok, status: r.status, eventId: event.event_id, body: text.slice(0, 200) }
  } catch (e) {
    return { error: String(e?.message || e).slice(0, 160) }
  }
}

const LISTS = {
  appUsersMega: Number(process.env.BREVO_APP_USERS_MEGA_LIST_ID || 36),
  trialUsers: Number(process.env.BREVO_TRIAL_USERS_LIST_ID || 21),
  monthlySubscribers: Number(process.env.BREVO_MONTHLY_SUBSCRIBERS_LIST_ID || 22),
  annualSubscribers: Number(process.env.BREVO_ANNUAL_SUBSCRIBERS_LIST_ID || 23),
  coachesPlanSubscribers: Number(process.env.BREVO_COACHES_PLAN_SUBSCRIBERS_LIST_ID || 24),
  freeSessionLeads: Number(process.env.BREVO_FREE_SESSION_LEADS_LIST_ID || 33),
  coachesFreeBundleUsers: Number(process.env.BREVO_COACHES_FREE_BUNDLE_USERS_LIST_ID || 34),
  trialUsersChurned: Number(process.env.BREVO_TRIAL_USERS_CHURNED_LIST_ID || 35),
  freeSoloBundleUsers: Number(process.env.BREVO_FREE_SOLO_BUNDLE_USERS_LIST_ID || 37),
  hundredDayTransformationBundle: Number(process.env.BREVO_HUNDRED_DAY_BUNDLE_LIST_ID || 38),
  cognitiveFreeBundle: Number(process.env.BREVO_COGNITIVE_FREE_BUNDLE_LIST_ID || 40),
  churnedMonthly: Number(process.env.BREVO_CHURNED_MONTHLY_LIST_ID || 30),
  churnedAnnual: Number(process.env.BREVO_CHURNED_ANNUAL_LIST_ID || 31),
  churnedCoaches: Number(process.env.BREVO_CHURNED_COACHES_LIST_ID || 32),
  failedPayments: Number(process.env.BREVO_FAILED_PAYMENTS_LIST_ID || 53),
  // Tier lists. Active reuses the EXISTING real lists 22/23/24 (already named
  // Starter/Plus/Max Active). Churned uses the new tier lists 57/58/59.
  starterActive: Number(process.env.BREVO_STARTER_ACTIVE_LIST_ID || 22),
  plusActive: Number(process.env.BREVO_PLUS_ACTIVE_LIST_ID || 23),
  maxActive: Number(process.env.BREVO_MAX_ACTIVE_LIST_ID || 24),
  starterChurned: Number(process.env.BREVO_STARTER_CHURNED_LIST_ID || 57),
  plusChurned: Number(process.env.BREVO_PLUS_CHURNED_LIST_ID || 58),
  maxChurned: Number(process.env.BREVO_MAX_CHURNED_LIST_ID || 59),
}

// Every current subscription offer, keyed to its tier and billing. Source of
// truth: Uscreen Manage People subscription plans (verified 2026-06-29).
const TIER_BY_OFFER_ID = {
  183083: 'starter', 189392: 'starter', 230697: 'starter',
  230699: 'plus', 183092: 'plus', 189393: 'plus',
  230698: 'max', 202578: 'max', 230696: 'max',
}
const BILLING_BY_OFFER_ID = {
  183083: 'monthly', 189392: 'monthly', 230699: 'monthly', 230698: 'monthly',
  230697: 'annual', 183092: 'annual', 189393: 'annual', 202578: 'annual', 230696: 'annual',
}
const ACTIVE_LIST_BY_TIER = { starter: LISTS.starterActive, plus: LISTS.plusActive, max: LISTS.maxActive }
const CHURNED_LIST_BY_TIER = { starter: LISTS.starterChurned, plus: LISTS.plusChurned, max: LISTS.maxChurned }
// Legacy by-billing lists kept populated during the transition so the winback
// engine and dashboard never miss anyone mid-migration.
const LEGACY_ACTIVE_BY_BILLING = { monthly: LISTS.monthlySubscribers, annual: LISTS.annualSubscribers }
const LEGACY_CHURNED_BY_BILLING = { monthly: LISTS.churnedMonthly, annual: LISTS.churnedAnnual }

const TRIAL_ELIGIBLE_OFFER_IDS = new Set(Object.keys(TIER_BY_OFFER_ID).map(Number))

const ALL_ACTIVE_LISTS = [
  LISTS.monthlySubscribers, LISTS.annualSubscribers, LISTS.coachesPlanSubscribers,
  LISTS.starterActive, LISTS.plusActive, LISTS.maxActive,
]
const ALL_CHURNED_LISTS = [
  LISTS.churnedMonthly, LISTS.churnedAnnual, LISTS.churnedCoaches,
  LISTS.starterChurned, LISTS.plusChurned, LISTS.maxChurned,
]

const OWNERSHIP_LISTS_BY_OFFER_ID = {
  226775: [LISTS.coachesFreeBundleUsers, LISTS.freeSessionLeads],
  226774: [LISTS.freeSoloBundleUsers, LISTS.freeSessionLeads],
  227739: [LISTS.hundredDayTransformationBundle, LISTS.freeSessionLeads],
  205911: [LISTS.freeSessionLeads],
  228257: [LISTS.cognitiveFreeBundle, LISTS.freeSessionLeads],
}

function json(res, status, payload) {
  return res.status(status).json(payload)
}

export function isValidUscreenWebhookSecret(req) {
  const expectedSecret = String(process.env.USCREEN_WEBHOOK_SECRET || '')
  if (!expectedSecret) return true
  const querySecret = Array.isArray(req.query?.secret) ? req.query.secret[0] : req.query?.secret
  const headerSecret = req.headers?.['x-uscreen-webhook-secret'] || req.headers?.['x-webhook-secret']
  const providedSecret = String(querySecret || headerSecret || '')
  if (!providedSecret || providedSecret.length !== expectedSecret.length) return false
  return crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expectedSecret))
}

function cleanValue(value, max = 500) {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map((item) => cleanValue(item, 120)).filter(Boolean).join(', ')
  if (typeof value === 'boolean') return value
  const text = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
  return text || undefined
}

function toInt(value) {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number.parseInt(String(value), 10)
  return Number.isFinite(number) ? number : undefined
}

function toFloat(value) {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number.parseFloat(String(value))
  return Number.isFinite(number) ? number : undefined
}

function normalizeEventType(rawEvent) {
  return String(rawEvent || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'unknown'
}

function nestedObject(data, key) {
  return data?.[key] && typeof data[key] === 'object' && !Array.isArray(data[key]) ? data[key] : {}
}

function extractEmail(data) {
  const customer = nestedObject(data, 'customer')
  const user = nestedObject(data, 'user')
  const nestedData = nestedObject(data, 'data')
  return cleanValue(
    data.email || data.customer_email || data.user_email || customer.email || user.email || nestedData.email,
    220,
  )?.toLowerCase()
}

function extractName(data) {
  const customer = nestedObject(data, 'customer')
  const user = nestedObject(data, 'user')
  const nestedData = nestedObject(data, 'data')
  return cleanValue(
    data.name || data.customer_name || data.customer_display_name || data.user_name || customer.name || customer.first_name || user.name || nestedData.name,
    180,
  )
}

function buildContactAttributes(data, eventType) {
  const attribution = extractAttribution(data)
  const metaIdentity = extractMetaIdentity(data)
  const attrs = {
    FIRSTNAME: cleanValue(data.name || data.customer_name || data.customer_display_name || data.user_name, 180),
    USCREEN_USER_ID: cleanValue(data.user_id || data.id, 120),
    USCREEN_OFFER_ID: cleanValue(data.offer_id || data.subscription_id, 120),
    USCREEN_OFFER_TITLE: cleanValue(data.offer_title || data.subscription_title || data.title, 180),
    USCREEN_TRANSACTION_ID: cleanValue(data.transaction_id, 180),
    USCREEN_ORIGIN: cleanValue(data.origin, 120),
    USCREEN_CURRENCY: cleanValue(data.currency || data.localized_amounts?.currency, 20),
    USCREEN_TAGS: cleanValue(data.tags, 500),
    UTM_SOURCE: cleanValue(attribution.utm_source, 180),
    UTM_MEDIUM: cleanValue(attribution.utm_medium, 180),
    UTM_TERM: cleanValue(attribution.utm_term, 180),
    UTM_CONTENT: cleanValue(attribution.utm_content, 180),
    UTM_CAMPAIGN: cleanValue(attribution.utm_campaign, 180),
    UTM_ID: cleanValue(attribution.utm_id, 180),
    UTM_PLACEMENT: cleanValue(attribution.placement, 120),
    META_FBC: cleanValue(metaIdentity.fbc, 500),
    META_FBP: cleanValue(metaIdentity.fbp, 240),
    NEWS_OPT_IN: data.opted_in_for_news_and_updates,
    COMMUNITY_OPT_IN: data.opted_in_for_community_updates,
    LAST_USCREEN_EVENT: cleanValue(eventType, 80),
    LAST_USCREEN_EVENT_DATE: cleanValue(data.event_date || new Date().toISOString().slice(0, 10), 40),
  }
  return Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== undefined && value !== null && value !== ''))
}

export function compactBrevoAttributes(attributes) {
  const retryKeys = [
    'FIRSTNAME',
    'UTM_SOURCE',
    'UTM_MEDIUM',
    'UTM_CAMPAIGN',
    'UTM_CONTENT',
    'UTM_TERM',
    'UTM_ID',
    'UTM_PLACEMENT',
    'META_FBC',
    'META_FBP',
    'LAST_USCREEN_EVENT',
    'LAST_USCREEN_EVENT_DATE',
  ]
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => retryKeys.includes(key)),
  )
}

async function brevoUpsertContact({ email, listIds, name, attributes, unlinkListIds = [] }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return { skipped: true, reason: 'brevo-api-key-missing' }

  const cleanListIds = [...new Set(listIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))]
  if (!cleanListIds.length) return { skipped: true, reason: 'no-list-ids' }

  // Lists to remove the contact from in the same call, so Brevo mirrors Uscreen
  // (a cancel pulls them out of active, a paid order pulls them out of churned).
  const cleanUnlink = [...new Set((unlinkListIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))].filter((id) => !cleanListIds.includes(id))

  const body = {
    email,
    listIds: cleanListIds,
    updateEnabled: true,
    attributes: { ...attributes },
  }
  if (cleanUnlink.length) body.unlinkListIds = cleanUnlink
  if (name && !body.attributes.FIRSTNAME) body.attributes.FIRSTNAME = name

  let response = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok && Object.keys(body.attributes || {}).length > 3) {
    response = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({ ...body, attributes: compactBrevoAttributes(body.attributes) }),
    })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Brevo contact upsert failed: ${response.status} ${text.slice(0, 300)}`)
  }

  return { success: true, listIds: cleanListIds }
}

async function brevoGetContactAttributes(email) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey || !email) return {}
  try {
    const response = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
      headers: { accept: 'application/json', 'api-key': apiKey },
    })
    if (response.status === 404) return {}
    if (!response.ok) throw new Error(`Brevo contact lookup failed: ${response.status}`)
    const body = await response.json()
    return body?.attributes && typeof body.attributes === 'object' ? body.attributes : {}
  } catch (error) {
    console.error('Brevo attribution lookup failed (non-fatal)', error?.message || String(error))
    return {}
  }
}

function attributionStorageKeys(data, email) {
  const keys = []
  const customer = nestedObject(data, 'customer')
  const user = nestedObject(data, 'user')
  const userId = cleanValue(data.user_id || data.customer_id || customer.id || user.id, 120)
  if (userId) keys.push(`jf:uscreen-attribution:user:${userId}`)
  const emailHash = sha256Hex(email)
  if (emailHash) keys.push(`jf:uscreen-attribution:email:${emailHash}`)
  return [...new Set(keys)]
}

async function kvCommand(command) {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return undefined
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!response.ok) throw new Error(`Attribution KV failed: ${response.status}`)
  const body = await response.json()
  return body?.result
}

async function storeAttributionSnapshot(data, email) {
  const attribution = extractAttribution(data)
  const metaIdentity = extractMetaIdentity(data)
  if (!attribution.utm_campaign && !metaIdentity.fbc && !metaIdentity.fbp) return { skipped: 'no-attribution' }
  const snapshot = {
    utm_source: attribution.utm_source,
    utm_medium: attribution.utm_medium,
    utm_campaign: attribution.utm_campaign,
    utm_content: attribution.utm_content,
    utm_term: attribution.utm_term,
    utm_id: attribution.utm_id,
    placement: attribution.placement,
    fbc: metaIdentity.fbc,
    fbp: metaIdentity.fbp,
  }
  const keys = attributionStorageKeys(data, email)
  if (!keys.length) return { skipped: 'no-storage-key' }
  try {
    for (const key of keys) await kvCommand(['SET', key, JSON.stringify(snapshot), 'EX', 90 * 24 * 60 * 60])
    return { stored: true, keys: keys.length }
  } catch (error) {
    console.error('Attribution KV store failed (non-fatal)', error?.message || String(error))
    return { error: true }
  }
}

async function loadAttributionSnapshot(data, email) {
  try {
    for (const key of attributionStorageKeys(data, email)) {
      const raw = await kvCommand(['GET', key])
      if (!raw) continue
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (parsed && typeof parsed === 'object') return parsed
    }
  } catch (error) {
    console.error('Attribution KV lookup failed (non-fatal)', error?.message || String(error))
  }
  return {}
}

function usableAttributionValue(value) {
  const cleaned = cleanValue(value, 1200)
  if (!cleaned) return undefined
  return /^(not available|unknown|none|null|direct)$/i.test(cleaned) ? undefined : cleaned
}

export function mergeStoredAttribution(data, attributes = {}) {
  const merged = { ...data }
  const fields = {
    utm_source: attributes.utm_source || attributes.UTM_SOURCE,
    utm_medium: attributes.utm_medium || attributes.UTM_MEDIUM,
    utm_campaign: attributes.utm_campaign || attributes.UTM_CAMPAIGN,
    utm_content: attributes.utm_content || attributes.UTM_CONTENT,
    utm_term: attributes.utm_term || attributes.UTM_TERM,
    utm_id: attributes.utm_id || attributes.UTM_ID,
    placement: attributes.placement || attributes.UTM_PLACEMENT,
    fbc: attributes.fbc || attributes.META_FBC,
    fbp: attributes.fbp || attributes.META_FBP,
  }
  for (const [key, storedValue] of Object.entries(fields)) {
    if (!usableAttributionValue(merged[key])) {
      const value = usableAttributionValue(storedValue)
      if (value) merged[key] = value
    }
  }
  return merged
}

export async function processUscreenPayload(data) {
  const eventType = normalizeEventType(data.event || data.type || data.event_type)
  const offerId = toInt(data.offer_id ?? data.subscription_id)
  const total = toFloat(data.total)
  const transactionId = cleanValue(data.transaction_id, 180)
  const email = extractEmail(data)
  const name = extractName(data)
  let eventData = data

  if (!email) return { accepted: true, event: eventType, skipped: true, reason: 'missing-email' }
  if (!EMAIL_RE.test(email)) return { accepted: true, event: eventType, skipped: true, reason: 'invalid-email' }

  // Uscreen often includes attribution on User Created but omits it from the
  // later trial/paid Order Paid webhook. First-party KV is the durable join;
  // Brevo remains only a non-critical fallback and CRM mirror.
  if (eventType === 'order.paid') {
    eventData = mergeStoredAttribution(data, await loadAttributionSnapshot(data, email))
    eventData = mergeStoredAttribution(eventData, await brevoGetContactAttributes(email))
  }
  const attributes = buildContactAttributes(eventData, eventType)

  let listIds = []
  let unlinkListIds = []
  let reason = ''

  if (eventType === 'user.created') {
    listIds = [LISTS.appUsersMega]
    await storeAttributionSnapshot(eventData, email)
    try {
      const meta = await sendVerifiedConversionToMeta(META_EVENTS.accountCreated, eventData, email)
      console.info('Uscreen->Meta verified account created', meta)
    } catch (e) {
      console.error('Meta account-created conversion failed (non-fatal)', e?.message || String(e))
    }
  } else if (eventType === 'subscription.assigned' || eventType === 'assigned.offer') {
    listIds = offerId ? (OWNERSHIP_LISTS_BY_OFFER_ID[offerId] || []) : []
    reason = listIds.length ? '' : 'subscription-assignment-no-ownership-list'
  } else if (eventType === 'subscription.canceled' || eventType === 'access.canceled') {
    if (!transactionId) {
      listIds = [LISTS.trialUsersChurned]
    } else {
      // Add to the proper tier churned list AND the legacy by-billing churned
      // list (dual-write transition), so both new and existing systems see them.
      const tier = TIER_BY_OFFER_ID[offerId]
      listIds = [CHURNED_LIST_BY_TIER[tier]].filter(Boolean)
      reason = listIds.length ? '' : 'no-churn-list-for-offer'
    }
    // They churned: pull them out of every active list, trial and failed-payment.
    unlinkListIds = [LISTS.trialUsers, ...ALL_ACTIVE_LISTS, LISTS.failedPayments]
  } else if (eventType === 'ownership.created') {
    listIds = offerId ? (OWNERSHIP_LISTS_BY_OFFER_ID[offerId] || []) : []
    reason = listIds.length ? '' : 'no-ownership-list-for-offer'
  } else if (eventType === 'order.paid') {
    if (offerId && OWNERSHIP_LISTS_BY_OFFER_ID[offerId] && total === 0) {
      listIds = OWNERSHIP_LISTS_BY_OFFER_ID[offerId]
    } else if (offerId && TRIAL_ELIGIBLE_OFFER_IDS.has(offerId) && total === 0) {
      listIds = [LISTS.trialUsers]
      try {
        const meta = await sendVerifiedConversionToMeta(META_EVENTS.trialStarted, eventData, email, 0)
        console.info('Uscreen->Meta verified trial started', meta)
      } catch (e) {
        console.error('Meta trial-started conversion failed (non-fatal)', e?.message || String(e))
      }
    } else if (offerId && TIER_BY_OFFER_ID[offerId] && total !== undefined && total > 0) {
      // Paid order: add to the proper tier active list (22/23/24).
      const tier = TIER_BY_OFFER_ID[offerId]
      listIds = [ACTIVE_LIST_BY_TIER[tier]].filter(Boolean)
      // Bridge this PAID conversion to Meta CAPI (guarded, never blocks Brevo).
      try {
        const meta = await sendVerifiedConversionToMeta(META_EVENTS.paidPurchase, eventData, email, total)
        console.info('Uscreen->Meta verified paid purchase', meta)
      } catch (e) {
        console.error('Meta paid conversion failed (non-fatal)', e?.message || String(e))
      }
    } else {
      reason = 'order-paid-no-list-rule'
    }
  } else if (eventType === 'invoice.overdue') {
    // A failed/late payment: flag them for the dunning lane and the dashboard tile.
    listIds = [LISTS.failedPayments]
  } else {
    reason = 'unhandled-event-type'
  }

  // A paid order means they are active again: pull them out of every churned and trial list.
  if (eventType === 'order.paid' && listIds.some((id) => ALL_ACTIVE_LISTS.includes(id))) {
    unlinkListIds = [...ALL_CHURNED_LISTS, LISTS.trialUsersChurned, LISTS.trialUsers, LISTS.failedPayments]
  }

  if (!listIds.length) return { accepted: true, event: eventType, skipped: true, reason, offerId }

  const brevo = await brevoUpsertContact({ email, listIds, name, attributes, unlinkListIds })
  return { accepted: true, event: eventType, processed: true, offerId, brevo }
}

export function parseUscreenBody(body) {
  if (body === undefined || body === null || body === '') return {}
  if (typeof body === 'string') {
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new Error('Invalid JSON webhook body')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Webhook body must be a JSON object')
    }
    return parsed
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Webhook body must be an object')
  }
  return body
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    return res.status(204).end()
  }

  if (req.method === 'GET') {
    return json(res, 200, { status: 'healthy', service: 'uscreen-webhook', timestamp: new Date().toISOString() })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    return json(res, 405, { success: false, error: 'Method not allowed' })
  }
  if (!isValidUscreenWebhookSecret(req)) {
    return json(res, 401, { success: false, error: 'Unauthorized webhook' })
  }

  let data
  try {
    data = parseUscreenBody(req.body)
  } catch {
    return json(res, 400, { success: false, error: 'Invalid webhook JSON' })
  }
  const eventType = normalizeEventType(data.event || data.type || data.event_type)

  try {
    const result = await processUscreenPayload(data)
    console.info('Uscreen webhook accepted', {
      event: result.event,
      id: cleanValue(data.id, 80),
      offerId: result.offerId || toInt(data.offer_id ?? data.subscription_id) || null,
      processed: Boolean(result.processed),
      skipped: Boolean(result.skipped),
      reason: result.reason || null,
    })
    return json(res, 200, { status: 'accepted', event: result.event, processed: Boolean(result.processed), skipped: Boolean(result.skipped), reason: result.reason || undefined })
  } catch (error) {
    console.error('Uscreen webhook processing failed after receipt', {
      event: eventType,
      id: cleanValue(data.id, 80),
      offerId: toInt(data.offer_id ?? data.subscription_id) || null,
      error: error?.message || String(error),
    })
    return json(res, 200, { status: 'accepted', event: eventType, processed: false, queuedForReview: true })
  }
}
