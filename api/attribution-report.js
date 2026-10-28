import crypto from 'node:crypto'
import { readInvoiceTruth, verificationChecks, saleCategory, acquisitionCategory, aggregateVerifiedSales } from './_invoice-truth.js'
import { readReliableRange, reliabilityKv } from './_reliability-ledger.js'
import { getJourney } from './_attribution-ledger.js'
import { listWebhookFailures, reliablePaymentIdentity } from './_reliability-ledger.js'
import { getHealth, listAlerts } from './_attribution-health.js'

// The dashboard renders what this returns. Raw identifiers stay server-side:
// full email hashes are stripped to the 16-char reference and click ids are
// reduced to presence flags before anything leaves this endpoint.
export function presentSale(sale) {
  const { email_sha256, ...rest } = sale
  return {
    ...rest,
    customer_reference: sale.customer_reference || (email_sha256 ? String(email_sha256).slice(0, 16) : undefined),
    has_fbc: Boolean(sale.has_fbc || sale.fbc),
    has_fbp: Boolean(sale.has_fbp || sale.fbp),
    has_fbclid: Boolean(sale.has_fbclid || sale.fbclid),
    fbc: undefined,
    fbp: undefined,
    fbclid: undefined,
  }
}

export function mergedSales(legacy, reliable) {
  const byPayment = new Map()
  let unjoinableIndex = 0
  for (const rawSale of [...legacy, ...reliable]) {
    const sale = {
      ...rawSale,
      // Historical durable records predate payment_status. Their normalised
      // kind was emitted only by authoritative successful-payment handlers.
      payment_status: rawSale.kind === 'refund'
        ? 'refunded'
        : rawSale.payment_status || rawSale.paymentStatus || (['payment', 'renewal'].includes(rawSale.kind) ? 'paid' : undefined),
    }
    const identity = reliablePaymentIdentity(sale)
    // Missing authoritative payment IDs must remain separate and unattributed;
    // never collapse unrelated payments under one empty identity.
    const user = String(sale.uscreen_user_id || '')
    const key = identity && user ? `${user}:${identity}` : `unjoinable:${unjoinableIndex++}`
    const existing = byPayment.get(key)
    byPayment.set(key, existing ? { ...existing, ...sale } : sale)
  }
  return [...byPayment.values()]
    .sort((a, b) => String(b.occurred_at || b.paid_at || '').localeCompare(String(a.occurred_at || a.paid_at || '')))

}

function json(res, status, body) { return res.status(status).json(body) }

// Query params (dashboard contract, 28 Oct 2026):
//   limit  rows returned, 1-200 (default 50). Totals never depend on it.
//   days   whole days back from `to` (or now), 1-3660.
//   from / to  ISO dates or timestamps, interval [from,to). They win over days.
// Default range: the last 30 days.
export function reportLimit(value) {
  return Math.min(Math.max(Math.floor(Number(value)) || 50, 1), 200)
}
export function reportRange(query = {}, now = Date.now()) {
  const days = /^\d+$/.test(String(query.days ?? '').trim()) ? Math.min(Math.max(Number(query.days), 1), 3660) : undefined
  if (query.days !== undefined && query.days !== '' && days === undefined) return { error: 'Invalid days' }
  const rawFrom = query.from ? String(query.from) : undefined
  const rawTo = query.to ? String(query.to) : undefined
  const toMs = rawTo ? Date.parse(rawTo) : now
  const fromMs = rawFrom ? Date.parse(rawFrom) : toMs - (days || 30) * 86400000
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) return { error: 'Invalid from/to range' }
  return {
    from: rawFrom || new Date(fromMs).toISOString(),
    to: rawTo || new Date(toMs).toISOString(),
    days: rawFrom ? Math.round((toMs - fromMs) / 86400000 * 100) / 100 : (days || 30),
  }
}

