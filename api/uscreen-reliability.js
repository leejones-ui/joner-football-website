import { listReliableSales, listWebhookFailures, replayWebhookFailure, reconcileAuthoritativePayments, getAnonymousAggregates } from './_reliability-ledger.js'
import { processUscreenPayload } from './_uscreen-webhook.js'

function json(res, status, body) { return res.status(status).json(body) }
function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function authorized(req) {
  const expected = process.env.USCREEN_RELIABILITY_TOKEN || process.env.OWNER_API_TOKEN
  return Boolean(expected && String(req.headers?.authorization || '') === `Bearer ${expected}`)
}

// Protected operator endpoint: inspect/replay dead letters or reconcile a
// batch exported from authoritative Uscreen payment history. Reconciliation
// is idempotent by payment_id and never bypasses the webhook Meta claim gate.
export default async function handler(req, res) {
  if (!authorized(req)) return json(res, 401, { success: false, error: 'Unauthorized' })
  try {
    if (req.method === 'GET') return json(res, 200, {
      success: true,
      sales: await listReliableSales(),
      failures: await listWebhookFailures(),
      aggregates: await getAnonymousAggregates(),
    })
    if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Method not allowed' })
    const body = parse(req)
    if (body.action === 'replay') {
      const result = await replayWebhookFailure(body.event_id, processUscreenPayload)
      return json(res, result.status === 'not_found' ? 404 : 200, { success: result.status !== 'not_found', result })
    }
    if (body.action === 'reconcile') {
      const payments = Array.isArray(body.payments) ? body.payments.slice(0, 500) : []
      return json(res, 200, { success: true, results: await reconcileAuthoritativePayments(payments) })
    }
    return json(res, 400, { success: false, error: 'Use action=replay or action=reconcile' })
  } catch (error) { return json(res, 500, { success: false, error: 'Reliability operation failed', detail: error?.message || String(error) }) }
}