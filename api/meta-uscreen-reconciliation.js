import { addPhaseTwoThree, buildDailySeries, buildReconciliation, config, fetchMetaDailyReport, fetchMetaReport, fetchReliableSales, fetchUscreenInvoices, previousWindow, resolveWindow, authorised } from './_meta-uscreen-reconciliation.js'

function json(res, status, body) {
  return res.status(status).json(body)
}

export default async function handler(req, res) {
  if (!authorised(req)) return json(res, 401, { success: false, error: 'Unauthorized' })
  if (req.method !== 'GET') return json(res, 405, { success: false, error: 'Method not allowed' })

  let window
  try {
    window = resolveWindow(req.query || {})
  } catch (error) {
    return json(res, 400, { success: false, error: error.message })
  }

  const started = Date.now()
  const sourceHealth = { meta: false, uscreen: false, kv: false }
  try {
    const settings = config()
    if (!settings.metaToken || !settings.uscreenKey || !settings.kvUrl || !settings.kvToken) {
      return json(res, 503, { success: false, error: 'Reconciliation source is not configured' })
    }
    const prior = previousWindow(window)
    const wantsDaily = String(req.query?.series || '') === 'daily'
    const [meta, invoices, sales, previousMeta, previousInvoices, metaDaily] = await Promise.all([
      fetchMetaReport(window),
      fetchUscreenInvoices(window),
      fetchReliableSales(),
      fetchMetaReport(prior),
      fetchUscreenInvoices(prior),
      wantsDaily ? fetchMetaDailyReport(window) : Promise.resolve(null),
    ])
    sourceHealth.meta = true
    sourceHealth.uscreen = true
    sourceHealth.kv = true
    const currentBase = buildReconciliation({ window, meta, invoices, sales, sourceHealth })
    const previousBase = buildReconciliation({ window: prior, meta: previousMeta, invoices: previousInvoices, sales, sourceHealth })
    const previousReport = addPhaseTwoThree({ report: previousBase, previousReport: null, meta: previousMeta, previousMeta: null, sourceHealth })
    const report = addPhaseTwoThree({ report: currentBase, previousReport, meta, previousMeta, sourceHealth })
    const daily = wantsDaily
      ? buildDailySeries({ window, metaDaily: metaDaily || [], invoices, sales })
      : undefined
    return json(res, 200, {
      success: true,
      ...report,
      ...(daily ? { daily } : {}),
      duration_ms: Date.now() - started,
    })
  } catch (error) {
    // Deliberately return no upstream response body: Meta/Uscreen/KV errors can
    // contain credential or private customer details. The cron gets a safe,
    // retryable status and a stable error category only.
    const message = String(error?.message || error)
    if (message === 'meta_not_configured') sourceHealth.meta = false
    if (message === 'uscreen_not_configured') sourceHealth.uscreen = false
    if (message === 'kv_not_configured') sourceHealth.kv = false
    return json(res, 503, {
      success: false,
      error: 'Reconciliation source unavailable',
      source_health: sourceHealth,
      period: window,
    })
  }
}
