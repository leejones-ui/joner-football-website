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
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200)
    const from = String(req.query?.from || new Date(Date.now() - 30 * 86400000).toISOString())
    const to = String(req.query?.to || new Date().toISOString())
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) return json(res, 400, { success: false, error: 'Invalid from/to range' })
    const [inventory, health, alerts, failures] = await Promise.all([
      readReliableRange({ from, to }), getHealth(), listAlerts(20), listWebhookFailures().catch(() => []),
    ])
    // Canonical records are joined only by the existing per-user key and invoice proof.
    const allSales = mergedSales([], inventory.sales)
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
      sale.amount = sale.payment_verification?.verified ? sale.payment_verification.amount : null
      sale.currency = sale.payment_verification?.verified ? sale.payment_verification.currency : null
      sale.payment_channel = sale.payment_verification?.verified ? sale.payment_verification.channel : 'unknown'
      sale.trial = sale.payment_verification?.verified ? sale.payment_verification.trial : null
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
      coverage: { ...inventory.coverage, display_limit: limit, returned_records: sales.length, totals_scope: 'All stored records in range, independently of display limit; revenue includes only verified invoices.', invoice_reads: invoiceReads },
      range_totals: rangeTotals,
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
