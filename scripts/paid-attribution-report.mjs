#!/usr/bin/env node
// Read-only paid-attribution report pack for Joner Football.
//
// Joins, without modifying anything:
//   1. Uscreen payment history (the authority for paid vs trial, renewal vs
//      new, plan and payment status)
//   2. Uscreen customer records incl. decoded __jfa1__ utm_source values
//   3. The KV journey ledger (website campaign/UTM/click identity)
//   4. The KV reliable sale ledger (webhook reconciliation results)
//   5. The KV first-paid claims (canonical CAPI event state + Meta receipts)
//   6. Brevo attribution mirrors (paid-history lists and UTM attributes)
//
// Output: reports/paid-attribution-<date>.{md,csv,json} in the repo root.
// Never sends events, never writes to any external system. Emails are used
// in memory for joining only; the pack carries hashes, never raw emails.
//
// Usage: node scripts/paid-attribution-report.mjs [--days=30] [--max-invoices=400]

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { decodeUscreenSource } from '../api/_attribution.js'

const DAYS = Number((process.argv.find((a) => a.startsWith('--days=')) || '').split('=')[1] || 30)
const MAX_INVOICES = Number((process.argv.find((a) => a.startsWith('--max-invoices=')) || '').split('=')[1] || 400)
const CUTOFF_MS = Date.now() - DAYS * 86_400_000

const USCREEN_KEY = process.env.USCREEN_API_KEY
const BREVO_KEY = process.env.BREVO_API_KEY
const KV_URL = process.env.KV_REST_API_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN
if (!USCREEN_KEY || !KV_URL || !KV_TOKEN) {
  console.error('Missing USCREEN_API_KEY or KV credentials in the environment.')
  process.exit(1)
}

const sha256 = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex')

async function uscreen(pathname) {
  const response = await fetch(`https://www.uscreen.io/publisher_api/v1${pathname}`, { headers: { Authorization: USCREEN_KEY, Accept: 'application/json' } })
  if (!response.ok) return undefined
  return response.json()
}

async function kv(...command) {
  const response = await fetch(KV_URL, { method: 'POST', headers: { authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(command) })
  if (!response.ok) throw new Error(`KV failed: ${response.status}`)
  return (await response.json())?.result
}
const parse = (raw) => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return undefined } }

async function brevoContact(email) {
  if (!BREVO_KEY || !email) return undefined
  const response = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, { headers: { 'api-key': BREVO_KEY, accept: 'application/json' } })
  if (!response.ok) return undefined
  return response.json()
}

const PAID_HISTORY_LISTS = new Set([21, 22, 23, 24, 30, 31, 32, 57, 58, 59])

