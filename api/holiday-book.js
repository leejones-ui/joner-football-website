// A parent books an hour. Tapping a time reserves it for RESERVE_MINUTES
// (action 'reserve'), so nobody else can take it while they type. Pressing
// Pay extends that hold to cover Stripe checkout, then creates the Checkout
// Session. If Stripe says no, the hour goes straight back.
import { protectForm, rateLimit, verifyRecaptcha } from './_security.js'
import { validateEmailQuality } from './_email-quality.js'
import {
  requireHolidayAccess, getConfig, getSlot, getBooking, coachById, resolvePriceCents,
  holdSlot, releaseSlot, saveBooking, indexBooking, newId, clean, siteUrl, stripeFetch,
  sydneyDateLabel, sydneyTimeLabel, TYPE_LABELS, SESSION_TYPES, HOLD_MINUTES, CHECKOUT_EXPIRES_MINUTES,
  maxPlayersForType, expireCheckoutSession, extendHold, RESERVE_MINUTES,
} from './_holiday-store.js'
import crypto from 'node:crypto'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }

function validatePlayers(input, seats) {
  const list = Array.isArray(input) ? input.slice(0, seats) : []
  if (list.length !== seats) return { error: `Enter a name and age for each of the ${seats} player${seats === 1 ? '' : 's'}.` }
  const players = []
  for (const p of list) {
    const name = clean(p?.name, 80)
    const age = Number(p?.age)
    if (name.length < 2) return { error: 'Enter each player\'s name.' }
    if (!Number.isInteger(age) || age < 4 || age > 18) return { error: 'Player age must be between 4 and 18.' }
    players.push({ name, age })
  }
  return { players }
}

async function releaseHeld(req, res, body) {
  const booking = await getBooking(body.bookingId)
  if (!booking) return fail(res, 404, 'Booking not found.')
  const token = clean(body.releaseToken, 64)
  if (!token || token.length !== booking.releaseToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(booking.releaseToken))) {
    return fail(res, 403, 'Not allowed.')
  }
  if (booking.status === 'held' || booking.status === 'reserving') {
    if (booking.status === 'held') await expireCheckoutSession(booking.stripeSessionId)
    await releaseSlot(booking.slotId, booking.id)
    await saveBooking({ ...booking, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'parent' })
  }
  return res.status(200).json({ success: true, released: true })
}

