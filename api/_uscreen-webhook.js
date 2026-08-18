import crypto from 'node:crypto'
import { extractAttribution, extractMetaIdentity } from './_attribution.js'
import { classifySource } from './_source-taxonomy.js'
import { enrichPayloadFromJourney, journeyStoreConfigured } from './_journey-ledger.js'
import { reconcilePayment } from './checkout-bridge.js'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Dedicated verified events are intentionally separate from Uscreen's noisy
// built-in Purchase stream. Meta custom conversions can count these exact
// server-side events without mixing them with duplicated browser events.
const META_PIXEL_ID = '232666285545279'
const META_EVENTS = {
  accountCreated: 'JF_Account_Created',
  trialStarted: 'JF_Trial_Started',
  firstPaidMembership: 'JF_First_Paid_Membership',
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
  const stableUserId = cleanValue(
    data.user_id || data.customer_id || data.customer?.id || data.user?.id,
    180,
  )
  if (stableUserId) userData.external_id = [sha256Hex(`uscreen:${stableUserId}`)]
  if (metaIdentity.fbc) userData.fbc = metaIdentity.fbc
  if (metaIdentity.fbp) userData.fbp = metaIdentity.fbp
  const value = Number.isFinite(Number(total)) ? Number(total) : undefined
  const rawCurrency = String(data.currency || data.localized_amounts?.currency || '').trim().toUpperCase()
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : undefined
  return {
    event_name: eventName,
    event_time: eventTime,
    event_id: stableEventKey(eventName, data, email),
    action_source: 'website',
    event_source_url: 'https://app.jonerfootball.com/checkout/success',
    user_data: userData,
    custom_data: {
      // Never invent a purchase currency. First-paid candidates are corrected
      // from the authoritative Uscreen invoice by the operator reconciliation
      // step before Meta is allowed to receive them.
      currency,
      value,
      subscription_plan: String(data.offer_title || data.subscription_title || data.title || '').slice(0, 120) || undefined,
      conversion_stage: eventName === META_EVENTS.firstPaidMembership ? 'first_paid_membership' : eventName === META_EVENTS.trialStarted ? 'trial' : 'account_created',
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      utm_content: attribution.utm_content,
      utm_term: attribution.utm_term,
      utm_id: attribution.utm_id,
      campaign_id: attribution.campaign_id,
      adset_id: attribution.adset_id,
      ad_id: attribution.ad_id,
      placement: attribution.placement,
      first_utm_source: attribution.first_utm_source,
      first_utm_medium: attribution.first_utm_medium,
      first_utm_campaign: attribution.first_utm_campaign,
      first_utm_content: attribution.first_utm_content,
      first_utm_term: attribution.first_utm_term,
      first_utm_id: attribution.first_utm_id,
      first_campaign_id: attribution.first_campaign_id,
      first_adset_id: attribution.first_adset_id,
      first_ad_id: attribution.first_ad_id,
      first_placement: attribution.first_placement,
    },
  }
}

