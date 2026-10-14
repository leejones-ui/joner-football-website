// Saved card or bank account, and automatic charging after each session
// (Lee, 14 Oct 2026). Session by session players (JFP and Pro sessions) can
// save a payment method once, and we charge it the day after each session.
//
// What we keep: nothing that is a card or bank number. Stripe holds the card
// or account (a Stripe Customer per family email, a SetupIntent for off
// session use, the PaymentMethod it made). We keep the Stripe ids, what to
// show (brand and last 4, or the bank's last 4 and the first 3 of the BSB),
// and the consent: when, which wording and which version.
//
// Saving (family, My account > Fees):
//   1. the family ticks the consent and taps Continue
//   2. a Stripe Checkout page in setup mode (card with Apple Pay and Google
//      Pay, or BECS Direct Debit, where Stripe shows its own mandate too)
//   3. back on My account (?saved=<session>) and from the webhook: the
//      method is read from Stripe and saved under the family email
//   Replace runs the same again (the old one is detached); Remove detaches it.
//
// Charging (daily job, 10:00 Sydney time, and staff "Run now"):
//   every session by session row that holds a place, whose family has a
//   saved method, for each session date since the method was saved (and
//   since the player joined or moved into the group), the day after:
//     covered        a committed date ([COVERED:]) or a date on a paid pay
//                    ahead link: skipped
//     told in time   "Can't make it" sent 24 hours or more before: skipped.
//                    Told late or not at all (a no-show): charged
//     paused         staff paused auto-charge for the player: skipped
//     open link      the date is on a pay ahead link not paid yet: left
//     prepaid        an older undated [PREPAID:n]: one comes off, no charge
//     no price       no price per session: left for staff
//     otherwise      charged: the player's price ([PERSESSION:] or the
//                    price list's default), off session, with the saved method
//   One record per player row and date (jfp:autocharge:<row>:<date>, set
//   once with NX), and the same Stripe idempotency key on every try, so a
//   session is never charged twice.
//
// Each charge is a payment request (PAY-..., reason 'sessions', autoCharge)
// so it is recorded exactly as a paid session invoice is: the session goes
// on the row's fee, finalise marks the row paid and writes the ledger line,
// and the family gets a receipt. Declined or needs the cardholder: the same
// request becomes a Pay link, the family is emailed it and staff see it
// flagged. BECS: processing first, finished by the webhook when it clears
// (payment_intent.succeeded) or turned into a Pay link if it fails.
import { stripeSecret, siteUrl } from './_holiday-store.js'
import {
  kvCommand, kvGetJson, kvSetJson, kvPipeline, clean, newId, formatAud, dateLabel, sydneyToday, getConfig, listGroups, listPayreqs, getPayreq, savePayreq,
  audit, listAudit, claimOnce, emailsIn, rowEmails, isSessionType, isProType, withPerSession, prepaidOf, withPrepaid, keys,
} from './_jfp-store.js'
import { loadRoster, getTerm4Row, updateTerm4Rows, appendNote, bustRosterCache } from './_jfp-airtable.js'
import { listCancels, rowSessionDates, rowTime, noticeFor, LATE_MINUTES } from './_jfp-cancel.js'
import { perSessionFor } from './_jfp-account-pay.js'
import { coveredOf } from './_jfp-quote.js'
import { finaliseJfpBooking } from './_jfp-finalise.js'
import { sendFamilyNotice } from './_jfp-email.js'
import { telegramAlert } from './_jfp-notify.js'
import { listCharges, getCharge, chargeStatus } from './_jfp-charges.js'

export const CONSENT_VERSION = 'jfp-auto-charge-v2 (14 Oct 2026)'
// Sessions further back than this are never charged automatically (a job
// that did not run for a while does not surprise a family with a pile).
export const LOOKBACK_DAYS = 14
// The daily job charges from 10:00 Sydney time (Vercel crons run in UTC).
export const RUN_HOUR = 10
const STALE_CHARGING_MS = 10 * 60 * 1000
const LONG = 60 * 60 * 24 * 400
// The Money tab's Stripe list (api/_jfp-stripe.js CACHE): read again after a charge.
const STRIPE_LIST_CACHE = 'jfp:stripe-payments:v2'

export const K = {
  customer: (email) => `jfp:savedpay:cust:${email}`,
  method: (email) => `jfp:savedpay:method:${email}`,
  setup: (sessionId) => `jfp:savedpay:setup:${sessionId}`,
  lock: (email) => `jfp:savedpay:lock:${email}`,
  pause: 'jfp:autocharge:pause',
  charge: (rowId, date) => `jfp:autocharge:${rowId}:${date}`,
  index: 'jfp:autocharge:index',
  last: 'jfp:autocharge:last',
  paid: 'jfp:autocharge:paid',
  runLock: 'jfp:autocharge:run-lock',
  lastRun: 'jfp:autocharge:last-run',
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const cents = (aud) => (typeof aud === 'number' && Number.isFinite(aud) ? Math.round(aud * 100) : 0)
const normEmail = (v) => emailsIn(v)[0] || ''
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }
const sydneyHour = (ms) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)))
const isTest = (name) => /test/i.test(name || '')

// ---------- the words families agree to ----------

// Shown on the page, saved with the method. No em dashes in family copy.
// v2 (Lee, 14 Oct 2026): it covers session by session fees and the extra
// sessions booked, each charged after the session.
export function consentText(kind, { self = false } = {}) {
  const what = kind === 'bank' ? 'this bank account' : 'this card'
  return self
    ? `I authorise Joner Football to charge ${what} for my session by session fees and the extra sessions I book, after each session I attend or miss without notice, at the agreed price, until I remove it.`
    : `I authorise Joner Football to charge ${what} for my player's session by session fees and the extra sessions booked for them, after each session they attend or miss without notice, at the agreed price, until I remove it.`
}
// Stripe's BECS Direct Debit Request wording (Stripe shows it on its own page too).
export const BECS_MANDATE = 'By providing your bank account details, you agree to this Direct Debit Request and the Direct Debit Request service agreement, and authorise Stripe Payments Australia Pty Ltd ACN 160 180 343 Direct Debit User ID number 507156 ("Stripe") to debit your account through the Bulk Electronic Clearing System (BECS) on behalf of Joner Football (the "Merchant") for any amounts separately communicated to you by the Merchant. You certify that you are either an account holder or an authorised signatory on the account listed above.'
export const BECS_AGREEMENT_URL = 'https://stripe.com/au-becs-dd-service-agreement/legal'

// ---------- Stripe ----------

// Like stripeFetch (same Sydney account and key), but it can send an
// Idempotency-Key and hands back Stripe's error object (a declined card's
// payment intent is inside it) instead of throwing.
export async function stripeCall(path, { method = 'GET', body, idem = '' } = {}) {
  const secret = stripeSecret()
  if (!secret) return { ok: false, status: 0, data: { error: { message: 'STRIPE_SECRET_KEY_SYDNEY is not configured.' } } }
  try {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${secret}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(idem ? { 'idempotency-key': idem } : {}) },
      body: body ? new URLSearchParams(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch (error) {
    return { ok: false, status: 0, data: { error: { message: String(error?.message || error) } } }
  }
}
async function stripeOk(path, opts) {
  const r = await stripeCall(path, opts)
  if (!r.ok) throw new Error(r.data?.error?.message || `Stripe request failed: ${r.status}`)
  return r.data
}

// One Stripe Customer per family email: the one we made before, else one
// Stripe already has for that email, else a new one.
export async function ensureCustomer(email, name = '') {
  const e = normEmail(email)
  if (!e) throw new Error('No email for the Stripe customer.')
  const known = await kvCommand(['GET', K.customer(e)])
  if (known) return known
  const found = await stripeOk(`/customers?email=${encodeURIComponent(e)}&limit=10`)
  let id = (found.data || []).find((c) => c && !c.deleted && String(c.email || '').toLowerCase() === e)?.id || ''
  if (!id) id = (await stripeOk('/customers', { method: 'POST', body: { email: e, ...(name ? { name: clean(name, 100) } : {}), 'metadata[source]': 'JFP portal saved payment' }, idem: `jfp-customer-${e}` })).id
  await kvCommand(['SET', K.customer(e), id])
  return id
}

// What we show of a payment method. Never a full number.
export function methodSummary(pm) {
  if (pm?.type === 'au_becs_debit') {
    const b = pm.au_becs_debit || {}
    return { type: 'au_becs_debit', kind: 'bank', last4: clean(b.last4, 4), bsbStart: clean(String(b.bsb_number || '').replace(/\D/g, '').slice(0, 3), 3) }
  }
  const c = pm?.card || {}
  return { type: 'card', kind: 'card', brand: clean(c.brand, 20), last4: clean(c.last4, 4), expMonth: Number(c.exp_month) || null, expYear: Number(c.exp_year) || null, wallet: clean(c.wallet?.type || '', 20) }
}
const BRAND = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', diners: 'Diners', jcb: 'JCB', unionpay: 'UnionPay', discover: 'Discover', eftpos_au: 'eftpos' }
const WALLET = { apple_pay: 'Apple Pay', google_pay: 'Google Pay', link: 'Link' }
export function methodView(m) {
  if (!m) return null
  const bank = m.kind === 'bank'
  return {
    kind: m.kind,
    label: bank ? `Bank account ending ${m.last4}` : `${BRAND[m.brand] || (m.brand ? m.brand[0].toUpperCase() + m.brand.slice(1) : 'Card')} ending ${m.last4}`,
    detail: bank ? `BSB ${m.bsbStart || '***'}-***, BECS Direct Debit` : `${m.expMonth ? `Expires ${String(m.expMonth).padStart(2, '0')}/${String(m.expYear || '').slice(-2)}` : ''}${m.wallet ? `${m.expMonth ? ', ' : ''}saved with ${WALLET[m.wallet] || m.wallet}` : ''}`,
    staffLabel: bank ? 'Direct debit on file' : 'Card on file',
    short: bank ? `bank ending ${m.last4}` : `card ending ${m.last4}`,
    savedAt: m.savedAt || '', savedLabel: m.savedAt ? dateLabel(sydneyToday(Date.parse(m.savedAt))) : '',
  }
}

export async function getMethod(email) { const e = normEmail(email); return e ? kvGetJson(K.method(e)) : null }
// Saved methods for many emails at once: Map email -> method.
export async function methodsFor(emails) {
  const list = [...new Set(emails.map(normEmail).filter(Boolean))]
  if (!list.length) return new Map()
  const got = await kvPipeline(list.map((e) => ['GET', K.method(e)]))
  return new Map(list.map((e, i) => [e, parse(got[i])]).filter(([, m]) => m && m.pmId))
}
// The method that pays for a row: the first of its emails with one.
const methodForRow = (r, methods) => rowEmails(r).map((e) => methods.get(normEmail(e))).find(Boolean) || null

async function pausedRows() {
  const flat = await kvCommand(['HGETALL', K.pause]).catch(() => [])
  const out = new Map()
  for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) { const v = parse(flat[i + 1]); if (v) out.set(flat[i], v) }
  return out
}
async function lastResults() {
  const flat = await kvCommand(['HGETALL', K.last]).catch(() => [])
  const out = new Map()
  for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) { const v = parse(flat[i + 1]); if (v) out.set(flat[i], v) }
  return out
}

