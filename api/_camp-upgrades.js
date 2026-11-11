// Camp booking upgrades (Lee, 11 Nov 2026): a family who paid for some camp
// days adds more days and pays only the difference to the package price.
//
// Example: three players paid A$450 for Tuesday. Both days for three is
// A$750, so the family pays A$300 more, once, not A$300 per child.
//
// An upgrade is its own record next to the booking. It owns:
//   - a fixed quote (what the booking looked like, the prices, the top-up)
//   - holds on the NEW days only, under its own id (CU-...#n), so it never
//     touches the family's paid places and never re-holds a day they have
//   - one Stripe Checkout Session (metadata campUpgradeId, never
//     campBookingId, so it can never fall into the new-booking finaliser)
// Only a verified paid session applies it, once: the same booking gains the
// days, the price becomes the package price, the top-up is added to what was
// paid, and the original Stripe payment stays as it was. Staff only (Lee and
// Ligia); parents cannot start one. No new cron: an unpaid link lapses on its
// own and is tidied the next time anyone looks.
import crypto from 'node:crypto'
import { kvCommand, kvPipeline, clean, stripeFetch, stripeSecret, CONFIRMED_SCORE, expireCheckoutSession } from './_holiday-store.js'
import { getCamp, getBooking, saveBooking, pricePerPlayer, bookableDays, daysText, audLabel, dayCounts, ckeys, releasePlaces } from './_camp-store.js'

// A link Ligia sends in a message has to last longer than the 30 minutes a
// family gets on the website: Stripe allows up to 24 hours. The new-day
// places are held 1 minute longer than the link, as the website booking does.
export const UPGRADE_LINK_MINUTES = 24 * 60 - 5
export const UPGRADE_HOLD_MINUTES = UPGRADE_LINK_MINUTES + 1
const LOCK_SECONDS = 60
// States: creating (record made, link not confirmed yet), pending (link out),
// applying (paid, being applied), applied, expired, cancelled, failed (Stripe
// said no to the link), recovery (paid but could not be applied: staff).
const OPEN = new Set(['creating', 'pending', 'applying', 'recovery'])
export const UPGRADE_STATES = ['creating', 'pending', 'applying', 'applied', 'expired', 'cancelled', 'failed', 'recovery']

export const ukeys = {
  upgrade: (id) => `camp:upgrade:${id}`,
  active: (bookingId) => `camp:upgrade-active:${bookingId}`,
  lock: (bookingId) => `camp:upgrade-lock:${bookingId}`,
  session: (sid) => `camp:upgrade-session:${sid}`,
  pi: (pi) => `camp:upgrade-pi:${pi}`,
  list: (campId) => `camp:upgrades:${campId}`,
  effect: (id, what) => `camp:upgrade-done:${id}:${what}`,
}

