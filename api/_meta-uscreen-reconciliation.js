const META_GRAPH_VERSION = 'v21.0'
const META_DEFAULT_ACCOUNT = 'act_601203457715082'
const USCREEN_API_BASE = 'https://www.uscreen.io/publisher_api/v1'
// Uscreen silently caps per_page at 30 regardless of the value sent, so a
// low page cap quietly truncates history and makes older windows under-report.
// 90 pages covers roughly 60 days at current volume.
const USCREEN_PER_PAGE = 30
const MAX_INVOICE_PAGES = 90
// Uscreen rate-limits (HTTP 429) well before this many parallel reads, and a
// throttled page must never be mistaken for the end of the data.
const INVOICE_PAGE_CONCURRENCY = 3
const INVOICE_PAGE_RETRIES = 3
const MAX_SALES = 400
const META_PURCHASE_ACTIONS = new Set([
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'omni_purchase',
])

const text = (value) => value === undefined || value === null ? '' : String(value).trim()
const number = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

export function defaultWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

export function resolveWindow(query = {}, now = new Date()) {
  const fallback = defaultWindow(now)
  const from = text(query.from) || fallback.from
  const to = text(query.to) || fallback.to
  if (!validDate(from) || !validDate(to) || from > to) throw new Error('Use a valid from/to date window')
  const span = (Date.parse(`${to}T23:59:59Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  if (span > 31) throw new Error('Date window cannot exceed 31 days')
  return { from, to, timezone: 'UTC' }
}

// Meta reports the same purchase under several alias action_types
// (purchase, offsite_conversion.fb_pixel_purchase, omni_purchase). Summing
// aliases triple-counts, so take the first alias present in priority order.
const META_PURCHASE_ACTION_PRIORITY = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase']

function extractDedupedAction(rows, priority) {
  const list = Array.isArray(rows) ? rows : []
  for (const name of priority) {
    const row = list.find((action) => text(action?.action_type) === name)
    const value = row === undefined ? undefined : number(row?.value)
    if (value !== undefined) return value
  }
  return 0
}

export function extractActionCount(actions = [], priority = META_PURCHASE_ACTION_PRIORITY) {
  return extractDedupedAction(actions, priority)
}

export function extractActionValue(actionValues = [], priority = META_PURCHASE_ACTION_PRIORITY) {
  return extractDedupedAction(actionValues, priority)
}

export const FB20_COUPON = 'FB20'

function invoiceCoupon(invoice) {
  return text(invoice?.coupon).toUpperCase()
}

export function invoiceInWindow(invoice, window) {
  const paidAt = Number(invoice?.paid_at)
  if (!Number.isFinite(paidAt) || paidAt <= 0) return false
  const date = new Date(paidAt * 1000).toISOString().slice(0, 10)
  return date >= window.from && date <= window.to
}

export function isPositivePaidInvoice(invoice) {
  return text(invoice?.status).toLowerCase() === 'paid' && (number(invoice?.amount) || 0) > 0
}

export function isTrialInvoice(invoice) {
  return invoice?.trial === true || (text(invoice?.status).toLowerCase() === 'paid' && (number(invoice?.amount) || 0) === 0)
}

export function isMetaSale(sale) {
  const acquisition = text(sale?.acquisition || sale?.channel).toLowerCase()
  return ['meta', 'facebook', 'instagram', 'exact_paid_meta'].includes(acquisition) || Boolean(sale?.has_fbc || sale?.has_fbclid || sale?.fbc || sale?.fbclid) && acquisition !== 'unknown'
}

export function buildReconciliation({ window, meta, invoices, sales, sourceHealth, generatedAt = new Date().toISOString() }) {
  const paidInvoices = (Array.isArray(invoices) ? invoices : []).filter((invoice) => invoiceInWindow(invoice, window) && isPositivePaidInvoice(invoice))
  const trialInvoices = (Array.isArray(invoices) ? invoices : []).filter((invoice) => invoiceInWindow(invoice, window) && isTrialInvoice(invoice))
  const paidUsers = new Set(paidInvoices.map((invoice) => text(invoice.user_id)).filter(Boolean))
  const trialUsers = new Set(trialInvoices.map((invoice) => text(invoice.user_id)).filter(Boolean))
  const salesByUser = new Map()
  for (const sale of Array.isArray(sales) ? sales : []) {
    const userId = text(sale?.uscreen_user_id)
    if (!userId || !isMetaSale(sale)) continue
    const existing = salesByUser.get(userId)
    if (!existing || text(sale.occurred_at) > text(existing.occurred_at)) salesByUser.set(userId, sale)
  }
  const confirmedUsers = [...paidUsers].filter((userId) => salesByUser.has(userId))
  const confirmedTrials = [...trialUsers].filter((userId) => salesByUser.has(userId))
  const metaReportedPurchases = Math.round(number(meta?.purchases) || 0)
  const confirmedUscreenBuyers = confirmedUsers.length
  const unknownSales = Math.max(paidUsers.size - confirmedUscreenBuyers, 0)
  const unmatchedMetaPurchases = Math.max(metaReportedPurchases - confirmedUscreenBuyers, 0)
  const matchRate = metaReportedPurchases > 0 ? Number((confirmedUscreenBuyers / metaReportedPurchases).toFixed(3)) : null
  const metaRevenue = number(meta?.purchase_value)
  const uscreenRevenue = paidInvoices.reduce((sum, invoice) => sum + ((number(invoice.amount) || 0) / 100), 0)
  const fb20Invoices = paidInvoices.filter((invoice) => invoiceCoupon(invoice) === FB20_COUPON)
  const fb20Revenue = fb20Invoices.reduce((sum, invoice) => sum + ((number(invoice.amount) || 0) / 100), 0)
  const confirmedUserSet = new Set(confirmedUsers)
  const confirmedRevenue = paidInvoices.reduce((sum, invoice) => {
    if (!confirmedUserSet.has(text(invoice.user_id))) return sum
    return sum + ((number(invoice.amount) || 0) / 100)
  }, 0)
  const historyComplete = !(Array.isArray(invoices) && invoices.truncated)
  const verdict = sourceHealth?.meta && sourceHealth?.uscreen && sourceHealth?.kv
    ? (unmatchedMetaPurchases > 0 || unknownSales > 0 || !historyComplete ? 'AMBER' : 'GREEN')
    : 'RED'
  const verdictReason = verdict === 'GREEN'
    ? 'Required sources fresh; Meta purchases reconcile to Uscreen buyers.'
    : verdict === 'AMBER'
      ? 'Required sources available, but some purchases or Uscreen buyers are not joined.'
      : 'A required reconciliation source is unavailable.'
  return {
    schema_version: 1,
    generated_at: generatedAt,
    period: window,
    source_health: sourceHealth,
    meta_reported_purchases: metaReportedPurchases,
    meta_reported_purchase_value: metaRevenue === undefined ? null : Number(metaRevenue.toFixed(2)),
    confirmed_uscreen_buyers: confirmedUscreenBuyers,
    confirmed_meta_buyers: confirmedUscreenBuyers,
    uscreen_paid_signups: paidUsers.size,
    uscreen_trials: trialUsers.size,
    meta_attributed_trials: confirmedTrials.length,
    unknown_sales: unknownSales,
    unmatched_meta_purchases: unmatchedMetaPurchases,
    pending_recent_conversions: 0,
    match_rate: matchRate,
    uscreen_paid_value: Number(uscreenRevenue.toFixed(2)),
    invoice_history_complete: !(Array.isArray(invoices) && invoices.truncated),
    confirmed_buyer_revenue: Number(confirmedRevenue.toFixed(2)),
    fb20_redemptions: fb20Invoices.length,
    fb20_revenue: Number(fb20Revenue.toFixed(2)),
    verdict,
    verdict_reason: verdictReason,
    definitions: {
      confirmed_meta_buyer: 'Unique Uscreen user with a positive paid invoice in the window and a Meta-classified sale ledger row.',
      match_rate: 'confirmed_meta_buyers divided by Meta-reported purchases; null when Meta reports zero purchases.',
      unknown_sales: 'Unique paid Uscreen users in the window without a Meta-classified sale ledger row.',
      pending_recent_conversions: 'Reserved for a future payment-delay window; zero in this exact-window implementation.',
      confirmed_buyer_revenue: 'Paid Uscreen invoice value in the window from confirmed Meta buyers only. The only revenue figure allowed into confirmed ROAS.',
      meta_purchase_dedup: 'Meta purchase count uses one action type only (omni_purchase preferred); alias action types are never summed.',
      fb20_redemptions: 'Paid invoices in the window carrying the Meta-ads-only attribution coupon. Hard proof of an ad-driven WEB CHECKOUT sale; native app-store billing cannot take web coupons.',
      invoice_history_complete: 'False when the Uscreen invoice fetch could not page back to the window start. Every Uscreen count is then a floor, not a total, and must not be compared against other windows.',
    },
  }
}

function delta(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null
  return Number((Number(current) - Number(previous)).toFixed(3))
}

export function previousWindow(window) {
  const start = Date.parse(`${window.from}T00:00:00Z`)
  const end = Date.parse(`${window.to}T23:59:59Z`)
  const span = end - start
  const previousEnd = new Date(start - 1)
  const previousStart = new Date(start - span - 1)
  return { from: previousStart.toISOString().slice(0, 10), to: previousEnd.toISOString().slice(0, 10), timezone: window.timezone }
}

export function addPhaseTwoThree({ report, previousReport, meta, previousMeta, sourceHealth, generatedAt = new Date().toISOString() }) {
  const spend = number(meta?.spend) || 0
  const confirmed = report.confirmed_meta_buyers || 0
  // Confirmed commercials may only ever be computed from confirmed-buyer
  // revenue. Whole-window Uscreen revenue is reported separately as context
  // and must never inflate ROAS (AMBER contract).
  const revenue = number(report.confirmed_buyer_revenue) || 0
  const cac = confirmed > 0 && spend > 0 ? Number((spend / confirmed).toFixed(2)) : null
  const roas = spend > 0 && confirmed > 0 ? Number((revenue / spend).toFixed(4)) : null
  const metrics = {
    spend: Number(spend.toFixed(2)),
    spend_currency: text(meta?.currency).toUpperCase() || null,
    confirmed_revenue: Number(revenue.toFixed(2)),
    confirmed_revenue_currency: text(report.uscreen_currency).toUpperCase() || 'USD',
    uscreen_window_revenue: number(report.uscreen_paid_value) ?? null,
    confirmed_cac: cac,
    confirmed_roas: roas,
  }
  const comparisonFields = ['meta_reported_purchases', 'confirmed_meta_buyers', 'uscreen_paid_signups', 'uscreen_trials', 'unknown_sales', 'match_rate']
  const comparison = { current: {}, previous: {}, delta: {} }
  for (const field of comparisonFields) {
    comparison.current[field] = report[field] ?? null
    comparison.previous[field] = previousReport?.[field] ?? null
    comparison.delta[field] = delta(comparison.current[field], comparison.previous[field])
  }
  comparison.current.confirmed_cac = cac
  comparison.previous.confirmed_cac = previousReport?.commercial?.confirmed_cac ?? null
  comparison.delta.confirmed_cac = delta(comparison.current.confirmed_cac, comparison.previous.confirmed_cac)
  const alerts = []
  if (!sourceHealth.meta || !sourceHealth.uscreen || !sourceHealth.kv) alerts.push({ severity: 'RED', code: 'SOURCE_UNAVAILABLE', message: 'A required reconciliation source is unavailable.' })
  if (report.invoice_history_complete === false) alerts.push({ severity: 'RED', code: 'INVOICE_HISTORY_TRUNCATED', message: 'Uscreen invoice history did not reach the window start. Uscreen counts are a floor, not a total; do not compare this window against another.' })
  if (report.unmatched_meta_purchases > 0) alerts.push({ severity: 'AMBER', code: 'META_PURCHASES_UNMATCHED', count: report.unmatched_meta_purchases, message: 'Meta-reported purchases do not yet have verified Uscreen buyer matches.' })
  if (report.unknown_sales > 0) alerts.push({ severity: 'AMBER', code: 'USCREEN_SALES_UNATTRIBUTED', count: report.unknown_sales, message: 'Positive Uscreen buyers have no Meta-classified ledger match.' })
  if (report.uscreen_paid_signups > 0 && report.confirmed_meta_buyers === 0) alerts.push({ severity: 'AMBER', code: 'ZERO_CONFIRMED_META_BUYERS', message: 'Uscreen paid activity exists but no Meta-attributed buyer is verified.' })
  if (spend > 0 && confirmed === 0) alerts.push({ severity: 'AMBER', code: 'NO_CONFIRMED_CAC', message: 'Spend is present but confirmed CAC cannot be calculated until a buyer is verified.' })
  return {
    ...report,
    schema_version: 2,
    generated_at: generatedAt,
    commercial: metrics,
    comparison,
    alerts,
    freshness: {
      requested_period: report.period,
      generated_at: generatedAt,
      sources_queried: sourceHealth,
      interpretation: 'Source availability is verified for this request; upstream event/payment latency remains possible.',
    },
    phase_status: { phase_1: 'complete', phase_2: 'complete', phase_3: 'complete' },
  }
}

function config() {
  const metaToken = process.env.META_CAPI_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN || process.env.FACEBOOK_API_KEY || process.env.META_ACCESS_TOKEN
  const uscreenKey = process.env.USCREEN_API_KEY
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const kvToken = process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return { metaToken, uscreenKey, kvUrl, kvToken }
}

async function getJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options)
  if (!response.ok) throw new Error(`upstream_${response.status}`)
  return response.json()
}

export async function fetchMetaReport(window, fetchImpl = fetch) {
  const { metaToken } = config()
  if (!metaToken) throw new Error('meta_not_configured')
  const account = process.env.META_AD_ACCOUNT_ID || META_DEFAULT_ACCOUNT
  const params = new URLSearchParams({
    fields: 'spend,actions,action_values,account_currency',
    level: 'account',
    time_range: JSON.stringify({ since: window.from, until: window.to }),
    access_token: metaToken,
  })
  const body = await getJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(account)}/insights?${params}`, { headers: { accept: 'application/json' } }, fetchImpl)
  const row = Array.isArray(body?.data) ? body.data[0] || {} : {}
  return {
    purchases: extractActionCount(row.actions),
    purchase_value: extractActionValue(row.action_values),
    spend: number(row.spend) || 0,
    currency: text(row.account_currency || row.currency || process.env.META_AD_ACCOUNT_CURRENCY).toUpperCase() || null,
  }
}

export function buildDailySeries({ window, metaDaily = [], invoices = [], sales = [] }) {
  const days = []
  for (let t = Date.parse(`${window.from}T00:00:00Z`); t <= Date.parse(`${window.to}T00:00:00Z`); t += 86400000) {
    days.push(new Date(t).toISOString().slice(0, 10))
  }
  const metaByDay = new Map()
  for (const row of Array.isArray(metaDaily) ? metaDaily : []) {
    metaByDay.set(text(row?.date_start), {
      spend: number(row?.spend) || 0,
      purchases: extractActionCount(row?.actions),
    })
  }
  const metaUserIds = new Set()
  for (const sale of Array.isArray(sales) ? sales : []) {
    const userId = text(sale?.uscreen_user_id)
    if (userId && isMetaSale(sale)) metaUserIds.add(userId)
  }
  const blank = () => ({
    spend: 0, meta_purchases: 0, uscreen_paid_buyers: 0, uscreen_paid_value: 0,
    uscreen_trials: 0, confirmed_meta_buyers: 0, fb20_redemptions: 0,
    app_paid_buyers: 0, web_paid_buyers: 0,
  })
  const byDay = new Map(days.map((d) => [d, blank()]))
  const seenPaid = new Map()
  for (const invoice of Array.isArray(invoices) ? invoices : []) {
    if (!invoiceInWindow(invoice, window)) continue
    const day = new Date(Number(invoice.paid_at) * 1000).toISOString().slice(0, 10)
    const row = byDay.get(day)
    if (!row) continue
    if (isPositivePaidInvoice(invoice)) {
      const userId = text(invoice.user_id)
      let seen = seenPaid.get(day)
      if (!seen) { seen = new Set(); seenPaid.set(day, seen) }
      if (userId && !seen.has(userId)) {
        seen.add(userId)
        row.uscreen_paid_buyers += 1
        if (metaUserIds.has(userId)) row.confirmed_meta_buyers += 1
        const origin = text(invoice.origin).toLowerCase()
        if (origin.includes('stripe') || origin.includes('paypal')) row.web_paid_buyers += 1
        else if (origin) row.app_paid_buyers += 1
      }
      row.uscreen_paid_value += (number(invoice.amount) || 0) / 100
      if (invoiceCoupon(invoice) === FB20_COUPON) row.fb20_redemptions += 1
    } else if (isTrialInvoice(invoice)) {
      row.uscreen_trials += 1
    }
  }
  return days.map((d) => {
    const row = byDay.get(d)
    const meta = metaByDay.get(d)
    if (meta) { row.spend = meta.spend; row.meta_purchases = meta.purchases }
    row.spend = Number(row.spend.toFixed(2))
    row.uscreen_paid_value = Number(row.uscreen_paid_value.toFixed(2))
    return { date: d, ...row }
  })
}

export async function fetchMetaDailyReport(window, fetchImpl = fetch) {
  const { metaToken } = config()
  if (!metaToken) throw new Error('meta_not_configured')
  const account = process.env.META_AD_ACCOUNT_ID || META_DEFAULT_ACCOUNT
  const params = new URLSearchParams({
    fields: 'spend,actions,action_values',
    level: 'account',
    time_increment: '1',
    time_range: JSON.stringify({ since: window.from, until: window.to }),
    access_token: metaToken,
  })
  const body = await getJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(account)}/insights?${params}`, { headers: { accept: 'application/json' } }, fetchImpl)
  return Array.isArray(body?.data) ? body.data : []
}

export async function fetchUscreenInvoices(window, fetchImpl = fetch) {
  const { uscreenKey } = config()
  if (!uscreenKey) throw new Error('uscreen_not_configured')
  const headers = { Authorization: `Bearer ${uscreenKey}`, accept: 'application/json' }
  const windowStart = Date.parse(`${window.from}T00:00:00Z`)
  const invoices = []
  let reachedStart = false
  let exhausted = false
  let failed = false
  let nextPage = 1

  const fetchPage = async (page) => {
    for (let attempt = 0; attempt < INVOICE_PAGE_RETRIES; attempt += 1) {
      try {
        return await getJson(`${USCREEN_API_BASE}/invoices?per_page=${USCREEN_PER_PAGE}&page=${page}`, { headers }, fetchImpl)
      } catch (error) {
        // Back off and retry: a 429 is a throttle, never a signal that the
        // invoice history has ended.
        if (attempt === INVOICE_PAGE_RETRIES - 1) return { error: String(error?.message || error) }
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
      }
    }
    return { error: 'unreachable' }
  }

  while (!reachedStart && !exhausted && !failed && nextPage <= MAX_INVOICE_PAGES) {
    const pages = []
    for (let i = 0; i < INVOICE_PAGE_CONCURRENCY && nextPage + i <= MAX_INVOICE_PAGES; i += 1) pages.push(nextPage + i)
    nextPage += pages.length
    const batches = await Promise.all(pages.map(fetchPage))
    for (const batch of batches) {
      // A page that errored after retries is unknown, NOT the end of history.
      if (!Array.isArray(batch)) { failed = true; continue }
      // Only a genuinely empty page means the history is exhausted.
      if (!batch.length) { exhausted = true; continue }
      invoices.push(...batch)
      const oldest = Math.min(...batch.map((invoice) => Number(invoice?.paid_at || 0) * 1000).filter(Boolean))
      if (oldest && oldest < windowStart) reachedStart = true
    }
  }
  // Complete only when the window start was actually reached, or the invoice
  // history genuinely ran out. Anything else is a floor, not a total.
  invoices.truncated = !reachedStart && !exhausted
  return invoices
}

async function kv(command, fetchImpl = fetch) {
  const { kvUrl, kvToken } = config()
  if (!kvUrl || !kvToken) throw new Error('kv_not_configured')
  return getJson(kvUrl, { method: 'POST', headers: { authorization: `Bearer ${kvToken}`, 'content-type': 'application/json' }, body: JSON.stringify(command) }, fetchImpl).then((body) => body?.result)
}

export async function fetchReliableSales(fetchImpl = fetch) {
  const ids = await kv(['ZREVRANGE', 'jfa:reliability:sales:index', '0', String(MAX_SALES - 1)], fetchImpl)
  const sales = []
  for (const id of Array.isArray(ids) ? ids : []) {
    const raw = await kv(['GET', `jfa:reliability:sale:${id}`], fetchImpl)
    try { if (raw) sales.push(typeof raw === 'string' ? JSON.parse(raw) : raw) } catch { /* ignore malformed ledger row */ }
  }
  return sales
}

export function authorised(req) {
  const expected = process.env.META_USCREEN_RECONCILIATION_TOKEN
  return Boolean(expected && text(req?.headers?.authorization) === `Bearer ${expected}`)
}

export { config, META_PURCHASE_ACTIONS }