// ---------- the family saves, replaces, removes ----------

const sessionRows = (fam) => fam.players.flatMap((p) => p.term4.map((r) => ({ ...r, playerName: p.name }))).filter((r) => r.holdsPlace && isSessionType(r.paymentType) && !/trial/i.test(r.paymentType || ''))

// Fees > "Save a card or bank account for session payments".
export async function familySavedView({ config, parent, fam }) {
  const email = normEmail(parent.email)
  const mine = await getMethod(email)
  const others = mine ? null : [...(await methodsFor((fam.emails || []).filter((e) => normEmail(e) !== email))).values()][0] || null
  const [groups, pauses] = await Promise.all([listGroups(), pausedRows()])
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, g]))
  const rows = sessionRows(fam)
  const players = rows.map((r) => {
    const g = byGroup[r.groupId] || null
    const per = perSessionFor(config, r, g)
    return { rowId: r.id, name: r.player, perCents: per, perLabel: per ? formatAud(per) : '', when: g ? `${g.day}s ${g.time}` : '', paused: pauses.has(r.id) }
  })
  const ids = new Set(rows.map((r) => r.id))
  const recent = (await recentCharges({ limit: 300 })).filter((x) => ids.has(x.rowId)).slice(0, 8).map((x) => ({ date: x.date, dateLabel: dateLabel(x.date), player: x.player, amountLabel: formatAud(x.amountCents), status: x.status, statusLabel: FAMILY_STATUS[x.status] || '', payreqId: ['failed', 'action'].includes(x.status) ? x.payreqId : '' })).filter((x) => x.statusLabel)
  const self = rows.length > 0 && rows.every((r) => r.ownContact)
  return {
    method: methodView(mine), mine: Boolean(mine),
    other: others ? { label: methodView(others).label, email: others.email } : null,
    consent: { card: consentText('card', { self }), bank: consentText('bank', { self }), becsMandate: BECS_MANDATE, becsAgreementUrl: BECS_AGREEMENT_URL, version: CONSENT_VERSION },
    consentAt: mine?.consent?.at || '',
    players, recent, self,
  }
}
const FAMILY_STATUS = { succeeded: 'Paid', processing: 'Direct debit processing', failed: 'Not paid: pay link sent', action: 'Not paid: pay link sent', uncertain: 'Being checked' }

// Start a Stripe Checkout page in setup mode. body: { kind: 'card'|'bank', agree: true }.
export async function startSetup({ req, parent, fam, body }) {
  const kind = body.kind === 'bank' ? 'bank' : body.kind === 'card' ? 'card' : ''
  if (!kind) return { ok: false, status: 400, error: 'Choose a card or a bank account.' }
  const email = normEmail(parent.email)
  if (!email) return { ok: false, status: 400, error: 'Sign in again to save a payment method.' }
  const self = sessionRows(fam).length > 0 && sessionRows(fam).every((r) => r.ownContact)
  if (body.agree !== true) return { ok: false, status: 400, error: kind === 'bank' ? 'Tick the box to agree to the authority and the Direct Debit Request first.' : 'Tick the box to agree first.', code: 'consent' }
  let customerId
  try { customerId = await ensureCustomer(email, fam.parentName || '') } catch (error) { console.error('jfp saved pay customer failed', error.message); return { ok: false, status: 503, error: 'Stripe could not be reached just now. Try again in a minute.' } }
  const base = siteUrl(req)
  const r = await stripeCall('/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'setup',
      customer: customerId,
      currency: 'aud',
      'payment_method_types[0]': kind === 'bank' ? 'au_becs_debit' : 'card',
      success_url: `${base}/jfp-account/?saved={CHECKOUT_SESSION_ID}#fees`,
      cancel_url: `${base}/jfp-account/#fees`,
      'metadata[jfpSavedPay]': '1',
      'metadata[jfpEmail]': email,
      'setup_intent_data[metadata][jfpSavedPay]': '1',
      'setup_intent_data[metadata][jfpEmail]': email,
      'setup_intent_data[description]': 'Joner Football: session payments, charged after each session',
    },
  })
  if (!r.ok || !r.data?.url) { console.error('jfp saved pay setup session failed', r.data?.error?.message); return { ok: false, status: 503, error: kind === 'bank' ? 'Bank accounts cannot be saved just now. Try a card, or try again later.' : 'Stripe could not be reached just now. Try again in a minute.' } }
  await kvSetJson(K.setup(r.data.id), { email, customerId, kind, consent: { at: new Date().toISOString(), version: CONSENT_VERSION, text: consentText(kind, { self }), ...(kind === 'bank' ? { mandate: BECS_MANDATE, agreementUrl: BECS_AGREEMENT_URL } : {}) }, createdAt: new Date().toISOString() }, 86400 * 3)
  await audit({ by: email, action: 'savedpay.start', target: email, after: { kind, session: r.data.id } })
  return { ok: true, url: r.data.url }
}

