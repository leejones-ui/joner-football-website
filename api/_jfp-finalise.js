// Turning a paid Stripe session into a JFP enrolment. Called by the webhook
// and by the success page, which can race, and either can die part way.
//
// Same shape as the holiday system: a short takeover lease, then each side
// effect records done / failed / uncertain on the booking. The two Airtable
// writes look for their own earlier row first, so a retry can never create a
// second enrolment or a second ledger payment.
import { stripeFetch } from './_holiday-store.js'
import { getBooking, saveBooking, getGroup, getConfig, confirmPlaces, releasePlaces, coachById, kvCommand, keys, clean } from './_jfp-store.js'
import { createTerm4Players, findTerm4ByBooking, createLedgerRow, findLedgerByPayment } from './_jfp-airtable.js'
import { sendParentConfirmation, sendStaffAlert, sendCoachAlert } from './_jfp-email.js'

const LEASE_SECONDS = 120
export const EFFECTS = ['airtable', 'ledger', 'parentEmail', 'staffAlert', 'coachAlert']

export function jfpBookingIdFromSession(session) {
  return clean(session?.metadata?.jfpBookingId || '', 60)
}

async function takeLease(id, booking) {
  const key = keys.finalised(id)
  if ((await kvCommand(['SET', key, String(Date.now()), 'NX', 'EX', String(LEASE_SECONDS)])) === 'OK') return true
  if (booking.status === 'paid') return false
  if (Number(await kvCommand(['TTL', key])) > 0) return false
  await kvCommand(['SET', key, String(Date.now()), 'EX', String(LEASE_SECONDS)])
  return true
}

function classify(error) {
  const m = String(error?.message || error)
  return /Airtable \d{3}|Brevo \d{3}|not configured|INVALID|permission/i.test(m) ? 'failed' : 'uncertain'
}

async function runEffect(name, booking, fn) {
  const cur = booking.effects?.[name]
  if (cur?.status === 'done' || cur?.status === 'uncertain') return
  const attempts = (cur?.attempts || 0) + 1
  booking.effects = { ...(booking.effects || {}), [name]: { status: 'running', at: new Date().toISOString(), attempts } }
  await saveBooking(booking)
  try {
    const result = await fn()
    booking.effects[name] = { status: 'done', at: new Date().toISOString(), attempts, ...(result === false ? { note: 'nothing to send' } : {}) }
  } catch (error) {
    console.error(`jfp ${name} failed for ${booking.id}`, error)
    booking.effects[name] = { status: classify(error), at: new Date().toISOString(), attempts, error: String(error?.message || error).slice(0, 300) }
  }
  await saveBooking(booking)
}

// The exact Stripe fee, from the balance transaction, not an estimate.
async function stripeFee(paymentIntentId) {
  if (!paymentIntentId) return null
  try {
    const pi = await stripeFetch(`/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`)
    const bt = pi?.latest_charge?.balance_transaction
    return typeof bt?.fee === 'number' ? bt.fee : null
  } catch (error) {
    console.warn('jfp stripe fee read failed', error.message)
    return null
  }
}

export function splitFee(total, n) {
  if (total == null || n < 1) return null
  const base = Math.floor(total / n)
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0))
}

async function runEffects(booking) {
  const [group, config] = await Promise.all([getGroup(booking.groupId), getConfig()])
  const g = group || booking.groupSnapshot
  const coach = coachById(config, g.coachId)
  await runEffect('airtable', booking, async () => {
    const existing = await findTerm4ByBooking(booking.id)
    if (existing.length) { booking.term4Ids = existing; return }
    booking.term4Ids = await createTerm4Players({ booking, group: g, config, coachAirtableName: coach?.airtableName, feeSplit: splitFee(booking.stripeFeeCents, booking.players.length) })
  })
  await runEffect('ledger', booking, async () => {
    const paymentId = booking.stripePaymentIntentId || booking.id
    const existing = await findLedgerByPayment(paymentId)
    if (existing.length) { booking.ledgerId = existing[0]; return }
    booking.ledgerId = await createLedgerRow({ booking, term4Ids: booking.term4Ids || [], config })
  })
  await runEffect('parentEmail', booking, () => sendParentConfirmation({ booking, group: g, config }))
  await runEffect('staffAlert', booking, () => sendStaffAlert({ booking, group: g, config }))
  await runEffect('coachAlert', booking, () => sendCoachAlert({ booking, group: g, config }))
}

export function effectsSummary(booking) {
  const e = booking.effects || {}
  const pending = EFFECTS.filter((k) => !e[k] || e[k].status === 'running')
  const failed = EFFECTS.filter((k) => e[k]?.status === 'failed')
  const uncertain = EFFECTS.filter((k) => e[k]?.status === 'uncertain')
  return { pending, failed, uncertain, ok: !pending.length && !failed.length && !uncertain.length }
}

export async function finaliseJfpBooking(id, session) {
  let booking = await getBooking(id)
  if (!booking) return { ok: false, reason: 'unknown-booking' }
  if (booking.status === 'cancelled') return { ok: true, already: true, booking }
  if (!(await takeLease(id, booking))) return { ok: true, already: true, booking }

  if (booking.status !== 'paid') {
    await confirmPlaces(booking.groupId, booking.id, booking.players.length)
    const pi = typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id || ''
    const heldUntil = Date.parse(booking.holdExpiresAt || 0)
    booking = {
      ...booking,
      status: 'paid',
      paidAt: new Date().toISOString(),
      stripeSessionId: session?.id || booking.stripeSessionId,
      stripePaymentIntentId: pi,
      amountPaidCents: Number(session?.amount_total ?? booking.priceCents),
      needsAttention: heldUntil && Date.now() > heldUntil ? 'late-payment' : '',
    }
    booking.stripeFeeCents = await stripeFee(pi)
    await saveBooking(booking)
  }
  await runEffects(booking)
  return { ok: true, already: false, booking }
}

// Admin repair: retry definite failures and unfinished effects only.
export async function repairJfpBooking(id) {
  const booking = await getBooking(id)
  if (!booking || booking.status !== 'paid') return { ok: false }
  if (booking.stripeFeeCents == null) booking.stripeFeeCents = await stripeFee(booking.stripePaymentIntentId)
  for (const k of EFFECTS) if (['failed', 'running'].includes(booking.effects?.[k]?.status)) delete booking.effects[k]
  await runEffects(booking)
  return { ok: true, summary: effectsSummary(booking) }
}

export async function expireJfpBooking(id) {
  const booking = await getBooking(id)
  if (!booking || !['held', 'reserving'].includes(booking.status)) return { changed: false }
  await releasePlaces(booking.groupId, booking.id, booking.players?.length || booking.seats || 6)
  await saveBooking({ ...booking, status: 'expired', expiredAt: new Date().toISOString() })
  return { changed: true }
}
