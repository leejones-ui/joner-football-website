import { createOrTouchJourney, journeyStoreConfigured, verifyJourneyToken } from './_journey-ledger.js'

const ACQUISITION_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'campaign_id',
  'adset_id', 'ad_id', 'fbclid', 'fbc', 'gclid', 'ttclid', 'msclkid',
]

function hasAcquisitionSignal(attribution = {}) {
  return ACQUISITION_KEYS.some((key) => String(attribution?.[key] || '').trim())
}

function json(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).json(payload)
}

function cors(req, res) {
  const origin = String(req.headers?.origin || '').trim()
  if (origin === 'https://app.jonerfootball.com') res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
}

export default async function handler(req, res) {
  cors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method === 'GET') {
    return json(res, 200, { status: 'healthy', configured: journeyStoreConfigured() })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    return json(res, 405, { success: false, error: 'Method not allowed' })
  }
  if (!journeyStoreConfigured()) return json(res, 503, { success: false, error: 'Journey ledger is not configured' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const attribution = body.attribution || body
    const existingToken = body.jf_journey_id || body.journey_token
    if (!verifyJourneyToken(existingToken) && !hasAcquisitionSignal(attribution)) {
      return json(res, 400, { success: false, error: 'Acquisition signal is required' })
    }
    const result = await createOrTouchJourney({
      token: existingToken,
      attribution,
      page_path: body.page_path,
      referrer: body.referrer,
    })
    return json(res, 200, { success: true, jf_journey_id: result.token })
  } catch (error) {
    console.error('Journey ledger request failed', error?.message || String(error))
    return json(res, 500, { success: false, error: 'Could not save journey' })
  }
}