const APP_STORE_ORIGINS = new Set(['apple', 'android', 'amazon', 'roku', 'external_apple', 'external_google', 'google_play', 'ios', 'app_store', 'play_store'])
const unknownAcquisition = (value) => ['unknown', 'none', 'null', ''].includes(String(value || '').toLowerCase())
export function isAppStoreSale(sale) {
  return sale.payment_channel === 'native_app' || sale.payment_verification?.channel === 'native_app'
    || APP_STORE_ORIGINS.has(String(sale.billing_origin || sale.payment_verification?.provider || '').toLowerCase())
}
// A new buyer is a positive, non-trial first payment (not a renewal or refund).
export function isNewBuyerSale(sale) {
  if (sale.kind !== 'payment' || sale.trial === true) return false
  if (sale.category && ['renewal', 'refund', 'trial', 'freebie', 'zero_value'].includes(sale.category)) return false
  const amount = Number(sale.payment_verification?.verified ? sale.payment_verification.amount : (sale.amount ?? sale.webhook_amount))
  return amount > 0
}
const buyerKey = (sale) => String(sale.uscreen_user_id || sale.customer_reference || (sale.email_sha256 ? String(sale.email_sha256).slice(0, 16) : '') || `sale:${sale.sale_id}`)

// Coverage over the whole requested range, deduped per buyer:
// new_buyers = tracked_buyers + untracked_buyers + app_store_buyers.
// App store buyers pay inside the iOS/Android app, so web attribution cannot
// see them; they are counted on their own and left out of the rate.
export function buyerCoverage(sales) {
  const buyers = new Map()
  for (const sale of sales) {
    if (!isNewBuyerSale(sale)) continue
    const key = buyerKey(sale)
    const prev = buyers.get(key) || { app: false, tracked: false }
    const app = prev.app || isAppStoreSale(sale)
    buyers.set(key, { app, tracked: prev.tracked || !unknownAcquisition(sale.acquisition) })
  }
  let tracked = 0, untracked = 0, appStore = 0
  for (const buyer of buyers.values()) {
    if (buyer.app) appStore++
    else if (buyer.tracked) tracked++
    else untracked++
  }
  const web = tracked + untracked
  return {
    new_buyers: buyers.size,
    tracked_buyers: tracked,
    untracked_buyers: untracked,
    app_store_buyers: appStore,
    tracked_rate: web ? Number((tracked / web).toFixed(3)) : null,
    tracked_rate_scope: 'tracked_buyers / (tracked_buyers + untracked_buyers); app store buyers excluded',
  }
}

// New buyers per acquisition channel and per specific source, whole range.
export function rangeAcquisitionTotals(sales) {
  const byAcquisition = {}, bySource = {}
  const seen = new Set()
  for (const sale of sales) {
    if (!isNewBuyerSale(sale)) continue
    const key = buyerKey(sale)
    if (seen.has(key)) continue
    seen.add(key)
    const acquisition = isAppStoreSale(sale) ? 'app_store' : (unknownAcquisition(sale.acquisition) ? 'unknown' : String(sale.acquisition).toLowerCase())
    byAcquisition[acquisition] = (byAcquisition[acquisition] || 0) + 1
    const source = String(sale.source_taxonomy && sale.source_taxonomy !== 'unknown' ? sale.source_taxonomy : (sale.source || acquisition)).toLowerCase().slice(0, 60)
    bySource[source] = (bySource[source] || 0) + 1
  }
  return { new_buyers: seen.size, new_buyers_by_acquisition: byAcquisition, new_buyers_by_source: bySource }
}
function authorized(req) {
  const expected = process.env.ATTRIBUTION_REPORT_TOKEN || process.env.OWNER_API_TOKEN
  const actual = String(req.headers?.authorization || '')
  return Boolean(expected && actual === `Bearer ${expected}`)
}