// After Stripe: from the page (?saved=<session>, signed in) or the webhook.
// Safe to run twice: the second run finds the method already saved.
export async function confirmSetup(sessionId, { email: signedIn = '', famEmails = [] } = {}) {
  const sid = clean(sessionId, 120)
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return { ok: false, status: 400, error: 'That link is not valid.' }
  const pending = await kvGetJson(K.setup(sid))
  if (!pending) return { ok: false, status: 404, error: 'We could not find that. Try saving again.' }
  const mineToo = new Set([normEmail(signedIn), ...famEmails.map(normEmail)].filter(Boolean))
  if (signedIn && !mineToo.has(pending.email)) return { ok: false, status: 404, error: 'We could not find that. Try saving again.' }
  const sess = await stripeCall(`/checkout/sessions/${encodeURIComponent(sid)}?expand[]=setup_intent.payment_method`)
  if (!sess.ok) return { ok: false, status: 503, error: 'Stripe could not be reached just now. Refresh in a minute.' }
  const s = sess.data
  if (s.metadata?.jfpSavedPay !== '1' || s.mode !== 'setup' || (s.customer && s.customer !== pending.customerId)) return { ok: false, status: 404, error: 'We could not find that. Try saving again.' }
  if (s.status !== 'complete') return { ok: false, status: 409, error: 'That was not finished, so nothing was saved.', code: 'not-complete' }
  let si = s.setup_intent
  if (typeof si === 'string') { const g = await stripeCall(`/setup_intents/${encodeURIComponent(si)}?expand[]=payment_method`); si = g.ok ? g.data : null }
  if (!si || si.status !== 'succeeded') return { ok: false, status: 409, error: 'Stripe is still checking it. Refresh in a minute.', code: 'pending' }
  let pm = si.payment_method
  if (typeof pm === 'string') { const g = await stripeCall(`/payment_methods/${encodeURIComponent(pm)}`); pm = g.ok ? g.data : null }
  if (!pm?.id) return { ok: false, status: 503, error: 'Stripe could not be reached just now. Refresh in a minute.' }
  const email = pending.email
  if ((await kvCommand(['SET', K.lock(email), '1', 'NX', 'EX', '20'])) !== 'OK') return { ok: false, status: 409, error: 'Just a moment, that is still being saved.', code: 'busy' }
  try {
    const before = await getMethod(email)
    if (before?.pmId === pm.id) return { ok: true, already: true, method: methodView(before) }
    // A newer save already replaced this one: leave the newer one.
    if (before?.savedAt && pending.consent?.at && before.consent?.at > pending.consent.at) return { ok: true, already: true, method: methodView(before) }
    const m = {
      email, customerId: pending.customerId, pmId: pm.id, setupIntentId: si.id, checkoutSessionId: sid,
      mandateId: typeof si.mandate === 'string' ? si.mandate : si.mandate?.id || '',
      ...methodSummary(pm),
      consent: pending.consent, savedAt: new Date().toISOString(),
    }
    await kvSetJson(K.method(email), m)
    await kvSetJson(K.setup(sid), { ...pending, doneAt: m.savedAt }, 86400 * 3)
    // Replaced: the old card or account is taken off the customer at Stripe.
    if (before?.pmId && before.pmId !== pm.id) await stripeCall(`/payment_methods/${encodeURIComponent(before.pmId)}/detach`, { method: 'POST', body: {} })
    await audit({ by: email, action: before ? 'savedpay.replace' : 'savedpay.save', target: email, before: before ? { kind: before.kind, last4: before.last4 } : undefined, after: { kind: m.kind, last4: m.last4, consentVersion: m.consent?.version, consentAt: m.consent?.at } })
    const v = methodView(m)
    if (await claimOnce(`jfp:savedpay:saved-email:${pm.id}`, LONG)) {
      try {
        await sendFamilyNotice({
          to: email, subject: `${v.label} saved for session payments`, heading: 'Saved for session payments', kind: 'saved payment method',
          paras: ['Thanks. From now on we charge it the day after each session, at the agreed price: session by session fees and the extra sessions booked. We email you a receipt each time.', `What you agreed to: ${m.consent?.text || consentText(m.kind)}`, ...(m.kind === 'bank' ? ['Direct debits take 2 to 3 business days to clear. Stripe sends you its Direct Debit Request by email too.'] : []), 'You can replace or remove it any time in My account, Fees.'],
          list: [['Saved', v.label], ['On', v.savedLabel]],
          cta: { label: 'Open My account', url: `${siteUrl()}/jfp-account/#fees` },
        })
      } catch (error) { console.error('jfp saved pay email failed', error.message) }
    }
    return { ok: true, method: v }
  } finally { await kvCommand(['DEL', K.lock(email)]).catch(() => {}) }
}

export async function removeSaved({ parent }) {
  const email = normEmail(parent.email)
  const m = await getMethod(email)
  if (!m) return { ok: true, already: true }
  const d = await stripeCall(`/payment_methods/${encodeURIComponent(m.pmId)}/detach`, { method: 'POST', body: {} })
  // Already gone at Stripe is fine; anything else is said, and nothing is removed here.
  if (!d.ok && !/no longer attached|not attached|No such PaymentMethod/i.test(d.data?.error?.message || '') && d.status !== 404) return { ok: false, status: 503, error: 'Stripe could not be reached just now, so it is still saved. Try again in a minute.' }
  await kvCommand(['DEL', K.method(email)])
  await audit({ by: email, action: 'savedpay.remove', target: email, before: { kind: m.kind, last4: m.last4 } })
  try { await sendFamilyNotice({ to: email, subject: 'Saved payment method removed', heading: 'Removed', kind: 'saved payment method', paras: [`${methodView(m).label} is no longer saved, and nothing more will be charged to it. Pay for sessions in My account, Fees.`], cta: { label: 'Open My account', url: `${siteUrl()}/jfp-account/#fees` } }) } catch (error) { console.error('jfp saved pay removed email failed', error.message) }
  return { ok: true }
}

// ---------- the plan: who, which date, how much, or why not ----------

const SKIP = {
  covered: 'Paid in advance (commitment or pay ahead)',
  told: 'Told us in time',
  paused: 'Auto-charge paused',
  'open-link': 'On a pay ahead link not paid yet',
  prepaid: 'Prepaid from My account: one comes off, nothing charged',
  'no-price': 'No price per session set',
}
// Kept for good (the date is settled); the others are looked at again next run.
const PERMANENT = new Set(['covered', 'told', 'paused', 'prepaid'])

// The latest moment a row started holding its current place: moved into
// the group, or put back after being removed. Sessions before it are not
// this group's to charge.
function placeSince(events, rowId) {
  let at = 0
  for (const e of events) if (e.target === rowId && ['player.move', 'player.restore'].includes(e.action)) at = Math.max(at, Date.parse(e.at) || 0)
  return at
}

// fresh: Airtable read now (a run); the preview takes the roster cache.
export async function planAutoCharges({ config, nowMs = Date.now(), fresh = true } = {}) {
  config = config || await getConfig()
  const today = sydneyToday(nowMs)
  const from = addDays(today, -LOOKBACK_DAYS)
  const [roster, groups, payreqs, cancels, pauses, events] = await Promise.all([loadRoster({ fresh }), listGroups(), listPayreqs(), listCancels(), pausedRows(), listAudit(5000).catch(() => [])])
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, g]))
  const rows = roster.players.filter((r) => r.holdsPlace && r.groupId && byGroup[r.groupId] && isSessionType(r.paymentType) && !/trial/i.test(r.paymentType || '') && !isTest(r.player))
  const methods = await methodsFor(rows.flatMap(rowEmails))
  const items = []
  for (const r of rows) {
    const m = methodForRow(r, methods)
    if (!m) continue
    const group = byGroup[r.groupId]
    const time = rowTime(r, group)
    const since = Math.max(Date.parse(m.consent?.at || m.savedAt) || 0, placeSince(events, r.id))
    const dates = rowSessionDates(config, r, group).filter((d) => d < today && d >= from)
    if (!dates.length) continue
    const pre = payreqs.filter((q) => q.prepay?.rowId === r.id)
    const covered = new Set([...coveredOf(r.notes), ...pre.filter((q) => q.status === 'paid').flatMap((q) => q.prepay.dates || [])])
    const onOpen = new Set(pre.filter((q) => ['open', 'checkout'].includes(q.status)).flatMap((q) => q.prepay.dates || []))
    let undated = Math.max(0, prepaidOf(r.notes) - covered.size)
    const per = perSessionFor(config, r, group)
    const recs = await kvPipeline(dates.map((d) => ['GET', K.charge(r.id, d)]))
    const marks = await kvPipeline(dates.map((d) => ['HGET', keys.attendance(group.id, d), r.id]))
    dates.forEach((d, i) => {
      const n = noticeFor({ date: d, time, nowMs })
      if (!n || n.startMs <= since || n.startMs > nowMs) return
      const rec = parse(recs[i])
      const base = { rowId: r.id, player: r.player, email: m.email, date: d, dateLabel: dateLabel(d), amountCents: per, amountLabel: per ? formatAud(per) : '', method: methodView(m), programme: isProType(r.paymentType) ? 'pro' : 'jfp', register: marks[i] || '', self: r.ownContact === true, parentName: r.ownContact ? '' : r.parent || '' }
      if (rec) {
        // An earlier try whose outcome is not known yet: tried again with the same key.
        const stuck = rec.status === 'uncertain' || (rec.status === 'charging' && nowMs - (Date.parse(rec.at) || 0) > STALE_CHARGING_MS)
        if (stuck) items.push({ ...base, amountCents: rec.amountCents, amountLabel: formatAud(rec.amountCents), action: 'charge', retry: rec, note: 'Trying again: the last try did not finish' })
        return
      }
      if (covered.has(d)) return items.push({ ...base, action: 'skip', reason: 'covered' })
      const c = cancels.find((x) => x.rowId === r.id && x.date === d && x.status === 'active')
      if (c && c.noticeMinutes >= LATE_MINUTES) return items.push({ ...base, action: 'skip', reason: 'told', reasonLabel: `${SKIP.told} (${c.noticeLabel || `${Math.floor(c.noticeMinutes / 60)} h notice`})` })
      if (pauses.has(r.id)) return items.push({ ...base, action: 'skip', reason: 'paused' })
      if (onOpen.has(d)) return items.push({ ...base, action: 'skip', reason: 'open-link' })
      if (undated > 0) { undated -= 1; return items.push({ ...base, action: 'skip', reason: 'prepaid' }) }
      if (!per) return items.push({ ...base, action: 'skip', reason: 'no-price' })
      const note = c ? `Told us late (${c.noticeLabel || 'under 24 h notice'}): charged` : base.register === 'Absent' ? 'Marked absent with no notice: charged' : ''
      items.push({ ...base, action: 'charge', ...(note ? { note } : {}) })
    })
  }
  // Extra sessions (Lee, 14 Oct 2026, round 2): an open charge for a family
  // with a saved method is charged the day after its session, like a session.
  const charges = (await listCharges().catch(() => [])).filter((c) => c.kind === 'extra' && c.payreqId && c.sessionDate && c.sessionDate < today && c.sessionDate >= from && chargeStatus(c) === 'open' && !isTest(c.playerName))
  if (charges.length) {
    const rowsById = new Map(roster.players.map((r) => [r.id, r]))
    const emailsOf = (c) => [c.email, ...(rowsById.get(c.rowId) ? rowEmails(rowsById.get(c.rowId)) : [])]
    const cm = await methodsFor(charges.flatMap(emailsOf))
    const byId = new Map(payreqs.map((q) => [q.id, q]))
    const recs = await kvPipeline(charges.map((c) => ['GET', K.charge(c.id, c.sessionDate)]))
    charges.forEach((c, i) => {
      const m = emailsOf(c).map((e) => cm.get(normEmail(e))).find(Boolean)
      if (!m || c.sessionDate < sydneyToday(Date.parse(m.consent?.at || m.savedAt) || 0)) return
      const q = byId.get(c.payreqId)
      if (!q || !['open', 'checkout', 'charging'].includes(q.status)) return
      const r = rowsById.get(c.rowId)
      const base = { type: 'payreq', key: c.id, chargeId: c.id, payreqId: q.id, what: c.label, rowId: c.rowId || '', player: c.playerName, email: m.email, date: c.sessionDate, dateLabel: dateLabel(c.sessionDate), amountCents: q.amountCents, amountLabel: formatAud(q.amountCents), method: methodView(m), programme: 'extra', register: '', self: Boolean(r?.ownContact), parentName: r?.ownContact ? '' : c.parentName || '' }
      const rec = parse(recs[i])
      if (rec) {
        const stuck = rec.status === 'uncertain' || (rec.status === 'charging' && nowMs - (Date.parse(rec.at) || 0) > STALE_CHARGING_MS)
        if (stuck) items.push({ ...base, amountCents: rec.amountCents, amountLabel: formatAud(rec.amountCents), action: 'charge', retry: rec, note: 'Trying again: the last try did not finish' })
        return
      }
      if (c.rowId && pauses.has(c.rowId)) return items.push({ ...base, action: 'skip', reason: 'paused' })
      if (q.status === 'checkout') return items.push({ ...base, action: 'skip', reason: 'open-link', reasonLabel: 'The family has its payment page open' })
      items.push({ ...base, action: 'charge', note: c.label })
    })
  }
  for (const x of items) if (x.action === 'skip') { x.reasonLabel = x.reasonLabel || SKIP[x.reason]; x.permanent = PERMANENT.has(x.reason) }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.player.localeCompare(b.player))
}

