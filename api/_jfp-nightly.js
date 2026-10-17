// Nightly money check (Lee, 18 Oct 2026). Every night it reads Stripe and
// Airtable the same way the Money page does (moneyData) and lists what does
// not match. It never changes a record: the hourly sync records Stripe
// payments, and anything it could not place is for Lee or Ligia to look at.
//
// Checks:
//   unmatched   Stripe payment not linked to any player
//   unrecorded  paid in Stripe, Airtable not updated (the hourly sync should clear these)
//   paidNoMoney Airtable says paid, no money found this term
//   overpaid    more money on a row than its fee (paid twice?)
//   stripeError Stripe could not be read
//   apps        requests that did not copy to Airtable (copied again here)
//
//   jfp:nightly:last      JSON of the last run
//   jfp:nightly:history   list of short summaries, newest first (60 kept)
import { kvCommand, kvGetJson, kvSetJson, getConfig, formatAud } from './_jfp-store.js'
import { telegramAlert } from './_jfp-notify.js'

const LAST = 'jfp:nightly:last'
const HISTORY = 'jfp:nightly:history'
const aud = (c) => formatAud(c)

// Pure: the findings from one moneyData result. Exported for tests.
export function findings(m) {
  const items = []
  for (const p of m.unmatched || []) items.push({ key: `unmatched:${p.id}`, kind: 'unmatched', text: `${p.name || 'Someone with no name on the payment'} paid ${aud(p.cents)} in Stripe, not linked to a player`, cents: p.cents })
  for (const p of (m.players || []).filter((x) => x.status === 'stripe')) items.push({ key: `unrecorded:${p.rowId}`, kind: 'unrecorded', text: `${p.player}: paid in Stripe, Airtable not updated`, cents: p.stripeAppliedCents || 0 })
  for (const p of m.paidNoMoney || []) items.push({ key: `pnm:${p.rowId}`, kind: 'paidNoMoney', text: `${p.player}: Airtable says paid, ${aud(p.missingCents)} not found`, cents: p.missingCents })
  for (const p of (m.players || []).filter((x) => x.status !== 'session' && x.feeCents > 0 && x.receivedCents > x.feeCents)) items.push({ key: `over:${p.rowId}`, kind: 'overpaid', text: `${p.player}: ${aud(p.receivedCents)} came in for a ${aud(p.feeCents)} fee`, cents: p.receivedCents - p.feeCents })
  if (m.stripeError) items.push({ key: 'stripeError', kind: 'stripeError', text: m.stripeError, cents: 0 })
  return items
}

const LABEL = { unmatched: 'Stripe payments not linked to a player', unrecorded: 'Paid in Stripe, not in Airtable', paidNoMoney: 'Marked paid, no money found', overpaid: 'More paid than the fee', stripeError: 'Stripe could not be read', apps: 'Requests not copied to Airtable' }
export const NIGHTLY_LABEL = LABEL

export async function runNightly({ nowMs = Date.now(), alert = true, money } = {}) {
  const config = await getConfig()
  const { moneyData } = await import('./jfp-portal-data.js')
  const m = money || (await moneyData(config, { fresh: true }))
  const items = findings(m)
  // Requests that did not reach Airtable: copy them again.
  let apps = null
  try { const { syncApplications } = await import('./_jfp-app-sync.js'); apps = await syncApplications() } catch (error) { console.error('jfp nightly app copy failed', error); apps = { error: error.message } }
  if (apps?.failed) items.push({ key: 'apps', kind: 'apps', text: `${apps.failed} request${apps.failed === 1 ? '' : 's'} could not be copied to Airtable`, cents: 0 })
  const before = (await kvGetJson(LAST)) || null
  const seen = new Set((before?.items || []).map((x) => x.key))
  for (const x of items) x.new = !seen.has(x.key)
  const counts = {}
  for (const x of items) counts[x.kind] = (counts[x.kind] || 0) + 1
  const rec = { at: new Date(nowMs).toISOString(), term: m.term, ok: items.length === 0, counts, newCount: items.filter((x) => x.new).length, items: items.slice(0, 200), apps }
  await kvSetJson(LAST, rec, 60 * 60 * 24 * 90)
  await kvCommand(['LPUSH', HISTORY, JSON.stringify({ at: rec.at, counts, newCount: rec.newCount })])
  await kvCommand(['LTRIM', HISTORY, '0', '59'])
  // Telegram to Lee and Ligia only when something new turned up.
  if (alert && rec.newCount) {
    const lines = Object.entries(counts).map(([k, n]) => `${LABEL[k] || k}: ${n}`)
    const fresh = items.filter((x) => x.new).slice(0, 6).map((x) => `• ${x.text}`)
    const site = process.env.PUBLIC_SITE_URL || 'https://jonerfootball.com'
    try { await telegramAlert(`JFP nightly money check: ${rec.newCount} new to look at\n${lines.join('\n')}\n\nNew:\n${fresh.join('\n')}\n\n${site}/jfp-portal/#overview`) } catch (error) { console.error('jfp nightly telegram failed', error) }
  }
  return rec
}

export async function lastNightly() {
  const last = await kvGetJson(LAST)
  const raw = (await kvCommand(['LRANGE', HISTORY, '0', '13'])) || []
  const history = raw.map((s) => { try { return JSON.parse(s) } catch { return null } }).filter(Boolean)
  return { last, history }
}
