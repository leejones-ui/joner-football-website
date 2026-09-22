// Turning a paid Stripe session into a confirmed seat. Called from two places
// that can race, the webhook and the success page, so every step is
// idempotent: a status check, a one-shot claim, and side effects that each
// guard themselves and never block the seat.
import { getBooking, saveBooking, getSlot, getConfig, coachById, confirmSeats, releaseSeats, claimOnce, keys, clean } from './_holiday-store.js'
import { sendHolidayConfirmationEmail, sendHolidayAdminAlert, appendHolidaySheetRow } from './_holiday-email.js'

export function bookingIdFromSession(session) {
  return clean(session?.metadata?.holidayBookingId || '', 60)
}

async function sideEffect(label, key, fn) {
  try {
    if (!(await claimOnce(key))) return { label, skipped: 'already-done' }
    await fn()
    return { label, ok: true }
  } catch (error) {
    console.error(`holiday ${label} failed`, error)
    return { label, error: error.message }
  }
}

export async function finaliseBooking(bookingId, session) {
  const booking = await getBooking(bookingId)
  if (!booking) return { ok: false, reason: 'unknown-booking' }
  if (booking.status === 'paid') return { ok: true, already: true, booking }
  if (!(await claimOnce(keys.finalised(bookingId)))) return { ok: true, already: true, booking }

  const slot = await getSlot(booking.slotId)
  const config = await getConfig()
  const coachName = (slot && coachById(config, slot.coachId)?.name) || booking.coachName || ''

  const now = new Date().toISOString()
  const heldUntil = new Date(booking.holdExpiresAt || 0).getTime()
  const attention = []
  if (!slot || slot.status !== 'open') attention.push('slot-cancelled')
  if (heldUntil && Date.now() > heldUntil) attention.push('late-payment')

  await confirmSeats(booking.slotId, booking.id, booking.seats)

  const paid = {
    ...booking,
    status: 'paid',
    paidAt: now,
    stripeSessionId: session?.id || booking.stripeSessionId,
    stripePaymentIntentId: typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id || booking.stripePaymentIntentId || '',
    amountPaidCents: Number(session?.amount_total ?? booking.priceCents),
    needsAttention: attention.join(', ') || booking.needsAttention || '',
    coachName,
  }
  await saveBooking(paid)

  const context = { booking: paid, slot: slot || { type: paid.type, location: '', startsAt: '', endsAt: '', date: '' }, coachName }
  const effects = await Promise.all([
    sideEffect('sheet', keys.sheet(paid.id), () => appendHolidaySheetRow(context)),
    sideEffect('email', keys.email(paid.id), () => sendHolidayConfirmationEmail(context)),
    sideEffect('admin-alert', keys.adminAlert(paid.id), () => sendHolidayAdminAlert(context)),
  ])

  return { ok: true, already: false, booking: paid, effects }
}

export async function expireBooking(bookingId) {
  const booking = await getBooking(bookingId)
  if (!booking || booking.status !== 'held') return { ok: true, changed: false, booking }
  await releaseSeats(booking.slotId, booking.id, booking.seats)
  const expired = { ...booking, status: 'expired', expiredAt: new Date().toISOString() }
  await saveBooking(expired)
  return { ok: true, changed: true, booking: expired }
}