// ---------- records ----------

// A record is per key and date: a session's key is its player row, a
// charge's (extra session, analysis, invoice) is the charge or invoice id.
const keyOf = (x) => x.key || x.rowId
async function saveRec(rec) {
  await kvPipeline([
    ['SET', K.charge(keyOf(rec), rec.date), JSON.stringify(rec)],
    ['ZADD', K.index, String(Date.parse(rec.at) || Date.now()), `${keyOf(rec)}|${rec.date}`],
    ...(rec.rowId ? [['HSET', K.last, rec.rowId, JSON.stringify({ date: rec.date, status: rec.status, amountCents: rec.amountCents, at: rec.updatedAt || rec.at, reason: rec.reason || '', error: rec.error || '', payreqId: rec.payreqId || '', what: rec.what || '' })]] : []),
  ])
  return rec
}
export async function getRec(key, date) { return parse(await kvCommand(['GET', K.charge(clean(key, 60), clean(date, 10))])) }
export async function recentCharges({ limit = 60, rowId = '' } = {}) {
  const members = (await kvCommand(['ZREVRANGE', K.index, '0', String(Math.max(limit, 1) * (rowId ? 10 : 1) - 1)])) || []
  const all = members.map((x) => { const [r, d] = x.split('|'); return [r, d] })
  const got = all.length ? await kvPipeline(all.map(([r, d]) => ['GET', K.charge(r, d)])) : []
  const recs = got.map(parse).filter(Boolean)
  return (rowId ? recs.filter((x) => x.rowId === rowId) : recs).slice(0, limit)
}

// ---------- charging ----------

const STAFF = { email: 'auto: saved payment', name: 'Auto-charge' }

// The session goes on the row's fee, once (the payment request id in the note says it is there).
async function billRow(rec, q, word) {
  const r = await getTerm4Row(rec.rowId)
  if (!r) throw new Error(`Airtable row missing: ${rec.rowId}`)
  if (String(r.notes || '').includes(q.id)) return r
  const fee = (isSessionType(r.paymentType) ? cents(r.feeAud) : cents(r.paidAud)) + rec.amountCents
  const paid = cents(r.paidAud)
  await updateTerm4Rows([{ id: r.id, fields: {
    'Term 4 Fee': fee / 100,
    'Term 4 Payment Status': paid >= fee ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid',
    'Term 4 Notes': appendNote(r.perSessionCents ? r.notes : withPerSession(r.notes, rec.amountCents), `Auto-charge for the session on ${rec.date}: 1 x ${formatAud(rec.amountCents)} to the saved ${rec.method?.short || 'payment method'}, ${word}, ${q.id}.`),
  } }])
  await bustRosterCache()
  return r
}

