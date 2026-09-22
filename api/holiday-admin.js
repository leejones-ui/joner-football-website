// Lee's side of the booking system. One route, one secret, an action switch.
// Nothing here is reachable without HOLIDAY_ADMIN_SECRET.
import { rateLimit } from './_security.js'
import {
  requireAdmin, getConfig, saveConfig, listSlots, getSlot, upsertSlot, cancelSlot, reopenSlot,
  seatCounts, publicSlot, listBookings, getBooking, saveBooking, releaseSeats, clean, sydneyIso, validateSlotInput,
  siteUrl, stripeFetch,
} from './_holiday-store.js'
import { HOLIDAY_SHEET } from './_holiday-email.js'
import { DEFAULT_SHEET_ID } from './_camp-automation.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }

async function slotsWithCounts(config) {
  const slots = await listSlots({ includeCancelled: true })
  const counts = await seatCounts(slots.map((s) => s.id))
  return slots.map((slot) => ({ ...publicSlot(slot, config, counts[slot.id]), priceOverrideCents: slot.priceCents }))
}

function adminBooking(booking, slotsById, config) {
  const slot = slotsById[booking.slotId]
  const view = slot ? publicSlot(slot, config, 0) : null
  return {
    id: booking.id,
    status: booking.status,
    needsAttention: booking.needsAttention || '',
    createdAt: booking.createdAt,
    paidAt: booking.paidAt || '',
    seats: booking.seats,
    players: booking.players || [],
    parentName: booking.parentName,
    email: booking.email,
    mobile: booking.mobile,
    notes: booking.notes || '',
    priceCents: booking.priceCents,
    coachName: view?.coachName || booking.coachName || '',
    typeLabel: view?.typeLabel || booking.type,
    dateLabel: view?.dateLabel || '',
    startLabel: view?.startLabel || '',
    slotId: booking.slotId,
    slotStatus: slot?.status || 'missing',
    stripeSessionId: booking.stripeSessionId || '',
    stripeUrl: booking.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${booking.stripePaymentIntentId}` : '',
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')

  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }

  const limited = rateLimit(req, { key: 'holiday-admin', limit: 60, windowMs: 60_000 })
  if (!limited.allowed) return fail(res, 429, 'Slow down a moment.')
  if (!requireAdmin(req, body)) return fail(res, 401, 'Admin secret is missing or wrong.')

  const action = clean(body.action, 40)
  try {
    const config = await getConfig()

    switch (action) {
      case 'ping':
        return res.status(200).json({ success: true })

      case 'getConfig':
        return res.status(200).json({ success: true, config, sheetUrl: `https://docs.google.com/spreadsheets/d/${process.env.HOLIDAY_SHEET_ID || DEFAULT_SHEET_ID}`, sheetTab: HOLIDAY_SHEET })

      case 'saveConfig': {
        const next = await saveConfig(body.config || {})
        return res.status(200).json({ success: true, config: next })
      }

      case 'listSlots':
        return res.status(200).json({ success: true, slots: await slotsWithCounts(config) })

      case 'upsertSlot': {
        const result = await upsertSlot(body.slot || {}, config)
        if (!result.ok) return fail(res, 400, result.errors.join(' '), { errors: result.errors })
        return res.status(200).json({ success: true, slot: publicSlot(result.slot, config, 0) })
      }

      case 'bulkAddSlots': {
        // One template repeated across dates and start times. Validated once
        // for shape, then created per combination; duplicates of an existing
        // open slot (same coach, same start) are skipped, not doubled.
        const template = body.template || {}
        const dates = (Array.isArray(body.dates) ? body.dates : []).map((d) => clean(d, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        const times = (Array.isArray(body.times) ? body.times : []).map((t) => clean(t, 5)).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
        if (!dates.length || !times.length) return fail(res, 400, 'Pick at least one date and one start time.')
        if (dates.length * times.length > 120) return fail(res, 400, 'That is more than 120 slots at once. Split it up.')
        const shape = validateSlotInput({ ...template, date: dates[0], startTime: times[0] }, config)
        if (!shape.ok) return fail(res, 400, shape.errors.join(' '), { errors: shape.errors })
        const existing = await listSlots()
        const taken = new Set(existing.map((s) => `${s.coachId}|${s.startsAt}`))
        const created = []
        let skipped = 0
        for (const date of dates) {
          for (const startTime of times) {
            const key = `${shape.slot.coachId}|${sydneyIso(date, startTime)}`
            if (taken.has(key)) { skipped += 1; continue }
            const result = await upsertSlot({ ...template, date, startTime }, config)
            if (result.ok) { created.push(result.slot.id); taken.add(key) }
          }
        }
        return res.status(200).json({ success: true, created: created.length, skipped })
      }

      case 'cancelSlot': {
        const slot = await cancelSlot(body.slotId)
        if (!slot) return fail(res, 404, 'Slot not found.')
        return res.status(200).json({ success: true, slot: publicSlot(slot, config, 0) })
      }

      case 'reopenSlot': {
        const slot = await reopenSlot(body.slotId)
        if (!slot) return fail(res, 404, 'Slot not found.')
        return res.status(200).json({ success: true, slot: publicSlot(slot, config, 0) })
      }

      case 'listBookings': {
        const bookings = await listBookings({ limit: Math.min(1000, Number(body.limit) || 500) })
        const slots = await listSlots({ includeCancelled: true })
        const slotsById = Object.fromEntries(slots.map((s) => [s.id, s]))
        return res.status(200).json({ success: true, bookings: bookings.map((b) => adminBooking(b, slotsById, config)) })
      }

      case 'cancelBooking': {
        const booking = await getBooking(body.bookingId)
        if (!booking) return fail(res, 404, 'Booking not found.')
        if (booking.status === 'cancelled') return res.status(200).json({ success: true, booking, changed: false })
        await releaseSeats(booking.slotId, booking.id, booking.seats)
        const wasPaid = booking.status === 'paid'
        const cancelled = { ...booking, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'admin', refundDue: wasPaid }
        await saveBooking(cancelled)
        return res.status(200).json({
          success: true,
          changed: true,
          refundDue: wasPaid,
          stripeUrl: booking.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${booking.stripePaymentIntentId}` : '',
        })
      }

      case 'registerStripeWebhook': {
        // Registers this site's holiday webhook on the Stripe account whose
        // key already lives in Vercel, so the key never leaves the server.
        // Stripe reveals the signing secret only at creation, so it comes back
        // once here for pasting into STRIPE_HOLIDAY_WEBHOOK_SECRET_SYDNEY.
        const url = `${siteUrl(req)}/api/holiday-payment-webhook`
        const existing = await stripeFetch('/webhook_endpoints?limit=100')
        const match = (existing.data || []).find((w) => w.url === url)
        if (match) {
          return res.status(200).json({ success: true, existing: true, id: match.id, url, status: match.status, enabled_events: match.enabled_events, configured: Boolean(process.env.STRIPE_HOLIDAY_WEBHOOK_SECRET_SYDNEY) })
        }
        const created = await stripeFetch('/webhook_endpoints', {
          method: 'POST',
          body: {
            url,
            description: 'Joner Football school holiday bookings',
            'enabled_events[0]': 'checkout.session.completed',
            'enabled_events[1]': 'checkout.session.expired',
          },
        })
        return res.status(200).json({ success: true, existing: false, id: created.id, url, secret: created.secret, livemode: created.livemode })
      }

      default:
        return fail(res, 400, `Unknown action: ${action || '(none)'}`)
    }
  } catch (error) {
    console.error(`holiday-admin ${action} failed`, error)
    return fail(res, 500, error.message || 'Admin action failed.')
  }
}
