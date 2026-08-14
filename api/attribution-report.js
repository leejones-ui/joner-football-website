import { getJourney, listSales } from './_attribution-ledger.js'
import { getAnonymousAggregates, listReliableSales, reliablePaymentIdentity } from './_reliability-ledger.js'

function saleUserReference(sale) {
  return String(sale.uscreen_user_id || sale.customer_reference || '').trim().toLowerCase()
}
function saleTime(sale) {
  const value = Date.parse(sale.occurred_at || sale.paid_at || sale.timestamp || sale.created_at || '')
  return Number.isFinite(value) ? value : null
}
function samePaymentShape(a, b) {
  return saleUserReference(a) && saleUserReference(a) === saleUserReference(b)
    && String(a.kind || 'payment') === String(b.kind || 'payment')
    && String(a.plan || '').trim().toLowerCase() === String(b.plan || '').trim().toLowerCase()
    && Number(a.amount || 0) === Number(b.amount || 0)
}

export function mergedSales(legacy, reliable) {
  const byPayment = new Map()
  for (const sale of [...reliable, ...legacy]) {
    const key = reliablePaymentIdentity(sale)
    const existing = byPayment.get(key)
    byPayment.set(key, existing ? { ...existing, ...sale } : sale)
  }
  const rows = [...byPayment.values()].sort((a, b) => Number(String(b.sale_id || '').startsWith('reconcile:')) - Number(String(a.sale_id || '').startsWith('reconcile:')))
  const consumed = new Set()
  const deduped = []
  for (let index = 0; index < rows.length; index++) {
    if (consumed.has(index)) continue
    const sale = rows[index]
    if (!String(sale.sale_id || '').startsWith('reconcile:')) { deduped.push(sale); continue }
    const candidates = rows.map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate, candidateIndex }) => candidateIndex !== index && !String(candidate.sale_id || '').startsWith('reconcile:') && samePaymentShape(sale, candidate))
    const saleAt = saleTime(sale)
    const timeMatched = saleAt === null ? candidates : candidates.filter(({ candidate }) => {
      const candidateAt = saleTime(candidate)
      return candidateAt !== null && Math.abs(candidateAt - saleAt) <= 2 * 60 * 60 * 1000
    })
    if (timeMatched.length === 1) {
      const { candidate, candidateIndex } = timeMatched[0]
      consumed.add(candidateIndex)
      deduped.push({ ...sale, ...candidate, currency: candidate.currency || sale.currency })
    } else deduped.push(sale)
  }
  return deduped
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
    const [legacySales, reliableSales, aggregates] = await Promise.all([listSales(), listReliableSales(), getAnonymousAggregates()])
    const sales = mergedSales(legacySales, reliableSales)
    const rows = []
    for (const id of ids) {
      const journey = await getJourney(id)
      if (!journey) continue
      rows.push({ journey_id: journey.journey_id, first_touch: journey.first_touch, last_touch: journey.last_touch, checkout: journey.checkout, events: (journey.events || []).map(({ event_id, event_name, occurred_at, cta, offer_id }) => ({ event_id, event_name, occurred_at, cta, offer_id })) })
    }
    const totals = sales.reduce((acc, sale) => { const amount = Number(sale.amount || 0); if (sale.billing_origin === 'refund' || sale.kind === 'refund') acc.refunds += Math.abs(amount); else if (amount > 0) { acc.payments += amount; acc.orders += 1 }; return acc }, { orders: 0, payments: 0, refunds: 0 })
    return json(res, 200, {
      success: true,
      summary: { journeys: rows.length, events: rows.reduce((n, row) => n + row.events.length, 0), sales: sales.length, totals },
      rows,
      sales,
      longTerm: {
        period: 'All time',
        channelRanking: Object.entries(aggregates).map(([name, value]) => ({ name, sales: value.count || 0, revenue: value.revenue || 0 })),
      },
    })
  } catch { return json(res, 500, { success: false, error: 'Could not read attribution report' }) }
}