function newPayreq(rec) {
  return {
    id: rec.payreqId,
    email: rec.email, parentName: rec.parentName || '',
    ...(rec.programme === 'pro' ? { programme: 'pro' } : {}),
    ...(rec.self ? { ownContact: true } : {}),
    playerNames: [rec.player], playerKeys: [String(rec.player).toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')], term4Ids: [rec.rowId],
    groupId: '', groupLabel: 'Session by session',
    amountCents: rec.amountCents, reason: 'sessions', requestId: '', product: '', productLabel: '', startDate: '', trialDate: '', creditCents: 0, afterpay: false,
    places: [{ rowId: rec.rowId, name: rec.player, label: `Session on ${dateLabel(rec.date)} at ${formatAud(rec.amountCents)}`, feeCents: rec.amountCents, paidCents: 0, owingCents: rec.amountCents }],
    autoCharge: { date: rec.date, rowId: rec.rowId, method: rec.method?.label || '', kind: rec.method?.kind || 'card' },
    status: 'charging', createdBy: STAFF.email, createdAt: new Date().toISOString(), expiresAt: '', siteUrl: siteUrl(),
  }
}

// Stripe's word on a failure, in plain words for the family and staff.
function failWords(err, pi) {
  const code = err?.decline_code || err?.code || pi?.last_payment_error?.decline_code || pi?.last_payment_error?.code || pi?.status || ''
  if (/authentication_required|requires_action/.test(code)) return { code, family: 'Your bank asked you to confirm the payment yourself.', staff: 'Needs the cardholder (bank asked to confirm)' }
  if (/insufficient_funds/.test(code)) return { code, family: 'The payment was declined for insufficient funds.', staff: 'Declined: insufficient funds' }
  if (/expired_card/.test(code)) return { code, family: 'The card has expired.', staff: 'Declined: card expired' }
  if (/card_declined|generic_decline|do_not_honor/.test(code)) return { code, family: 'The payment was declined.', staff: 'Declined' }
  return { code, family: 'The payment did not go through.', staff: `Not paid${err?.message ? `: ${clean(err.message, 120)}` : ''}` }
}

// The cron and the webhook can both settle the same charge: one at a time,
// so the session goes on the row's fee once.
async function settling(rec, fn) {
  const key = `jfp:autocharge:settle:${rec.payreqId}`
  if ((await kvCommand(['SET', key, '1', 'NX', 'EX', '120'])) !== 'OK') return { busy: true, status: 'busy' }
  try { return await fn() } finally { await kvCommand(['DEL', key]).catch(() => {}) }
}

async function succeed(rec, piId, amount) { return settling(rec, () => succeedNow(rec, piId, amount)) }
async function succeedNow(rec, piId, amount) {
  let q = await getPayreq(rec.payreqId)
  if (!q) throw new Error(`payment request missing: ${rec.payreqId}`)
  // A charge or an invoice (claude/card-on-file, round 2): its own request,
  // finalised as if paid on its page (the charge and invoice get the payment,
  // with the intent id, and send their own receipt).
  if (rec.type === 'payreq') return succeedPayreq(rec, q, piId, amount)
  if (q.status !== 'paid') {
    await billRow(rec, q, 'paid')
    // The receipt and staff summary for an auto-charge are our own (below and
    // on Telegram); finalise does everything else exactly as for any paid link.
    q = { ...(await getPayreq(rec.payreqId)), stripePaymentIntentId: piId, effects: { ...(q.effects || {}), parentEmail: { status: 'done', at: new Date().toISOString(), note: 'auto-charge receipt sent separately' }, staffAlert: { status: 'done', at: new Date().toISOString(), note: 'auto-charge: daily summary' } } }
    await savePayreq(q)
    const f = await finaliseJfpBooking(q.id, { id: '', payment_intent: piId, amount_total: amount })
    if (f.busy) return { busy: true }
  }
  const paidAt = new Date().toISOString()
  await kvPipeline([['HSET', K.paid, piId, JSON.stringify({ id: piId, payreqId: rec.payreqId, rowId: rec.rowId, date: rec.date, at: paidAt, email: rec.email, name: rec.player, amountCents: amount, type: rec.method?.kind === 'bank' ? 'au_becs_debit' : 'card', pro: rec.programme === 'pro' })], ['DEL', STRIPE_LIST_CACHE]])
  await saveRec({ ...rec, status: 'succeeded', intentId: piId, updatedAt: paidAt, error: '' })
  if (await claimOnce(`jfp:autocharge:receipt:${piId}`, LONG)) {
    try {
      await sendFamilyNotice({
        to: rec.email, subject: rec.self ? `Session paid: ${dateLabel(rec.date)}` : `Session paid: ${rec.player}, ${dateLabel(rec.date)}`, heading: 'Payment received', kind: 'auto-charge receipt',
        paras: [rec.self ? `Thanks. We charged your saved ${rec.method?.short || 'payment method'} for your session.` : `Thanks${rec.parentName ? ` ${rec.parentName}` : ''}. We charged your saved ${rec.method?.short || 'payment method'} for ${rec.player}'s session.`],
        list: [['Session', dateLabel(rec.date)], ['Paid', formatAud(amount)], ['Paid with', rec.method?.label || ''], ['Reference', rec.payreqId]],
        cta: { label: 'Open My account', url: `${siteUrl()}/jfp-account/#fees` },
      })
    } catch (error) { console.error('jfp auto-charge receipt failed', error.message) }
  }
  return { status: 'succeeded' }
}

async function failed(rec, err, pi) { return settling(rec, () => failedNow(rec, err, pi)) }
async function failedNow(rec, err, pi) {
  const w = failWords(err, pi)
  let q = await getPayreq(rec.payreqId)
  if (q && q.status !== 'paid') {
    if (rec.type !== 'payreq') await billRow(rec, q, 'not paid, pay link sent')
    q = await getPayreq(rec.payreqId)
    // The same request is now the Pay link the family is emailed; staff see it flagged.
    await savePayreq({ ...q, status: 'open', stripePaymentIntentId: '', autoCharge: { ...(q.autoCharge || {}), failed: { code: w.code, why: w.staff, at: new Date().toISOString(), intentId: pi?.id || '' } }, needsAttention: [...new Set([...String(q.needsAttention || '').split(', ').filter(Boolean), 'auto-charge-failed'])].join(', ') })
  }
  // A payment waiting on the cardholder is closed, so it can never go through on top of the Pay link.
  if (pi?.id && ['requires_action', 'requires_payment_method', 'requires_confirmation'].includes(pi.status)) await stripeCall(`/payment_intents/${encodeURIComponent(pi.id)}/cancel`, { method: 'POST', body: {} })
  const status = /authentication_required|requires_action/.test(w.code) ? 'action' : 'failed'
  await saveRec({ ...rec, status, intentId: pi?.id || rec.intentId || '', error: w.staff, updatedAt: new Date().toISOString() })
  if (q && q.status !== 'paid' && await claimOnce(`jfp:autocharge:failed-email:${rec.payreqId}`, LONG)) {
    const url = `${siteUrl()}/jfp-account/?pay=${encodeURIComponent(rec.payreqId)}`
    try {
      await sendFamilyNotice({
        to: rec.email, subject: rec.type === 'payreq' ? `Please pay: ${rec.what || 'Joner Football'}` : rec.self ? `Please pay for your session on ${dateLabel(rec.date)}` : `Please pay for ${rec.player}'s session on ${dateLabel(rec.date)}`, heading: rec.type === 'payreq' ? 'Still to pay' : 'Your session is still to pay', kind: 'auto-charge failed',
        paras: [rec.type === 'payreq' ? `We tried to charge your saved ${rec.method?.short || 'payment method'} for ${rec.what || 'your payment'}. ${w.family}` : `We tried to charge your saved ${rec.method?.short || 'payment method'} for the session on ${dateLabel(rec.date)}. ${w.family}`, 'Please pay with the button below. Card or Apple Pay. Nothing else has been charged.', 'If your card has changed, you can save the new one in My account, Fees.'],
        list: [rec.type === 'payreq' ? ['For', rec.what || ''] : ['Session', dateLabel(rec.date)], ['To pay', formatAud(rec.amountCents)], ['Reference', rec.payreqId]],
        cta: { label: `Pay ${formatAud(rec.amountCents)}`, url },
      })
    } catch (error) { console.error('jfp auto-charge failed email failed', error.message) }
  }
  return { status, why: w.staff }
}

async function processing(rec, pi) { return settling(rec, () => processingNow(rec, pi)) }
async function processingNow(rec, pi) {
  const q = await getPayreq(rec.payreqId)
  if (q && q.status !== 'paid') await savePayreq({ ...q, status: 'processing', stripePaymentIntentId: pi.id })
  await saveRec({ ...rec, status: 'processing', intentId: pi.id, updatedAt: new Date().toISOString() })
  if (await claimOnce(`jfp:autocharge:debit-email:${pi.id}`, LONG)) {
    try {
      await sendFamilyNotice({
        to: rec.email, subject: rec.type === 'payreq' ? `Direct debit: ${rec.what || 'Joner Football'}` : rec.self ? `Direct debit for your session on ${dateLabel(rec.date)}` : `Direct debit for ${rec.player}'s session on ${dateLabel(rec.date)}`, heading: 'Direct debit started', kind: 'auto-charge debit notice',
        paras: [`We have started a direct debit of ${formatAud(rec.amountCents)} from your saved ${rec.method?.short || 'bank account'} for ${rec.type === 'payreq' ? rec.what || 'your payment' : `the session on ${dateLabel(rec.date)}`}. It takes 2 to 3 business days to clear, and we email a receipt when it has.`],
        list: [['Session', dateLabel(rec.date)], ['Amount', formatAud(rec.amountCents)], ['Reference', rec.payreqId]],
      })
    } catch (error) { console.error('jfp auto-charge debit email failed', error.message) }
  }
  return { status: 'processing' }
}

// A charge's or invoice's request paid with the saved method.
async function succeedPayreq(rec, q, piId, amount) {
  if (q.status !== 'paid') {
    q = { ...q, stripePaymentIntentId: piId, savedCharge: { kind: rec.kind, method: rec.method?.label || '' }, effects: { ...(q.effects || {}), staffAlert: { status: 'done', at: new Date().toISOString(), note: 'saved payment: daily summary' } } }
    await savePayreq(q)
    const f = await finaliseJfpBooking(q.id, { id: '', payment_intent: piId, amount_total: amount })
    if (f.busy) return { busy: true }
  }
  const paidAt = new Date().toISOString()
  // A JFP or Pro invoice for a place is term money: in Money's Stripe list.
  // Charges are counted in Money > Extra sessions from the charge itself.
  if (!q.charge && (q.term4Ids || []).length) await kvPipeline([['HSET', K.paid, piId, JSON.stringify({ id: piId, payreqId: q.id, rowId: rec.rowId, date: rec.date, at: paidAt, email: rec.email, name: rec.player, amountCents: amount, type: rec.kind === 'bank' ? 'au_becs_debit' : 'card', pro: q.programme === 'pro' })], ['DEL', STRIPE_LIST_CACHE]])
  await saveRec({ ...rec, status: 'succeeded', intentId: piId, updatedAt: paidAt, error: '' })
  return { status: 'succeeded' }
}

// One date for one player. Returns { status, why? }.
export async function chargeOne(item) {
  const at = new Date().toISOString()
  let rec = item.retry || null
  if (!rec) {
    const fresh = { ...(item.type === 'payreq' ? { type: 'payreq', key: item.key, chargeId: item.chargeId || '', invoiceId: item.invoiceId || '', what: item.what || '' } : {}), rowId: item.rowId || '', date: item.date, player: item.player, email: item.email, parentName: item.parentName || '', self: item.self === true, amountCents: item.amountCents, method: item.method, programme: item.programme, status: 'charging', at, payreqId: item.payreqId || newId('PAY'), tries: 0, ...(item.by ? { by: item.by } : {}) }
    if ((await kvCommand(['SET', K.charge(keyOf(fresh), item.date), JSON.stringify(fresh), 'NX'])) !== 'OK') return { status: 'already' }
    rec = await saveRec(fresh)
  }
  // The method as it is now (removed since the plan was made: nothing is
  // charged). A retry keeps the exact Stripe ids of its first try, so it is
  // the same Stripe request (and the same idempotency key) every time.
  const m = await getMethod(rec.email)
  if (!m && !rec.pmId) { await saveRec({ ...rec, status: 'skipped', reason: 'removed', error: 'Saved payment method removed', updatedAt: at }); return { status: 'skipped', why: 'Saved payment method removed' } }
  const pin = rec.pmId ? { pmId: rec.pmId, customerId: rec.customerId, mandateId: rec.mandateId || '', kind: rec.kind } : { pmId: m.pmId, customerId: m.customerId, mandateId: m.mandateId || '', kind: m.kind }
  rec = { ...rec, ...pin, tries: (rec.tries || 0) + 1, status: 'charging', at: rec.at || at, method: rec.pmId ? rec.method : methodView(m) }
  // The payment request first (it is what finalise and the Pay link use).
  let q = await getPayreq(rec.payreqId)
  if (rec.type === 'payreq') {
    // A charge's or invoice's own request: only while it is open (never while the family is on its card page).
    if (!q || ['cancelled', 'expired'].includes(q.status)) { await saveRec({ ...rec, status: 'skipped', reason: 'cancelled', error: 'The charge was cancelled', updatedAt: at }); return { status: 'skipped', why: 'The charge was cancelled' } }
    if (q.status === 'checkout') { await kvCommand(['DEL', K.charge(keyOf(rec), rec.date)]); return { status: 'skipped', why: 'The family has its payment page open right now' } }
    if (['open', 'charging'].includes(q.status)) { rec.amountCents = rec.tries > 1 ? rec.amountCents : q.amountCents; await savePayreq({ ...q, status: 'charging', savedCharge: { kind: rec.kind, method: rec.method?.label || '' } }) }
  } else if (!q) {
    const row = await getTerm4Row(rec.rowId)
    if (!row) { await saveRec({ ...rec, status: 'skipped', reason: 'row-missing', error: 'Player row not found', updatedAt: at }); return { status: 'skipped', why: 'Player row not found' } }
    q = newPayreq(rec)
    await savePayreq(q)
  }
  if (q.status === 'paid') { await saveRec({ ...rec, status: 'succeeded', updatedAt: at }); return { status: 'succeeded' } }
  if (q.status === 'cancelled') { await saveRec({ ...rec, status: 'skipped', reason: 'cancelled', error: 'Link cancelled by staff', updatedAt: at }); return { status: 'skipped' } }
  await saveRec(rec)
  const bank = rec.kind === 'bank'
  const r = await stripeCall('/payment_intents', {
    method: 'POST',
    // Every try for this player and date is the same Stripe request.
    idem: `jfp-autocharge-${keyOf(rec)}-${rec.date}-${rec.pmId}`,
    body: {
      amount: String(rec.amountCents), currency: 'aud', customer: rec.customerId, payment_method: rec.pmId,
      'payment_method_types[0]': bank ? 'au_becs_debit' : 'card',
      off_session: 'true', confirm: 'true',
      ...(bank && rec.mandateId ? { mandate: rec.mandateId } : {}),
      description: (rec.type === 'payreq' ? `Joner Football: ${rec.what || 'payment'}, ${rec.player}` : `JFP session ${rec.date}: ${rec.player}`).slice(0, 400),
      'metadata[jfpBookingId]': rec.payreqId,
      'metadata[jfpAutoCharge]': '1',
      'metadata[jfpKey]': keyOf(rec),
      'metadata[jfpRowId]': rec.rowId,
      ...(rec.chargeId ? { 'metadata[jfpCharge]': rec.chargeId } : {}),
      ...(rec.invoiceId ? { 'metadata[jfpInvoice]': rec.invoiceId } : {}),
      'metadata[jfpDate]': rec.date,
      'metadata[jfpProgramme]': rec.programme,
      ...(rec.programme === 'pro' ? { 'metadata[jfpProduct]': 'pro' } : {}),
    },
  })
  const err = r.ok ? null : r.data?.error || {}
  const pi = r.ok ? r.data : err.payment_intent || null
  // No answer we can trust (network, Stripe down): the next run asks again with the same key.
  if (!pi && (!r.status || r.status >= 500 || r.status === 409 || r.status === 429)) {
    await saveRec({ ...rec, status: 'uncertain', error: clean(err?.message || 'Stripe did not answer', 200), updatedAt: new Date().toISOString() })
    return { status: 'uncertain', why: 'Stripe did not answer; tried again next run' }
  }
  const out = pi?.status === 'succeeded' ? await succeed(rec, pi.id, pi.amount_received || pi.amount || rec.amountCents) : pi?.status === 'processing' ? await processing(rec, pi) : await failed(rec, err, pi)
  // The webhook is settling it at this moment: it finishes there (or the next run does).
  if (out.busy) { await saveRec({ ...rec, intentId: pi?.id || '', updatedAt: new Date().toISOString() }); return { status: 'charging', why: 'Being finished by Stripe\'s message' } }
  return out
}

// Settled skips are kept, so the date is never looked at again.
async function settleSkip(item) {
  const rec = { ...(item.type === 'payreq' ? { type: 'payreq', key: item.key, chargeId: item.chargeId || '', what: item.what || '' } : {}), rowId: item.rowId, date: item.date, player: item.player, email: item.email, amountCents: item.amountCents || 0, method: item.method, programme: item.programme, status: 'skipped', reason: item.reason, error: item.reasonLabel, at: new Date().toISOString() }
  if ((await kvCommand(['SET', K.charge(keyOf(rec), item.date), JSON.stringify(rec), 'NX'])) !== 'OK') return false
  await saveRec(rec)
  if (item.reason === 'prepaid') {
    const r = await getTerm4Row(item.rowId)
    if (r && prepaidOf(r.notes) > 0) {
      await updateTerm4Rows([{ id: r.id, fields: { 'Term 4 Notes': appendNote(withPrepaid(r.notes, prepaidOf(r.notes) - 1), `Session on ${item.date}: prepaid from My account, so not charged (auto-charge).`) } }])
      await bustRosterCache()
    }
  }
  return true
}

// The whole run. dry: the list only, nothing charged or written.
export async function runAutoCharges({ config, nowMs = Date.now(), dry = false, by = 'cron' } = {}) {
  config = config || await getConfig()
  const items = await planAutoCharges({ config, nowMs })
  if (dry) return { dry: true, items }
  if ((await kvCommand(['SET', K.runLock, by, 'NX', 'EX', '300'])) !== 'OK') return { busy: true, items: [] }
  const done = []
  try {
    for (const x of items) {
      if (x.action === 'skip') { if (x.permanent && await settleSkip(x)) done.push({ ...x, result: 'skipped' }); continue }
      try {
        const out = await chargeOne(x)
        done.push({ ...x, result: out.status, why: out.why || '' })
      } catch (error) {
        console.error('jfp auto-charge failed', x.rowId, x.date, error)
        done.push({ ...x, result: 'error', why: clean(error.message, 160) })
      }
    }
  } finally { await kvCommand(['DEL', K.runLock]).catch(() => {}) }
  const count = (s) => done.filter((d) => d.result === s)
  const sum = (l) => l.reduce((t, d) => t + (d.amountCents || 0), 0)
  const summary = { at: new Date(nowMs).toISOString(), by, charged: count('succeeded').length, chargedCents: sum(count('succeeded')), processing: count('processing').length, failed: done.filter((d) => ['failed', 'action', 'error', 'uncertain'].includes(d.result)).length, skipped: count('skipped').length }
  await kvSetJson(K.lastRun, summary)
  if (summary.charged || summary.processing || summary.failed) {
    const line = (d) => `${d.player}, ${dateLabel(d.date)}, ${formatAud(d.amountCents)}${d.why ? `: ${d.why}` : ''}`
    const parts = [`JFP auto-charge ${sydneyToday(nowMs)}`]
    if (summary.charged) parts.push(`Charged ${summary.charged} (${formatAud(summary.chargedCents)}):\n${count('succeeded').map(line).join('\n')}`)
    if (summary.processing) parts.push(`Direct debits started ${summary.processing}:\n${count('processing').map(line).join('\n')}`)
    const bad = done.filter((d) => ['failed', 'action', 'error', 'uncertain'].includes(d.result))
    if (bad.length) parts.push(`Not paid (pay link emailed, flagged in Money > Pro sessions > Auto charges):\n${bad.map(line).join('\n')}`)
    await telegramAlert(parts.join('\n\n')).catch(() => {})
  }
  return { dry: false, items, done, summary }
}

// The daily Vercel cron: only from 10:00 Sydney time (two UTC schedules
// cover daylight saving; the second one finds nothing left to do).
export async function cronAutoCharges({ nowMs = Date.now() } = {}) {
  if (sydneyHour(nowMs) < RUN_HOUR) return { waiting: true, hour: sydneyHour(nowMs) }
  const r = await runAutoCharges({ nowMs, by: 'daily job' })
  return r.busy ? { busy: true } : r.summary
}

// ---------- Stripe tells us (webhook) ----------

// payment_intent.* for an auto-charge: BECS clearing or failing, or a card
// payment we already know about. Anything else: null (not ours).
export async function savedPayIntentEvent(type, intentId) {
  if (!/^pi_[A-Za-z0-9_]+$/.test(intentId || '')) return null
  const g = await stripeCall(`/payment_intents/${encodeURIComponent(intentId)}`)
  if (!g.ok) return g.status === 404 ? null : { status: 500, body: { success: false, error: 'Could not read the payment' } }
  const pi = g.data
  if (pi?.metadata?.jfpAutoCharge !== '1') return null
  const rec = await getRec(pi.metadata.jfpKey || pi.metadata.jfpRowId, pi.metadata.jfpDate)
  if (!rec || rec.payreqId !== pi.metadata.jfpBookingId) return { status: 200, body: { success: true, ignored: 'unknown-auto-charge' } }
  if (pi.status === 'succeeded') {
    if (rec.status === 'succeeded') return { status: 200, body: { success: true, already: true } }
    const out = await succeed(rec, pi.id, pi.amount_received || pi.amount || rec.amountCents)
    return out.busy ? { status: 500, body: { success: false, busy: true } } : { status: 200, body: { success: true, autoCharge: 'succeeded' } }
  }
  if (type === 'payment_intent.payment_failed' || ['requires_payment_method', 'canceled'].includes(pi.status)) {
    if (['failed', 'action', 'succeeded'].includes(rec.status)) return { status: 200, body: { success: true, already: true } }
    const out = await failed(rec, pi.last_payment_error || { code: pi.status }, pi)
    await telegramAlert(`JFP auto-charge not paid: ${rec.player}, ${dateLabel(rec.date)}, ${formatAud(rec.amountCents)}: ${out.why}. Pay link emailed.`).catch(() => {})
    return { status: 200, body: { success: true, autoCharge: out.status } }
  }
  return { status: 200, body: { success: true, ignored: pi.status } }
}

// checkout.session.completed for a setup page: save the method (backstop for the return page).
export async function savedPaySetupEvent(session) {
  if (session?.mode !== 'setup' || session?.metadata?.jfpSavedPay !== '1') return null
  const r = await confirmSetup(session.id)
  return { status: r.ok || r.status === 404 || r.code === 'not-complete' ? 200 : 500, body: { success: r.ok, savedPay: r.ok ? 'saved' : r.error } }
}

// ---------- the Money tab's Stripe list ----------

// Auto-charges are Stripe payments that are not Checkout Sessions, so the
// Money list (api/_jfp-stripe.js) adds them from here, shaped as its own.
export async function autoChargePayments(sinceIso = '') {
  const flat = await kvCommand(['HGETALL', K.paid]).catch(() => [])
  const list = []
  for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) { const v = parse(flat[i + 1]); if (v?.id && (!sinceIso || sydneyToday(Date.parse(v.at)) >= sinceIso)) list.push(v) }
  const payreqs = await Promise.all(list.map((v) => getPayreq(v.payreqId).catch(() => null)))
  return list.map((v, i) => ({
    id: v.id, intentId: v.id, at: v.at, email: v.email, name: '', amountCents: v.amountCents, refundedCents: payreqs[i]?.refundedCents || 0,
    product: `Session auto-charge ${v.date}`, source: 'auto', jfpRef: v.payreqId, payMethod: v.type,
    feeCents: null, feeGstCents: null, stripeNetCents: null, feeKnown: false, nextTerm: false, forTerm: '', ...(v.pro ? { pro: true } : {}),
  }))
}

