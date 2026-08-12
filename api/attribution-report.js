import { getJourney, listSales } from './_attribution-ledger.js'

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
    const sales = await listSales()
    const rows = []
    for (const id of ids) {
      const journey = await getJourney(id)
      if (!journey) continue
      rows.push({ journey_id: journey.journey_id, first_touch: journey.first_touch, last_touch: journey.last_touch, checkout: journey.checkout, events: (journey.events || []).map(({ event_id, event_name, occurred_at, cta, offer_id }) => ({ event_id, event_name, occurred_at, cta, offer_id })) })
    }
    const totals = sales.reduce((acc, sale) => { const amount = Number(sale.amount || 0); if (sale.billing_origin === 'refund' || sale.kind === 'refund') acc.refunds += Math.abs(amount); else if (amount > 0) { acc.payments += amount; acc.orders += 1 }; return acc }, { orders: 0, payments: 0, refunds: 0 })
    return json(res, 200, { success: true, summary: { journeys: rows.length, events: rows.reduce((n, row) => n + row.events.length, 0), sales: sales.length, totals }, rows, sales })
  } catch { return json(res, 500, { success: false, error: 'Could not read attribution report' }) }
}
