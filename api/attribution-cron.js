import { listReliableSales, appendReliableSale, listWebhookFailures } from './_reliability-ledger.js'
import { reconcilePayment } from './checkout-bridge.js'
import { attemptFirstPaidAutoSend } from './_uscreen-webhook.js'
import { setHealthField, bumpHealthCounter, getHealth, recordAlert } from './_attribution-health.js'

// Hourly reconciliation and retry for the sales attribution system.
// Vercel cron hits this every hour; the 21:00 UTC run (07:00 Sydney) performs
// the daily deep sweep. Every step is bounded and idempotent, so overlapping
// or repeated runs are safe.

const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const MAX_SEND_ATTEMPTS = 24
const USCREEN_API_BASE = 'https://www.uscreen.io/publisher_api/v1'

function json(res, status, body) { return res.status(status).json(body) }

function authorized(req) {
  const header = String(req.headers?.authorization || '')
  const secrets = [process.env.CRON_SECRET, process.env.USCREEN_RELIABILITY_TOKEN, process.env.OWNER_API_TOKEN].filter(Boolean)
  return secrets.some((secret) => header === `Bearer ${secret}`)
}

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('Attribution KV is not configured')
  return { url: url.replace(/\/$/, ''), token }
}

async function kv(command) {
  const { url, token } = kvConfig()
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!response.ok) throw new Error(`Attribution KV failed: ${response.status}`)
  return (await response.json())?.result
}

async function uscreenGet(path) {
  const key = process.env.USCREEN_API_KEY
  if (!key) return undefined
  const response = await fetch(`${USCREEN_API_BASE}${path}`, { headers: { Authorization: key, Accept: 'application/json' } })
  if (!response.ok) return undefined
  return response.json()
}

const parse = (raw) => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return undefined } }
const meaningfulAcquisition = (value) => Boolean(value && !['unknown', 'none', 'null'].includes(String(value).toLowerCase()))

// Step A: retry canonical first-paid sends that were held (missing currency,
// transient Meta failure). Enrich value/currency from the authoritative
// Uscreen invoice when the webhook payload lacked them.
async function retryFirstPaidCandidates(limit = 25) {
  const out = { scanned: 0, retried: 0, sent: 0, enriched: 0 }
  let cursor = '0'
  const keys = []
  do {
    const result = await kv(['SCAN', cursor, 'MATCH', 'jf:meta:first-paid:*', 'COUNT', '200'])
    cursor = result?.[0] || '0'
    for (const key of result?.[1] || []) if (!key.endsWith(':send-lock')) keys.push(key)
  } while (cursor !== '0' && keys.length < 500)
  for (const key of keys) {
    if (out.retried >= limit) break
    const record = parse(await kv(['GET', key]))
    if (!record || !['candidate', 'pending'].includes(record.status)) continue
    out.scanned += 1
    if (Number(record.attempts || 0) >= MAX_SEND_ATTEMPTS) continue
    const claimedAt = Date.parse(record.claimedAt || record.awaitingVerificationSince || '') || 0
    if (claimedAt && Date.now() - claimedAt > RETRY_WINDOW_MS) continue
    const metaEvent = record.metaEvent
    if (!metaEvent?.event_id) continue
    // Enrich a missing value/currency from the authoritative invoice.
    const value = Number(metaEvent.custom_data?.value)
    const currency = String(metaEvent.custom_data?.currency || '')
    if ((!(value > 0) || !/^[A-Z]{3}$/.test(currency)) && record.uscreenOrderId) {
      const invoice = await uscreenGet(`/invoices/${encodeURIComponent(record.uscreenOrderId)}`)
      if (invoice && invoice.status === 'paid' && Number(invoice.amount) > 0) {
        metaEvent.custom_data = {
          ...metaEvent.custom_data,
          value: Number(invoice.amount) / 100,
          currency: /^[A-Z]{3}$/.test(String(invoice.currency || '').toUpperCase()) ? String(invoice.currency).toUpperCase() : metaEvent.custom_data?.currency,
        }
        out.enriched += 1
      }
    }
    out.retried += 1
    const result = await attemptFirstPaidAutoSend({ key, record, metaEvent })
    if (result.sent) out.sent += 1
  }
  return out
}

