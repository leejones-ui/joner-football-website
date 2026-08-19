import { getJourney, listSales } from './_attribution-ledger.js'
import { getAnonymousAggregates, listReliableSales, listWebhookFailures, reliablePaymentIdentity } from './_reliability-ledger.js'
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
    const key = identity || `unjoinable:${unjoinableIndex++}`
    const existing = byPayment.get(key)
    byPayment.set(key, existing ? { ...existing, ...sale } : sale)
  }
  return [...byPayment.values()]
    .sort((a, b) => String(b.occurred_at || b.paid_at || '').localeCompare(String(a.occurred_at || a.paid_at || '')))
    .slice(0, 50)
}

function json(res, status, body) { return res.status(status).json(body) }
function authorized(req) {
  const expected = process.env.ATTRIBUTION_REPORT_TOKEN || process.env.OWNER_API_TOKEN
  const actual = String(req.headers?.authorization || '')
  return Boolean(expected && actual === `Bearer ${expected}`)
}

export default async function handler(req, res) {
  if (!authorized(req)) return json(res, 401, { success: false, error: 'Unauthorized' })
  if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const ids = String(req.query?.journey_ids || '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 100)
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200)
    const [legacySales, reliableSales, aggregates, health, alerts, failures] = await Promise.all([
      listSales(), listReliableSales(fetch, limit), getAnonymousAggregates(), getHealth(), listAlerts(20), listWebhookFailures().catch(() => []),
    ])
    const sales = mergedSales(legacySales, reliableSales).map(presentSale)
    const rows = []
    for (const id of ids) {
      const journey = await getJourney(id)
      if (!journey) continue
      rows.push({ journey_id: journey.journey_id, first_touch: journey.first_touch, last_touch: journey.last_touch, checkout: journey.checkout, events: (journey.events || []).map(({ event_id, event_name, occurred_at, cta, offer_id }) => ({ event_id, event_name, occurred_at, cta, offer_id })) })
    }
    const totals = sales.reduce((acc, sale) => { const amount = Number(sale.amount || 0); if (sale.billing_origin === 'refund' || sale.kind === 'refund') acc.refunds += Math.abs(amount); else if (amount > 0) { acc.payments += amount; acc.orders += 1 }; return acc }, { orders: 0, payments: 0, refunds: 0 })
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
      longTerm: {
        period: 'All time',
        channelRanking: Object.entries(aggregates).map(([name, value]) => ({ name, sales: value.count || 0, revenue: value.revenue || 0 })),
      },
    })
  } catch { return json(res, 500, { success: false, error: 'Could not read attribution report' }) }
}
