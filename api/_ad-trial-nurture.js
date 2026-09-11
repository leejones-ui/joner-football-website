// Ad-trial nurture: send the three Brevo templates to people who started a
// Uscreen trial from a paid Meta click, once each, on day 1, 3 and 6, and
// never to someone who has already paid. Runs from the daily cron. Uscreen
// is the source of truth for trial state; Brevo only delivers.
import { fetchTrialCohort } from './_trial-cohort.js'
import { config } from './_meta-uscreen-reconciliation.js'
import { reliabilityKv } from './_reliability-ledger.js'

// Day 1 is matched to the ad the person clicked: Planning Session clickers get
// the session-plan email (329), everyone else the full-session email (326).
export const DAY1_TEMPLATE_BY_AD = Object.freeze([{ match: /planning session/i, templateId: 329 }])
export const NURTURE_STEPS = Object.freeze([
  { step: 'day1', templateId: 326, minDays: 1, maxDays: 3 },
  { step: 'day3', templateId: 327, minDays: 3, maxDays: 6 },
  { step: 'day6', templateId: 328, minDays: 6, maxDays: 7 },
])
// Only trials that started after go-live are nurtured. Earlier Meta trialists
// are already inside the generic Brevo trial automations and must not be
// emailed twice.
export const nurtureFrom = () => process.env.AD_TRIAL_NURTURE_FROM || '2026-09-11T14:00:00Z'
const LOOKBACK_DAYS = 9
const SENT_TTL_SECONDS = 60 * 60 * 24 * 60
const sentKey = (userId, step) => `jf:nurture:ad-trial:${userId}:${step}`
const DAY = 86400000

export function pickStep(row, now = new Date(), steps = NURTURE_STEPS) {
  if (row?.attribution?.channel !== 'meta_ads') return undefined
  if (row.status === 'converted') return undefined
  if (Date.parse(row.trial_started_at) < Date.parse(nurtureFrom())) return undefined
  const days = (now.getTime() - Date.parse(row.trial_started_at)) / DAY
  if (!Number.isFinite(days)) return undefined
  // Day 6 must land before the trial actually ends.
  if (now.getTime() >= Date.parse(row.trial_ends_at)) return undefined
  return steps.find((s) => days >= s.minDays && days < s.maxDays)
}

export function planNurture(rows, now = new Date()) {
  const plan = []
  for (const row of rows || []) {
    const step = pickStep(row, now)
    if (!step) continue
    const ad = String(row.attribution?.ad || '')
    const variant = step.step === 'day1' ? DAY1_TEMPLATE_BY_AD.find((v) => v.match.test(ad)) : undefined
    plan.push({ uscreen_user_id: row.uscreen_user_id, step: step.step, templateId: variant ? variant.templateId : step.templateId, trial_started_at: row.trial_started_at, ad })
  }
  return plan
}

async function fetchCustomerEmail(userId, fetchImpl) {
  const { uscreenKey } = config()
  if (!uscreenKey) throw new Error('uscreen_not_configured')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(`https://www.uscreen.io/publisher_api/v1/customers/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${uscreenKey}`, accept: 'application/json' } })
    if (response.status === 429) { await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); continue }
    if (!response.ok) return undefined
    const customer = await response.json()
    return { email: String(customer?.email || '').trim().toLowerCase(), name: String(customer?.name || '').trim() }
  }
  return undefined
}

async function sendTemplate({ templateId, email, name, step }, fetchImpl) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('brevo_not_configured')
  const response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ templateId, to: [{ email, ...(name ? { name } : {}) }], tags: ['ad-trial-nurture', step] }),
  })
  if (!response.ok) throw new Error(`brevo_${response.status}`)
  return response.json()
}

export async function runAdTrialNurture({ dryRun = true, now = new Date(), fetchImpl = fetch } = {}) {
  const to = now.toISOString().slice(0, 10)
  const from = new Date(now.getTime() - LOOKBACK_DAYS * DAY).toISOString().slice(0, 10)
  const cohort = await fetchTrialCohort({ from, to, timezone: 'UTC' }, fetchImpl, now)
  const summary = { window: { from, to }, dry_run: dryRun, cohort_complete: cohort.invoice_history_complete, meta_trials_in_window: cohort.rows.filter((r) => r.attribution?.channel === 'meta_ads').length, planned: 0, already_sent: 0, sent: 0, skipped_no_email: 0, failed: 0, steps: {} }
  if (!cohort.invoice_history_complete) { summary.aborted = 'invoice_history_incomplete'; return summary }
  const plan = planNurture(cohort.rows, now)
  summary.planned = plan.length
  for (const item of plan) {
    summary.steps[item.step] = (summary.steps[item.step] || 0) + 1
    const key = sentKey(item.uscreen_user_id, item.step)
    const already = await reliabilityKv(['GET', key], fetchImpl).then((r) => r?.result).catch(() => null)
    if (already) { summary.already_sent += 1; continue }
    if (dryRun) continue
    let customer
    try { customer = await fetchCustomerEmail(item.uscreen_user_id, fetchImpl) } catch { customer = undefined }
    if (!customer?.email || !customer.email.includes('@')) { summary.skipped_no_email += 1; continue }
    try {
      const result = await sendTemplate({ templateId: item.templateId, email: customer.email, name: customer.name, step: item.step }, fetchImpl)
      await reliabilityKv(['SET', key, JSON.stringify({ sent_at: now.toISOString(), message_id: result?.messageId, template_id: item.templateId }), 'EX', String(SENT_TTL_SECONDS)], fetchImpl)
      summary.sent += 1
    } catch (error) {
      summary.failed += 1
      summary.last_error = String(error?.message || error)
    }
  }
  return summary
}
