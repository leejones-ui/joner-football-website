// Turning a paid Stripe session into a confirmed booking. Called from two
// places that can race, the webhook and the success page, and either can die
// halfway. So: the booking itself is claimed with a short lease, and each
// side effect (roster row, parent email, Lee's alert) records its own
// outcome on the booking. A definite failure can be retried from admin. An
// unknown outcome (the provider may or may not have acted) is surfaced for a
// human rather than retried blind, because a second email is worse than a
// late one.
import { getBooking, saveBooking, getSlot, getConfig, coachById, confirmSlot, releaseSlot, slotOwners, kvCommand, keys, clean } from './_holiday-store.js'
import { sendHolidayConfirmationEmail, sendHolidayAdminAlert, appendHolidaySheetRow, sheetHasBooking } from './_holiday-email.js'

const LEASE_SECONDS = 120
export const EFFECTS = ['sheet', 'email', 'adminAlert']

export function bookingIdFromSession(session) {
  return clean(session?.metadata?.holidayBookingId || '', 60)
}

// Take the finalise lease. A live lease held by another caller means "already
// being done". A stale lease with the booking still unpaid means the earlier
// caller died, so we take over.
async function takeLease(bookingId, booking) {
  const key = keys.finalised(bookingId)
  const claimed = await kvCommand(['SET', key, String(Date.now()), 'NX', 'EX', String(LEASE_SECONDS)])
  if (claimed === 'OK') return true
  if (booking.status === 'paid') return false
  const ttl = Number(await kvCommand(['TTL', key]))
  if (ttl > 0) return false
  await kvCommand(['SET', key, String(Date.now()), 'EX', String(LEASE_SECONDS)])
  return true
}

function classify(error) {
  // HTTP errors from the provider are definite: nothing was sent. Anything
  // else (timeout, reset) is unknown, because the request may have landed.
  const msg = String(error?.message || error || '')
  return /failed: \d{3}|^\{|"code"|Brevo|permission|not found|invalid/i.test(msg) ? 'failed' : 'uncertain'
}

async function runEffect(name, booking, fn) {
  const current = booking.effects?.[name]
  if (current?.status === 'done' || current?.status === 'uncertain') return current
  const started = { status: 'running', at: new Date().toISOString(), attempts: (current?.attempts || 0) + 1 }
  booking.effects = { ...(booking.effects || {}), [name]: started }
  await saveBooking(booking)
  try {
    await fn()
    booking.effects[name] = { status: 'done', at: new Date().toISOString(), attempts: started.attempts }
  } catch (error) {
    console.error(`holiday ${name} failed for ${booking.id}`, error)
    booking.effects[name] = { status: classify(error), at: new Date().toISOString(), attempts: started.attempts, error: String(error?.message || error).slice(0, 300) }
  }
  await saveBooking(booking)
  return booking.effects[name]
}

async function runEffects(booking, slot, coachName) {
  const context = { booking, slot: slot || { type: booking.type, location: '', startsAt: '', endsAt: '', date: '' }, coachName }
  // The sheet is the one effect we can make safe to retry: check for the row first.
  await runEffect('sheet', booking, async () => {
    if (await sheetHasBooking(booking.id)) return
    await appendHolidaySheetRow(context)
  })
  await runEffect('email', booking, () => sendHolidayConfirmationEmail(context))
  await runEffect('adminAlert', booking, () => sendHolidayAdminAlert(context))
  return booking.effects
}

export function effectsSummary(booking) {
  const e = booking.effects || {}
  const pending = EFFECTS.filter((k) => !e[k] || e[k].status === 'running')
  const failed = EFFECTS.filter((k) => e[k]?.status === 'failed')
  const uncertain = EFFECTS.filter((k) => e[k]?.status === 'uncertain')
  return { pending, failed, uncertain, ok: !pending.length && !failed.length && !uncertain.length }
}

export async function finaliseBooking(bookingId, session) {
  let booking = await getBooking(bookingId)
  if (!booking) return { ok: false, reason: 'unknown-booking' }
  if (booking.status === 'cancelled') return { ok: true, already: true, booking }
  if (!(await takeLease(bookingId, booking))) return { ok: true, already: true, booking }

  const slot = await getSlot(booking.slotId)
  const config = await getConfig()
  const coachName = (slot && coachById(config, slot.coachId)?.name) || booking.coachName || ''

  if (booking.status !== 'paid') {
    const attention = []
    if (!slot || slot.status !== 'open') attention.push('slot-cancelled')
    const heldUntil = new Date(booking.holdExpiresAt || 0).getTime()
    if (heldUntil && Date.now() > heldUntil) attention.push('late-payment')

    // Take the slot for real. If a newer booking now holds it (only possible
    // after a late payment), do not confirm over the top of them: flag it.
    const current = (await slotOwners([booking.slotId]))[booking.slotId]
    if (current?.booked && current.ownerId !== booking.id) attention.push('slot-taken-by-' + current.ownerId)
    else await confirmSlot(booking.slotId, booking.id)

    booking = {
      ...booking,
      status: 'paid',
      paidAt: new Date().toISOString(),
      stripeSessionId: session?.id || booking.stripeSessionId,
      stripePaymentIntentId: typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id || booking.stripePaymentIntentId || '',
      amountPaidCents: Number(session?.amount_total ?? booking.priceCents),
      needsAttention: attention.join(', ') || booking.needsAttention || '',
      coachName,
    }
    await saveBooking(booking)
  }

  const effects = await runEffects(booking, slot, coachName)
  return { ok: true, already: false, booking, effects }
}

// Admin repair: retry definite failures and unfinished effects. Never
// re-sends anything whose outcome is unknown; that stays a human call.
export async function repairBooking(bookingId) {
  const booking = await getBooking(bookingId)
  if (!booking || booking.status !== 'paid') return { ok: false, reason: 'not-paid' }
  const slot = await getSlot(booking.slotId)
  const config = await getConfig()
  const coachName = (slot && coachById(config, slot.coachId)?.name) || booking.coachName || ''
  for (const name of EFFECTS) {
    if (booking.effects?.[name]?.status === 'failed' || booking.effects?.[name]?.status === 'running') delete booking.effects[name]
  }
  const effects = await runEffects(booking, slot, coachName)
  return { ok: true, effects, summary: effectsSummary(booking) }
}

export async function expireBooking(bookingId) {
  const booking = await getBooking(bookingId)
  if (!booking || booking.status !== 'held') return { ok: true, changed: false, booking }
  await releaseSlot(booking.slotId, booking.id)
  const expired = { ...booking, status: 'expired', expiredAt: new Date().toISOString() }
  await saveBooking(expired)
  return { ok: true, changed: true, booking: expired }
}