async function sendMetaEventPayload(event, testEventCode) {
  const token = process.env.META_CAPI_TOKEN
  if (!token) return { skipped: 'no-capi-token' }
  if (!event) return { skipped: 'no-event' }
  const payload = { data: [event] }
  if (testEventCode) payload.test_event_code = cleanValue(testEventCode, 100)
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

async function sendVerifiedConversionToMeta(eventName, data, email, total) {
  const event = buildVerifiedMetaEvent(eventName, data, email, total)
  return sendMetaEventPayload(event, data.meta_test_event_code || data.test_event_code)
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
const ALL_PAID_HISTORY_LISTS = new Set([...ALL_ACTIVE_LISTS, ...ALL_CHURNED_LISTS])
const NON_WEB_PAYMENT_ORIGINS = new Set([
  'external_apple', 'external_google', 'apple', 'google_play',
  'ios', 'android', 'app_store', 'play_store',
])

export function classifyFirstPaidAcquisition({ eventType, offerId, total, transactionId, origin, contactSnapshot }) {
  if (eventType !== 'order.paid' || !TIER_BY_OFFER_ID[offerId] || !(Number(total) > 0)) {
    return { eligible: false, reason: 'not-positive-paid-order' }
  }
  const paymentOrigin = String(origin || '').trim().toLowerCase()
  if (NON_WEB_PAYMENT_ORIGINS.has(paymentOrigin)) {
    return { eligible: false, reason: 'non-web-payment-origin' }
  }
  // The reconciled web checkout currently produces Stripe charge IDs. This
  // deliberately fails closed for Apple/Google IAP and any unknown channel.
  if (!/^ch_[A-Za-z0-9_]+$/.test(String(transactionId || ''))) {
    return { eligible: false, reason: 'unreconciled-payment-channel' }
  }
  if (!contactSnapshot || contactSnapshot.status === 'error' || contactSnapshot.status === 'unavailable') {
    return { eligible: false, reason: 'paid-history-unavailable' }
  }
  const listIds = new Set((contactSnapshot.listIds || []).map(Number))
  if ([...listIds].some((id) => ALL_PAID_HISTORY_LISTS.has(id))) {
    return { eligible: false, reason: 'existing-member-payment' }
  }
  const attrs = contactSnapshot.attributes || {}
  if (attrs.JF_FIRST_PAID_TRANSACTION_ID || attrs.JF_FIRST_PAID_AT) {
    return { eligible: false, reason: 'existing-member-payment' }
  }
  if (listIds.has(LISTS.trialUsers)) {
    return { eligible: true, reason: 'trial-converted-first-paid' }
  }
  return { eligible: true, reason: 'first-paid-membership' }
}

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
    META_CAMPAIGN_ID: cleanValue(attribution.campaign_id, 180),
    META_ADSET_ID: cleanValue(attribution.adset_id, 180),
    META_AD_ID: cleanValue(attribution.ad_id, 180),
    UTM_PLACEMENT: cleanValue(attribution.placement, 120),
    FIRST_UTM_SOURCE: cleanValue(attribution.first_utm_source, 180),
    FIRST_UTM_MEDIUM: cleanValue(attribution.first_utm_medium, 180),
    FIRST_UTM_CAMPAIGN: cleanValue(attribution.first_utm_campaign, 180),
    FIRST_UTM_CONTENT: cleanValue(attribution.first_utm_content, 180),
    FIRST_UTM_TERM: cleanValue(attribution.first_utm_term, 180),
    FIRST_UTM_ID: cleanValue(attribution.first_utm_id, 180),
    FIRST_META_CAMPAIGN_ID: cleanValue(attribution.first_campaign_id, 180),
    FIRST_META_ADSET_ID: cleanValue(attribution.first_adset_id, 180),
    FIRST_META_AD_ID: cleanValue(attribution.first_ad_id, 180),
    FIRST_UTM_PLACEMENT: cleanValue(attribution.first_placement, 120),
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
    'META_CAMPAIGN_ID',
    'META_ADSET_ID',
    'META_AD_ID',
    'UTM_PLACEMENT',
    'META_FBC',
    'META_FBP',
    'JF_FIRST_PAID_AT',
    'JF_FIRST_PAID_TRANSACTION_ID',
    'JF_FIRST_PAID_EVENT_ID',
    'JF_FIRST_PAID_CANDIDATE_AT',
    'JF_FIRST_PAID_CANDIDATE_TRANSACTION_ID',
    'JF_FIRST_PAID_CANDIDATE_EVENT_ID',
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

async function brevoGetContactSnapshot(email) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey || !email) return { status: 'unavailable', attributes: {}, listIds: [] }
  try {
    const response = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
      headers: { accept: 'application/json', 'api-key': apiKey },
    })
    if (response.status === 404) return { status: 'not_found', attributes: {}, listIds: [] }
    if (!response.ok) throw new Error(`Brevo contact lookup failed: ${response.status}`)
    const body = await response.json()
    return {
      status: 'found',
      attributes: body?.attributes && typeof body.attributes === 'object' ? body.attributes : {},
      listIds: Array.isArray(body?.listIds) ? body.listIds.map(Number).filter(Number.isFinite) : [],
    }
  } catch (error) {
    console.error('Brevo paid-history lookup failed', error?.message || String(error))
    return { status: 'error', attributes: {}, listIds: [] }
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

function firstPaidStorageKey(data) {
  const customer = nestedObject(data, 'customer')
  const user = nestedObject(data, 'user')
  const userId = cleanValue(data.user_id || data.customer_id || customer.id || user.id, 180)
  if (!userId) return undefined
  return `jf:meta:first-paid:${sha256Hex(`uscreen:${userId}`)}`
}

function firstPaidEventId(data, email) {
  const key = firstPaidStorageKey(data, email)
  const identityHash = key?.split(':').at(-1)
  return identityHash ? `${META_EVENTS.firstPaidMembership}.${identityHash}` : undefined
}

function firstPaidUserId(data) {
  const customer = nestedObject(data, 'customer')
  const user = nestedObject(data, 'user')
  return cleanValue(data.user_id || data.customer_id || customer.id || user.id, 180)
}

async function getFirstPaidClaim(key) {
  const raw = await kvCommand(['GET', key])
  if (!raw) return undefined
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw }
  catch { return undefined }
}

