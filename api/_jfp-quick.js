// Prices and quick payment links (Lee, 13 Oct 2026: "we want to be able to
// create custom prices here, add as many as we want, and be able to create
// payment links straight away").
//
// Prices: the JFP price list (config.prices, the keys every term link already
// uses) plus Lee's own prices in config.customPrices, each with a programme.
//
// A quick link is a payment request (PAY-..., KV jfp:payreq:<id>) with
// quick: true. It is paid on its own page, /jfp-pay/?q=<id>, with no sign-in,
// through a Stripe Checkout Session on the Sydney account that carries the
// same jfpBookingId metadata as every other JFP link, so the webhook, the
// success check and refunds all find it. jfpProgramme on the session says
// which Money view it belongs to: only 'jfp' counts as JFP term income.
//
// Pure helpers here; jfp-portal-data and jfp-pay do the reading and writing.
import { PRODUCTS, clean, formatAud, CHECKOUT_EXPIRES_MINUTES } from './_jfp-store.js'
import { PROGRAMMES, isProgramme, programmeLabel, JUNIORS_TAG, PRICE_MIN, PRICE_MAX, PRICES_MAX, cleanPrice, cleanCustomPrices } from './_jfp-prices.js'
import { HOLIDAY_PERIODS, rangeLabel, isPeriodId, suggestPeriod } from './_holiday-periods.js'

export { PROGRAMMES, isProgramme, programmeLabel, JUNIORS_TAG, PRICE_MIN, PRICE_MAX, PRICES_MAX, cleanPrice, cleanCustomPrices }

export const QUICK_DAYS = 30
export const FOR_MAX = 120
export const SESSIONS_MAX = 40
export const QUICK_ID = /^PAY-\d{10,16}-[0-9A-F]{6}$/

// The JFP price list, shown in the same list. Only the amount can change
// (it is config.prices[key]); it cannot be archived.
const ONE_SESSION = new Set(['trial', 'oneToOne'])
export function builtinPrices(config) {
  return PRODUCTS.map((x) => ({ id: `jfp:${x.key}`, key: x.key, name: x.label, cents: config.prices[x.key], programme: 'jfp', description: `JFP price list${x.perPlaces > 1 ? ', covers two places' : ''}${x.proRata ? ', pro rata on term links' : ''}`, perSession: ONE_SESSION.has(x.key), builtin: true, archived: false }))
}
export function allPrices(config) { return [...builtinPrices(config), ...(config.customPrices || [])] }
export function priceById(config, id) { return allPrices(config).find((p) => p.id === clean(id, 50)) || null }

// The holidays a holiday quick link can be for: the next ones and the one
// just over (a late payment), the next one first.
export function quickHolidayPeriods(today) {
  const recent = HOLIDAY_PERIODS.filter((p) => p.end >= today).slice(0, 3)
  const last = [...HOLIDAY_PERIODS].reverse().find((p) => p.end < today)
  return [...recent, ...(last ? [last] : [])].map((p) => ({ id: p.id, label: p.label, range: rangeLabel(p) }))
}

// ---------- quick links ----------

// What staff asked for, checked. price: the chosen price or null. row: the
// chosen player's Term 4 row or null. { ok, link } or { ok: false, status, error }.
export function quickLinkInput(body = {}, { price = null, row = null, today, now = Date.now() } = {}) {
  const bad = (error, status = 400) => ({ ok: false, status, error })
  const sessions = price?.perSession ? Number(body.sessions ?? 1) : 1
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > SESSIONS_MAX) return bad(`Sessions must be 1 to ${SESSIONS_MAX}.`)
  const typed = body.amountCents == null || body.amountCents === '' ? null : Number(body.amountCents)
  if (typed != null && (!Number.isInteger(typed) || typed < PRICE_MIN || typed > PRICE_MAX)) return bad('Enter an amount from A$1 to A$20,000.')
  const amountCents = typed ?? (price ? price.cents * sessions : null)
  if (!amountCents) return bad('Choose a price or type an amount.')
  if (amountCents > PRICE_MAX) return bad('That is more than A$20,000. Make two links.')
  const programme = isProgramme(body.programme) ? body.programme : price?.programme || ''
  if (!programme) return bad('Pick the programme.')
  const forText = clean(body.forText, FOR_MAX) || (price ? `${price.name}${sessions > 1 ? `, ${sessions} sessions` : ''}` : '')
  if (!forText) return bad('Say what it is for.')
  const email = body.email ? String(body.email).trim().toLowerCase() : ''
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('That email does not look right.')
  // Holiday training: the holiday picked, else the next one (or the one on now).
  const period = programme === 'holiday' ? (isPeriodId(body.holidayPeriod) && body.holidayPeriod !== 'other' ? body.holidayPeriod : quickHolidayPeriods(today)[0]?.id || suggestPeriod(today).id) : ''
  return {
    ok: true,
    link: {
      quick: true, reason: 'quick', programme, forText, amountCents,
      priceId: price?.id || '', priceName: price?.name || '', unitCents: price && price.perSession ? price.cents : null, sessions: price?.perSession ? sessions : null,
      email: email || (row?.email || ''), parentName: row?.parent || '',
      playerNames: row ? [row.player] : [], playerKeys: row ? [String(row.player || '').toLowerCase().replace(/\s+/g, ' ').trim()] : [],
      // Only a JFP link writes to the player's Term 4 row when it is paid.
      term4Ids: row && programme === 'jfp' ? [row.id] : [], rowId: row?.id || '',
      groupId: row && programme === 'jfp' ? row.groupId || '' : '',
      holidayPeriod: period, afterpay: body.afterpay !== false,
      status: 'open', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + QUICK_DAYS * 86400000).toISOString(),
    },
  }
}