const parse = (v) => { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return null } }
const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24)
export const isUpgradeId = (id) => typeof id === 'string' && /^CU-\d+-[0-9A-F]{6}$/.test(id)
const newUpgradeId = () => `CU-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

export async function getUpgrade(id) { return isUpgradeId(id) ? parse(await kvCommand(['GET', ukeys.upgrade(id)])) : null }
async function saveUpgrade(u) {
  u.updatedAt = new Date().toISOString()
  await kvCommand(['SET', ukeys.upgrade(u.id), JSON.stringify(u), 'EX', String(400 * 86400)])
  return u
}
// A compact history on the upgrade itself: references, amounts and states only.
const log = (u, what, extra = {}) => { u.log = [...(u.log || []), { at: new Date().toISOString(), what, ...extra }].slice(-40) }

// ---------- locks: one change to a booking's upgrade at a time ----------

const DROP = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0"
async function withLock(bookingId, fn) {
  const token = crypto.randomBytes(12).toString('hex')
  if ((await kvCommand(['SET', ukeys.lock(bookingId), token, 'NX', 'EX', String(LOCK_SECONDS)])) !== 'OK') return { busy: true }
  try { return await fn() } finally { await kvCommand(['EVAL', DROP, '1', ukeys.lock(bookingId), token]).catch(() => {}) }
}

// The open upgrade for a booking, if any (used to stop an edit or cancel
// while a payment link is out).
export async function openUpgradeFor(bookingId) {
  const id = await kvCommand(['GET', ukeys.active(bookingId)])
  const u = id ? await getUpgrade(id) : null
  return u && OPEN.has(u.state) ? u : null
}
async function clearActive(u) {
  await kvCommand(['EVAL', DROP, '1', ukeys.active(u.baseBookingId), u.id]).catch(() => {})
}

// ---------- the quote ----------

// What can change the money: if any of this moves after the quote, the
// quote is stale and staff look again.
export function bookingFingerprint(b) {
  return sha([b.status, [...(b.dayIds || [])].sort(), (b.players || []).length, b.amountPaidCents || 0, b.priceCents || 0, b.priceEachCents || 0, b.refundedCents || 0, (b.upgrades || []).length, b.cancelledAt || ''])
}

// Pure: is this booking one we can upgrade, and to what, for how much.
// Returns { error, manual? } or the quote. Never trusts anything from the
// browser but the days ticked.
export function quoteUpgrade(b, camp, targetIn, { today } = {}) {
  if (!b || b.campId !== camp.id) return { error: 'Sign-up not found.' }
  if (b.status !== 'paid' || b.cancelledAt) return { error: 'Only a paid sign-up can be upgraded.' }
  const manual = (why) => ({ error: `${why} Upgrade this one by hand: check with Lee before taking any money.`, manual: true })
  if (b.refundedCents) return manual('This sign-up has had a refund.')
  if (b.method !== 'Stripe' || !b.paymentIntent || !b.stripeSessionId || !b.paidAt) return manual('This sign-up was not paid online through the camp page.')
  const players = (b.players || []).length
  if (!players) return { error: 'This sign-up has no players.' }
  // A standard, fully paid booking: what they paid is exactly the price they
  // were charged, and that price is the camp price for their days today.
  const eachNow = pricePerPlayer(camp, b.dayIds)
  if (!b.priceEachCents || b.priceCents !== b.priceEachCents * players || b.amountPaidCents !== b.priceCents) return manual('What this family paid is not the standard price (a discount, promo code or part payment).')
  if (eachNow !== b.priceEachCents) return manual('The camp price has changed since this family booked.')

  const valid = new Set(camp.days.map((d) => d.id))
  const asked = [...new Set((Array.isArray(targetIn) ? targetIn : []).map((d) => clean(d, 20)))]
  if (asked.some((d) => !valid.has(d))) return { error: 'Choose days from this camp.' }
  if (b.dayIds.some((d) => !asked.includes(d))) return { error: 'An upgrade only adds days. To take a day off, edit or cancel the sign-up.' }
  const targetDayIds = camp.days.filter((d) => asked.includes(d.id)).map((d) => d.id)
  const newDayIds = targetDayIds.filter((d) => !b.dayIds.includes(d))
  if (!newDayIds.length) return { error: b.dayIds.length === camp.days.length ? 'This sign-up already has every day.' : 'Tick at least one more day.' }
  const open = new Set(bookableDays(camp, today).map((d) => d.id))
  const gone = newDayIds.filter((d) => !open.has(d))
  if (gone.length) return { error: `${daysText(camp, gone)} has already been.` }

  const targetEachCents = pricePerPlayer(camp, targetDayIds)
  const targetTotalCents = targetEachCents * players
  const paidCents = b.amountPaidCents
  const topUpCents = targetTotalCents - paidCents
  if (!(topUpCents > 0)) return manual('The package price is not more than they already paid.')
  const fingerprint = bookingFingerprint(b)
  const quote = {
    campId: camp.id, baseBookingId: b.id, players, playerNames: b.players.map((p) => p.firstName),
    originalDayIds: [...b.dayIds], newDayIds, targetDayIds,
    originalEachCents: b.priceEachCents, targetEachCents, targetTotalCents, paidCents, topUpCents, currency: 'aud',
    prices: { ...camp.prices }, fingerprint,
    text: {
      have: daysText(camp, b.dayIds), adding: daysText(camp, newDayIds), target: daysText(camp, targetDayIds),
      package: audLabel(targetTotalCents), paid: audLabel(paidCents), topUp: audLabel(topUpCents),
    },
  }
  quote.quoteKey = sha([fingerprint, camp.prices, targetDayIds, topUpCents, players])
  return quote
}

// The quote plus the places left on each new day (holds included).
async function quoteWithPlaces(b, camp, target) {
  const q = quoteUpgrade(b, camp, target)
  if (q.error) return q
  const counts = await dayCounts(camp)
  q.places = Object.fromEntries(q.newDayIds.map((d) => [d, { left: counts[d].left, need: q.players }]))
  q.room = q.newDayIds.every((d) => counts[d].left >= q.players)
  return q
}

// ---------- places on the new days ----------

// KEYS: the seats ZSET of each NEW day. ARGV: now, upgradeId, bookingId,
// players, capacity, confirmed score. Moves the upgrade's hold to the
// booking's own paid places; takes them fresh (capacity checked) if the hold
// ran out. All days or none. Already moved: nothing to do. Returns 0, or
// 1 + the index of the day that is full.
export const UPGRADE_APPLY_SCRIPT = `-- camp-upgrade-apply
local want = tonumber(ARGV[4])
local cap = tonumber(ARGV[5])
for k = 1, #KEYS do
  redis.call('ZREMRANGEBYSCORE', KEYS[k], '-inf', ARGV[1])
  local base = 0
  local up = 0
  for i = 1, 12 do
    if redis.call('ZSCORE', KEYS[k], ARGV[3] .. '#' .. i) then base = base + 1 end
    if redis.call('ZSCORE', KEYS[k], ARGV[2] .. '#' .. i) then up = up + 1 end
  end
  if base < want and redis.call('ZCARD', KEYS[k]) - base - up + want > cap then return k end