// ---------- charges and invoices: "Charge saved card", and the email when one is made ----------

// The saved method that would pay a request (its email, the player's row emails).
async function methodForPayreq(q, c = null) {
  const rowIds = [...new Set([...(q?.term4Ids || []), ...(q?.chargeRowIds || []), ...(c?.rowId ? [c.rowId] : [])])]
  const rows = (await Promise.all(rowIds.map((id) => getTerm4Row(id).catch(() => null)))).filter(Boolean)
  const emails = [q?.email, c?.email, ...rows.flatMap(rowEmails)].filter(Boolean)
  const methods = await methodsFor(emails)
  return { m: emails.map((e) => methods.get(normEmail(e))).find(Boolean) || null, row: rows[0] || null }
}
async function resolveTarget({ chargeId, invoiceId }) {
  let c = null, inv = null, q = null
  if (chargeId) { c = await getCharge(chargeId); if (!c) return { error: 'Charge not found.', status: 404 }; if (c.invoiceId) invoiceId = c.invoiceId }
  if (invoiceId) {
    const { getInvoice } = await import('./_jfp-invoices.js')
    inv = await getInvoice(clean(invoiceId, 20))
    if (!inv) return { error: 'Invoice not found.', status: 404 }
    if (inv.voidedAt) return { error: 'This invoice is void.', status: 409 }
    if (!inv.payreqId) return { error: 'Send the invoice (or mark it ready) first.', status: 409 }
    if (!c && inv.chargeId) c = await getCharge(inv.chargeId)
  }
  q = await getPayreq((c?.payreqId) || inv?.payreqId || '')
  if (!q) return { error: 'There is nothing to pay on this.', status: 409 }
  return { c, inv, q }
}