// Buyer display names for the owner dashboard. Names only, never emails or
// phones; fetched from Uscreen on demand and cached in KV so one report call
// does not hammer the API. Only served when the owner proxy asks for them.
async function attachBuyerNames(sales) {
  const apiKey = process.env.USCREEN_API_KEY
  if (!apiKey) return sales
  const kvUrl = process.env.KV_REST_API_URL
  const kvToken = process.env.KV_REST_API_TOKEN
  const kv = async (command) => {
    if (!kvUrl || !kvToken) return undefined
    const response = await fetch(kvUrl, { method: 'POST', headers: { authorization: `Bearer ${kvToken}`, 'content-type': 'application/json' }, body: JSON.stringify(command) })
    return response.ok ? (await response.json())?.result : undefined
  }
  const out = []
  for (const sale of sales) {
    const uid = String(sale.uscreen_user_id || '').trim()
    if (!uid) { out.push(sale); continue }
    let name
    try {
      name = await kv(['GET', `jfa:buyer-name:${uid}`])
      if (!name) {
        const response = await fetch(`https://www.uscreen.io/publisher_api/v1/customers/${encodeURIComponent(uid)}`, { headers: { Authorization: apiKey, Accept: 'application/json' } })
        if (response.ok) {
          const customer = await response.json()
          name = String(customer?.display_name || customer?.name || '').trim().slice(0, 80)
          // Report reads do not change the name cache.
        }
      }
    } catch { /* name is a nicety, never fatal */ }
    out.push(name ? { ...sale, buyer_name: name } : sale)
  }
  return out
}

