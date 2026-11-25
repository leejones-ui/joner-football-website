// GET /api/book-sales?from=YYYY-MM-DD&to=YYYY-MM-DD[&orders=1][&fresh=1]
// Book sales and where they came from, for the dashboard and the daily report.
// Read only. Bearer token (the same one as /api/meta-uscreen-reconciliation).
// Dates are Sydney days. Money is AUD cents. No customer details.
import { authorised } from './_meta-uscreen-reconciliation.js'
import { BOOKS, bookSalesData, bookSummary, resolveBookWindow } from './_book-sales.js'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!authorised(req)) return res.status(401).json({ success: false, error: 'Unauthorized' })
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  let window
  try {
    window = resolveBookWindow(req.query || {})
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message })
  }
  try {
    const data = await bookSalesData(window, { fresh: String(req.query?.fresh || '') === '1' })
    const body = {
      success: true,
      window,
      currency: 'AUD',
      books: BOOKS.map((b) => ({ key: b.key, name: b.name })),
      rule: 'A sale counts for ads when an ad was the first or the last visit before the order.',
      ...bookSummary(data.rows, window),
      sourceTracking: data.journey,
      ...(data.journey ? {} : { sourceTrackingError: data.journeyError }),
      complete: data.complete,
      updatedAt: data.at,
      cached: data.cached,
    }
    if (String(req.query?.orders || '') === '1') {
      body.orders = data.rows.filter((r) => !r.free).map(({ free, ...r }) => r)
    }
    return res.status(200).json(body)
  } catch (error) {
    console.error('book-sales failed', String(error?.message || error).slice(0, 200))
    const notConnected = error?.code === 'not_connected'
    return res.status(notConnected ? 503 : 502).json({ success: false, error: notConnected ? 'Shopify is not connected' : 'Could not read Shopify just now' })
  }
}
