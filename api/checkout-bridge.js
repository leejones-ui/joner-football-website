import { getJourney, normalizeJourneyId, sanitizeIdentity, sha256, classifyAttribution, getEmailJourneyCandidates, indexEmailJourney } from './_attribution-ledger.js'
import { getSignedJourney, verifyJourneyToken } from './_journey-ledger.js'

function json(res, status, body) { return res.status(status).json(body) }
function cors(req, res) { const origin = req.headers?.origin; if (origin === 'https://app.jonerfootball.com') res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'content-type') }
function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }

export async function reconcilePayment(payment) {
  const withTouch = (result, journey) => {
    const touch = journey?.last_touch || journey?.first_touch || {}
    return {
      ...result,
      journey_id: journey?.journey_id,
      source: touch.utm_source,
      medium: touch.utm_medium,
      campaign: touch.campaign_id || touch.campaign || touch.utm_campaign,
      adset: touch.adset_id || touch.adset,
      ad: touch.ad_id || touch.ad,
      placement: touch.placement,
      landing_page: touch.landing_url || touch.path,
      fbc: touch.fbc,
      fbp: touch.fbp,
      fbclid: touch.fbclid,
    }
  }
  const suppliedJourneyId = payment.journey_id || payment.jf_journey_id
  const signedJourneyId = verifyJourneyToken(suppliedJourneyId)
  if (signedJourneyId) {
    const journey = await getSignedJourney(suppliedJourneyId)
    if (journey) return { ...withTouch(classifyAttribution({ journey, payment: { ...payment, journey_id: suppliedJourneyId } }), journey), join_method: 'signed_journey_id' }
    return { classification: 'unknown', confidence: 'none', evidence: ['signed_journey_not_found'], join_method: 'signed_journey_id' }
  }
  // A malformed signed token must fail closed rather than falling through to
  // an email join that an attacker could use to misattribute a payment.
  if (suppliedJourneyId && String(suppliedJourneyId).includes('.')) {
    return { classification: 'unknown', confidence: 'none', evidence: ['invalid_signed_journey_id'], join_method: 'none' }
  }
  const journeyId = normalizeJourneyId(suppliedJourneyId)
  if (journeyId) {
    const journey = await getJourney(journeyId)
    if (journey) return { ...withTouch(classifyAttribution({ journey, payment }), journey), join_method: 'explicit_journey_id' }
  }
  const emailHash = payment.email_hash || sha256(payment.email)
  if (!emailHash) return { classification: 'unknown', confidence: 'none', evidence: ['no_email_or_journey'], join_method: 'none' }
  const indexed = await getEmailJourneyCandidates(emailHash)
  const candidates = []
  for (const item of indexed) {
    const journey = await getJourney(item.journey_id)
    if (journey?.email_hash === emailHash) candidates.push(journey)
  }
  if (candidates.length !== 1) return { classification: 'unknown', confidence: 'none', evidence: candidates.length ? ['ambiguous_hashed_email_candidates'] : ['no_safe_join'], join_method: 'hashed_email_time_bounded' }
  return { ...withTouch(classifyAttribution({ journey: candidates[0], payment: { ...payment, email_hash: emailHash } }), candidates[0]), join_method: 'hashed_email_time_bounded' }
}

export default async function handler(req, res) {
  cors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const body = parse(req)
    const journeyId = normalizeJourneyId(body.journey_id)
    if (!journeyId) return json(res, 400, { success: false, error: 'Valid journey_id is required' })
    const journey = await getJourney(journeyId)
    if (!journey) return json(res, 404, { success: false, error: 'Journey not found' })
    const identity = sanitizeIdentity({ ...body, journey_id: journeyId })
    if (identity.email_hash) {
      journey.email_hash = identity.email_hash
      journey.identity_source = identity.identity_source
      await indexEmailJourney(identity.email_hash, journeyId, new Date().toISOString())
    }
    const uscreenUserId = String(body.uscreen_user_id || body.user_id || '').trim().slice(0, 180)
    if (uscreenUserId) journey.uscreen_user_id = uscreenUserId
    journey.checkout = { ...(journey.checkout || {}), checkout_id: String(body.checkout_id || '').slice(0, 120) || undefined, bridged_at: new Date().toISOString() }
    const { upsertJourney } = await import('./_attribution-ledger.js')
    await upsertJourney(journey)
    return json(res, 200, { success: true, journey_id: journeyId })
  } catch { return json(res, 400, { success: false, error: 'Could not save checkout bridge' }) }
}
