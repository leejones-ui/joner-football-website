import crypto from 'node:crypto'

const PIXEL_ID = '232666285545279'
const META_GRAPH_VERSION = 'v21.0'
const META_EVENTS_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}/${PIXEL_ID}/events`
const ALLOWED_EVENTS = new Set([
  'PageView',
  'ViewContent',
  'Lead',
  'Purchase',
  'CompleteRegistration',
  'AddToCart',
  'InitiateCheckout',
  'app_checkout_click',
  'app_store_click',
  'camp_form_start',
  'camp_form_submit',
  'camp_signup_click',
  'club_pricing_click',
  'free_section_click',
  'google_play_click',
  'join_max_click',
  'join_plus_click',
  'join_starter_click',
  'lead_magnet_click',
  'team_subscription_interest',
  'WebsiteClickToCheckout',
  'WebsiteDeepScroll',
  'CoachesPageClickToCheckout',
  'CoachesPageDeepScroll',
])

function cleanString(value, max = 500) {
  return String(value || '').trim().slice(0, max)
}

function sha256(value) {
  const cleaned = cleanString(value, 500).toLowerCase()
  if (!cleaned) return undefined
  return crypto.createHash('sha256').update(cleaned).digest('hex')
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim())
}

function normalizeHashedField(value) {
  if (!value) return undefined
  if (Array.isArray(value)) {
    const hashed = value
      .map((item) => cleanString(item, 500).toLowerCase())
      .filter(Boolean)
      .map((item) => isSha256(item) ? item : sha256(item))
      .filter(Boolean)
    return hashed.length ? hashed : undefined
  }
  const cleaned = cleanString(value, 500).toLowerCase()
  if (!cleaned) return undefined
  return [isSha256(cleaned) ? cleaned : sha256(cleaned)]
}

function ipFromRequest(req) {
  const forwardedFor = req.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) return forwardedFor.split(',')[0].trim()
  if (Array.isArray(forwardedFor) && forwardedFor[0]) return forwardedFor[0].split(',')[0].trim()
  return req.socket?.remoteAddress || undefined
}

function safeObject(input, maxKeys = 40) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return Object.fromEntries(
    Object.entries(input)
      .slice(0, maxKeys)
      .map(([key, value]) => {
        if (value == null) return [cleanString(key, 80), value]
        if (typeof value === 'number' || typeof value === 'boolean') return [cleanString(key, 80), value]
        if (Array.isArray(value)) return [cleanString(key, 80), value.slice(0, 20).map((item) => cleanString(item, 200))]
        if (typeof value === 'object') return [cleanString(key, 80), safeObject(value, 20)]
        return [cleanString(key, 80), cleanString(value, 500)]
      })
      .filter(([key]) => key)
  )
}

function buildUserData(bodyUserData, req) {
  const userData = safeObject(bodyUserData)
  const email = userData.email || userData.em
  const phone = userData.phone || userData.ph

  delete userData.email
  delete userData.phone

  const normalized = {
    ...userData,
    em: normalizeHashedField(email),
    ph: normalizeHashedField(phone),
    client_ip_address: cleanString(userData.client_ip_address || ipFromRequest(req), 120),
    client_user_agent: cleanString(userData.client_user_agent || req.headers['user-agent'], 600),
  }

  Object.keys(normalized).forEach((key) => {
    if (normalized[key] === undefined || normalized[key] === '' || (Array.isArray(normalized[key]) && !normalized[key].length)) {
      delete normalized[key]
    }
  })

  return normalized
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const accessToken = process.env.META_CAPI_TOKEN
  if (!accessToken) {
    return res.status(500).json({ success: false, error: 'META_CAPI_TOKEN is not configured.' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const eventName = cleanString(body.event_name, 80)
    if (!eventName || !ALLOWED_EVENTS.has(eventName)) {
      return res.status(400).json({ success: false, error: 'Unsupported event_name.' })
    }

    const eventId = cleanString(body.event_id, 120) || crypto.randomUUID()
    const eventSourceUrl = cleanString(body.event_source_url || body.source_url || req.headers.referer, 1000)
    const userData = buildUserData(body.user_data, req)
    const customData = safeObject(body.custom_data)
    const eventTime = Math.floor(Date.now() / 1000)

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: eventTime,
          event_id: eventId,
          action_source: 'website',
          event_source_url: eventSourceUrl,
          user_data: userData,
          custom_data: customData,
        },
      ],
      access_token: accessToken,
    }

    if (body.test_event_code) payload.test_event_code = cleanString(body.test_event_code, 120)

    const metaResponse = await fetch(META_EVENTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const text = await metaResponse.text()
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch (error) { data = { raw: text } }

    if (!metaResponse.ok) {
      console.error('Meta CAPI error:', data)
      return res.status(metaResponse.status).json({ success: false, error: data?.error?.message || 'Meta CAPI request failed.' })
    }

    return res.status(200).json({ success: true, event_id: eventId, meta: data })
  } catch (error) {
    console.error('CAPI track-event failed:', error)
    return res.status(500).json({ success: false, error: 'Could not track event.' })
  }
}
