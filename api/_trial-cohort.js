// Trial cohort: every Uscreen free trial started in a window, who sent it, and
// whether it converted, lapsed, or is still running. Uscreen is the source of
// truth for trials and conversions; the KV sales ledger and the customer's
// signup-time UTMs supply attribution. No PII leaves this module.
import { fetchUscreenInvoices, isPositivePaidInvoice, isTrialInvoice, fetchReliableSales, config } from './_meta-uscreen-reconciliation.js'
import { decodeUscreenSource } from './_attribution.js'

export const TRIAL_DAYS = 7
const CUSTOMER_CONCURRENCY = 3
const CUSTOMER_RETRIES = 3
const MAX_CUSTOMER_LOOKUPS = 250

const text = (value) => value === undefined || value === null ? '' : String(value).trim()
const number = (value) => { const n = Number(value); return Number.isFinite(n) ? n : undefined }
const iso = (unixSeconds) => new Date(Number(unixSeconds) * 1000).toISOString()
const day = (isoString) => String(isoString || '').slice(0, 10)

const META_SOURCES = /^(fb|ig|an|facebook|instagram|meta)/i

export function classifyTrialAttribution({ sale, customer }) {
  // 1. Ledger row written at trial/checkout time carries the joined journey.
  const acquisition = text(sale?.acquisition).toLowerCase()
  if (sale && acquisition && !['unknown', 'none'].includes(acquisition)) {
    const meta = ['meta', 'facebook', 'instagram', 'exact_paid_meta'].includes(acquisition) || META_SOURCES.test(text(sale.source))
    return {
      channel: meta ? 'meta_ads' : (text(sale.source) || acquisition),
      confidence: text(sale.confidence) || 'medium',
      source: text(sale.source) || undefined,
      medium: text(sale.medium) || undefined,
      campaign: text(sale.campaign) || undefined,
      ad: text(sale.ad) || undefined,
      evidence: 'journey_ledger',
    }
  }
  // 2. Uscreen stored the signup-time UTMs (website signups carry the codec).
  const utm = customer?.utm_params || {}
  const rawSource = text(utm.utm_source)
  if (rawSource) {
    const decoded = decodeUscreenSource(rawSource) || {}
    const source = text(decoded.utm_source) || rawSource
    const medium = text(decoded.utm_medium || utm.utm_medium)
    const paid = /paid/i.test(medium) || Boolean(decoded.ad_id || decoded.adset_id || decoded.campaign_id)
    const meta = META_SOURCES.test(source)
    return {
      channel: meta && paid ? 'meta_ads' : meta ? 'meta_organic' : source,
      confidence: meta && paid ? 'high' : 'medium',
      source, medium: medium || undefined,
      campaign: text(decoded.utm_campaign || utm.utm_campaign) || undefined,
      ad: text(decoded.utm_content) || undefined,
      evidence: 'uscreen_signup_utms',
    }
  }
  const referrer = text(customer?.referrer)
  if (referrer) return { channel: 'referral', confidence: 'low', source: referrer.slice(0, 120), evidence: 'uscreen_signup_referrer' }
  // 3. Nothing stored. App-store signups are the structural unknown.
  const origin = text(customer?.origin).toLowerCase()
  return { channel: origin.includes('app') ? 'unknown_app_signup' : origin.includes('web') ? 'unknown_web_signup' : 'unknown', confidence: 'none', evidence: 'no_signal' }
}

