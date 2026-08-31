// Server-side backfill core: re-run production reconciliation over unknown
// reliability-ledger sale rows using the signup-time utm_params and referrer
// Uscreen stores on the customer object. Lives server-side because journey
// token signing needs USCREEN_WEBHOOK_SECRET, a sensitive env var that never
// leaves Vercel. Rows with no stored signal stay unknown on purpose.
import { reconcilePayment } from './checkout-bridge.js'
import { decodeUscreenSource } from './_attribution.js'
import { classifySource } from './_source-taxonomy.js'

const EVIDENCE_MARKER = 'backfill_customer_signup_utms_2026-08-31'

function kvConfig() {
  const url = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '')
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url, token } : undefined
}

async function kv(command) {
  const config = kvConfig()
  if (!config) throw new Error('kv_not_configured')
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!response.ok) throw new Error(`kv_${response.status}`)
  return (await response.json())?.result
}

async function fetchCustomer(id) {
  const apiKey = process.env.USCREEN_API_KEY
  if (!apiKey) return undefined
  try {
    const response = await fetch(`https://www.uscreen.io/publisher_api/v1/customers/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
    })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

export async function runCustomerUtmBackfill({ dryRun = true, offset = 0, limit = 40 } = {}) {
  const ids = (await kv(['ZREVRANGE', 'jfa:reliability:sales:index', String(offset), String(offset + limit - 1)])) || []
  const summary = { offset, limit, returned: ids.length, scanned: 0, candidates: 0, upgraded: 0, display_only: 0, no_signal: 0, already_backfilled: 0, dry_run: dryRun, rows: [] }
  for (const id of ids) {
    const key = `jfa:reliability:sale:${id}`
    const raw = await kv(['GET', key])
    if (!raw) continue
    let row
    try { row = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { continue }
    summary.scanned += 1
    if (row.kind !== 'payment') continue
    const acquisition = String(row.acquisition || '').toLowerCase()
    if (acquisition && acquisition !== 'unknown') continue
    if ((row.evidence || []).includes(EVIDENCE_MARKER)) { summary.already_backfilled += 1; continue }
    if (!row.uscreen_user_id) continue
    summary.candidates += 1
    const customer = await fetchCustomer(row.uscreen_user_id)
    const utm = customer?.utm_params || {}
    const utmSource = String(utm.utm_source || '').trim()
    const referrer = String(customer?.referrer || '').trim()
    if (!utmSource && !referrer) { summary.no_signal += 1; continue }
    const decoded = decodeUscreenSource(utmSource)
    let reconciliation
    try {
      reconciliation = await reconcilePayment({
        user_id: row.uscreen_user_id,
        email_hash: row.email_sha256,
        utm_source: utmSource || undefined,
        utm_medium: utm.utm_medium || undefined,
        utm_campaign: utm.utm_campaign || undefined,
        referrer: referrer || undefined,
        jf_journey_id: decoded.jf_journey_id,
      })
    } catch {
      reconciliation = { classification: 'unknown' }
    }
    const resolved = reconciliation.classification && reconciliation.classification !== 'unknown'
    const updated = resolved
      ? {
          ...row,
          acquisition: reconciliation.classification,
          confidence: reconciliation.confidence || 'medium',
          join_method: reconciliation.join_method || row.join_method,
          source: reconciliation.source || decoded.utm_source || row.source,
          medium: reconciliation.medium || decoded.utm_medium || row.medium,
          campaign: reconciliation.campaign || decoded.utm_campaign || row.campaign,
          adset: reconciliation.adset || decoded.adset_id || row.adset,
          ad: reconciliation.ad || decoded.ad_id || row.ad,
          placement: reconciliation.placement || row.placement,
          landing_page: reconciliation.landing_page || row.landing_page,
          has_fbc: Boolean(reconciliation.fbc) || row.has_fbc,
          has_fbp: Boolean(reconciliation.fbp) || row.has_fbp,
          has_fbclid: Boolean(reconciliation.fbclid) || row.has_fbclid,
          source_taxonomy: row.source_taxonomy && row.source_taxonomy !== 'unknown' ? row.source_taxonomy : classifySource({ ...utm, utm_source: utmSource, referrer }),
          evidence: [...(row.evidence || []), EVIDENCE_MARKER, ...(reconciliation.evidence || [])],
        }
      : {
          ...row,
          source: row.source || decoded.utm_source || utmSource || undefined,
          medium: row.medium || decoded.utm_medium || utm.utm_medium || undefined,
          campaign: row.campaign || decoded.utm_campaign || utm.utm_campaign || undefined,
          source_taxonomy: row.source_taxonomy && row.source_taxonomy !== 'unknown' ? row.source_taxonomy : classifySource({ ...utm, utm_source: utmSource, referrer }),
          evidence: [...(row.evidence || []), EVIDENCE_MARKER, 'signup_utms_display_only_no_safe_join'],
        }
    if (resolved) summary.upgraded += 1
    else summary.display_only += 1
    summary.rows.push({ id, result: resolved ? reconciliation.classification : 'display_only', join: reconciliation.join_method || null })
    if (!dryRun) {
      const ttl = await kv(['TTL', key])
      const command = ['SET', key, JSON.stringify(updated)]
      if (Number.isInteger(ttl) && ttl > 0) command.push('EX', String(ttl))
      await kv(command)
    }
  }
  return summary
}