// Step B: re-reconcile recent unknown sales. A checkout identity that arrived
// after the payment webhook makes the email-hash join succeed on retry.
async function reconcileUnknownSales(limit = 50) {
  const out = { checked: 0, reclassified: 0 }
  const sales = await listReliableSales(fetch, 200)
  for (const sale of sales) {
    if (out.checked >= limit) break
    if (meaningfulAcquisition(sale.acquisition)) continue
    if (sale.kind === 'refund') continue
    const occurred = Date.parse(sale.occurred_at || '') || 0
    if (!occurred || Date.now() - occurred > RETRY_WINDOW_MS) continue
    if (!sale.email_sha256 && !sale.uscreen_user_id) continue
    out.checked += 1
    let reconciliation
    try {
      reconciliation = await reconcilePayment({
        user_id: sale.uscreen_user_id,
        email_hash: sale.email_sha256,
        journey_id: sale.journey_id,
        event_date: sale.occurred_at,
      })
    } catch { continue }
    const attempts = Number(sale.reconcile_attempts || 0) + 1
    if (meaningfulAcquisition(reconciliation?.classification)) {
      await appendReliableSale({
        ...sale,
        acquisition: reconciliation.classification,
        confidence: reconciliation.confidence,
        evidence: reconciliation.evidence,
        source: reconciliation.source,
        medium: reconciliation.medium,
        campaign: reconciliation.campaign,
        adset: reconciliation.adset,
        ad: reconciliation.ad,
        placement: reconciliation.placement,
        landing_page: reconciliation.landing_page,
        journey_id: reconciliation.journey_id,
        join_method: reconciliation.join_method,
        has_fbc: Boolean(reconciliation.fbc) || sale.has_fbc,
        has_fbp: Boolean(reconciliation.fbp) || sale.has_fbp,
        has_fbclid: Boolean(reconciliation.fbclid) || sale.has_fbclid,
        reconcile_attempts: attempts,
        last_reconciled_at: new Date().toISOString(),
      })
      out.reclassified += 1
      await bumpHealthCounter('reconcile_reclassified')
    } else {
      await appendReliableSale({ ...sale, reconcile_attempts: attempts, last_reconciled_at: new Date().toISOString() })
    }
  }
  return out
}

