// The success page asks Stripe directly whether this session is paid and
// finalises the enrolment if so. The session id is the key; no cookie needed.
import { stripeFetch } from './_holiday-store.js'
import { getBooking, getGroup, getConfig, coachById, sessionDates, dateLabel, formatAud, clean } from './_jfp-store.js'
import { finaliseJfpBooking, jfpBookingIdFromSession } from './_jfp-finalise.js'
import { locationLine } from './_jfp-email.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  const sessionId = clean(req.query?.session_id, 120)
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return res.status(400).json({ success: false, error: 'Missing session' })
  try {
    const session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionId)}`)
    const id = jfpBookingIdFromSession(session)
    if (!id) return res.status(404).json({ success: false, error: 'Booking not found' })
    let booking = await getBooking(id)
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' })
    let status = 'pending'
    if (booking.status === 'cancelled') status = 'cancelled'
    else if (session.payment_status === 'paid') { booking = (await finaliseJfpBooking(id, session)).booking || booking; status = 'paid' }
    else if (session.status === 'expired' || booking.status === 'expired') status = 'expired'
    const config = await getConfig()
    const group = (await getGroup(booking.groupId)) || booking.groupSnapshot
    const coach = coachById(config, group.coachId)
    const dates = sessionDates(config, group.day)
    return res.status(200).json({
      success: true,
      status,
      booking: {
        id: booking.id,
        term: config.term,
        players: (booking.players || []).map((p) => ({ name: p.name })),
        day: group.day, time: group.time, location: group.location, address: locationLine(group.location),
        coachName: coach ? `Coach ${coach.name}` : '',
        firstDate: dates[0] ? dateLabel(dates[0]) : '',
        dates: dates.map(dateLabel),
        isoDates: dates, time24: group.time, durationMin: group.durationMin,
        priceLabel: formatAud(booking.amountPaidCents ?? booking.priceCents),
        waiverUrl: config.waiverUrl || '',
      },
    })
  } catch (error) {
    console.error('jfp-confirm failed', error)
    return res.status(502).json({ success: false, error: 'Could not confirm the payment yet.' })
  }
}
