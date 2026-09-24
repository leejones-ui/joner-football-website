// A new family books a JFP group, or applies for a Pathway group.
//
//   reserve  -> holds N places for 10 minutes while the form is filled in
//   (submit) -> extends the hold, creates the Stripe Checkout Session
//   release  -> hands the places back (closed form, back from Stripe)
//   apply    -> Pathway application, no payment
//   payApproved -> an approved application's private link starts checkout
import crypto from 'node:crypto'
import { protectForm, rateLimit, verifyRecaptcha } from './_security.js'
import { validateEmailQuality } from './_email-quality.js'
import { stripeFetch, siteUrl, expireCheckoutSession } from './_holiday-store.js'
import {
  requireParentAccess, getConfig, getGroup, getBooking, saveBooking, indexBooking, newId, clean, holdPlaces, extendPlaces,
  releasePlaces, onlineCounts, placesLeft, tokenMatches, saveApplication, getApplication, coachById, sessionDates, dateLabel,
  RESERVE_MINUTES, HOLD_MINUTES, CHECKOUT_EXPIRES_MINUTES,
} from './_jfp-store.js'
import { airtableCounts } from './_jfp-airtable.js'
import { sendApplicationReceived, sendApplicationAlert } from './_jfp-email.js'
import { captureWebsiteContact } from './_master-contact-capture.js'

const MAX_PLAYERS = 3
function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }

function validatePlayers(input, n, config) {
  const list = Array.isArray(input) ? input.slice(0, n) : []
  if (list.length !== n) return { error: `Enter a name and age for each of the ${n} player${n === 1 ? '' : 's'}.` }
  const players = []
  for (const x of list) {
    const name = clean(x?.name, 80)
    const age = Number(x?.age)
    if (name.length < 2) return { error: 'Enter each player\'s full name.' }
    if (!Number.isInteger(age) || age < config.minAge || age > config.maxAge) return { error: `JFP is for players aged ${config.minAge} to ${config.maxAge}.` }
    players.push({ name, age })
  }
  return { players }
}

async function contact(body) {
  const parentName = clean(body.parentName, 100)
  const mobile = clean(body.mobile, 40)
  if (parentName.length < 2) return { error: 'Enter the parent or guardian name.' }
  if (mobile.replace(/\D/g, '').length < 8) return { error: 'Enter a mobile number we can reach you on.' }
  const e = await validateEmailQuality(body.email, { label: 'email' })
  if (!e.ok) return { error: e.error }
  return { parentName, mobile, email: e.email, notes: clean(body.notes, 500) }
}

async function available(group) {
  const { counts } = await airtableCounts()
  const online = (await onlineCounts([group.id]))[group.id] || 0
  return { left: placesLeft(group, counts[group.id], online), airtable: counts[group.id] || 0, online }
}

async function reserve(req, res, body) {
  if (!rateLimit(req, { key: 'jfp-reserve', limit: 12, windowMs: 60_000 }).allowed) return fail(res, 429, 'Too many tries. Wait a minute and try again.')
  const rc = await verifyRecaptcha(req, body.recaptchaToken)
  if (!rc.ok) return fail(res, 400, rc.error)
  const group = await getGroup(body.groupId)
  if (!group || group.mode !== 'direct') return fail(res, 404, 'That group is not taking online bookings.', { code: 'not_bookable' })
  const want = Number(body.players || 1)
  if (!Number.isInteger(want) || want < 1 || want > MAX_PLAYERS) return fail(res, 400, `Book up to ${MAX_PLAYERS} players at a time.`)
  let snapshot
  try { snapshot = await available(group) } catch { return fail(res, 503, 'Bookings are briefly unavailable. Try again in a minute.') }
  const nowMs = Date.now()
  const id = newId('JFP')
  const expiresMs = nowMs + RESERVE_MINUTES * 60_000
  const ok = await holdPlaces({ gid: group.id, bookingId: id, want, available: Math.max(0, group.capacity - snapshot.airtable), expiresMs, nowMs })
  if (!ok) {
    const left = Math.max(0, snapshot.left)
    return fail(res, 409, left > 0 ? `Only ${left} place${left === 1 ? '' : 's'} left in that group.` : 'That group has just filled. Pick another.', { code: 'full', placesLeft: left })
  }
  const releaseToken = crypto.randomBytes(16).toString('hex')
  await saveBooking({ id, groupId: group.id, seats: want, status: 'reserving', releaseToken, holdExpiresAt: new Date(expiresMs).toISOString(), createdAt: new Date(nowMs).toISOString() })
  return res.status(200).json({ success: true, bookingId: id, releaseToken, expiresAt: new Date(expiresMs).toISOString(), players: want })
}