async function claimFirstPaidEvent(data, email, event) {
  const eventId = event?.event_id
  const key = firstPaidStorageKey(data, email)
  if (!key || !eventId || !process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return { status: 'unavailable' }
  }
  const existing = await getFirstPaidClaim(key)
  if (existing) return { status: existing.status || 'pending', key, existing }
  const record = {
    eventId,
    status: 'pending',
    claimedAt: new Date().toISOString(),
    uscreenUserId: firstPaidUserId(data),
    uscreenOrderId: cleanValue(data.order_id || data.id, 180),
    webhookTransactionId: cleanValue(data.transaction_id, 180),
    offerId: toInt(data.offer_id ?? data.subscription_id),
    webhookTotal: toFloat(data.total),
    webhookCurrency: cleanValue(data.currency || data.localized_amounts?.currency, 10),
    webhookOrigin: cleanValue(data.origin, 120),
    metaEvent: event,
  }
  const result = await kvCommand(['SET', key, JSON.stringify(record), 'NX', 'EX', 10 * 365 * 24 * 60 * 60])
  if (result === 'OK') return { status: 'claimed', key, record }
  const raced = await getFirstPaidClaim(key)
  return { status: raced?.status || 'pending', key, existing: raced }
}

async function markFirstPaidCandidate(key, record) {
  await kvCommand(['SET', key, JSON.stringify({
    ...record,
    status: 'candidate',
    awaitingVerificationSince: new Date().toISOString(),
  }), 'EX', 10 * 365 * 24 * 60 * 60])
}

async function markFirstPaidEventSent(key, eventId) {
  const existing = await getFirstPaidClaim(key)
  const record = { ...existing, eventId, status: 'sent', sentAt: new Date().toISOString() }
  await kvCommand(['SET', key, JSON.stringify(record), 'EX', 10 * 365 * 24 * 60 * 60])
}