// Where a quick link stands, for the Payment links list.
export function quickStatus(q, { views = 0, emailedAt = '', nowMs = Date.now() } = {}) {
  if (q.status === 'paid') return 'paid'
  if (q.status === 'cancelled') return 'cancelled'
  if (q.status === 'expired' || (q.expiresAt && Date.parse(q.expiresAt) < nowMs)) return 'expired'
  if (q.status === 'checkout') return 'paying'
  if (views > 0) return 'opened'
  if (emailedAt || q.emailedAt) return 'sent'
  return 'made'
}
export const QUICK_STATUS = { made: 'Not sent yet', sent: 'Emailed', opened: 'Opened', paying: 'Paying now', paid: 'Paid', expired: 'Expired', cancelled: 'Cancelled' }
// Open means it can still be paid.
export const quickOpen = (q, nowMs = Date.now()) => ['open', 'checkout'].includes(q.status) && !(q.expiresAt && Date.parse(q.expiresAt) < nowMs)
// Paid with no player named: Lee matches it on that programme's Money page.
// checked: { [id]: when } from KV jfp:quick-checked, kept off the payment
// record so a tick can never undo a payment being recorded at that moment.
export const QUICK_CHECKED = 'jfp:quick-checked'
export const QUICK_EMAILED = 'jfp:quick-emailed'
export const quickToCheck = (q, checked = {}) => Boolean(q.quick) && q.status === 'paid' && !(q.playerNames || []).length && !checked[q.id]

export const quickUrl = (base, q) => `${base}/jfp-pay/?q=${encodeURIComponent(q.id)}`

// The Stripe Checkout Session, the same way every JFP link is made, with the
// programme on it. Juniors carries the tag the Juniors money reads.
export function quickCheckoutBody(q, base, nowMs = Date.now()) {
  const name = `Joner Football: ${q.forText}`.slice(0, 250)
  const meta = { jfpBookingId: q.id, jfpProgramme: q.programme, ...(q.programme === 'juniors' ? { programme: JUNIORS_TAG, ...(q.playerNames?.[0] ? { player: q.playerNames[0] } : {}) } : {}) }
  return {
    mode: 'payment',
    ...(q.email ? { customer_email: q.email } : {}),
    expires_at: String(Math.floor(nowMs / 1000) + CHECKOUT_EXPIRES_MINUTES * 60),
    success_url: `${base}/jfp-pay/?q=${encodeURIComponent(q.id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/jfp-pay/?q=${encodeURIComponent(q.id)}`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'aud',
    'line_items[0][price_data][unit_amount]': String(q.amountCents),
    'line_items[0][price_data][product_data][name]': name,
    ...(q.afterpay === false ? { 'payment_method_types[0]': 'card' } : {}),
    ...Object.fromEntries(Object.entries({ ...meta, source: 'quick', jfpFor: q.forText.slice(0, 200) }).map(([k, v]) => [`metadata[${k}]`, v])),
    ...Object.fromEntries(Object.entries(meta).map(([k, v]) => [`payment_intent_data[metadata][${k}]`, v])),
    'payment_intent_data[description]': name.slice(0, 400),
  }
}

// What the public page may show: what it is for and how much. No names or emails.
export function publicQuick(q, nowMs = Date.now()) {
  const st = quickStatus(q, { nowMs })
  return { id: q.id, forText: q.forText, amountCents: q.paidCents ?? q.amountCents, amountLabel: formatAud(q.paidCents ?? q.amountCents), programme: programmeLabel(q.programme), status: st === 'paid' ? 'paid' : st === 'cancelled' ? 'cancelled' : st === 'expired' ? 'expired' : 'open', afterpay: q.afterpay !== false }
}
