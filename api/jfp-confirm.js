// The success page (and the account page after a payment) asks Stripe
// directly whether this session is paid and finalises it if so. The Checkout
// Session id is the key; no cookie needed. Returns no contact details.
import { stripeFetch } from './_holiday-store.js'
import { getBooking, getGroup, getConfig, getPayreq, coachById, sessionDates, dateLabel, formatAud, clean, locationFor, to24h } from './_jfp-store.js'
import { finaliseJfpBooking, jfpBookingIdFromSession } from './_jfp-finalise.js'

// fromIso: joined mid term; only: a trial's one session.
function groupView(config, group, { fromIso = '', only = '' } = {}) {
  const coach = coachById(config, group.coachId)
  const dates = only ? [only] : sessionDates(config, group.day).filter((d) => !fromIso || d >= fromIso)
  const loc = locationFor(config, group.location)
  return {
    day: group.day, time: group.time, time24: to24h(group.time), durationMin: group.durationMin || 60,
    location: loc.name, address: loc.address, maps: loc.maps,
    coachName: coach ? `Coach ${coach.name}` : '',
    firstDate: dates[0] ? dateLabel(dates[0]) : '', dates: dates.map(dateLabel), isoDates: dates,
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  const sessionId = clean(req.query?.session_id, 120)
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return res.status(400).json({ success: false, error: 'Missing session' })
  try {
    const session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionId)}`)
    const id = jfpBookingIdFromSession(session)
    if (!id) return res.status(404).json({ success: false, error: 'Booking not found' })
    const config = await getConfig()

    if (id.startsWith('PAY-')) {
      let q = await getPayreq(id)
      if (!q) return res.status(404).json({ success: false, error: 'Payment not found' })
      let status = 'pending'
      if (session.payment_status === 'paid') {
        const r = await finaliseJfpBooking(id, session)
        q = r.payreq || q
        status = r.attention ? 'received' : r.busy ? 'pending' : 'paid'
      } else if (session.status === 'expired' || (q.status === 'cancelled' && session.status !== 'complete')) status = 'expired'
      const group = q.groupId ? await getGroup(q.groupId) : null
      return res.status(200).json({ success: true, status, kind: 'payment', kit: { url: config.kitUrl, note: config.kitNote }, payment: { id: q.id, players: q.playerNames, trial: q.reason === 'trial', trialDate: q.trialDate ? dateLabel(q.trialDate) : '', startDate: q.startDate ? dateLabel(q.startDate) : '', priceLabel: formatAud(q.paidCents ?? q.amountCents), group: group ? groupView(config, group, { fromIso: q.startDate || '', only: q.reason === 'trial' ? q.trialDate || '' : '' }) : null, term: config.term } })
    }

    let booking = await getBooking(id)
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' })
    // Stripe decides whether money moved. A payment for something already
    // cancelled is 'received': recorded and flagged, never "nothing charged".
    let status = 'pending'
    if (session.payment_status === 'paid') {
      const r = await finaliseJfpBooking(id, session)
      booking = r.booking || booking
      status = r.attention ? 'received' : r.busy ? 'pending' : 'paid'
    } else if (session.status === 'expired' || (['expired', 'cancelled'].includes(booking.status) && session.status !== 'complete')) status = 'expired'
    const group = (await getGroup(booking.groupId)) || booking.groupSnapshot
    return res.status(200).json({
      success: true,
      status,
      kind: 'booking',
      kit: { url: config.kitUrl, note: config.kitNote },
      booking: {
        id: booking.id,
        term: config.term,
        players: (booking.players || []).map((p) => ({ name: p.name })),
        priceLabel: formatAud(booking.amountPaidCents ?? booking.priceCents),
        ...groupView(config, group, { fromIso: booking.startDate || '' }),
      },
    })
  } catch (error) {
    console.error('jfp-confirm failed', error)
    return res.status(502).json({ success: false, error: 'Could not confirm the payment yet.' })
  }
}