// Admin only (jfp-portal-data.js checks the role). Analysis and invoices are
// never charged on their own; staff press this, see the amount and the
// method, and confirm. The amount is what the request asks, never typed.
export async function chargeSavedNow({ principal, chargeId = '', invoiceId = '' }) {
  const t = await resolveTarget({ chargeId: clean(chargeId, 60), invoiceId: clean(invoiceId, 20) })
  if (t.error) return { ok: false, status: t.status, error: t.error }
  const { c, inv, q } = t
  if (q.status === 'paid' || (c && chargeStatus(c) === 'paid')) return { ok: false, status: 409, error: 'This is already paid.' }
  if (q.status === 'checkout') return { ok: false, status: 409, error: 'The family has the payment page open right now. Try again in a few minutes.' }
  if (['charging', 'processing'].includes(q.status)) return { ok: false, status: 409, error: 'A charge for this is already going through.' }
  if (q.status !== 'open') return { ok: false, status: 409, error: `This is ${q.status}, so it cannot be charged.` }
  const { m, row } = await methodForPayreq(q, c)
  if (!m) return { ok: false, status: 409, error: 'This family has no saved card or bank account.' }
  const key = c?.id || inv?.id || q.id
  const date = sydneyToday()
  const before = await getRec(key, date)
  if (before) return { ok: false, status: 409, error: before.status === 'succeeded' ? 'Already charged today.' : ['failed', 'action'].includes(before.status) ? `Tried today already: ${before.error || 'not paid'}. The family has been emailed the Pay link.` : 'A charge for this is already going through.' }
  const item = { type: 'payreq', key, chargeId: c?.id || '', invoiceId: inv?.id || q.invoiceId || '', payreqId: q.id, what: c?.label || (inv ? `Invoice ${inv.id}` : q.groupLabel || q.productLabel || 'Joner Football'), rowId: c?.rowId || (q.term4Ids || [])[0] || (q.chargeRowIds || [])[0] || '', player: (q.playerNames || []).join(' and '), email: m.email, date, amountCents: q.amountCents, method: methodView(m), programme: q.programme || c?.programme || 'jfp', self: Boolean(row?.ownContact), parentName: row?.ownContact ? '' : q.parentName || '', by: principal.email }
  const out = await chargeOne(item)
  await audit({ by: principal.email, action: 'savedpay.charge', target: key, after: { payreq: q.id, cents: item.amountCents, method: item.method?.label, status: out.status } })
  if (out.status === 'already') return { ok: false, status: 409, error: 'A charge for this is already going through.' }
  return { ok: true, status: out.status, why: out.why || '', amountLabel: formatAud(item.amountCents), method: item.method?.label || '' }
}

// Which open charges and invoices could be charged with a saved method (for the buttons).
export async function savedPayFor({ chargeIds = [], invoiceIds = [] } = {}) {
  const out = { charges: {}, invoices: {} }
  for (const [list, kind] of [[chargeIds, 'charges'], [invoiceIds, 'invoices']]) {
    for (const id of (Array.isArray(list) ? list : []).slice(0, 200)) {
      const t = await resolveTarget(kind === 'charges' ? { chargeId: clean(id, 60) } : { invoiceId: clean(id, 20) }).catch(() => ({ error: 'x' }))
      if (t.error || t.q.status !== 'open') continue
      const { m } = await methodForPayreq(t.q, t.c)
      if (m) { const v = methodView(m); out[kind][id] = { kind: v.kind, label: v.label, button: v.kind === 'bank' ? 'Charge by direct debit' : 'Charge saved card', amountLabel: formatAud(t.q.amountCents) } }
    }
  }
  return out
}