export function buildTrialCohort({ window, invoices = [], sales = [], customers = new Map(), now = new Date() }) {
  const nowMs = now.getTime()
  const byUser = new Map()
  for (const invoice of invoices) {
    const userId = text(invoice?.user_id)
    const paidAt = number(invoice?.paid_at)
    if (!userId || !paidAt) continue
    const entry = byUser.get(userId) || { trials: [], paid: [] }
    if (isTrialInvoice(invoice)) entry.trials.push(invoice)
    else if (isPositivePaidInvoice(invoice)) entry.paid.push(invoice)
    byUser.set(userId, entry)
  }
  const salesByUser = new Map()
  for (const sale of sales) {
    const id = text(sale?.uscreen_user_id)
    if (!id) continue
    // Prefer the row with the strongest attribution.
    const existing = salesByUser.get(id)
    const acq = text(sale.acquisition).toLowerCase()
    if (!existing || (['unknown', 'none', ''].includes(text(existing.acquisition).toLowerCase()) && !['unknown', 'none', ''].includes(acq))) salesByUser.set(id, sale)
  }

  const rows = []
  for (const [userId, entry] of byUser) {
    if (!entry.trials.length) continue
    const first = entry.trials.sort((a, b) => number(a.paid_at) - number(b.paid_at))[0]
    const startedAt = iso(first.paid_at)
    const startDay = day(startedAt)
    if (startDay < window.from || startDay > window.to) continue
    const startMs = number(first.paid_at) * 1000
    const trialEndsMs = startMs + TRIAL_DAYS * 86400000
    const conversion = entry.paid.filter((inv) => number(inv.paid_at) * 1000 > startMs).sort((a, b) => number(a.paid_at) - number(b.paid_at))[0]
    let status
    if (conversion) status = 'converted'
    else if (nowMs >= trialEndsMs) status = 'ended_not_converted'
    else status = 'in_trial'
    const attribution = classifyTrialAttribution({ sale: salesByUser.get(userId), customer: customers.get(userId) })
    rows.push({
      uscreen_user_id: userId,
      trial_started_at: startedAt,
      trial_ends_at: new Date(trialEndsMs).toISOString(),
      plan: text(first.offer_title || first.subscription_title || first.title || first.product_title || first.description) || undefined,
      status,
      converted_at: conversion ? iso(conversion.paid_at) : undefined,
      converted_amount: conversion ? Number(((number(conversion.amount) || 0) / 100).toFixed(2)) : undefined,
      converted_currency: conversion ? text(conversion.currency) || undefined : undefined,
      days_to_convert: conversion ? Number(((number(conversion.paid_at) * 1000 - startMs) / 86400000).toFixed(1)) : undefined,
      attribution,
    })
  }
  rows.sort((a, b) => b.trial_started_at.localeCompare(a.trial_started_at))

  const bucket = () => ({ trials: 0, converted: 0, ended_not_converted: 0, in_trial: 0, converted_revenue: 0 })
  const summary = bucket()
  const byChannel = {}
  for (const row of rows) {
    const key = row.attribution.channel
    byChannel[key] = byChannel[key] || bucket()
    for (const target of [summary, byChannel[key]]) {
      target.trials += 1
      target[row.status] += 1
      if (row.status === 'converted') target.converted_revenue = Number((target.converted_revenue + (row.converted_amount || 0)).toFixed(2))
    }
  }
  const rate = (b) => { const decided = b.converted + b.ended_not_converted; return decided ? Number((b.converted / decided).toFixed(3)) : null }
  summary.conversion_rate_of_decided = rate(summary)
  for (const b of Object.values(byChannel)) b.conversion_rate_of_decided = rate(b)
  return { window, generated_at: now.toISOString(), trial_days: TRIAL_DAYS, summary, by_channel: byChannel, rows }
}

async function fetchCustomer(id, fetchImpl) {
  const { uscreenKey } = config()
  if (!uscreenKey) return undefined
  for (let attempt = 0; attempt < CUSTOMER_RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(`https://www.uscreen.io/publisher_api/v1/customers/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${uscreenKey}`, accept: 'application/json' } })
      if (response.status === 429) throw new Error('throttled')
      if (!response.ok) return undefined
      return await response.json()
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  return undefined
}

export async function fetchTrialCohort(window, fetchImpl = fetch, now = new Date()) {
  const [invoices, sales] = await Promise.all([fetchUscreenInvoices(window, fetchImpl), fetchReliableSales(fetchImpl).catch(() => [])])
  // Only look up customers whose ledger row cannot already explain them.
  const provisional = buildTrialCohort({ window, invoices, sales, now })
  const needLookup = provisional.rows.filter((row) => row.attribution.evidence !== 'journey_ledger').map((row) => row.uscreen_user_id).slice(0, MAX_CUSTOMER_LOOKUPS)
  const customers = new Map()
  for (let i = 0; i < needLookup.length; i += CUSTOMER_CONCURRENCY) {
    const batch = needLookup.slice(i, i + CUSTOMER_CONCURRENCY)
    const results = await Promise.all(batch.map((id) => fetchCustomer(id, fetchImpl)))
    results.forEach((customer, index) => { if (customer) customers.set(batch[index], customer) })
  }
  const cohort = buildTrialCohort({ window, invoices, sales, customers, now })
  cohort.invoice_history_complete = !invoices.truncated
  cohort.customer_lookups = { attempted: needLookup.length, resolved: customers.size, capped: provisional.rows.length > MAX_CUSTOMER_LOOKUPS }
  return cohort
}
