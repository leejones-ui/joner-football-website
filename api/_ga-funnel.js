import crypto from 'node:crypto'
import { isMetaPaidTouch, isOrganicSocialTouch, normalizeMedium, normalizeSource } from './_source-taxonomy.js'

// "Where they drop off" funnel per channel, read from GA4. GA adds detail only:
// paid buyers stay Uscreen-verified and come from the attribution report, never
// from here. Website steps come from the website property (where ad clicks land);
// app steps come from the Uscreen app property, which only carries the visitor's
// original source from 31 Oct 2026 (website commit 2331daa) onwards.

export const GA_WEBSITE_PROPERTY = '541906886'
export const GA_APP_PROPERTY = '296061189'
export const APP_SOURCE_CARRY_FROM = '2026-10-31'
const MAX_DAYS = 90

// Same names as the dashboard's channel list so the two can be joined.
export const FUNNEL_CHANNELS = ['Meta', 'Paid Search', 'Social', 'Email', 'Organic', 'Referral', 'Direct', 'Other']

const SOCIAL_REFERRER_RE = /(^|\.)(instagram|facebook|youtube|tiktok|threads|linktr|twitter|x)\.(com|ee|net)$|^(t\.co|lnk\.bio)$/
const EMAIL_SOURCE_RE = /brevo|sendibm|sendinblue|mail\.google|outlook|gmail/

export function gaChannel(source, medium) {
  // Links into Uscreen pack the journey into utm_source as "<source>__jfa1__...".
  const rawSource = String(source || '').trim().toLowerCase().split('__jfa1__')[0]
  const rawMedium = String(medium || '').trim().toLowerCase()
  if (rawSource === '(direct)' && (rawMedium === '(none)' || rawMedium === '(not set)')) return 'Direct'
  const touch = { utm_source: rawSource, utm_medium: rawMedium }
  if (isMetaPaidTouch(touch)) return 'Meta'
  const med = normalizeMedium(rawMedium)
  if (['cpc', 'ppc', 'paid_search', 'paidsearch'].includes(med)) return 'Paid Search'
  if (med === 'email' || EMAIL_SOURCE_RE.test(rawSource)) return 'Email'
  if (isOrganicSocialTouch(touch) || SOCIAL_REFERRER_RE.test(rawSource.replace(/^(l|lm|m|www)\./, '')) || normalizeSource(rawSource) === 'youtube') return 'Social'
  if (med === 'organic') return 'Organic'
  if (med === 'referral') return 'Referral'
  return 'Other'
}

// Meta ad links briefly went live with unfilled {{...}} macros (31 Oct 2026,
// about 04:00 to 05:30 UTC). Those visits are counted separately, not dropped
// silently, and excluded from the funnel.
export const isPlaceholderCampaign = (campaign) => /\{\{|%7b%7b/i.test(String(campaign || ''))

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function parseServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try { return JSON.parse(raw) } catch {
    try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) } catch { return null }
  }
}

async function analyticsToken(fetchImpl) {
  const account = parseServiceAccount()
  if (!account?.client_email || !account?.private_key) throw new Error('Google service account is not configured.')
  const now = Math.floor(Date.now() / 1000)
  const claim = { iss: account.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now }
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claim))}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new Error(`Google token failed: ${response.status}`)
  return data.access_token
}

async function runReport(property, body, token, fetchImpl) {
  const response = await fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ limit: 10000, ...body }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`GA report failed for ${property}: ${response.status}`)
  return (data.rows || []).map((row) => ({
    dims: (row.dimensionValues || []).map((d) => d.value),
    value: Number(row.metricValues?.[0]?.value || 0),
  }))
}

const eventReport = (from, to, events) => ({
  dateRanges: [{ startDate: from, endDate: to }],
  dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'sessionCampaignName' }, { name: 'eventName' }],
  metrics: [{ name: 'totalUsers' }],
  dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: events } } },
})

// Website: session_start = visitors, begin_checkout = clicked through to join.
// App (Uscreen): "Sign Up" = account made, "Purchase" = Uscreen checkout done
// (includes free trials, so it is not a paid buyer).
const STEPS = [
  { key: 'visitors', property: 'website', event: 'session_start' },
  { key: 'checkout_clicks', property: 'website', event: 'begin_checkout' },
  { key: 'app_signups', property: 'app', event: 'Sign Up' },
  { key: 'app_checkouts', property: 'app', event: 'Purchase' },
]

export function buildFunnel({ websiteRows, appRows, metaCampaignLimit = 12 }) {
  const channels = Object.fromEntries(FUNNEL_CHANNELS.map((name) => [name, { channel: name, visitors: 0, checkout_clicks: 0, app_signups: 0, app_checkouts: 0 }]))
  const metaCampaigns = {}
  let placeholderVisits = 0
  for (const [rows, property] of [[websiteRows, 'website'], [appRows, 'app']]) {
    for (const { dims: [source, medium, campaign, eventName], value } of rows) {
      const step = STEPS.find((s) => s.property === property && s.event === eventName)
      if (!step) continue
      if (isPlaceholderCampaign(campaign)) {
        if (step.key === 'visitors') placeholderVisits += value
        continue
      }
      const channel = gaChannel(source, medium)
      channels[channel][step.key] += value
      if (channel === 'Meta' && property === 'website') {
        const decoded = String(campaign || '').replace(/\+/g, ' ').trim()
        const name = decoded && decoded !== '(not set)' ? decoded : '(no campaign name)'
        metaCampaigns[name] ||= { campaign: name, visitors: 0, checkout_clicks: 0 }
        metaCampaigns[name][step.key] += value
      }
    }
  }
  return {
    channels: FUNNEL_CHANNELS.map((name) => channels[name]),
    meta_campaigns: Object.values(metaCampaigns).sort((a, b) => b.visitors - a.visitors).slice(0, metaCampaignLimit),
    placeholder_visits_excluded: placeholderVisits,
  }
}

export function funnelRange(query = {}, now = new Date()) {
  const iso = (d) => d.toISOString().slice(0, 10)
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to || '')) ? String(query.to) : iso(now)
  let from = /^\d{4}-\d{2}-\d{2}$/.test(String(query.from || '')) ? String(query.from) : null
  if (!from) {
    const days = Math.min(MAX_DAYS, Math.max(1, Number(query.days) || 28))
    from = iso(new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86400000))
  }
  const minFrom = iso(new Date(Date.parse(`${to}T00:00:00Z`) - (MAX_DAYS - 1) * 86400000))
  if (from < minFrom) from = minFrom
  return { from, to }
}

export async function readGaFunnel(query = {}, fetchImpl = fetch) {
  const { from, to } = funnelRange(query)
  const token = await analyticsToken(fetchImpl)
  const websiteEvents = STEPS.filter((s) => s.property === 'website').map((s) => s.event)
  const appEvents = STEPS.filter((s) => s.property === 'app').map((s) => s.event)
  const [websiteRows, appRows] = await Promise.all([
    runReport(GA_WEBSITE_PROPERTY, eventReport(from, to, websiteEvents), token, fetchImpl),
    runReport(GA_APP_PROPERTY, eventReport(from, to, appEvents), token, fetchImpl),
  ])
  return {
    from,
    to,
    app_source_carry_from: APP_SOURCE_CARRY_FROM,
    app_steps_partial: from < APP_SOURCE_CARRY_FROM,
    ...buildFunnel({ websiteRows, appRows }),
  }
}
