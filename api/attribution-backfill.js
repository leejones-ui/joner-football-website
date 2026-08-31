import { authorised } from './_meta-uscreen-reconciliation.js'
import { runCustomerUtmBackfill } from './_customer-utm-backfill.js'

export const config = { maxDuration: 120 }

export default async function handler(req, res) {
  if (!authorised(req)) return res.status(401).json({ success: false, error: 'Unauthorized' })
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body || '{}') } catch { return {} } })() : (req.body || {})
  const dryRun = body.dry_run !== false
  const offset = Math.max(0, Number(body.offset) || 0)
  const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 100)
  try {
    const summary = await runCustomerUtmBackfill({ dryRun, offset, limit })
    return res.status(200).json({ success: true, ...summary })
  } catch (error) {
    return res.status(503).json({ success: false, error: String(error?.message || error).slice(0, 120) })
  }
}