end
for k = 1, #KEYS do
  for i = 1, 12 do redis.call('ZREM', KEYS[k], ARGV[2] .. '#' .. i) end
  for i = 1, want do redis.call('ZADD', KEYS[k], ARGV[6], ARGV[3] .. '#' .. i) end
end
return 0`

async function holdNewDays(camp, u, untilMs) {
  // The camp hold step with the upgrade's own id: checks capacity on the new
  // days only, all or none, and never force.
  const { holdPlaces } = await import('./_camp-store.js')
  return holdPlaces({ camp, dayIds: u.newDayIds, bookingId: u.id, players: u.players, scoreMs: untilMs, force: false })
}
async function moveNewDays(camp, u) {
  const r = Number(await kvCommand(['EVAL', UPGRADE_APPLY_SCRIPT, String(u.newDayIds.length), ...u.newDayIds.map((d) => ckeys.seats(camp.id, d)), String(Date.now()), u.id, u.baseBookingId, String(u.players), String(camp.capacityPerDay), String(CONFIRMED_SCORE)]))
  return r === 0 ? { ok: true } : { ok: false, fullDay: u.newDayIds[r - 1] }
}

// ---------- Stripe ----------

// A Stripe answer that says no (4xx) is a definite failure. No answer, or a
// 5xx, might have made the session: keep the attempt and ask again with the
// same idempotency key, which returns the same session.
const definite = (error) => Number(error?.status) >= 400 && Number(error?.status) < 500

function checkoutBody(u, camp, b, baseUrl) {
  const pageUrl = `${baseUrl}/camps/${camp.slug}/`
  return {
    mode: 'payment',
    // Not on this session: the top-up is a fixed difference, no codes on top.
    allow_promotion_codes: 'false',
    customer_email: b.email,
    expires_at: String(Math.floor(u.linkExpiresMs / 1000)),
    success_url: `${pageUrl}?upgraded=${encodeURIComponent(u.id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${pageUrl}?upgrade_open=${encodeURIComponent(u.id)}`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'aud',
    'line_items[0][price_data][unit_amount]': String(u.topUpCents),
    'line_items[0][price_data][product_data][name]': `${camp.title}: add ${daysText(camp, u.newDayIds)}`,
    'line_items[0][price_data][product_data][description]': `${u.players} player${u.players === 1 ? '' : 's'}, now ${daysText(camp, u.targetDayIds)}. Already paid ${audLabel(u.paidCents)}, package ${audLabel(u.targetTotalCents)}.`.slice(0, 300),
    'metadata[campUpgradeId]': u.id,
    'metadata[upgradeOf]': u.baseBookingId,
    'metadata[campId]': camp.id,
    'metadata[camp]': camp.title,
    'metadata[days]': u.newDayIds.join(','),
    'payment_intent_data[metadata][campUpgradeId]': u.id,
    'payment_intent_data[metadata][upgradeOf]': u.baseBookingId,
    'payment_intent_data[metadata][camp]': camp.title,
    'payment_intent_data[description]': `${camp.title} upgrade (${u.id} for ${u.baseBookingId})`,
  }
}

export function upgradeIdFromSession(session) {
  const id = session?.metadata?.campUpgradeId
  return isUpgradeId(id) ? id : ''
}

// ---------- staff: quote, create, cancel, retry ----------

// Lazy tidy for a link past its time (no cron): ask Stripe what happened.
// Paid: apply it. Expired: let its new-day places go.
export async function settleIfLapsed(u, deps = {}) {
  if (!u || u.state !== 'pending' || Date.now() < u.linkExpiresMs + 60_000) return u
  let s = null
  try { s = await stripeFetch(`/checkout/sessions/${encodeURIComponent(u.sessionId)}`) } catch { return u }
  if (s.payment_status === 'paid') { await finaliseCampUpgrade(u.id, s, { ...deps, via: 'lapsed-check' }); return getUpgrade(u.id) }
  if (s.status === 'expired') return (await expireCampUpgrade(u.id, s)).upgrade || u
  return u
}

export async function upgradeQuote(b, camp, target) {
  const open = await openUpgradeFor(b.id)
  const live = open ? await settleIfLapsed(open) : null
  const q = await quoteWithPlaces(b, camp, target)
  return { quote: q, open: live && OPEN.has(live.state) ? publicUpgrade(live, camp) : null }
}

// Make (or give back) the payment link. Returns { status, body }.
export async function upgradeCreate({ b, camp, target, quoteKey, by, baseUrl }) {
  // A link past its time is settled first (it takes the lock itself).
  const lapsed = await openUpgradeFor(b.id)
  if (lapsed) await settleIfLapsed(lapsed)
  const r = await withLock(b.id, async () => {
    // One open upgrade per booking. The same request again gets the same link.
    const open = await openUpgradeFor(b.id)
    if (open && OPEN.has(open.state)) {
      const same = open.targetDayIds.join() === quoteUpgrade(b, camp, target).targetDayIds?.join()
      if (!same) return { status: 409, body: { error: `There is already an upgrade for ${daysText(camp, open.targetDayIds)}${open.state === 'pending' ? ' with a payment link out' : ''}. Cancel that first.`, upgrade: publicUpgrade(open, camp) } }
      if (open.state === 'pending') return { status: 200, body: { upgrade: publicUpgrade(open, camp), again: true } }
      if (open.state === 'creating') return makeLink(open, camp, b, baseUrl)
      return { status: 409, body: { error: open.state === 'recovery' ? 'This upgrade was paid and needs a look. Open it below.' : 'This upgrade is being applied. Look again in a minute.', upgrade: publicUpgrade(open, camp) } }
    }
    const q = await quoteWithPlaces(b, camp, target)
    if (q.error) return { status: q.manual ? 422 : 400, body: { error: q.error, manual: q.manual === true } }
    if (!quoteKey || quoteKey !== q.quoteKey) return { status: 409, body: { error: 'The booking or price changed since you looked. Check the new amount and press Create again.', quote: q, stale: true } }
    if (!q.room) return { status: 409, body: { error: `Not enough places on ${daysText(camp, q.newDayIds.filter((d) => q.places[d].left < q.players))}.`, quote: q } }
    const now = Date.now()
    const u = {
      id: newUpgradeId(), campId: camp.id, baseBookingId: b.id, state: 'creating', createdAt: new Date(now).toISOString(), by,
      baseFingerprint: q.fingerprint, quoteKey: q.quoteKey, players: q.players,
      originalDayIds: q.originalDayIds, newDayIds: q.newDayIds, targetDayIds: q.targetDayIds,
      originalEachCents: q.originalEachCents, targetEachCents: q.targetEachCents, targetTotalCents: q.targetTotalCents,
      paidCents: q.paidCents, topUpCents: q.topUpCents, currency: 'aud', prices: q.prices,
      linkExpiresMs: now + UPGRADE_LINK_MINUTES * 60_000, holdExpiresMs: now + UPGRADE_HOLD_MINUTES * 60_000,
      effects: {},
    }
    u.idempotencyKey = `camp-upgrade-${u.id}`
    log(u, 'quote accepted', { topUpCents: u.topUpCents, by })
    // The record exists before anything outside: a crash from here on is found and finished.
    await saveUpgrade(u)
    await kvCommand(['SET', ukeys.active(b.id), u.id, 'EX', String(3 * 86400)])
    await kvCommand(['ZADD', ukeys.list(camp.id), String(now), u.id])
    const held = await holdNewDays(camp, u, u.holdExpiresMs)
    if (!held.ok) {
      u.state = 'cancelled'; u.reason = `${daysText(camp, [held.fullDay])} filled up`; log(u, 'no room', { day: held.fullDay })
      await saveUpgrade(u); await clearActive(u)
      return { status: 409, body: { error: `${daysText(camp, [held.fullDay])} is full now. Nothing was charged.` } }
    }
    return makeLink(u, camp, b, baseUrl)
  })
  if (r.busy) return { status: 409, body: { error: 'Someone is changing this upgrade right now. Try again in a moment.' } }
  return r
}

async function makeLink(u, camp, b, baseUrl) {
  if (!(await stripeAccountOk())) {
    log(u, 'stripe account check failed')
    await saveUpgrade(u)
    return { status: 502, body: { error: 'The Stripe account could not be confirmed as the Sydney account, so no link was made. Nothing was charged.' } }
  }
  let session
  try {
    session = await stripeFetch('/checkout/sessions', { method: 'POST', body: checkoutBody(u, camp, b, baseUrl), idempotencyKey: u.idempotencyKey })
  } catch (error) {
    if (definite(error)) {
      await releasePlaces(camp.id, u.newDayIds, u.id)
      u.state = 'failed'; u.reason = `Stripe said no: ${String(error.message).slice(0, 120)}`; log(u, 'checkout refused')
      await saveUpgrade(u); await clearActive(u)
      return { status: 502, body: { error: 'Stripe would not make the payment link. Nothing was charged. Try again in a minute.' } }
    }
    // No answer: keep the places and the attempt; pressing Create again asks
    // Stripe for the same session.
    log(u, 'checkout unclear', { message: String(error?.message || error).slice(0, 80) })
    await saveUpgrade(u)
    return { status: 502, body: { error: 'Stripe did not answer. Press Create again: it will give the same link, never a second one.', upgrade: publicUpgrade(u, camp) } }
  }
  if (session?.metadata?.campUpgradeId !== u.id || Number(session.amount_total) !== u.topUpCents) {
    log(u, 'checkout mismatch')
    await saveUpgrade(u)
    return { status: 502, body: { error: 'Stripe gave back a link that does not match this upgrade. Nothing was sent. Tell Lee.' } }
  }
  u.sessionId = session.id
  u.url = session.url
  if (Number(session.expires_at)) u.linkExpiresMs = Number(session.expires_at) * 1000
  u.state = 'pending'
  log(u, 'link made', { sessionId: session.id })
  await saveUpgrade(u)
  await kvCommand(['SET', ukeys.session(session.id), u.id, 'EX', String(7 * 86400)])
  return { status: 200, body: { upgrade: publicUpgrade(u, camp) } }
}

// The Sydney account, checked once per warm function with the key actually in use.
export const SYDNEY_ACCOUNT = 'acct_1QyPm0EwxK4ojTS1'
let accountOk = null
async function stripeAccountOk() {
  if (accountOk === true) return true
  if (!stripeSecret()) return false
  try { accountOk = (await stripeFetch('/account'))?.id === SYDNEY_ACCOUNT } catch { accountOk = null; return false }
  return accountOk
}

// Staff stop an unpaid link: close the Stripe page first, then let the new-day
// places go. A link that turns out to be paid is applied instead.
export async function upgradeCancel(b, camp, upgradeId, by) {
  const r = await withLock(b.id, async () => {
    const u = await getUpgrade(upgradeId)
    if (!u || u.baseBookingId !== b.id) return { status: 404, body: { error: 'Upgrade not found.' } }
    if (!['creating', 'pending'].includes(u.state)) return { status: 400, body: { error: `This upgrade is ${u.state}, it cannot be cancelled here.` } }
    if (u.sessionId) {
      let s = null
      try { s = await stripeFetch(`/checkout/sessions/${encodeURIComponent(u.sessionId)}`) } catch { return { status: 502, body: { error: 'Could not check Stripe, so the link was left open. Try again.' } } }
      if (s.payment_status === 'paid') return { status: 409, body: { error: 'The family has just paid. It is being applied now.' }, paid: s }
      if (s.status === 'open' && !(await expireCheckoutSession(u.sessionId))) return { status: 502, body: { error: 'Stripe would not close the link. Try again.' } }
    }
    await releasePlaces(camp.id, u.newDayIds, u.id)
    u.state = 'cancelled'; u.reason = 'Cancelled in the portal'; u.cancelledBy = by; log(u, 'cancelled', { by })
    await saveUpgrade(u); await clearActive(u)
    return { status: 200, body: { upgrade: publicUpgrade(u, camp) } }
  })
  if (r.busy) return { status: 409, body: { error: 'Someone is changing this upgrade right now. Try again in a moment.' } }
  if (r.paid) { await finaliseCampUpgrade(upgradeId, r.paid, { via: 'cancel-found-paid' }); return { status: 409, body: r.body } }
  return r
}

// Staff "Check again": Stripe's own word, then finish whatever is left.
export async function upgradeRetry(b, camp, upgradeId) {
  const u = await getUpgrade(upgradeId)
  if (!u || u.baseBookingId !== b.id) return { status: 404, body: { error: 'Upgrade not found.' } }
  if (u.state === 'creating') return { status: 400, body: { error: 'No link yet. Press Create payment link again.' } }
  if (!u.sessionId) return { status: 400, body: { error: 'This upgrade never got a payment link.' } }
  let s
  try { s = await stripeFetch(`/checkout/sessions/${encodeURIComponent(u.sessionId)}`) } catch { return { status: 502, body: { error: 'Could not reach Stripe. Try again.' } } }
  if (s.payment_status !== 'paid') {
    if (s.status === 'expired') await expireCampUpgrade(u.id, s)
    return { status: 200, body: { upgrade: publicUpgrade(await getUpgrade(u.id), camp), stripe: s.status } }
  }
  const r = await finaliseCampUpgrade(u.id, s, { via: 'staff-retry', retry: true })
  if (r.busy) return { status: 409, body: { error: 'It is being applied right now. Look again in a moment.' } }
  return { status: 200, body: { upgrade: publicUpgrade(await getUpgrade(u.id), camp) } }
}

// ---------- verified payment: apply once ----------

// Check the session is this upgrade's, paid, exactly the top-up, in AUD, on
// the right kind of key, with a payment not used for anything else.
function verify(u, session) {
  const why = []
  if (session?.id !== u.sessionId) why.push('not this upgrade\'s Stripe session')
  if (session?.metadata?.campUpgradeId !== u.id) why.push('session metadata does not match')
  if (session?.payment_status !== 'paid') why.push('not paid')
  if (Number(session?.amount_total) !== u.topUpCents) why.push(`paid ${audLabel(session?.amount_total || 0)}, expected ${audLabel(u.topUpCents)}`)
  if (String(session?.currency || '').toLowerCase() !== 'aud') why.push('not in AUD')
  const key = stripeSecret()
  if (typeof session?.livemode === 'boolean' && /^sk_(live|test)_/.test(key) && session.livemode !== key.startsWith('sk_live_')) why.push('live and test mixed up')
  const pi = typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id || ''
  if (session?.payment_status === 'paid' && !pi) why.push('no payment reference')
  return { ok: !why.length, why, pi }
}

// Webhook, success page, lapsed check and staff retry all come here. Returns
// { state, upgrade, busy?, already?, notPaid? }.
export async function finaliseCampUpgrade(upgradeId, session, deps = {}) {
  const first = await getUpgrade(upgradeId)
  if (!first) return { missing: true }
  const r = await withLock(first.baseBookingId, async () => {
    let u = await getUpgrade(upgradeId)
    if (u.state === 'applied') return { already: true, upgrade: u }
    const camp = await getCamp(u.campId)
    const v = verify(u, session)
    if (!v.ok) {
      if (session?.payment_status !== 'paid') return { notPaid: true, upgrade: u }
      // Money came in but something does not add up: keep it in front of staff, never drop it.
      if (u.state !== 'recovery') { u.state = 'recovery'; u.reason = `Paid, but ${v.why.join('; ')}.`; log(u, 'paid but not verified', { why: v.why }); await saveUpgrade(u); await alert(u, camp, deps) }
      return { state: u.state, upgrade: u }
    }
    // The same payment can only ever pay for one upgrade.
    const claim = await kvCommand(['SET', ukeys.pi(v.pi), u.id, 'NX', 'EX', String(400 * 86400)])
    if (claim !== 'OK' && (await kvCommand(['GET', ukeys.pi(v.pi)])) !== u.id) {
      if (u.state !== 'recovery') { u.state = 'recovery'; u.reason = 'Paid with a payment already used for another upgrade.'; log(u, 'payment reused'); await saveUpgrade(u); await alert(u, camp, deps) }
      return { state: u.state, upgrade: u }
    }
    // 1. Money in: write it down before anything else.
    if (u.state !== 'applying') {
      u.state = 'applying'; u.paidAt = u.paidAt || new Date().toISOString(); u.paymentIntent = v.pi; u.amountReceivedCents = Number(session.amount_total)
      u.reason = ''; log(u, 'payment verified', { pi: v.pi, via: deps.via || 'webhook' })
      await saveUpgrade(u)
    }
    let b = await getBooking(u.baseBookingId)
    const done = (b?.upgrades || []).some((x) => x.id === u.id)
    if (!done) {
      // 2. The booking must be as it was when the quote was made.
      if (!b || bookingFingerprint(b) !== u.baseFingerprint) {
        u.state = 'recovery'; u.reason = !b ? 'The sign-up is missing.' : b.status !== 'paid' ? `The sign-up is ${b.status} now.` : 'The sign-up was changed after the link was made.'
        log(u, 'booking changed'); await saveUpgrade(u); await alert(u, camp, deps)
        return { state: u.state, upgrade: u }
      }
      // 3. The new-day places: move the hold to the family, or take them fresh.
      const moved = await moveNewDays(camp, u)
      if (!moved.ok) {
        u.state = 'recovery'; u.reason = `Paid after the hold ran out and ${daysText(camp, [moved.fullDay])} is full. Nothing was overbooked; the family still has their original days.`
        log(u, 'no room at apply', { day: moved.fullDay }); await saveUpgrade(u); await alert(u, camp, deps)
        return { state: u.state, upgrade: u }
      }
      // 4. The booking, once: same id, same players, original payment kept.
      const original = b.payments?.length ? [] : [{ kind: 'original', amountCents: b.amountPaidCents, sessionId: b.stripeSessionId, paymentIntent: b.paymentIntent, paidAt: b.paidAt, method: b.method }]
      b = {
        ...b,
        dayIds: camp.days.map((d) => d.id).filter((d) => u.targetDayIds.includes(d)),
        priceEachCents: u.targetEachCents, priceCents: u.targetTotalCents,
        amountPaidCents: (b.amountPaidCents || 0) + u.topUpCents,
        payments: [...original, ...(b.payments || []), { kind: 'upgrade', upgradeId: u.id, amountCents: u.topUpCents, sessionId: u.sessionId, paymentIntent: v.pi, paidAt: u.paidAt, method: 'Stripe' }],
        upgrades: [...(b.upgrades || []), { id: u.id, at: new Date().toISOString(), addedDayIds: u.newDayIds, topUpCents: u.topUpCents, paymentIntent: v.pi, sessionId: u.sessionId }],
      }
      await saveBooking(b)
    }
    // 5. Applied.
    u.state = 'applied'; u.appliedAt = u.appliedAt || new Date().toISOString(); log(u, 'applied')
    await saveUpgrade(u); await clearActive(u)
    return { applied: true, upgrade: u }
  })
  if (r.busy) return { busy: true }
  if (r.applied || r.already) await runUpgradeEffects(r.upgrade.id, deps)
  const u = await getUpgrade(upgradeId)
  return { state: u.state, upgrade: u, already: r.already === true, notPaid: r.notPaid === true }
}

// Stripe says the link ran out (or an async payment failed). Only ever lets
// go of this upgrade's own new-day places, never a paid booking's, and never
// undoes a payment already applied.
export async function expireCampUpgrade(upgradeId, session) {
  const u0 = await getUpgrade(upgradeId)
  if (!u0) return { changed: false }
  const r = await withLock(u0.baseBookingId, async () => {
    const u = await getUpgrade(upgradeId)
    if (!['creating', 'pending'].includes(u.state)) return { changed: false, upgrade: u }
    if (session?.payment_status === 'paid') return { changed: false, upgrade: u }
    await releasePlaces(u.campId, u.newDayIds, u.id)
    u.state = 'expired'; log(u, 'link expired')
    await saveUpgrade(u); await clearActive(u)
    return { changed: true, upgrade: u }
  })
  return r.busy ? { changed: false, busy: true } : r
}

// ---------- after it is applied: each once ----------

// The parent's confirmation goes by itself once the upgrade is applied: Lee
// approved the wording on 11 Nov 2026. CAMP_UPGRADE_PARENT_EMAIL=off holds it
// again ("waiting", staff send it from the portal). Staff alert and Telegram
// always go straight away.
export const parentEmailLive = () => String(process.env.CAMP_UPGRADE_PARENT_EMAIL || 'on').toLowerCase() !== 'off'

export async function runUpgradeEffects(upgradeId, deps = {}) {
  const email = deps.email || (await import('./_camp-email.js'))
  const u = await getUpgrade(upgradeId)
  if (!u || u.state !== 'applied') return
  const camp = await getCamp(u.campId)
  const b = await getBooking(u.baseBookingId)
  const effects = { ...(u.effects || {}) }
  const step = async (what, fn) => {
    if (effects[what] === 'done' || effects[what] === 'unclear') return
    if ((await kvCommand(['SET', ukeys.effect(u.id, what), new Date().toISOString(), 'NX', 'EX', '600'])) !== 'OK') return
    try { const ref = await fn(); effects[what] = 'done'; if (ref && typeof ref === 'string') effects[`${what}Ref`] = ref } catch (error) {
      console.error(`camp upgrade ${what} failed`, u.id, error?.message || error)
      // Sent or not is unknown (no answer): keep it so nobody sends it twice blind.
      effects[what] = /fetch failed|timed? ?out|socket|ECONN/i.test(String(error?.message || error)) ? 'unclear' : 'failed'
      if (effects[what] === 'failed') await kvCommand(['DEL', ukeys.effect(u.id, what)]).catch(() => {})
    }
  }
  if (parentEmailLive()) await step('parentEmail', () => email.sendCampUpgradeConfirmation(b, camp, u))
  else if (!effects.parentEmail) effects.parentEmail = 'waiting'
  await step('staffEmail', () => email.sendCampUpgradeStaffAlert(b, camp, { ...u, effects }))
  await step('telegram', async () => {
    const { telegramAlert } = await import('./_jfp-notify.js')
    const counts = await dayCounts(camp)
    await telegramAlert(`Camp upgrade paid: ${b.players.map((p) => p.firstName).join(', ')} (${b.parentName}) now ${daysText(camp, b.dayIds)}. Top-up ${audLabel(u.topUpCents)}, ${audLabel(b.amountPaidCents)} paid in all. Places left: ${camp.days.map((d) => `${d.short} ${counts[d.id].left}`).join(', ')}.`)
  })
  const fresh = await getUpgrade(u.id)
  fresh.effects = { ...(fresh.effects || {}), ...effects }
  await saveUpgrade(fresh)
}

// Staff send the parent confirmation by hand (after the wording is approved).
export async function upgradeSendEmail(b, camp, upgradeId, by, deps = {}) {
  const email = deps.email || (await import('./_camp-email.js'))
  const u = await getUpgrade(upgradeId)
  if (!u || u.baseBookingId !== b.id) return { status: 404, body: { error: 'Upgrade not found.' } }
  if (u.state !== 'applied') return { status: 400, body: { error: 'Only an applied upgrade gets the confirmation email.' } }
  if (u.effects?.parentEmail === 'done' && !deps.again) return { status: 409, body: { error: `Already sent${u.effects.parentEmailAt ? ` on ${u.effects.parentEmailAt.slice(0, 10)}` : ''}.` } }
  if ((await kvCommand(['SET', ukeys.effect(u.id, 'parentEmail'), by, 'NX', 'EX', '600'])) !== 'OK') return { status: 409, body: { error: 'It is sending right now.' } }
  try {
    const ref = await email.sendCampUpgradeConfirmation(b, camp, u)
    u.effects = { ...(u.effects || {}), parentEmail: 'done', parentEmailAt: new Date().toISOString(), parentEmailBy: by, ...(typeof ref === 'string' ? { parentEmailRef: ref } : {}) }
    log(u, 'parent email sent', { by })
    await saveUpgrade(u)
    return { status: 200, body: { sent: `Sent to ${b.email}.` } }
  } catch (error) {
    await kvCommand(['DEL', ukeys.effect(u.id, 'parentEmail')]).catch(() => {})
    return { status: 502, body: { error: `The email did not send (${String(error.message).slice(0, 80)}).` } }
  }
}

async function alert(u, camp, deps = {}) {
  try {
    const { telegramAlert } = deps.telegram ? { telegramAlert: deps.telegram } : await import('./_jfp-notify.js')
    await telegramAlert(`CHECK camp upgrade ${u.id} for ${u.baseBookingId} (${camp?.short || 'camp'}): ${u.reason} The money is kept, nothing was refunded. Portal > Camps > open the sign-up.`)
  } catch (error) { console.error('camp upgrade alert failed', error?.message || error) }
}

// ---------- reading ----------

// What the portal shows: references, days, amounts and state. No tokens.
export function publicUpgrade(u, camp) {
  if (!u) return null
  return {
    id: u.id, baseBookingId: u.baseBookingId, state: u.state, reason: u.reason || '', createdAt: u.createdAt, by: u.by,
    players: u.players, originalDayIds: u.originalDayIds, newDayIds: u.newDayIds, targetDayIds: u.targetDayIds,
    paidCents: u.paidCents, targetTotalCents: u.targetTotalCents, topUpCents: u.topUpCents,
    url: u.state === 'pending' ? u.url : '', linkExpiresMs: u.linkExpiresMs, sessionId: u.sessionId || '',
    paymentIntent: u.paymentIntent || '', paidAt: u.paidAt || '', appliedAt: u.appliedAt || '', effects: u.effects || {},
    text: camp ? { adding: daysText(camp, u.newDayIds), target: daysText(camp, u.targetDayIds), topUp: audLabel(u.topUpCents), package: audLabel(u.targetTotalCents), paid: audLabel(u.paidCents) } : undefined,
    log: (u.log || []).slice(-12),
  }
}

// Every upgrade for a camp (newest first), with lapsed links tidied.
export async function listUpgrades(camp) {
  const ids = (await kvCommand(['ZREVRANGE', ukeys.list(camp.id), '0', '499'])) || []
  if (!ids.length) return []
  const rows = (await kvPipeline(ids.map((id) => ['GET', ukeys.upgrade(id)]))).map(parse).filter(Boolean)
  const out = []
  for (const u of rows) out.push(publicUpgrade(u.state === 'pending' && Date.now() > u.linkExpiresMs + 60_000 ? await settleIfLapsed(u) : u, camp))
  return out
}

// The family's view on the camp page after paying: only with the upgrade id
// AND its own Stripe session id, and only first names, days and amounts.
export async function upgradeResult(upgradeId, sessionId, camp) {
  const u = await getUpgrade(clean(upgradeId, 60))
  if (!u || u.campId !== camp.id || !sessionId || u.sessionId !== sessionId) return { status: 'unknown' }
  let s = null
  try { s = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionId)}`) } catch { return { status: 'confirming' } }
  if (upgradeIdFromSession(s) !== u.id) return { status: 'unknown' }
  let now = u
  if (s.payment_status === 'paid' && u.state !== 'applied') {
    const r = await finaliseCampUpgrade(u.id, s, { via: 'success-page' })
    if (r.busy) return { status: 'confirming' }
    now = r.upgrade || (await getUpgrade(u.id))
  }
  const b = await getBooking(u.baseBookingId)
  const status = now.state === 'applied' ? 'confirmed'
    : now.state === 'recovery' ? 'checking'
    : s.payment_status === 'paid' ? 'confirming'
    : s.status === 'expired' || now.state === 'expired' || now.state === 'cancelled' ? 'expired' : 'unpaid'
  return {
    status, id: u.id, players: (b?.players || []).map((p) => p.firstName),
    days: daysText(camp, status === 'confirmed' ? b.dayIds : u.originalDayIds), adding: daysText(camp, u.newDayIds),
    topUp: audLabel(u.topUpCents), total: audLabel(status === 'confirmed' ? b.amountPaidCents : u.paidCents), amount: u.topUpCents / 100,
  }
}

// A refund made in Stripe on an upgrade payment: kept on that payment only,
// never written over the original payment's refund.
export async function recordUpgradeRefund(charge, pi, upgradeId) {
  const u = await getUpgrade(upgradeId)
  if (!u) return ''
  const amount = Number(charge?.amount_refunded) || 0
  u.refundedCents = amount; u.refundedAt = new Date().toISOString(); log(u, 'refund seen in Stripe', { amountCents: amount })
  await saveUpgrade(u)
  const b = await getBooking(u.baseBookingId)
  if (b && Array.isArray(b.payments)) {
    b.payments = b.payments.map((p) => (p.paymentIntent === pi ? { ...p, refundedCents: amount, refundedAt: u.refundedAt } : p))
    b.refundedCents = b.payments.reduce((t, p) => t + (Number(p.refundedCents) || 0), 0)
    b.refundedAt = u.refundedAt
    await saveBooking(b)
  }
  return u.baseBookingId
}
