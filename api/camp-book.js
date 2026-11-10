// Camp bookings on the website (Lee, 10 Nov 2026).
//   GET  ?camp=<slug>                     places left per day (no names)
//   GET  ?camp=<slug>&session_id=&booked= the success page: finish a paid booking
//   POST { action:'book', ... }           hold the places, open Stripe Checkout
//   POST { action:'release', id, t }      the family came back from Stripe without paying
//   POST { action:'waitlist', ... }       a full day: keep their details for Lee
import { protectForm } from './_security.js'
import { clean, stripeFetch, siteUrl, expireCheckoutSession } from './_holiday-store.js'
import {
  getCampBySlug, publicCamp, validateBookingInput, holdPlaces, releasePlaces, newCampId, pricePerPlayer, createCheckout,
  saveBooking, indexBooking, getBooking, ckeys, CAMP_HOLD_MINUTES, finaliseCampBooking, campBookingIdFromSession,
  bookableDays, addWaitlist, daysText, audLabel,
} from './_camp-store.js'
import { kvCommand } from './_holiday-store.js'

const fail = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra })

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (req.method === 'GET') return await get(req, res)
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return fail(res, 405, 'Method not allowed') }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    if (body.action === 'release') return await release(res, body)
    if (body.action === 'waitlist') return await waitlist(req, res, body)
    return await book(req, res, body)
  } catch (error) {
    console.error('camp-book failed', error)
    return fail(res, 500, 'Something went wrong. Please try again, or email ligia@jonerfootball.com.')
  }
}

