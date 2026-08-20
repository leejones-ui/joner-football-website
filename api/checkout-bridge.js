import { getJourney, normalizeJourneyId, sanitizeIdentity, sha256, classifyAttribution, getEmailJourneyCandidates, indexEmailJourney } from './_attribution-ledger.js'
import { getJourneyByUscreenUserId, getSignedJourney, linkJourneyIdentity, verifyJourneyToken } from './_journey-ledger.js'

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
  const uscreenUserId = payment.user_id || payment.uscreen_user_id || payment.customer_id || payment.customer?.id || payment.user?.id
  if (uscreenUserId) {
    const journey = await getJourneyByUscreenUserId(uscreenUserId)
    if (journey) return { ...withTouch(classifyAttribution({ journey, payment: { ...payment, journey_id: journey.journey_id } }), journey), join_method: 'uscreen_user_id' }
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
  // Signed-ledger email candidates first (the head code links these), then the
  // legacy jfy ledger. Candidates under one email hash are the same person, so
  // when several exist the most recently updated journey wins (last touch).
  try {
    const { resolveJourneyByEmailHash, getSignedJourney: getSigned, createJourneyToken } = await import('./_journey-ledger.js')
    const resolution = await resolveJourneyByEmailHash(emailHash)
    if (resolution?.id) {
      const journey = await getSigned(createJourneyToken(resolution.id))
      if (journey) {
        return {
          ...withTouch(classifyAttribution({ journey, payment: { ...payment, email_hash: emailHash, journey_id: journey.journey_id } }), journey),
          join_method: resolution.join_method || 'hashed_email_signed',
        }
      }
    }
  } catch { /* fall through to the legacy ledger */ }
  const indexed = await getEmailJourneyCandidates(emailHash)
  const candidates = []
  for (const item of indexed) {
    const journey = await getJourney(item.journey_id)
    if (journey?.email_hash === emailHash) candidates.push(journey)
  }
  if (!candidates.length) return { classification: 'unknown', confidence: 'none', evidence: ['no_safe_join'], join_method: 'hashed_email_time_bounded' }
  candidates.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  return { ...withTouch(classifyAttribution({ journey: candidates[0], payment: { ...payment, email_hash: emailHash } }), candidates[0]), join_method: candidates.length > 1 ? 'hashed_email_latest' : 'hashed_email_time_bounded' }
}

// A checkout identity can arrive after the payment webhook already classified
// the sale unknown. Re-run the join for recent unknown sales that reference
// this email hash so a late identity still attributes the payment. Bounded and
// non-fatal: the bridge response never waits on perfection here.
export async function retriggerUnknownSalesForEmail(emailHash) {
  if (!emailHash) return { checked: 0, reclassified: 0 }
  const out = { checked: 0, reclassified: 0 }
  try {
    const { listReliableSales, appendReliableSale } = await import('./_reliability-ledger.js')
    const sales = await listReliableSales(fetch, 100)
    const prefix = String(emailHash).slice(0, 16)
    for (const sale of sales) {
      if (out.checked >= 10) break
      const acquisition = String(sale.acquisition || '').toLowerCase()
      if (acquisition && !['unknown', 'none'].includes(acquisition)) continue
      if (sale.kind === 'refund') continue
      const matches = sale.email_sha256 === emailHash || (!sale.email_sha256 && sale.customer_reference === prefix)
      if (!matches) continue
      const occurred = Date.parse(sale.occurred_at || '') || 0
      if (!occurred || Date.now() - occurred > 7 * 24 * 60 * 60 * 1000) continue
      out.checked += 1
      const reconciliation = await reconcilePayment({
        user_id: sale.uscreen_user_id,
        email_hash: emailHash,
        event_date: sale.occurred_at,
      })
      const classification = String(reconciliation?.classification || '').toLowerCase()
      if (!classification || ['unknown', 'none'].includes(classification)) continue
      await appendReliableSale({
        ...sale,
        email_sha256: sale.email_sha256 || emailHash,
        acquisition: reconciliation.classification,
        confidence: reconciliation.confidence,
        evidence: [...(reconciliation.evidence || []), 'late_identity_retrigger'],
        source: reconciliation.source,
        medium: reconciliation.medium,
        campaign: reconciliation.campaign,
        adset: reconciliation.adset,
        ad: reconciliation.ad,
        placement: reconciliation.placement,
        landing_page: reconciliation.landing_page,
        journey_id: reconciliation.journey_id,
        join_method: reconciliation.join_method,
        last_reconciled_at: new Date().toISOString(),
      })
      out.reclassified += 1
    }
  } catch { /* non-fatal */ }
  return out
}

export default async function handler(req, res) {
  cors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const body = parse(req)
    const suppliedToken = body.jf_journey_id || body.journey_id
    if (verifyJourneyToken(suppliedToken)) {
      const journey = await getSignedJourney(suppliedToken)
      if (!journey) return json(res, 404, { success: false, error: 'Journey not found' })
      const linked = await linkJourneyIdentity(suppliedToken, {
        email: body.email,
        uscreenUserId: body.uscreen_user_id || body.user_id,
        // Click identity the head code observed on the checkout page (fbc/fbp
        // set by the pixel on the app domain). Gap-fill only, never overwrite.
        clickIdentity: body.attribution && typeof body.attribution === 'object' ? body.attribution : undefined,
      })
      if (body.email) {
        const emailHash = sha256(String(body.email).trim().toLowerCase())
        await retriggerUnknownSalesForEmail(emailHash)
      }
      return json(res, 200, { success: true, journey_id: suppliedToken, linked: linked.linked })
    }
    const journeyId = normalizeJourneyId(body.journey_id)
    if (!journeyId) return json(res, 400, { success: false, error: 'Valid journey_id is required' })
    const journey = await getJourney(journeyId)
    if (!journey) return json(res, 404, { success: false, error: 'Journey not found' })
    const identity = sanitizeIdentity({ ...body, journey_id: journeyId })
    if (identity.email_hash) {
      journey.email_hash = identity.email_hash
      journey.identity_source = identity.identity_source
      await indexEmailJourney(identity.email_hash, journeyId, new Date().toISOString())
      await retriggerUnknownSalesForEmail(identity.email_hash)
    }
    const uscreenUserId = String(body.uscreen_user_id || body.user_id || '').trim().slice(0, 180)
    if (uscreenUserId) journey.uscreen_user_id = uscreenUserId
    journey.checkout = { ...(journey.checkout || {}), checkout_id: String(body.checkout_id || '').slice(0, 120) || undefined, bridged_at: new Date().toISOString() }
    const { upsertJourney } = await import('./_attribution-ledger.js')
    await upsertJourney(journey)
    return json(res, 200, { success: true, journey_id: journeyId })
  } catch { return json(res, 400, { success: false, error: 'Could not save checkout bridge' }) }
}