async function release(req, res, body) {
  const b = await getBooking(body.bookingId)
  if (!b) return fail(res, 404, 'Booking not found.')
  if (!tokenMatches(clean(body.releaseToken, 64), b.releaseToken)) return fail(res, 403, 'Not allowed.')
  if (b.status === 'held' || b.status === 'reserving') {
    if (b.status === 'held') await expireCheckoutSession(b.stripeSessionId)
    await releasePlaces(b.groupId, b.id, b.seats || b.players?.length || 1)
    await saveBooking({ ...b, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'parent' })
  }
  return res.status(200).json({ success: true })
}

async function checkout(req, { booking, group, config, source }) {
  const coach = coachById(config, group.coachId)
  const dates = sessionDates(config, group.day)
  const base = siteUrl(req)
  const n = booking.players.length
  const name = `${config.term}: ${group.day} ${group.time}, ${group.location}${coach ? ` with Coach ${coach.name}` : ''}`
  return stripeFetch('/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment',
      customer_email: booking.email,
      expires_at: String(Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRES_MINUTES * 60),
      success_url: `${base}/jfp-booking/success/?booking_id=${encodeURIComponent(booking.id)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/jfp-booking/?payment=cancelled&booking_id=${encodeURIComponent(booking.id)}&release=${booking.releaseToken}`,
      'line_items[0][quantity]': String(n),
      'line_items[0][price_data][currency]': 'aud',
      'line_items[0][price_data][unit_amount]': String(booking.unitCents),
      'line_items[0][price_data][product_data][name]': name.slice(0, 250),
      'line_items[0][price_data][product_data][description]': `10 weeks, ${dateLabel(dates[0])} to ${dateLabel(dates.at(-1))}. ${n} player${n === 1 ? '' : 's'}.`,
      'metadata[jfpBookingId]': booking.id,
      'metadata[groupId]': group.id,
      'metadata[source]': source,
      'metadata[players]': booking.players.map((x) => x.name).join(', ').slice(0, 480),
      'payment_intent_data[metadata][jfpBookingId]': booking.id,
      'payment_intent_data[metadata][groupId]': group.id,
      'payment_intent_data[description]': name.slice(0, 400),
    },
  })
}

async function submit(req, res, body) {
  const protection = await protectForm(req, res, 'jfp-book', body)
  if (!protection.ok) return protection.response
  const config = await getConfig()
  const group = await getGroup(body.groupId)
  if (!group || group.mode !== 'direct') return fail(res, 404, 'That group is not taking online bookings.')
  const reservation = await getBooking(body.bookingId)
  if (!reservation || reservation.groupId !== group.id || !tokenMatches(clean(body.releaseToken, 64), reservation.releaseToken) || reservation.status !== 'reserving') {
    return fail(res, 409, 'Your hold on this group ended. Tap the group again.', { code: 'hold_lost' })
  }
  const n = reservation.seats
  const pl = validatePlayers(body.players, n, config)
  if (pl.error) return fail(res, 400, pl.error)
  const who = await contact(body)
  if (who.error) return fail(res, 400, who.error)
  if (body.agreementAccepted !== true) return fail(res, 400, 'Please accept the terms to continue.')

  const nowMs = Date.now()
  const holdExpiresMs = nowMs + HOLD_MINUTES * 60_000
  if (!(await extendPlaces({ gid: group.id, bookingId: reservation.id, want: n, expiresMs: holdExpiresMs, nowMs }))) {
    return fail(res, 409, 'Your 10 minute hold ran out and the place was released. Tap the group again.', { code: 'hold_lost' })
  }
  const booking = {
    ...reservation,
    ...who,
    players: pl.players,
    unitCents: config.priceCents,
    priceCents: config.priceCents * n,
    groupSnapshot: group,
    source: 'direct',
    status: 'held',
    holdExpiresAt: new Date(holdExpiresMs).toISOString(),
  }
  let session
  try { session = await checkout(req, { booking, group, config, source: 'direct' }) } catch (error) {
    console.error('jfp checkout failed', error)
    await releasePlaces(group.id, booking.id, n).catch(() => {})
    await saveBooking({ ...booking, status: 'cancelled', cancelledBy: 'checkout-failed' })
    return fail(res, 502, 'Could not start the payment. Nothing has been charged. Please try again.')
  }
  booking.stripeSessionId = session.id
  await saveBooking(booking)
  await indexBooking(booking)
  const masterCapture = await captureWebsiteContact({ endpoint: 'jfp-book', form: 'jfp-direct-booking', country: 'AU', players: booking.players, phone: booking.mobile, email: booking.email, parentName: booking.parentName, contactType: 'Parent/Guardian', source: 'jfp-direct-booking', sourceLabel: 'JFP term booking', submittedAt: booking.createdAt })
  if (masterCapture.status === 'failed') console.error('Master contact capture failed:', masterCapture.reason)
  return res.status(200).json({ success: true, bookingId: booking.id, url: session.url })
}