async function reserve(req, res, body) {
  const limited = rateLimit(req, { key: 'holiday-reserve', limit: 12, windowMs: 60_000 })
  if (!limited.allowed) return fail(res, 429, 'Too many tries. Wait a minute and try again.')
  const recaptcha = await verifyRecaptcha(req, body.recaptchaToken)
  if (!recaptcha.ok) return fail(res, 400, recaptcha.error)

  const config = await getConfig()
  const slot = await getSlot(body.slotId)
  if (!slot) return fail(res, 404, 'That session is no longer available.', { code: 'slot_gone' })
  if (slot.status === 'blocked') return fail(res, 409, 'That time is already booked. Pick another time.', { code: 'slot_full' })
  if (slot.status !== 'open') return fail(res, 404, 'That session is no longer available.', { code: 'slot_gone' })
  const nowMs = Date.now()
  if (new Date(slot.startsAt).getTime() <= nowMs + config.bookingCutoffHours * 60 * 60_000) {
    return fail(res, 409, 'That session is too close to book online now.', { code: 'too_late' })
  }

  const bookingId = newId('HOL')
  const holdExpiresMs = nowMs + RESERVE_MINUTES * 60_000
  const held = await holdSlot({ slotId: slot.id, bookingId, holdExpiresMs, nowMs })
  if (held !== 'held') return fail(res, 409, 'Someone is booking that time right now. Pick another, or try again in a few minutes.', { code: 'slot_full' })

  const releaseToken = crypto.randomBytes(16).toString('hex')
  await saveBooking({ id: bookingId, slotId: slot.id, coachId: slot.coachId, status: 'reserving', releaseToken, holdExpiresAt: new Date(holdExpiresMs).toISOString(), createdAt: new Date(nowMs).toISOString() })
  return res.status(200).json({ success: true, bookingId, releaseToken, expiresAt: new Date(holdExpiresMs).toISOString() })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  if (!requireHolidayAccess(req, res)) return

  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }

  if (body.action === 'release') {
    try { return await releaseHeld(req, res, body) } catch (error) {
      console.error('holiday release failed', error)
      return fail(res, 500, 'Could not release that booking.')
    }
  }

  if (body.action === 'reserve') {
    try { return await reserve(req, res, body) } catch (error) {
      console.error('holiday reserve failed', error)
      return fail(res, 500, 'Could not hold that time. Try again.')
    }
  }

  const protection = await protectForm(req, res, 'holiday-book', body)
  if (!protection.ok) return protection.response

  const config = await getConfig()
  const slot = await getSlot(body.slotId)
  if (!slot) return fail(res, 404, 'That session is no longer available.', { code: 'slot_gone' })
  if (slot.status === 'blocked') return fail(res, 409, 'That time is already booked. Pick another time.', { code: 'slot_full' })
  if (slot.status !== 'open') return fail(res, 404, 'That session is no longer available.', { code: 'slot_gone' })

  const nowMs = Date.now()
  if (new Date(slot.startsAt).getTime() <= nowMs + config.bookingCutoffHours * 60 * 60_000) {
    return fail(res, 409, 'That session is too close to book online now. Email us and we will try to fit you in.', { code: 'too_late' })
  }

  // The type only sets the per-player price and how many of this family's
  // players can come. Whatever they pick, the booking takes the whole hour.
  const requested = clean(body.type, 10)
  const type = slot.type === 'open' ? requested : slot.type
  if (!SESSION_TYPES.includes(type) || (slot.type !== 'open' && requested && requested !== slot.type)) {
    return fail(res, 400, 'Choose 1 to 1, shared or group.')
  }
  const maxPlayers = maxPlayersForType(slot, type)

  const seats = Number(body.seats || 1)
  if (!Number.isInteger(seats) || seats < 1 || seats > maxPlayers) return fail(res, 400, `A ${TYPE_LABELS[type]} session is for up to ${maxPlayers} player${maxPlayers === 1 ? '' : 's'}.`)
  const playersCheck = validatePlayers(body.players, seats)
  if (playersCheck.error) return fail(res, 400, playersCheck.error)

  const parentName = clean(body.parentName, 100)
  const mobile = clean(body.mobile, 40)
  const notes = clean(body.notes, 500)
  if (parentName.length < 2) return fail(res, 400, 'Enter the parent or guardian name.')
  if (mobile.replace(/\D/g, '').length < 8) return fail(res, 400, 'Enter a mobile number we can reach you on.')
  if (body.agreementAccepted !== true) return fail(res, 400, 'Please accept the terms to continue.')

  const emailCheck = await validateEmailQuality(body.email, { label: 'email' })
  if (!emailCheck.ok) return fail(res, 400, emailCheck.error)
  const email = emailCheck.email

  const coach = coachById(config, slot.coachId)
  const unitCents = resolvePriceCents({ ...slot, type }, config)
  if (!unitCents) return fail(res, 503, 'This session has no price set yet. Please try again later.')

  // Carry on the reservation made when the form opened, if it is still ours.
  const holdExpiresMs = nowMs + HOLD_MINUTES * 60_000
  let bookingId, releaseToken
  const reservation = body.bookingId ? await getBooking(body.bookingId) : null
  const tokenOk = reservation && typeof body.releaseToken === 'string' && reservation.releaseToken &&
    body.releaseToken.length === reservation.releaseToken.length &&
    crypto.timingSafeEqual(Buffer.from(body.releaseToken), Buffer.from(reservation.releaseToken))
  if (tokenOk && reservation.status === 'reserving' && reservation.slotId === slot.id &&
      await extendHold({ slotId: slot.id, bookingId: reservation.id, holdExpiresMs, nowMs })) {
    bookingId = reservation.id
    releaseToken = reservation.releaseToken
  } else {
    // No reservation, or it lapsed: take the hour now if it is still free.
    bookingId = newId('HOL')
    const held = await holdSlot({ slotId: slot.id, bookingId, holdExpiresMs, nowMs })
    if (held !== 'held') return fail(res, 409, 'That time was just booked by someone else. Pick another time.', { code: 'slot_full' })
    releaseToken = crypto.randomBytes(16).toString('hex')
  }
  const typeLabel = TYPE_LABELS[type]
  const base = siteUrl(req)
  const productName = `${coach?.name || 'Coach'}: ${typeLabel} session, ${sydneyDateLabel(slot.startsAt)} ${sydneyTimeLabel(slot.startsAt)}`

  let session
  try {
    session = await stripeFetch('/checkout/sessions', {
      method: 'POST',
      body: {
        mode: 'payment',
        customer_email: email,
        expires_at: String(Math.floor(nowMs / 1000) + CHECKOUT_EXPIRES_MINUTES * 60),
        success_url: `${base}/holiday-bookings/success/?booking_id=${encodeURIComponent(bookingId)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/holiday-bookings/?payment=cancelled&booking_id=${encodeURIComponent(bookingId)}&release=${releaseToken}`,
        'line_items[0][quantity]': String(seats),
        'line_items[0][price_data][currency]': 'aud',
        'line_items[0][price_data][unit_amount]': String(unitCents),
        'line_items[0][price_data][product_data][name]': productName,
        'line_items[0][price_data][product_data][description]': `${slot.location}. ${seats} player${seats === 1 ? '' : 's'}.`,
        'metadata[holidayBookingId]': bookingId,
        'metadata[slotId]': slot.id,
        'metadata[coach]': coach?.name || slot.coachId,
        'metadata[players]': playersCheck.players.map((p) => p.name).join(', ').slice(0, 480),
        'payment_intent_data[metadata][holidayBookingId]': bookingId,
        'payment_intent_data[metadata][slotId]': slot.id,
        'payment_intent_data[description]': productName.slice(0, 400),
      },
    })
  } catch (error) {
    console.error('holiday checkout failed', error)
    await releaseSlot(slot.id, bookingId).catch(() => {})
    return fail(res, 502, 'Could not start the payment. Nothing has been charged. Please try again.')
  }

  const booking = {
    id: bookingId,
    slotId: slot.id,
    coachId: slot.coachId,
    coachName: coach?.name || slot.coachId,
    type,
    seats,
    players: playersCheck.players,
    parentName,
    email,
    mobile,
    notes,
    unitCents,
    priceCents: unitCents * seats,
    status: 'held',
    stripeSessionId: session.id,
    holdExpiresAt: new Date(holdExpiresMs).toISOString(),
    releaseToken,
    createdAt: new Date(nowMs).toISOString(),
  }
  await saveBooking(booking)
  await indexBooking(booking)

  return res.status(200).json({ success: true, bookingId, url: session.url })
}
