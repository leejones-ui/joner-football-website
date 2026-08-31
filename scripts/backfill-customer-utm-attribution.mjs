// Backfill buyer-source attribution for reliability-ledger sale rows that
// classified as unknown, using the signup-time utm_params and referrer that
// Uscreen stores on the customer object. Runs the exact production
// reconcilePayment path, so a stored journey token upgrades a row to an
// exact join; nothing is ever guessed. Rows with no stored signal stay
// unknown on purpose.
//
// Usage:
//   node scripts/backfill-customer-utm-attribution.mjs --dry-run
//   node scripts/backfill-customer-utm-attribution.mjs --backup /path/rows.json
// Env: KV_REST_API_URL, KV_REST_API_TOKEN, USCREEN_API_KEY,
//      USCREEN_WEBHOOK_SECRET (journey token signing).
import fs from 'node:fs'
import { reconcilePayment } from '../api/checkout-bridge.js'
import { decodeUscreenSource } from '../api/_attribution.js'
import { classifySource } from '../api/_source-taxonomy.js'

const DRY = process.argv.includes('--dry-run')
const backupIndex = process.argv.indexOf('--backup')
const BACKUP_PATH = backupIndex > -1 ? process.argv[backupIndex + 1] : undefined
const KV_URL = String(process.env.KV_REST_API_URL || '').replace(/\/$/, '')
const KV_TOKEN = process.env.KV_REST_API_TOKEN
const USCREEN_KEY = process.env.USCREEN_API_KEY
if (!KV_URL || !KV_TOKEN || !USCREEN_KEY) { console.error('missing env'); process.exit(1) }

async function kv(command) {
  const response = await fetch(KV_URL, { method: 'POST', headers: { authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(command) })
  if (!response.ok) throw new Error(`kv ${response.status}`)
  return (await response.json())?.result
}

async function customer(id) {
  try {
    const response = await fetch(`https://www.uscreen.io/publisher_api/v1/customers/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${USCREEN_KEY}`, accept: 'application/json' } })
    if (!response.ok) return undefined
    return await response.json()
  } catch { return undefined }
}

const ids = (await kv(['ZREVRANGE', 'jfa:reliability:sales:index', '0', '399'])) || []
console.log(`${ids.length} sale rows in index`)
const backup = []
let scanned = 0, candidates = 0, upgraded = 0, displayOnly = 0, noSignal = 0

for (const id of ids) {
  const key = `jfa:reliability:sale:${id}`
  const raw = await kv(['GET', key])
  if (!raw) continue
  let row
  try { row = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { continue }
  scanned += 1
  backup.push({ key, row })
  if (row.kind !== 'payment') continue
  const acquisition = String(row.acquisition || '').toLowerCase()
  if (acquisition && acquisition !== 'unknown') continue
  const userId = row.uscreen_user_id
  if (!userId) continue
  candidates += 1
  const c = await customer(userId)
  const utm = c?.utm_params || {}
  const utmSource = String(utm.utm_source || '').trim()
  const referrer = String(c?.referrer || '').trim()
  if (!utmSource && !referrer) { noSignal += 1; continue }
  const decoded = decodeUscreenSource(utmSource)
  const payment = {
    user_id: userId,
    email_hash: row.email_sha256,
    utm_source: utmSource || undefined,
    utm_medium: utm.utm_medium || undefined,
    utm_campaign: utm.utm_campaign || undefined,
    referrer: referrer || undefined,
    jf_journey_id: decoded.jf_journey_id,
  }
  let reconciliation
  try { reconciliation = await reconcilePayment(payment) } catch { reconciliation = { classification: 'unknown' } }
  const marker = 'backfill_customer_signup_utms_2026-08-31'
  if (reconciliation.classification && reconciliation.classification !== 'unknown') {
    const updated = {
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
      evidence: [...(row.evidence || []), marker, ...(reconciliation.evidence || [])],
    }
    upgraded += 1
    console.log(`UPGRADE ${id}: unknown -> ${reconciliation.classification} (${reconciliation.join_method || 'utm'})${DRY ? ' [dry-run]' : ''}`)
    if (!DRY) {
      const ttl = await kv(['TTL', key])
      const cmd = ['SET', key, JSON.stringify(updated)]
      if (Number.isInteger(ttl) && ttl > 0) cmd.push('EX', String(ttl))
      await kv(cmd)
    }
  } else {
    // No proven join: keep acquisition unknown, but surface the stored signup
    // labels so the operator sees "unknown via <source>" instead of nothing.
    const source = decoded.utm_source || utmSource || undefined
    if (!source && !referrer) { noSignal += 1; continue }
    const updated = {
      ...row,
      source: row.source || source,
      medium: row.medium || decoded.utm_medium || utm.utm_medium || undefined,
      campaign: row.campaign || decoded.utm_campaign || utm.utm_campaign || undefined,
      source_taxonomy: row.source_taxonomy && row.source_taxonomy !== 'unknown' ? row.source_taxonomy : classifySource({ ...utm, utm_source: utmSource, referrer }),
      evidence: [...(row.evidence || []), marker, 'signup_utms_display_only_no_safe_join'],
    }
    displayOnly += 1
    console.log(`DISPLAY ${id}: stays unknown, labelled via ${source || 'referrer'}${DRY ? ' [dry-run]' : ''}`)
    if (!DRY) {
      const ttl = await kv(['TTL', key])
      const cmd = ['SET', key, JSON.stringify(updated)]
      if (Number.isInteger(ttl) && ttl > 0) cmd.push('EX', String(ttl))
      await kv(cmd)
    }
  }
}
if (BACKUP_PATH) { fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 1)); console.log(`backup: ${backup.length} rows -> ${BACKUP_PATH}`) }
console.log(`scanned ${scanned}, unknown-payment candidates ${candidates}, upgraded ${upgraded}, display-only ${displayOnly}, no stored signal ${noSignal}`)