async function main() {
  const generatedAt = new Date().toISOString()
  // Fail safely: a missing required source aborts instead of producing a
  // silently incomplete report that could show false GREEN results.
  const sourceHealth = { uscreen: false, kv: false, brevo: Boolean(BREVO_KEY) }
  const probe = await uscreen('/invoices?per_page=1')
  sourceHealth.uscreen = Array.isArray(probe)
  try { await kv('PING'); sourceHealth.kv = true } catch { sourceHealth.kv = false }
  if (!sourceHealth.uscreen || !sourceHealth.kv) {
    console.error(`FATAL: required source unavailable (uscreen=${sourceHealth.uscreen}, kv=${sourceHealth.kv}). No report written.`)
    process.exit(2)
  }
  if (!sourceHealth.brevo) console.error('WARNING: Brevo key missing; paid-history checks degrade and verdicts cap at AMBER.')

  console.error(`Reading Uscreen invoices, last ${DAYS} days (max ${MAX_INVOICES})...`)
  const invoices = []
  for (let page = 1; page <= Math.ceil(MAX_INVOICES / 100); page += 1) {
    const batch = await uscreen(`/invoices?per_page=100&page=${page}`)
    if (!Array.isArray(batch) || !batch.length) break
    invoices.push(...batch)
    const oldest = Math.min(...batch.map((i) => Number(i.paid_at || i.created_at || 0) * 1000).filter(Boolean))
    if (oldest && oldest < CUTOFF_MS) break
  }
  const inWindow = invoices.filter((i) => Number(i.paid_at || 0) * 1000 >= CUTOFF_MS)
  const byUser = new Map()
  for (const invoice of inWindow) {
    if (!byUser.has(invoice.user_id)) byUser.set(invoice.user_id, [])
    byUser.get(invoice.user_id).push(invoice)
  }
  console.error(`${inWindow.length} invoices in window across ${byUser.size} users.`)

  // Reliable sale rows, keyed loosely by uscreen user id.
  const saleRows = []
  for (const id of (await kv('ZREVRANGE', 'jfa:reliability:sales:index', '0', '399')) || []) {
    const row = parse(await kv('GET', `jfa:reliability:sale:${id}`))
    if (row) saleRows.push(row)
  }

  const rows = []
  for (const [userId, userInvoices] of byUser) {
    const paidPositives = userInvoices.filter((i) => i.status === 'paid' && Number(i.amount) > 0)
    const trials = userInvoices.filter((i) => i.trial === true || (i.status === 'paid' && Number(i.amount) === 0))
    const customer = await uscreen(`/customers/${userId}`)
    const email = String(customer?.email || '').trim().toLowerCase()
    const emailHash = email ? sha256(email) : undefined
    const packedSource = customer?.utm_params?.utm_source || ''
    const decoded = packedSource ? decodeUscreenSource(packedSource) : {}

    // Journey ledger join (uscreen index first, then email candidates).
    let journey
    const journeyId = await kv('GET', `jf:journey:index:uscreen:${userId}`)
    let resolvedId = journeyId
    if (!resolvedId && emailHash) {
      const candidates = (await kv('SMEMBERS', `jf:journey:index:email-candidates:${emailHash}`)) || []
      let newest
      for (const id of candidates) {
        const record = parse(await kv('GET', `jf:journey:${id}`))
        if (record && (!newest || String(record.updated_at || '') > String(newest.updated_at || ''))) newest = record
      }
      if (newest) { journey = newest; resolvedId = newest.id }
    } else if (resolvedId) {
      journey = parse(await kv('GET', `jf:journey:${resolvedId}`))
    }
    const touch = journey ? { ...(journey.first_touch || {}), ...(journey.latest_touch || {}) } : {}

    // Brevo mirror: paid history + UTM attributes.
    const contact = await brevoContact(email)
    const brevoLists = Array.isArray(contact?.listIds) ? contact.listIds : []
    const brevoPaidHistory = brevoLists.some((id) => PAID_HISTORY_LISTS.has(Number(id)))
    const attrs = contact?.attributes || {}
    const brevoFirstPaid = Boolean(attrs.JF_FIRST_PAID_TRANSACTION_ID || attrs.JF_FIRST_PAID_AT)

    // Canonical claim + Meta receipt.
    const claim = parse(await kv('GET', `jf:meta:first-paid:${sha256(`uscreen:${userId}`)}`))
    let metaReceipt = false
    try { metaReceipt = Number(JSON.parse(claim?.metaResponse?.body || '{}')?.events_received || 0) === 1 } catch { /* none */ }

    // Ledger reconciliation for this user's payments.
    const userSales = saleRows.filter((row) => String(row.uscreen_user_id || '') === String(userId) || (emailHash && row.email_sha256 === emailHash))
    const bestSale = userSales.find((row) => row.acquisition && !['unknown', 'none'].includes(String(row.acquisition).toLowerCase())) || userSales[0]

    // Payment-history verdicts. Uscreen is the authority; the fetch window
    // bounds what "first ever" can prove, so Brevo history closes the gap.
    const accountCreatedMs = Number(customer?.created_at || 0) * 1000
    const accountPredatesWindow = accountCreatedMs && accountCreatedMs < CUTOFF_MS
    const hasPositive = paidPositives.length > 0
    let acquisitionKind = 'no-positive-payment'
    if (hasPositive) {
      if (brevoFirstPaid || (accountPredatesWindow && brevoPaidHistory)) acquisitionKind = accountPredatesWindow ? 'renewal-or-reactivation' : 'repeat-payment'
      else if (paidPositives.length > 1) acquisitionKind = 'new-buyer-plus-renewal-in-window'
      else acquisitionKind = 'first-ever-paid-candidate'
    } else if (trials.length) acquisitionKind = 'trial-only'
    // A sent canonical claim is definitive: the webhook verified no paid
    // history at payment time, before this very payment updated Brevo. The
    // report reads Brevo after the fact, so the claim outranks the mirror.
    if (hasPositive && claim?.status === 'sent') acquisitionKind = 'first-ever-paid-verified'

    const attributionSource = bestSale?.source || decoded.utm_source || touch.utm_source
    const attributionReconciled = Boolean(bestSale && bestSale.acquisition && !['unknown', 'none'].includes(String(bestSale.acquisition).toLowerCase()))
    const canonicalSent = claim?.status === 'sent'

    let verdict = 'RED'
    let verdictReason = acquisitionKind
    if (['first-ever-paid-candidate', 'new-buyer-plus-renewal-in-window', 'first-ever-paid-verified'].includes(acquisitionKind)) {
      if (attributionReconciled && canonicalSent && metaReceipt && BREVO_KEY) { verdict = 'GREEN'; verdictReason = 'first paid, payment verified, attribution reconciled, canonical event received' }
      else if (attributionReconciled && canonicalSent && metaReceipt) { verdict = 'AMBER'; verdictReason = 'all evidence present but the Brevo mirror was unavailable to this run' }
      else { verdict = 'AMBER'; verdictReason = `paid verified; ${attributionReconciled ? '' : 'attribution unreconciled; '}${canonicalSent ? '' : 'canonical event not sent; '}${metaReceipt ? '' : 'no Meta receipt'}`.trim() }
    }

    const first = paidPositives.sort((a, b) => Number(a.paid_at) - Number(b.paid_at))[0]

    // Source classification for first-ever buyers, per the reconciliation
    // contract. Meta requires reconciled ledger evidence, never a guess.
    const KNOWN_META_CAMPAIGNS = new Set(['120249257260070035'])
    const campaignValue = String(bestSale?.campaign || decoded.campaign_id || touch.campaign_id || '')
    const sourceValue = String(attributionSource || '').toLowerCase()
    let sourceClass = 'unattributed_first_paid'
    if (!hasPositive) sourceClass = 'not_applicable'
    else if (attributionReconciled && (String(bestSale?.acquisition) === 'exact_paid_meta' || KNOWN_META_CAMPAIGNS.has(campaignValue))) sourceClass = 'meta_attributed_first_paid'
    else if (['brevo', 'email'].includes(sourceValue)) sourceClass = 'brevo_email_first_paid'
    else if (['organic', 'direct', 'referral', 'google'].includes(sourceValue) || String(bestSale?.acquisition) === 'organic' || String(bestSale?.acquisition) === 'direct') sourceClass = 'organic_direct_first_paid'
    else if (sourceValue) sourceClass = 'other_identifiable_source'

    // Dry-run release eligibility only. This script never sends events.
    const webChargeEvidence = userSales.some((row) => /^ch_/.test(String(row.payment_id || row.provider_payment_id || '')))
    const eligibleForRelease = ['first-ever-paid-candidate', 'new-buyer-plus-renewal-in-window'].includes(acquisitionKind)
      && !canonicalSent
      && claim?.status !== 'suppressed'
      && webChargeEvidence
      && !['apple', 'android', 'ios'].includes(String(first?.origin || userInvoices[0]?.origin || '').toLowerCase())

    const evidencePaths = [
      first ? `uscreen:/invoices/${first.id}` : `uscreen:/customers/${userId}`,
      `uscreen:/customers/${userId}`,
      resolvedId ? `kv:jf:journey:${resolvedId}` : null,
      ...userSales.slice(0, 3).map((row) => `kv:jfa:reliability:sale:${row.sale_id}`),
      claim ? `kv:jf:meta:first-paid:${sha256(`uscreen:${userId}`)}` : null,
      contact ? 'brevo:contacts/<hashed>' : null,
    ].filter(Boolean)

    rows.push({
      uscreen_user_id: userId,
      email_hash_prefix: emailHash ? emailHash.slice(0, 12) : null,
      account_created: accountCreatedMs ? new Date(accountCreatedMs).toISOString() : null,
      plan_product_id: first?.product_id || userInvoices[0]?.product_id || null,
      paid_status: hasPositive ? 'paid' : trials.length ? 'trial' : 'none',
      paid_invoices_in_window: paidPositives.length,
      first_paid_invoice_id: first?.id || null,
      first_paid_amount: first ? Number(first.amount) / 100 : null,
      first_paid_currency: first?.currency || null,
      first_paid_at: first ? new Date(Number(first.paid_at) * 1000).toISOString() : null,
      billing_origin: first?.origin || userInvoices[0]?.origin || null,
      acquisition_kind: acquisitionKind,
      brevo_paid_history: brevoPaidHistory,
      source_platform: attributionSource || null,
      medium: bestSale?.medium || decoded.utm_medium || touch.utm_medium || null,
      campaign: bestSale?.campaign || decoded.campaign_id || decoded.utm_campaign || touch.campaign_id || touch.utm_campaign || null,
      adset: bestSale?.adset || decoded.adset_id || touch.adset_id || null,
      ad: bestSale?.ad || decoded.ad_id || touch.ad_id || null,
      placement: bestSale?.placement || decoded.placement || touch.placement || null,
      click_identity: Boolean(touch.fbc || touch.fbclid || decoded.fbc || decoded.fbclid),
      journey_joined: Boolean(resolvedId),
      ledger_acquisition: bestSale?.acquisition || null,
      ledger_confidence: bestSale?.confidence || null,
      ledger_join_method: bestSale?.join_method || null,
      capi_claim_status: claim?.status || null,
      meta_event_id: claim?.eventId || null,
      meta_receipt_confirmed: metaReceipt,
      source_class: sourceClass,
      eligible_for_release_dry_run: eligibleForRelease,
      verdict,
      verdict_reason: verdictReason,
      evidence_paths: evidencePaths.join('; '),
      generated_at: generatedAt,
    })
  }

  // Duplicate detection: one canonical event id per buyer, ever.
  const eventIds = rows.map((row) => row.meta_event_id).filter(Boolean)
  const duplicateEventIds = [...new Set(eventIds.filter((id, index) => eventIds.indexOf(id) !== index))]
  if (duplicateEventIds.length) console.error(`WARNING: duplicate canonical event ids detected: ${duplicateEventIds.join(', ')}`)

  rows.sort((a, b) => String(b.first_paid_at || '').localeCompare(String(a.first_paid_at || '')))
  const stamp = new Date().toISOString().slice(0, 10)
  const outDir = path.join(process.cwd(), 'reports')
  fs.mkdirSync(outDir, { recursive: true })

  const firstEver = rows.filter((row) => ['first-ever-paid-candidate', 'new-buyer-plus-renewal-in-window', 'first-ever-paid-verified'].includes(row.acquisition_kind))
  const dryRunRelease = rows.filter((row) => row.eligible_for_release_dry_run)
  fs.writeFileSync(path.join(outDir, `paid-attribution-${stamp}.json`), JSON.stringify({
    generated_at: generatedAt,
    window_days: DAYS,
    source_health: sourceHealth,
    duplicate_event_ids: duplicateEventIds,
    first_ever_paid_count: firstEver.length,
    dry_run_release_candidates: dryRunRelease.map((row) => ({ uscreen_user_id: row.uscreen_user_id, first_paid_invoice_id: row.first_paid_invoice_id, amount: row.first_paid_amount, currency: row.first_paid_currency, source_class: row.source_class, reason: 'eligible pending Barry approval; nothing sent' })),
    candidates: rows,
  }, null, 2))

  const csvColumns = Object.keys(rows[0] || { none: true })
  const csv = [csvColumns.join(',')].concat(rows.map((row) => csvColumns.map((key) => {
    const value = row[key]
    const s = value === null || value === undefined ? '' : String(value)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(','))).join('\n')
  fs.writeFileSync(path.join(outDir, `paid-attribution-${stamp}.csv`), csv)

  const counts = { GREEN: 0, AMBER: 0, RED: 0 }
  for (const row of rows) counts[row.verdict] += 1
  const md = [
    `# Joner Football paid-attribution report, ${stamp}`,
    '',
    `Read-only reconciliation across Uscreen payment history (authority), the journey and sale ledgers, Brevo mirrors, decoded __jfa1__ sources, and canonical CAPI claims. Window: last ${DAYS} days. Candidates: ${rows.length}.`,
    '',
    `Verdicts: GREEN ${counts.GREEN}, AMBER ${counts.AMBER}, RED ${counts.RED}.`,
    '',
    '| Verdict | User | First paid | Amount | Origin | Kind | Source | Campaign | CAPI | Receipt | Reason |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.verdict} | ${row.uscreen_user_id} | ${row.first_paid_at ? row.first_paid_at.slice(0, 16) : ''} | ${row.first_paid_amount ?? ''} ${row.first_paid_currency ?? ''} | ${row.billing_origin ?? ''} | ${row.acquisition_kind} | ${row.source_platform ?? ''} | ${row.campaign ?? ''} | ${row.capi_claim_status ?? ''} | ${row.meta_receipt_confirmed ? 'yes' : 'no'} | ${row.verdict_reason} |`),
    '',
    '## First-ever paid buyer reconciliation',
    '',
    `${firstEver.length} first-ever paid buyers in the window, by source class:`,
    '',
    ...Object.entries(firstEver.reduce((acc, row) => { acc[row.source_class] = (acc[row.source_class] || 0) + 1; return acc }, {})).map(([name, count]) => `- ${name}: ${count}`),
    '',
    '| User | First paid | Amount | Origin | Source class | Journey | Ledger | CAPI | Receipt |',
    '|---|---|---|---|---|---|---|---|---|',
    ...firstEver.map((row) => `| ${row.uscreen_user_id} | ${row.first_paid_at ? row.first_paid_at.slice(0, 16) : ''} | ${row.first_paid_amount ?? ''} ${row.first_paid_currency ?? ''} | ${row.billing_origin ?? ''} | ${row.source_class} | ${row.journey_joined ? 'yes' : 'no'} | ${row.ledger_acquisition ?? 'none'} | ${row.capi_claim_status ?? 'none'} | ${row.meta_receipt_confirmed ? 'yes' : 'no'} |`),
    '',
    '## Dry-run release candidates (NOTHING SENT)',
    '',
    dryRunRelease.length
      ? `${dryRunRelease.length} buyers are eligible for a canonical event release pending Barry's independent verification: ${dryRunRelease.map((row) => row.uscreen_user_id).join(', ')}. This script sends nothing; release is a separate, explicitly approved operation.`
      : 'No unreleased eligible candidates in this window.',
    '',
    `Duplicate canonical event ids: ${duplicateEventIds.length ? duplicateEventIds.join(', ') : 'none detected'}.`,
    `Source health: uscreen=${sourceHealth.uscreen}, kv=${sourceHealth.kv}, brevo=${sourceHealth.brevo}.`,
    '',
    'RED covers trials, renewals, reactivations and payment-free records by definition; it does not mean an error. Raw emails are never written to this pack.',
  ].join('\n')
  fs.writeFileSync(path.join(outDir, `paid-attribution-${stamp}.md`), md)
  console.error(`Wrote reports/paid-attribution-${stamp}.{md,csv,json} with ${rows.length} candidates.`)
}

main().catch((error) => { console.error(error); process.exit(1) })
