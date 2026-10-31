import crypto from 'node:crypto'
import { listReliableSales, reliablePaymentIdentity, reliabilityKv } from './_reliability-ledger.js'
import { getJourney } from './_attribution-ledger.js'

// Copies verified Uscreen payments into GA4 (app property) as purchase events
// via the Measurement Protocol. Uscreen payments stay the source of truth for
// buyers: this only reads the reliability ledger, never writes to it, and never
// touches the website's tracking tags. GA4 accepts events up to 72h old, so
// only recent rows are sent; each payment is claimed once in KV and GA4 also
// dedupes on transaction_id.

const GA4_APP_MEASUREMENT_ID = process.env.GA4_APP_MEASUREMENT_ID || 'G-H73LP37D8D'
const MP_URL = 'https://www.google-analytics.com/mp/collect'
const MAX_AGE_MS = 70 * 60 * 60 * 1000
const SENT_TTL = 90 * 24 * 60 * 60
const sentKey = (id) => `jfa:ga4:purchase-sent:${id}`

const param = (value, max = 100) => {
  const text = String(value ?? '').trim()
  return text && !['unknown', 'none', 'null', 'undefined'].includes(text.toLowerCase()) ? text.slice(0, max) : undefined
}

/** GA4 client ids look like "123456789.1700000000". When the buyer's own _ga id
 * wasn't captured, derive a stable one from the Uscreen user so the purchase
 * still counts (it just can't join that visitor's session). */
export function fallbackClientId(seed) {
  const digest = crypto.createHash('sha256').update(`jf-ga4:${seed}`).digest()
  return `${digest.readUInt32BE(0)}.${digest.readUInt32BE(4) % 2000000000}`
}

export function isGa4PurchaseCandidate(sale, now = Date.now()) {
  if (!sale || sale.kind !== 'payment' || sale.payment_status !== 'paid') return false
  if (!(Number(sale.amount) > 0) || !param(sale.currency, 10)) return false
  if (!reliablePaymentIdentity(sale)) return false
  const at = Date.parse(String(sale.occurred_at || ''))
  return Number.isFinite(at) && now - at <= MAX_AGE_MS && at <= now + 5 * 60 * 1000
}

export function buildGa4Purchase(sale, gaClientId) {
  const transactionId = reliablePaymentIdentity(sale)
  const at = Date.parse(String(sale.occurred_at))
  const value = Math.round(Number(sale.amount) * 100) / 100
  const currency = String(sale.currency).toUpperCase()
  const uscreenUser = param(sale.uscreen_user_id, 80)
  return {
    client_id: param(gaClientId, 120) || fallbackClientId(uscreenUser || sale.email_sha256 || transactionId),
    ...(uscreenUser ? { user_id: `uscreen:${uscreenUser}` } : {}),
    timestamp_micros: String(at * 1000),
    non_personalized_ads: true,
    events: [{
      name: 'purchase',
      params: Object.fromEntries(Object.entries({
        transaction_id: transactionId,
        value,
        currency,
        jf_acquisition: param(sale.acquisition),
        jf_source: param(sale.source),
        jf_medium: param(sale.medium),
        jf_campaign: param(sale.campaign),
        jf_billing_origin: param(sale.billing_origin),
        items: [{ item_id: param(sale.offer_id, 80) || 'membership', item_name: 'Joner Football membership', price: value, quantity: 1 }],
      }).filter(([, v]) => v !== undefined)),
    }],
  }
}

async function journeyClientId(journeyId, fetchImpl) {
  if (!journeyId) return undefined
  try {
    const journey = await getJourney(journeyId, fetchImpl)
    return journey?.last_touch?.ga_client_id || journey?.first_touch?.ga_client_id || undefined
  } catch { return undefined }
}

export async function sendRecentSalesToGa4({ limit = 25, fetchImpl = fetch, list = listReliableSales, kv = reliabilityKv, now = Date.now() } = {}) {
  const apiSecret = process.env.GA4_MP_API_SECRET
  if (!apiSecret) return { skipped: 'no-ga4-secret' }
  const sales = (await list(fetchImpl, 200)).filter((sale) => isGa4PurchaseCandidate(sale, now)).slice(0, limit)
  const summary = { candidates: sales.length, sent: 0, already: 0, failed: 0, joined_session: 0 }
  for (const sale of sales) {
    const id = reliablePaymentIdentity(sale)
    const claim = await kv(['SET', sentKey(id), new Date(now).toISOString(), 'NX', 'EX', String(SENT_TTL)], fetchImpl)
    if (claim?.result !== 'OK') { summary.already += 1; continue }
    const gaClientId = await journeyClientId(sale.journey_id, fetchImpl)
    const url = `${MP_URL}?measurement_id=${encodeURIComponent(GA4_APP_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(apiSecret)}`
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildGa4Purchase(sale, gaClientId)) })
      if (!response.ok) throw new Error(`GA4 MP ${response.status}`)
      summary.sent += 1
      if (gaClientId) summary.joined_session += 1
    } catch {
      summary.failed += 1
      await kv(['DEL', sentKey(id)], fetchImpl).catch(() => {})
    }
  }
  return summary
}