// Step C: webhook continuity. Compare Uscreen's authoritative invoice stream
// against what the webhook recorded; import and flag anything that slipped
// through so a delivery gap can never silently lose a sale again.
async function checkInvoiceContinuity({ deep }) {
  const out = { scanned: 0, imported: 0, apiAvailable: Boolean(process.env.USCREEN_API_KEY) }
  if (!out.apiAvailable) return out
  const lookbackMs = (deep ? 7 * 24 : 6) * 60 * 60 * 1000
  const pages = deep ? 3 : 1
  // The webhook records web sales under Stripe charge ids, not invoice ids, so
  // an unseen invoice is only a real gap when no ledger row matches the same
  // customer, amount and time window.
  const recentRows = await listReliableSales(fetch, 200).catch(() => [])
  const matchesExistingRow = (invoice, paidAtMs) => recentRows.some((row) => {
    if (String(row.uscreen_user_id || '') !== String(invoice.user_id || '')) return false
    if (Math.abs(Number(row.amount || 0) - Number(invoice.amount) / 100) > 0.01) return false
    const rowAt = Date.parse(row.occurred_at || '') || 0
    return rowAt && Math.abs(rowAt - paidAtMs) < 90 * 60 * 1000
  })
  for (let page = 1; page <= pages; page += 1) {
    const invoices = await uscreenGet(`/invoices?per_page=100&page=${page}`)
    if (!Array.isArray(invoices) || !invoices.length) break
    for (const invoice of invoices) {
      const paidAtMs = Number(invoice.paid_at) * 1000
      if (!paidAtMs || Date.now() - paidAtMs > lookbackMs) continue
      if (invoice.status !== 'paid' || !(Number(invoice.amount) > 0)) continue
      // Give the webhook 30 minutes to arrive before treating this as a gap.
      if (Date.now() - paidAtMs < 30 * 60 * 1000) continue
      out.scanned += 1
      const seen = await kv(['GET', `jfa:reliability:invoice-seen:${invoice.id}`])
      if (seen) continue
      if (matchesExistingRow(invoice, paidAtMs)) {
        await kv(['SET', `jfa:reliability:invoice-seen:${invoice.id}`, 'matched-existing-row', 'EX', String(90 * 24 * 60 * 60)])
        continue
      }
      // Gap: the webhook never recorded this paid invoice.
      let emailHash
      let reconciliation
      try {
        const customer = await uscreenGet(`/customers/${invoice.user_id}`)
        const email = String(customer?.email || '').trim().toLowerCase()
        if (email) {
          const { sha256 } = await import('./_attribution-ledger.js')
          emailHash = sha256(email)
        }
        reconciliation = await reconcilePayment({
          user_id: invoice.user_id,
          email_hash: emailHash,
          event_date: new Date(paidAtMs).toISOString(),
        })
      } catch { reconciliation = { classification: 'unknown', confidence: 'none', evidence: ['continuity_reconcile_error'] } }
      await appendReliableSale({
        sale_id: `payment:${invoice.id}`,
        kind: 'payment',
        payment_status: 'paid',
        provider_payment_id: String(invoice.id),
        invoice_id: String(invoice.id),
        occurred_at: new Date(paidAtMs).toISOString(),
        offer_id: invoice.product_id,
        amount: Number(invoice.amount) / 100,
        currency: String(invoice.currency || '').toUpperCase() || undefined,
        billing_origin: String(invoice.origin || '') || undefined,
        uscreen_user_id: String(invoice.user_id || '') || undefined,
        customer_reference: emailHash ? emailHash.slice(0, 16) : undefined,
        email_sha256: emailHash,
        acquisition: reconciliation?.classification || 'unknown',
        confidence: reconciliation?.confidence || 'none',
        evidence: [...(reconciliation?.evidence || []), 'continuity_backfill'],
        source: reconciliation?.source,
        medium: reconciliation?.medium,
        campaign: reconciliation?.campaign,
        adset: reconciliation?.adset,
        ad: reconciliation?.ad,
        placement: reconciliation?.placement,
        journey_id: reconciliation?.journey_id,
        join_method: reconciliation?.join_method,
      })
      await kv(['SET', `jfa:reliability:invoice-seen:${invoice.id}`, `payment:${invoice.id}`, 'EX', String(90 * 24 * 60 * 60)])
      await recordAlert({ type: 'webhook_gap_backfill', invoice_id: String(invoice.id), amount: Number(invoice.amount) / 100, currency: invoice.currency })
      await bumpHealthCounter('continuity_backfills')
      out.imported += 1
    }
    if (!deep) break
  }
  return out
}

// Step D: health evaluation and alerts.
async function evaluateHealth() {
  const health = await getHealth()
  const lastEvent = Date.parse(health.webhook_last_event_at || '') || 0
  if (lastEvent && Date.now() - lastEvent > 24 * 60 * 60 * 1000) {
    await recordAlert({ type: 'webhook_silent', detail: `No webhook events since ${health.webhook_last_event_at}` })
  }
  const failures = await listWebhookFailures().catch(() => [])
  await setHealthField('dead_letter_count', String(failures.length))
  return { deadLetters: failures.length }
}

export default async function handler(req, res) {
  if (!authorized(req)) return json(res, 401, { success: false, error: 'Unauthorized' })
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { success: false, error: 'Method not allowed' })
  const deep = req.query?.deep === '1' || new Date().getUTCHours() === 21
  const started = Date.now()
  const summary = { deep }
  try {
    summary.firstPaid = await retryFirstPaidCandidates(deep ? 100 : 25)
    summary.unknowns = await reconcileUnknownSales(deep ? 150 : 50)
    summary.continuity = await checkInvoiceContinuity({ deep })
    summary.health = await evaluateHealth()
    await setHealthField('cron_last_run_at', new Date().toISOString())
    await setHealthField('cron_last_summary', summary)
    if (deep) await setHealthField('daily_last_run_at', new Date().toISOString())
    await bumpHealthCounter('cron_runs')
    summary.duration_ms = Date.now() - started
    return json(res, 200, { success: true, ...summary })
  } catch (error) {
    await recordAlert({ type: 'cron_failed', detail: String(error?.message || error).slice(0, 200) }).catch(() => {})
    return json(res, 500, { success: false, error: String(error?.message || error).slice(0, 200), partial: summary })
  }
}