async function releaseFirstPaidClaim(key, eventId) {
  const existing = await getFirstPaidClaim(key)
  if (existing?.eventId === eventId && existing?.status !== 'sent') await kvCommand(['DEL', key])
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
    campaign_id: attribution.campaign_id,
    adset_id: attribution.adset_id,
    ad_id: attribution.ad_id,
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
    campaign_id: attributes.campaign_id || attributes.META_CAMPAIGN_ID || attributes.UTM_ID,
    adset_id: attributes.adset_id || attributes.META_ADSET_ID,
    ad_id: attributes.ad_id || attributes.META_AD_ID,
    placement: attributes.placement || attributes.UTM_PLACEMENT,
    first_utm_source: attributes.first_utm_source || attributes.FIRST_UTM_SOURCE,
    first_utm_medium: attributes.first_utm_medium || attributes.FIRST_UTM_MEDIUM,
    first_utm_campaign: attributes.first_utm_campaign || attributes.FIRST_UTM_CAMPAIGN,
    first_utm_content: attributes.first_utm_content || attributes.FIRST_UTM_CONTENT,
    first_utm_term: attributes.first_utm_term || attributes.FIRST_UTM_TERM,
    first_utm_id: attributes.first_utm_id || attributes.FIRST_UTM_ID,
    first_campaign_id: attributes.first_campaign_id || attributes.FIRST_META_CAMPAIGN_ID || attributes.FIRST_UTM_ID,
    first_adset_id: attributes.first_adset_id || attributes.FIRST_META_ADSET_ID,
    first_ad_id: attributes.first_ad_id || attributes.FIRST_META_AD_ID,
    first_placement: attributes.first_placement || attributes.FIRST_UTM_PLACEMENT,
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
  let contactSnapshot = { status: 'unavailable', attributes: {}, listIds: [] }

  if (!email) return { accepted: true, event: eventType, skipped: true, reason: 'missing-email' }
  if (!EMAIL_RE.test(email)) return { accepted: true, event: eventType, skipped: true, reason: 'invalid-email' }

  // Prefer the signed first-party journey ledger. It can resolve directly from
  // the checkout token, then later by Uscreen user id or the same email hash.
  eventData = await enrichPayloadFromJourney(data, email)

  // Resolve durable attribution before writing the sale. Paid and renewal
  // events often omit the fields present on account creation.
  const authoritativeSaleEvent = ['order.paid', 'subscription.renewed', 'recurring.payment.successful', 'payment.refunded', 'refund.created'].includes(eventType)
  if (authoritativeSaleEvent) {
    eventData = mergeStoredAttribution(eventData, await loadAttributionSnapshot(eventData, email))
    if (eventType === 'order.paid') {
      contactSnapshot = await brevoGetContactSnapshot(email)
      eventData = mergeStoredAttribution(eventData, contactSnapshot.attributes)
    }
  }

  let reconciliation
  let sale
  if (authoritativeSaleEvent) {
    try {
      reconciliation = await reconcilePayment({ ...eventData, email_hash: sha256Hex(email) })
    } catch {
      reconciliation = { classification: 'unknown', confidence: 'none', evidence: ['reconciliation_error'] }
    }
    const kind = eventType.includes('refund') ? 'refund' : (eventType.includes('renew') || eventType.includes('recurring')) ? 'renewal' : 'payment'
    const stablePaymentId = cleanValue(eventData.invoice_id || eventData.payment_id || transactionId || eventData.order_id, 180)
    const saleId = stablePaymentId ? `${kind}:${stablePaymentId}` : undefined
    if (saleId) {
      try {
        const { appendReliableSale } = await import('./_reliability-ledger.js')
        sale = await appendReliableSale({
        sale_id: saleId,
        kind,
        payment_status: kind === 'refund' ? 'refunded' : 'paid',
        provider_payment_id: stablePaymentId,
        invoice_id: cleanValue(eventData.invoice_id, 180),
        payment_id: cleanValue(eventData.payment_id || transactionId, 180),
        occurred_at: cleanValue(eventData.event_date || eventData.paid_at || eventData.created_at, 40) || new Date().toISOString(),
        offer_id: offerId,
        plan: cleanValue(eventData.offer_title || eventData.subscription_title || eventData.title, 180),
        amount: total,
        currency: cleanValue(eventData.currency || eventData.localized_amounts?.currency, 20),
        billing_origin: cleanValue(eventData.origin || eventData.payment_origin || eventData.provider, 80) || (eventType.includes('refund') ? 'refund' : (eventType.includes('renew') || eventType.includes('recurring')) ? 'renewal' : 'web'),
        uscreen_user_id: cleanValue(eventData.user_id || eventData.customer_id || eventData.user?.id || eventData.customer?.id, 120),
        customer_reference: sha256Hex(email)?.slice(0, 16),
        source_taxonomy: classifySource(eventData),
        acquisition: reconciliation.classification || 'unknown',
        confidence: reconciliation.confidence || 'none',
        evidence: reconciliation.evidence || ['no_safe_join'],
        source: reconciliation.source,
        medium: reconciliation.medium,
        campaign: reconciliation.campaign,
        adset: reconciliation.adset,
        ad: reconciliation.ad,
        placement: reconciliation.placement,
        landing_page: reconciliation.landing_page,
        journey_id: reconciliation.journey_id,
        })
      } catch (error) {
        // A durable sale record with an incomplete secondary index must still
        // fail the webhook so the provider retries and the dead-letter queue
        // records the incident. listReliableSales also self-heals the index.
        throw error
      }
    }
  }

  // Uscreen often includes attribution on User Created but omits it from the
  // later trial/paid Order Paid webhook. First-party KV is the durable join;
  // Brevo remains only a non-critical fallback and CRM mirror.
  if (eventType === 'order.paid') {
    eventData = mergeStoredAttribution(data, await loadAttributionSnapshot(data, email))
    contactSnapshot = await brevoGetContactSnapshot(email)
    eventData = mergeStoredAttribution(eventData, contactSnapshot.attributes)
  }
  let attributes = buildContactAttributes(eventData, eventType)

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
      // Every positive paid order still updates active/churn CRM truth. Only the
      // first reconciled web membership is allowed to become Meta's acquisition
      // optimisation signal.
      const tier = TIER_BY_OFFER_ID[offerId]
      listIds = [ACTIVE_LIST_BY_TIER[tier]].filter(Boolean)
      const firstPaid = classifyFirstPaidAcquisition({
        eventType, offerId, total, transactionId, origin: eventData.origin, contactSnapshot,
      })
      if (firstPaid.reason === 'paid-history-unavailable') {
        throw new Error('Cannot verify first-paid history; retry required')
      }
      if (firstPaid.eligible) {
        const eventId = firstPaidEventId(eventData, email)
        const metaEvent = buildVerifiedMetaEvent(META_EVENTS.firstPaidMembership, eventData, email, total)
        if (!eventId || !metaEvent) throw new Error('Stable first-paid identity unavailable')
        metaEvent.event_id = eventId
        const claim = await claimFirstPaidEvent(eventData, email, metaEvent)
        if (claim.status === 'unavailable') throw new Error('First-paid idempotency store unavailable')
        const sameEvent = !claim.existing?.eventId || claim.existing.eventId === eventId
        const candidateStates = new Set(['claimed', 'pending', 'candidate'])
        // Hard safety boundary: webhooks only create or preserve a candidate.
        // The canonical first-paid event can only be released by the manual
        // operator script after authoritative Uscreen payment-history review.
        if (sameEvent && candidateStates.has(claim.status)) {
          await markFirstPaidCandidate(claim.key, claim.record || claim.existing || {
            eventId,
            uscreenUserId: firstPaidUserId(eventData),
            uscreenOrderId: cleanValue(eventData.order_id || eventData.id, 180),
            webhookTransactionId: transactionId,
            offerId,
            webhookTotal: total,
            webhookCurrency: cleanValue(eventData.currency || eventData.localized_amounts?.currency, 10),
            webhookOrigin: cleanValue(eventData.origin, 120),
            metaEvent,
          })
          console.info('Uscreen->Meta first paid candidate awaiting verification', {
            eventId,
            uscreenUserId: firstPaidUserId(eventData),
            reason: firstPaid.reason,
          })
          attributes = {
            ...attributes,
            JF_FIRST_PAID_CANDIDATE_AT: cleanValue(eventData.event_date || eventData.created_at || new Date().toISOString(), 40),
            JF_FIRST_PAID_CANDIDATE_TRANSACTION_ID: cleanValue(transactionId, 180),
            JF_FIRST_PAID_CANDIDATE_EVENT_ID: cleanValue(eventId, 220),
          }
        }
      } else {
        console.info('Uscreen->Meta first paid skipped', { reason: firstPaid.reason, offerId })
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

  if (!listIds.length) return { accepted: true, event: eventType, skipped: true, reason, offerId, reconciliation, sale }

  const brevo = await brevoUpsertContact({ email, listIds, name, attributes, unlinkListIds })
  return { accepted: true, event: eventType, processed: true, offerId, brevo, reconciliation, sale }
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
    return json(res, 200, {
      status: 'healthy',
      service: 'uscreen-webhook',
      configured: {
        secureWebhook: Boolean(process.env.USCREEN_WEBHOOK_SECRET),
        attributionStore: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
        journeyLedger: journeyStoreConfigured(),
        metaCapi: Boolean(process.env.META_CAPI_TOKEN),
      },
      timestamp: new Date().toISOString(),
    })
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
    try {
      const { recordWebhookFailure } = await import('./_reliability-ledger.js')
      await recordWebhookFailure({
        event_id: cleanValue(data.id || data.event_id || data.transaction_id, 180) || `${eventType}:${crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 24)}`,
        payload: data,
        error: error?.message || String(error),
      })
    } catch (recordError) {
      console.error('Could not record webhook dead letter', recordError?.message || String(recordError))
    }
    console.error('Uscreen webhook processing failed after receipt', {
      event: eventType,
      id: cleanValue(data.id, 80),
      offerId: toInt(data.offer_id ?? data.subscription_id) || null,
      error: error?.message || String(error),
    })
    return json(res, 503, { status: 'retry', event: eventType, processed: false, retryRequired: true })
  }
}
