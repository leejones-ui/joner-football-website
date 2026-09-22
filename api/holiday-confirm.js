// The success page asks Stripe directly whether this session is paid and
// finalises the booking if so. The webhook usually gets there first; this
// makes the page correct even when it does not, and needs no cookie because
// the Checkout Session id is unguessable.
import { stripeFetch, getBooking, getSlot, getConfig, bookingSummary, clean } from './_holiday-store.js'
import { finaliseBooking, bookingIdFromSession } from './_holiday-finalise.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const sessionId = clean(req.query?.session_id, 120)
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return res.status(400).json({ success: false, error: 'Missing session' })

  try {
    const session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionId)}`)
    const bookingId = bookingIdFromSession(session)
    if (!bookingId) return res.status(404).json({ success: false, error: 'Booking not found' })

    let booking = await getBooking(bookingId)
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' })

    let status = 'pending'
    if (booking.status === 'cancelled') {
      status = 'cancelled'
    } else if (session.payment_status === 'paid') {
      const result = await finaliseBooking(bookingId, session)
      booking = result.booking || booking
      status = booking.status === 'cancelled' ? 'cancelled' : 'paid'
    } else if (session.status === 'expired' || booking.status === 'expired') {
      status = 'expired'
    }

    const slot = await getSlot(booking.slotId)
    const config = await getConfig()
    return res.status(200).json({ success: true, status, booking: bookingSummary(booking, slot, config) })
  } catch (error) {
    console.error('holiday-confirm failed', error)
    return res.status(502).json({ success: false, error: 'Could not confirm the payment yet.' })
  }
}