async function apply(req, res, body) {
  const protection = await protectForm(req, res, 'jfp-apply', body)
  if (!protection.ok) return protection.response
  const config = await getConfig()
  const group = await getGroup(body.groupId)
  if (!group || group.mode !== 'application') return fail(res, 404, 'That group is not taking applications.')
  const n = Math.min(MAX_PLAYERS, Math.max(1, Number(body.playersCount) || (Array.isArray(body.players) ? body.players.length : 1)))
  const pl = validatePlayers(body.players, n, config)
  if (pl.error) return fail(res, 400, pl.error)
  const who = await contact(body)
  if (who.error) return fail(res, 400, who.error)
  const application = {
    id: newId('APP'),
    groupId: group.id,
    players: pl.players,
    ...who,
    club: clean(body.club, 120),
    status: 'pending',
    payToken: '',
    createdAt: new Date().toISOString(),
  }
  await saveApplication(application)
  await Promise.all([
    sendApplicationReceived({ application, group, config }).catch((e) => console.error('jfp application ack failed', e)),
    sendApplicationAlert({ application, group, config }).catch((e) => console.error('jfp application alert failed', e)),
  ])
  const masterCapture = await captureWebsiteContact({ endpoint: 'jfp-book', form: 'jfp-application', country: 'AU', players: application.players, phone: application.mobile, email: application.email, parentName: application.parentName, contactType: 'Parent/Guardian', source: 'jfp-application', sourceLabel: 'JFP Pathway application', submittedAt: application.createdAt })
  if (masterCapture.status === 'failed') console.error('Master contact capture failed:', masterCapture.reason)
  return res.status(200).json({ success: true, applicationId: application.id })
}

// No password needed: the private token from the approval email is the key.
async function payApproved(req, res, body) {
  if (!rateLimit(req, { key: 'jfp-pay-approved', limit: 10, windowMs: 60_000 }).allowed) return fail(res, 429, 'Too many tries.')
  const app = await getApplication(body.applicationId)
  if (!app || app.status !== 'approved' || !tokenMatches(clean(body.token, 64), app.payToken) || Date.parse(app.payTokenExpiresAt) < Date.now()) {
    return fail(res, 403, 'This payment link is not valid or has expired. Contact Joner Football.')
  }
  if (app.bookingId) {
    const prior = await getBooking(app.bookingId)
    if (prior?.status === 'paid') return fail(res, 409, 'This place is already paid for.', { code: 'already_paid' })
  }
  const config = await getConfig()
  const group = await getGroup(app.groupId)
  if (!group) return fail(res, 404, 'That group no longer exists. Contact Joner Football.')
  let snap
  try { snap = await available(group) } catch { return fail(res, 503, 'Payments are briefly unavailable. Try again in a minute.') }
  const nowMs = Date.now()
  const id = newId('JFP')
  const n = app.players.length
  const holdExpiresMs = nowMs + HOLD_MINUTES * 60_000
  if (!(await holdPlaces({ gid: group.id, bookingId: id, want: n, available: Math.max(0, group.capacity - snap.airtable), expiresMs: holdExpiresMs, nowMs }))) {
    return fail(res, 409, 'That group is now full. Contact Joner Football and we will sort out a place.', { code: 'full' })
  }
  const booking = {
    id, groupId: group.id, seats: n, status: 'held', releaseToken: crypto.randomBytes(16).toString('hex'),
    players: app.players, parentName: app.parentName, email: app.email, mobile: app.mobile, notes: app.notes || '',
    unitCents: config.priceCents, priceCents: config.priceCents * n, groupSnapshot: group, source: 'application', applicationId: app.id,
    holdExpiresAt: new Date(holdExpiresMs).toISOString(), createdAt: new Date(nowMs).toISOString(),
  }
  let session
  try { session = await checkout(req, { booking, group, config, source: 'application' }) } catch (error) {
    console.error('jfp approved checkout failed', error)
    await releasePlaces(group.id, id, n).catch(() => {})
    return fail(res, 502, 'Could not start the payment. Nothing has been charged. Please try again.')
  }
  booking.stripeSessionId = session.id
  await saveBooking(booking)
  await indexBooking(booking)
  await saveApplication({ ...app, bookingId: id })
  return res.status(200).json({ success: true, url: session.url })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }
  try {
    if (body.action === 'payApproved') return await payApproved(req, res, body)
    if (!requireParentAccess(req, res)) return
    if (body.action === 'reserve') return await reserve(req, res, body)
    if (body.action === 'release') return await release(req, res, body)
    if (body.action === 'apply') return await apply(req, res, body)
    return await submit(req, res, body)
  } catch (error) {
    console.error('jfp-book failed', error)
    return fail(res, 500, 'Something went wrong. Nothing has been charged. Please try again.')
  }
}
