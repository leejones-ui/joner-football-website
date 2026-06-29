const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

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
}

const TRIAL_ELIGIBLE_OFFER_IDS = new Set([183083, 189392, 183092, 189393])

const CHURNED_LIST_BY_OFFER_ID = {
  183083: LISTS.churnedMonthly,
  189392: LISTS.churnedMonthly,
  183092: LISTS.churnedAnnual,
  189393: LISTS.churnedAnnual,
  202578: LISTS.churnedCoaches,
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

function extractUtm(data, key) {
  const utm = nestedObject(data, 'utm_params')
  return data[key] || utm[key]
}

function buildContactAttributes(data, eventType) {
  const attrs = {
    FIRSTNAME: cleanValue(data.name || data.customer_name || data.customer_display_name || data.user_name, 180),
    USCREEN_USER_ID: cleanValue(data.user_id || data.id, 120),
    USCREEN_OFFER_ID: cleanValue(data.offer_id || data.subscription_id, 120),
    USCREEN_OFFER_TITLE: cleanValue(data.offer_title || data.subscription_title || data.title, 180),
    USCREEN_TRANSACTION_ID: cleanValue(data.transaction_id, 180),
    USCREEN_ORIGIN: cleanValue(data.origin, 120),
    USCREEN_CURRENCY: cleanValue(data.currency || data.localized_amounts?.currency, 20),
    USCREEN_TAGS: cleanValue(data.tags, 500),
    UTM_SOURCE: cleanValue(extractUtm(data, 'utm_source'), 180),
    UTM_MEDIUM: cleanValue(extractUtm(data, 'utm_medium'), 180),
    UTM_TERM: cleanValue(extractUtm(data, 'utm_term'), 180),
    UTM_CONTENT: cleanValue(extractUtm(data, 'utm_content'), 180),
    UTM_CAMPAIGN: cleanValue(extractUtm(data, 'utm_campaign'), 180),
    NEWS_OPT_IN: data.opted_in_for_news_and_updates,
    COMMUNITY_OPT_IN: data.opted_in_for_community_updates,
    LAST_USCREEN_EVENT: cleanValue(eventType, 80),
    LAST_USCREEN_EVENT_DATE: cleanValue(data.event_date || new Date().toISOString().slice(0, 10), 40),
  }
  return Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== undefined && value !== null && value !== ''))
}

function compactBrevoAttributes(attributes) {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => ['FIRSTNAME', 'LAST_USCREEN_EVENT', 'LAST_USCREEN_EVENT_DATE'].includes(key)),
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

export async function processUscreenPayload(data) {
  const eventType = normalizeEventType(data.event || data.type || data.event_type)
  const offerId = toInt(data.offer_id ?? data.subscription_id)
  const total = toFloat(data.total)
  const transactionId = cleanValue(data.transaction_id, 180)
  const email = extractEmail(data)
  const name = extractName(data)
  const attributes = buildContactAttributes(data, eventType)

  if (!email) return { accepted: true, event: eventType, skipped: true, reason: 'missing-email' }
  if (!EMAIL_RE.test(email)) return { accepted: true, event: eventType, skipped: true, reason: 'invalid-email' }

  let listIds = []
  let unlinkListIds = []
  let reason = ''

  if (eventType === 'user.created') {
    listIds = [LISTS.appUsersMega]
  } else if (eventType === 'subscription.assigned' || eventType === 'assigned.offer') {
    listIds = offerId ? (OWNERSHIP_LISTS_BY_OFFER_ID[offerId] || []) : []
    reason = listIds.length ? '' : 'subscription-assignment-no-ownership-list'
  } else if (eventType === 'subscription.canceled' || eventType === 'access.canceled') {
    if (!transactionId) {
      listIds = [LISTS.trialUsersChurned]
    } else {
      listIds = offerId ? [CHURNED_LIST_BY_OFFER_ID[offerId]].filter(Boolean) : []
      reason = listIds.length ? '' : 'no-churn-list-for-offer'
    }
    // They churned: pull them out of the active and trial lists so Brevo matches Uscreen.
    unlinkListIds = [LISTS.trialUsers, LISTS.monthlySubscribers, LISTS.annualSubscribers, LISTS.coachesPlanSubscribers]
  } else if (eventType === 'ownership.created') {
    listIds = offerId ? (OWNERSHIP_LISTS_BY_OFFER_ID[offerId] || []) : []
    reason = listIds.length ? '' : 'no-ownership-list-for-offer'
  } else if (eventType === 'order.paid') {
    if (offerId && OWNERSHIP_LISTS_BY_OFFER_ID[offerId] && total === 0) {
      listIds = OWNERSHIP_LISTS_BY_OFFER_ID[offerId]
    } else if (offerId && TRIAL_ELIGIBLE_OFFER_IDS.has(offerId) && total === 0) {
      listIds = [LISTS.trialUsers]
    } else if ((offerId === 183083 || offerId === 189392) && total !== undefined && total > 0) {
      listIds = [LISTS.monthlySubscribers]
    } else if ((offerId === 183092 || offerId === 189393) && total !== undefined && total > 0) {
      listIds = [LISTS.annualSubscribers]
    } else if (offerId === 202578 && total !== undefined && total > 0) {
      listIds = [LISTS.coachesPlanSubscribers]
    } else {
      reason = 'order-paid-no-list-rule'
    }
  } else if (eventType === 'invoice.overdue') {
    reason = 'invoice-overdue-logged-only'
  } else {
    reason = 'unhandled-event-type'
  }

  // A paid order means they are active again: pull them out of churned and trial lists.
  const PAID_ACTIVE_LISTS = [LISTS.monthlySubscribers, LISTS.annualSubscribers, LISTS.coachesPlanSubscribers]
  if (eventType === 'order.paid' && listIds.some((id) => PAID_ACTIVE_LISTS.includes(id))) {
    unlinkListIds = [LISTS.churnedMonthly, LISTS.churnedAnnual, LISTS.churnedCoaches, LISTS.trialUsersChurned, LISTS.trialUsers]
  }

  if (!listIds.length) return { accepted: true, event: eventType, skipped: true, reason, offerId }

  const brevo = await brevoUpsertContact({ email, listIds, name, attributes, unlinkListIds })
  return { accepted: true, event: eventType, processed: true, offerId, brevo }
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

  const data = req.body && typeof req.body === 'object' ? req.body : {}
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