async function get(req, res) {
  const camp = await getCampBySlug(clean(req.query.camp, 80))
  if (!camp || camp.status === 'hidden') return fail(res, 404, 'Camp not found.')
  const out = { success: true, camp: await publicCamp(camp) }
  const sid = clean(req.query.session_id, 200)
  if (sid) {
    // The success page: Stripe's own word on the session, then finish it here
    // too, so the family is confirmed even if the webhook is slow.
    let session = null
    try { session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sid)}`) } catch { return res.status(200).json({ ...out, booking: { status: 'unknown' } }) }
    const id = campBookingIdFromSession(session)
    if (!id || id !== clean(req.query.booked, 60)) return res.status(200).json({ ...out, booking: { status: 'unknown' } })
    let b = await getBooking(id)
    if (session.payment_status === 'paid' && b && b.status !== 'paid') {
      const r = await finaliseCampBooking(id, session)
      if (r.busy) return res.status(200).json({ ...out, booking: { status: 'confirming' } })
      b = r.booking || b
    }
    if (!b) return res.status(200).json({ ...out, booking: { status: 'unknown' } })
    out.booking = {
      status: b.status === 'paid' ? 'paid' : b.status === 'cancelled' && b.paidAt ? 'cancelled' : session.payment_status === 'paid' ? 'confirming' : 'unpaid',
      id: b.id, days: daysText(camp, b.dayIds), players: b.players.map((p) => p.firstName), paid: audLabel(b.amountPaidCents || 0), amount: (b.amountPaidCents || 0) / 100,
    }
    out.camp = await publicCamp(camp)
  }
  return res.status(200).json(out)
}

async function book(req, res, body) {
  const protection = await protectForm(req, res, 'camp-book', body)
  if (!protection.ok) return protection.response
  const camp = await getCampBySlug(clean(body.camp, 80))
  if (!camp || camp.status !== 'open') return fail(res, 400, 'Bookings for this camp are closed.')
  const checked = validateBookingInput(body, camp)
  if (checked.error) return fail(res, 400, checked.error)
  const v = checked.value
  const open = new Set(bookableDays(camp).map((d) => d.id))
  if (v.dayIds.some((d) => !open.has(d))) return fail(res, 400, 'That day has already been.')
  const each = pricePerPlayer(camp, v.dayIds)
  if (!each) return fail(res, 400, 'This camp has no price set yet. Please email ligia@jonerfootball.com.')

  const id = newCampId('CB')
  const holdUntil = Date.now() + CAMP_HOLD_MINUTES * 60_000
  const held = await holdPlaces({ camp, dayIds: v.dayIds, bookingId: id, players: v.players.length, scoreMs: holdUntil })
  if (!held.ok) {
    const day = camp.days.find((d) => d.id === held.fullDay)
    const c = await publicCamp(camp)
    const left = c.days.find((d) => d.id === held.fullDay)?.left || 0
    return fail(res, 409, left ? `Only ${left} place${left === 1 ? '' : 's'} left on ${day?.label || 'that day'}.` : `${day?.label || 'That day'} is full. Join the waitlist and we will be in touch if a place opens.`, { full: held.fullDay, camp: c })
  }
  const booking = {
    id, campId: camp.id, status: 'held', source: 'online', createdAt: new Date().toISOString(), holdExpiresMs: holdUntil,
    releaseToken: newCampId('T').slice(-12), ...v, priceEachCents: each, priceCents: each * v.players.length, checkins: {}, effects: {},
  }
  try {
    const session = await createCheckout({ camp, booking, baseUrl: siteUrl(req) })
    booking.stripeSessionId = session.id
    await saveBooking(booking)
    await indexBooking(booking)
    await kvCommand(['SET', ckeys.session(session.id), id, 'EX', String(3 * 86400)])
    // The master contact list, as every website form does. Never blocks the booking.
    try {
      const { captureWebsiteContact } = await import('./_master-contact-capture.js')
      await captureWebsiteContact({ endpoint: 'camp-book', form: camp.title, phone: v.mobile, email: v.email, parentName: v.parentName, players: v.players.map((p) => ({ name: `${p.firstName} ${p.surname}` })), contactType: 'Parent/Guardian', source: camp.title, sourceLabel: camp.title, submittedAt: booking.createdAt })
    } catch (error) { console.warn('camp master capture failed', error?.message || error) }
    return res.status(200).json({ success: true, id, url: session.url, totalCents: booking.priceCents })
  } catch (error) {
    console.error('camp checkout failed', error)
    await releasePlaces(camp.id, v.dayIds, id)
    return fail(res, 502, 'Stripe could not open the payment page. Please try again in a minute.')
  }
}

async function release(res, body) {
  const b = await getBooking(clean(body.id, 60))
  if (!b || !body.t || clean(body.t, 40) !== b.releaseToken) return res.status(200).json({ success: true, state: 'unknown' })
  if (b.status === 'paid') return res.status(200).json({ success: true, state: 'paid' })
  if (b.status !== 'held') return res.status(200).json({ success: true, state: b.status })
  // Close the Stripe page first, so a released place can never be paid for after.
  if (b.stripeSessionId) {
    try {
      const s = await stripeFetch(`/checkout/sessions/${encodeURIComponent(b.stripeSessionId)}`)
      if (s.payment_status === 'paid') {
        const r = await finaliseCampBooking(b.id, s)
        return res.status(200).json({ success: true, state: r.busy ? 'confirming' : 'paid' })
      }
    } catch {}
    await expireCheckoutSession(b.stripeSessionId)
  }
  await releasePlaces(b.campId, b.dayIds, b.id)
  b.status = 'cancelled'
  b.cancelledAt = new Date().toISOString()
  b.cancelReason = 'Left the payment page'
  await saveBooking(b)
  return res.status(200).json({ success: true, state: 'cancelled' })
}

async function waitlist(req, res, body) {
  const protection = await protectForm(req, res, 'camp-waitlist', body)
  if (!protection.ok) return protection.response
  const camp = await getCampBySlug(clean(body.camp, 80))
  if (!camp) return fail(res, 404, 'Camp not found.')
  const email = clean(body.email, 160).toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'Enter a valid email address.')
  const parentName = clean(body.parentName, 100)
  const mobile = clean(body.mobile, 30)
  if (!parentName || mobile.replace(/\D/g, '').length < 8) return fail(res, 400, 'Enter your name and mobile.')
  const days = (Array.isArray(body.days) ? body.days : [body.days]).map((d) => clean(d, 20)).filter((d) => camp.days.some((x) => x.id === d))
  await addWaitlist(camp.id, { parentName, email, mobile, players: clean(body.players, 200), days })
  return res.status(200).json({ success: true })
}