export default async function handler(req, res) {
  if (!authorized(req)) return json(res, 401, { success: false, error: 'Unauthorized' })
  if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const ids = String(req.query?.journey_ids || '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 100)
    const limit = reportLimit(req.query?.limit)
    const range = reportRange(req.query)
    if (range.error) return json(res, 400, { success: false, error: range.error })
    const { from, to } = range
    const [inventory, health, alerts, failures] = await Promise.all([
      readReliableRange({ from, to }), getHealth(), listAlerts(20), listWebhookFailures().catch(() => []),
    ])
    // Canonical records are joined only by the existing per-user key and invoice proof.
    // The range scan returns KV order, not time order. Newest first, so the
    // display limit shows the most recent sales rather than an arbitrary slice.
    const allSales = mergedSales([], inventory.sales).sort((a, b) => (Date.parse(b.occurred_at || b.paid_at) || 0) - (Date.parse(a.occurred_at || a.paid_at) || 0))
    const invoiceCache = new Map(), canonicalCache = new Map()
    // Bounded live verification. Unverified historical rows remain visible, never silently valued.
    const candidates = allSales.filter(sale => /^\d+$/.test(String(sale.invoice_id || sale.order_id || ''))).slice(0, 5)
    const invoiceReads = candidates.length
    await Promise.all(candidates.map(async sale => {
      const uid = String(sale.uscreen_user_id || ''), invoiceId = String(sale.invoice_id || sale.order_id || '')
      const cacheKey = `${uid}:${invoiceId}:${sale.offer_id || ''}`
      invoiceCache.set(cacheKey, await readInvoiceTruth({ invoiceId, userId: uid, offerId: sale.offer_id }))
    }))
    const userIds = [...new Set(allSales.map(sale => String(sale.uscreen_user_id || '')).filter(Boolean))]
    for (let i = 0; i < userIds.length; i += 100) {
      const batch = userIds.slice(i, i + 100)
      const keys = batch.map(uid => `jf:meta:first-paid:${crypto.createHash('sha256').update(`uscreen:${uid}`).digest('hex')}`)
      const values = (await reliabilityKv(['MGET', ...keys]))?.result
      if (!Array.isArray(values) || values.length !== batch.length) throw new Error('Incomplete canonical batch')
      batch.forEach((uid, index) => { try { canonicalCache.set(uid, typeof values[index] === 'string' ? JSON.parse(values[index]) : values[index]) } catch { canonicalCache.set(uid, null) } })
    }
    for (const sale of allSales) {
      const uid = String(sale.uscreen_user_id || ''), invoiceId = String(sale.invoice_id || sale.order_id || '')
      const truth = invoiceCache.get(`${uid}:${invoiceId}:${sale.offer_id || ''}`)
      if (truth) sale.payment_verification = truth
      sale.proof_checks = verificationChecks(sale, canonicalCache.get(uid))
      sale.category = saleCategory(sale)
      sale.acquisition_category = acquisitionCategory(sale)
      sale.reported_amount = sale.amount
      sale.reported_currency = sale.currency
      // Verified invoices override the reported values. Unverified rows keep the
      // webhook-reported amount, currency and trial flag so the dashboard can
      // still show them; proof_checks and payment_verification carry the
      // verification state separately. (Lee, 2026-09-17: restore the sales page.)
      const verified = sale.payment_verification?.verified
      // Rows written between 12 and 17 Sep 2026 stored null amounts with the
      // webhook value in webhook_amount; read that back so no sale is blank.
      sale.amount = verified ? sale.payment_verification.amount : (sale.amount ?? sale.webhook_amount ?? sale.reported_amount)
      sale.currency = verified ? sale.payment_verification.currency : (sale.currency ?? sale.webhook_currency ?? sale.reported_currency)
      sale.payment_channel = verified ? sale.payment_verification.channel : (sale.billing_origin || 'unknown')
      sale.trial = verified ? sale.payment_verification.trial : (sale.trial ?? null)
      sale.amount_verified = Boolean(verified)
    }
    const rangeTotals = aggregateVerifiedSales(allSales, inventory.coverage.complete)
    let sales = allSales.slice(0, limit).map(presentSale)
    if (req.query?.include_names === '1') sales = await attachBuyerNames(sales)
    const rows = []
    for (const id of ids) {
      const journey = await getJourney(id)
      if (!journey) continue
      rows.push({ journey_id: journey.journey_id, first_touch: journey.first_touch, last_touch: journey.last_touch, checkout: journey.checkout, events: (journey.events || []).map(({ event_id, event_name, occurred_at, cta, offer_id }) => ({ event_id, event_name, occurred_at, cta, offer_id })) })
    }
    const totals = { orders: rangeTotals.paid_invoices, payments: null, refunds: null, revenue_by_currency: rangeTotals.revenue_by_currency }
    const unknown = sales.reduce((acc, sale) => {
      const amount = Number(sale.amount || 0)
      const acquisition = String(sale.acquisition || 'unknown').toLowerCase()
      if (sale.kind === 'refund' || !(amount > 0)) return acc
      if (['unknown', 'none', ''].includes(acquisition)) {
        acc.count += 1
        const currency = String(sale.currency || 'unknown').toUpperCase()
        acc.value[currency] = (acc.value[currency] || 0) + amount
      }
      return acc
    }, { count: 0, value: {} })
    return json(res, 200, {
      success: true,
      generated_at: new Date().toISOString(),
      coverage: { ...inventory.coverage, ...buyerCoverage(allSales), display_limit: limit, returned_records: sales.length, totals_scope: 'All stored records in range, independently of display limit; revenue includes only verified invoices.', invoice_reads: invoiceReads, range_days: range.days },
      range_totals: { ...rangeTotals, ...rangeAcquisitionTotals(allSales) },
      deployment: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        branch: process.env.VERCEL_GIT_COMMIT_REF || null,
        repo: process.env.VERCEL_GIT_REPO_SLUG || null,
      },
      summary: {
        journeys: rows.length,
        events: rows.reduce((n, row) => n + row.events.length, 0),
        sales: sales.length,
        totals,
        unknown,
        unknown_rate: totals.orders ? Number((unknown.count / totals.orders).toFixed(3)) : null,
      },
      health: {
        ...health,
        dead_letters: failures.length,
        alerts,
      },
      rows,
      sales,
      longTerm: { period: 'Legacy mixed-currency aggregates withheld', channelRanking: [] },
    })
  } catch { return json(res, 500, { success: false, error: 'Could not read attribution report' }) }
}