// "You have a payment to make" (Lee, 14 Oct 2026, round 2): when an admin
// makes a charge, or a coach or staff put a player on an extra session.
// Never fatal (the charge is already made). No coach names.
export async function notifyNewCharge({ charge: c, payreq: q, siteUrl: base = '' }) {
  if (!c?.email || !q?.id || q.status === 'paid') return { emailed: false }
  if (!(await claimOnce(`jfp:charge-notice:${c.id}`, LONG))) return { emailed: false, already: true }
  const { m, row } = await methodForPayreq(q, c)
  const auto = c.kind === 'extra' && Boolean(m) && Boolean(c.sessionDate) && c.sessionDate >= sydneyToday(Date.parse(m.consent?.at || m.savedAt) || 0)
  const self = Boolean(row?.ownContact)
  const url = `${(base || siteUrl()).replace(/\/$/, '')}/jfp-account/?pay=${encodeURIComponent(q.id)}`
  const hi = self ? String(c.playerName || '').split(' ')[0] : c.parentName || ''
  await sendFamilyNotice({
    to: c.email, name: self ? c.playerName : c.parentName, subject: 'You have a payment to make', heading: 'You have a payment to make', kind: 'new charge',
    paras: [`Hi${hi ? ` ${hi}` : ''}, there is a payment for ${self ? 'you' : c.playerName} in your Joner Football account.`, auto ? `Nothing to do now: it will be charged to your saved ${methodView(m).short} after the session.` : 'Pay in My account with the button below. Card or Apple Pay.'],
    list: [['For', c.label], ...(self ? [] : [['Player', c.playerName]]), ['Amount', formatAud(q.amountCents)], ...(c.sessionDate ? [['Session', dateLabel(c.sessionDate)]] : [])],
    cta: auto ? { label: 'Open My account', url } : { label: `Pay ${formatAud(q.amountCents)}`, url },
  })
  return { emailed: true, auto }
}

// ---------- staff ----------

// Players list and Edit player: "Card on file" / "Direct debit on file" / none,
// auto-charge on or paused, and the last result. Adds savedPay to each player.
export async function withSavedPay(players) {
  try {
    const roster = await loadRoster()
    const emailsOf = new Map(roster.players.map((r) => [r.id, rowEmails(r)]))
    const methods = await methodsFor(players.flatMap((p) => emailsOf.get(p.rowId) || [p.email]))
    const [pauses, last] = await Promise.all([pausedRows(), lastResults()])
    for (const p of players) {
      const m = (emailsOf.get(p.rowId) || [p.email]).map((e) => methods.get(normEmail(e))).find(Boolean)
      const l = last.get(p.rowId)
      p.savedPay = m ? { kind: m.kind, label: methodView(m).staffLabel, method: methodView(m).label, paused: pauses.has(p.rowId), ...(l ? { last: lastView(l) } : {}) } : null
    }
  } catch (error) { console.error('jfp saved pay list failed', error.message) }
  return players
}
const STAFF_STATUS = { succeeded: 'Charged', processing: 'Direct debit processing', failed: 'Not paid', action: 'Needs the cardholder', uncertain: 'Being checked', charging: 'Charging', skipped: 'Not charged' }
function lastView(l) { return { date: l.date, dateLabel: dateLabel(l.date), status: l.status, label: `${STAFF_STATUS[l.status] || l.status}${l.status === 'skipped' && l.error ? `: ${l.error}` : ['failed', 'action'].includes(l.status) && l.error ? `: ${l.error}` : ''}`, amountLabel: formatAud(l.amountCents || 0), payreqId: l.payreqId || '' } }
const recView = (x) => ({ rowId: x.rowId, player: x.player, date: x.date, dateLabel: dateLabel(x.date), amountLabel: formatAud(x.amountCents || 0), status: x.status, statusLabel: STAFF_STATUS[x.status] || x.status, why: x.error || '', method: x.method?.label || '', payreqId: x.payreqId || '', at: x.updatedAt || x.at })

export async function autoChargeStatus(rowId) {
  const id = clean(rowId, 30)
  const r = await getTerm4Row(id)
  if (!r) return { ok: false, status: 404, error: 'Player row not found.' }
  const methods = await methodsFor(rowEmails(r))
  const m = methodForRow(r, methods)
  const pause = (await pausedRows()).get(id) || null
  return { ok: true, sessionPay: isSessionType(r.paymentType), method: methodView(m), email: m?.email || '', consent: m?.consent ? { at: m.consent.at, version: m.consent.version } : null, paused: Boolean(pause), pausedBy: pause?.by || '', pausedAt: pause?.at || '', recent: (await recentCharges({ rowId: id, limit: 8 })).map(recView) }
}

export async function setPause(principal, rowId, paused) {
  const id = clean(rowId, 30)
  if (!(await getTerm4Row(id))) return { ok: false, status: 404, error: 'Player row not found.' }
  if (paused) await kvCommand(['HSET', K.pause, id, JSON.stringify({ by: principal.email, at: new Date().toISOString() })])
  else await kvCommand(['HDEL', K.pause, id])
  await audit({ by: principal.email, action: paused ? 'autocharge.pause' : 'autocharge.resume', target: id })
  return { ok: true, paused: Boolean(paused) }
}

// Money > Pro sessions > Auto charges: the preview (what the next run would
// do), what needs a look, the latest results, the last run.
export async function autoChargePanel(config, { nowMs = Date.now() } = {}) {
  const [items, recent, lastRun] = await Promise.all([planAutoCharges({ config, nowMs, fresh: false }), recentCharges({ limit: 60 }), kvGetJson(K.lastRun)])
  const view = (x) => ({ rowId: x.rowId, player: x.player, date: x.date, dateLabel: x.dateLabel, amountLabel: x.amountLabel, method: x.method?.label || '', action: x.action, reason: x.reason || '', reasonLabel: x.reasonLabel || '', note: x.note || '', register: x.register || '', programme: x.programme })
  return {
    schedule: `Every day from ${RUN_HOUR}:00 Sydney time, for sessions the day before (up to ${LOOKBACK_DAYS} days back, never before the card or account was saved)`,
    preview: items.map(view),
    toCharge: items.filter((x) => x.action === 'charge').length,
    toChargeLabel: formatAud(items.filter((x) => x.action === 'charge').reduce((t, x) => t + (x.amountCents || 0), 0)),
    needsLook: recent.filter((x) => ['failed', 'action', 'uncertain'].includes(x.status)).map(recView),
    recent: recent.filter((x) => x.status !== 'skipped' || x.reason).slice(0, 30).map(recView),
    lastRun: lastRun || null,
  }
}

// Staff actions (Money > Pro sessions > Auto charges, Edit player).
export const SAVED_PAY_ACTIONS = new Set(['autoChargePanel', 'autoChargeRun', 'autoChargePause', 'autoChargeStatus', 'chargeSavedPay', 'savedPayFor'])
export async function savedPayAction(req, res, principal, config, body, action) {
  const testNow = process.env.JFP_TEST_CLOCK === '1' && Number(body.now) ? Number(body.now) : Date.now()
  const no = (status, error) => res.status(status).json({ success: false, error })
  if (action === 'autoChargePanel') return res.status(200).json({ success: true, ...(await autoChargePanel(config, { nowMs: testNow })) })
  if (action === 'autoChargeStatus') { const r = await autoChargeStatus(body.rowId); return r.ok ? res.status(200).json({ success: true, ...r }) : no(r.status, r.error) }
  if (action === 'autoChargePause') { const r = await setPause(principal, body.rowId, body.paused === true); return r.ok ? res.status(200).json({ success: true, paused: r.paused }) : no(r.status, r.error) }
  if (action === 'savedPayFor') return res.status(200).json({ success: true, ...(await savedPayFor({ chargeIds: body.chargeIds, invoiceIds: body.invoiceIds })) })
  if (action === 'chargeSavedPay') {
    if (body.confirm !== true) return no(400, 'Confirm the charge first.')
    const r = await chargeSavedNow({ principal, chargeId: body.chargeId, invoiceId: body.invoiceId })
    return r.ok ? res.status(200).json({ success: true, result: r.status, why: r.why, amountLabel: r.amountLabel, method: r.method }) : no(r.status, r.error)
  }
  if (action === 'autoChargeRun') {
    if (body.confirm !== true) return no(400, 'Confirm the run first.')
    const r = await runAutoCharges({ config, nowMs: testNow, by: principal.email })
    if (r.busy) return no(409, 'The auto-charge run is already going. Try again in a few minutes.')
    await audit({ by: principal.email, action: 'autocharge.run', target: 'run', after: r.summary })
    return res.status(200).json({ success: true, summary: r.summary, done: r.done.map((d) => ({ player: d.player, dateLabel: d.dateLabel, amountLabel: d.amountLabel, result: d.result, why: d.why || d.reasonLabel || '' })) })
  }
  return no(400, 'Unknown action.')
}

// Family actions (My account > Fees).
export const SAVED_PAY_FAMILY = new Set(['savedPay', 'savedPaySetup', 'savedPayConfirm', 'savedPayRemove'])
export async function savedPayFamily(req, res, parent, body, { config, fam }) {
  const send = (r) => (r.ok ? res.status(200).json({ success: true, ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'ok')) }) : res.status(r.status).json({ success: false, error: r.error, ...(r.code ? { code: r.code } : {}) }))
  if (body.action === 'savedPay') return res.status(200).json({ success: true, saved: await familySavedView({ config, parent, fam }) })
  if (body.action === 'savedPaySetup') return send(await startSetup({ req, parent, fam, body }))
  if (body.action === 'savedPayConfirm') return send(await confirmSetup(body.sessionId, { email: parent.email, famEmails: fam.emails || [] }))
  if (body.action === 'savedPayRemove') return send(await removeSaved({ parent }))
  return res.status(400).json({ success: false, error: 'Unknown action.' })
}
