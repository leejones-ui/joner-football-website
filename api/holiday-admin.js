// Lee's side of the booking system. One route, one secret, an action switch.
// Nothing here is reachable without HOLIDAY_ADMIN_SECRET.
import { rateLimit } from './_security.js'
import { staffPrincipal, sameOrigin } from './_jfp-people.js'
import { withAgent } from './_jfp-agent.js'
import { getConfig as getJfpConfig, sydneyToday } from './_jfp-store.js'
import { holidayRecord, planHolidays, planToCreate, PLAN_MAX } from './_holiday-plan.js'
import {
  requireAdmin, getConfig, saveConfig, listSlots, getSlot, upsertSlot, cancelSlot, reopenSlot, setSlotStatus, setSlotField,
  slotOwners, publicSlot, listBookings, getBooking, saveBooking, releaseSlot, clean, sydneyIso, validateSlotInput,
  siteUrl, stripeFetch, refundFor, formatAud, expireCheckoutSession, TYPE_LABELS, kvCommand,
} from './_holiday-store.js'
import { repairBooking, effectsSummary } from './_holiday-finalise.js'
import { HOLIDAY_SHEET, ROSTER_HEADERS, holidaySheetId, rebuildRoster } from './_holiday-email.js'
import { ensureSheetTab } from './_camp-automation.js'

// Keep the coach roster in step after any change that affects it. A sheet
// outage must never block the admin action itself.
async function syncRoster() {
  try { await rebuildRoster() } catch (error) { console.error('holiday roster rebuild failed', error) }
}

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }

async function slotsWithCounts(config) {
  const slots = await listSlots({ includeCancelled: true })
  const owners = await slotOwners(slots.map((s) => s.id))
  const ownerIds = [...new Set(Object.values(owners).flatMap((o) => o.ownerIds || []).filter(Boolean))]
  const ownerBookings = Object.fromEntries((await Promise.all(ownerIds.map((id) => getBooking(id)))).filter(Boolean).map((b) => [b.id, b]))
  const view = (b) => ({ id: b.id, status: b.status, seats: b.seats || 1, players: (b.players || []).map((p) => p.name), parentName: b.parentName || '', typeLabel: b.type || '' })
  return slots.map((slot) => {
    const owner = ownerBookings[owners[slot.id]?.ownerId]
    return {
      ...publicSlot(slot, config, owners[slot.id]),
      priceOverrideCents: slot.priceCents,
      bookedBy: owner ? view(owner) : null,
      // Trial slots hold several families; list every one.
      seatBookings: slot.seatMode === 'shared' ? (owners[slot.id]?.ownerIds || []).map((id) => ownerBookings[id]).filter(Boolean).map(view) : null,
    }
  })
}

function adminBooking(booking, slotsById, config) {
  const slot = slotsById[booking.slotId]
  const view = slot ? publicSlot(slot, config) : null
  return {
    id: booking.id,
    status: booking.status,
    needsAttention: booking.needsAttention || '',
    effects: booking.status === 'paid' ? effectsSummary(booking) : null,
    effectDetail: booking.effects || {},
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
    typeLabel: TYPE_LABELS[booking.type] || view?.typeLabel || booking.type,
    dateLabel: view?.dateLabel || '',
    startLabel: view?.startLabel || '',
    slotId: booking.slotId,
    // The session's day, so the page can keep past holidays out of Coming up.
    slotDate: slot?.date || '',
    slotStatus: slot?.status || 'missing',
    stripeSessionId: booking.stripeSessionId || '',
    stripeUrl: booking.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${booking.stripePaymentIntentId}` : '',
  }
}

export default function handler(req, res) { return withAgent(req, 'holiday', () => handleAdmin(req, res), res) }

async function handleAdmin(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')

  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }

  const limited = rateLimit(req, { key: 'holiday-admin', limit: 60, windowMs: 60_000 })
  if (!limited.allowed) return fail(res, 429, 'Slow down a moment.')
  // Lee and Ligia manage holidays inside the JFP portal with their own
  // sign-in. The admin secret still works for scripts.
  if (!requireAdmin(req, body)) {
    const staff = sameOrigin(req) ? await staffPrincipal(req, await getJfpConfig()) : null
    if (!staff) return fail(res, 401, 'Sign in to the JFP portal as Lee or Ligia.')
    // A coach is signed in, but holiday training is Lee and Ligia's.
    if (staff.role !== 'admin') return fail(res, 403, 'Not allowed.')
  }

  const action = clean(body.action, 40)
  try {
    const config = await getConfig()

    switch (action) {
      case 'ping':
        return res.status(200).json({ success: true })

      case 'getConfig':
        return res.status(200).json({ success: true, config, sheetUrl: `https://docs.google.com/spreadsheets/d/${holidaySheetId()}`, sheetTab: HOLIDAY_SHEET })

      case 'saveConfig': {
        const next = await saveConfig(body.config || {})
        return res.status(200).json({ success: true, config: next })
      }

      case 'listSlots':
        return res.status(200).json({ success: true, slots: await slotsWithCounts(config), today: sydneyToday() })

      // Past holidays (Lee, 13 Oct 2026): a read only record, one school
      // holiday at a time, newest first.
      case 'holidayRecord': {
        const [slots, bookings] = await Promise.all([listSlots({ includeCancelled: true }), listBookings({ limit: 2000 })])
        const today = sydneyToday()
        return res.status(200).json({ success: true, today, periods: holidayRecord({ slots, bookings, config, today }) })
      }

      // Set up the next holidays: a preview first (planHolidays), then the
      // slots Lee left ticked (createHolidays). Nothing is emailed; parents
      // can book only once the slots exist.
      case 'planHolidays': {
        const plan = planHolidays({ slots: await listSlots({ includeCancelled: true }), config, today: sydneyToday(), period: clean(body.period, 20), source: clean(body.source, 20), mode: body.mode === 'blank' ? 'blank' : 'copy' })
        return plan.ok ? res.status(200).json({ success: true, plan }) : fail(res, 400, plan.error)
      }
      case 'createHolidays': {
        const plan = planHolidays({ slots: await listSlots({ includeCancelled: true }), config, today: sydneyToday(), period: clean(body.period, 20), source: clean(body.source, 20), mode: 'copy' })
        if (!plan.ok) return fail(res, 400, plan.error)
        if (!plan.source) return fail(res, 400, 'There is no earlier holiday to copy. Add the slots below instead.')
        const dates = (Array.isArray(body.dates) ? body.dates : []).map((d) => clean(d, 10))
        const todo = planToCreate(plan, dates)
        if (!todo.length) return fail(res, 400, 'Tick at least one day with new sessions.')
        if (todo.length > PLAN_MAX) return fail(res, 400, `That is more than ${PLAN_MAX} slots at once. Untick some days.`)
        // Two taps (or two people) at once: one makes the slots, the other waits.
        if ((await kvCommand(['SET', 'holiday:plan-lock', '1', 'NX', 'EX', '60'])) !== 'OK') return fail(res, 409, 'The next holidays are being set up right now. Wait a moment and refresh.')
        let created = 0
        const errors = []
        try {
          // Read again inside the lock: an hour made a moment ago is not made twice.
          const now = new Set((await listSlots()).map((s) => `${s.coachId}|${s.startsAt}`))
          for (const t of todo) {
            if (now.has(`${t.coachId}|${sydneyIso(t.date, t.startTime)}`)) continue
            const result = await upsertSlot(t, config)
            if (result.ok) { created += 1; now.add(`${t.coachId}|${result.slot.startsAt}`) } else errors.push(`${t.date} ${t.startTime}: ${result.errors.join(' ')}`)
          }
        } finally { await kvCommand(['DEL', 'holiday:plan-lock']) }
        const skipped = plan.days.filter((d) => dates.includes(d.date)).flatMap((d) => d.items).length - created
        return res.status(200).json({ success: true, created, skipped, errors: errors.slice(0, 10), period: plan.target })
      }

      case 'upsertSlot': {
        const result = await upsertSlot(body.slot || {}, config)
        if (!result.ok) return fail(res, 400, result.errors.join(' '), { errors: result.errors })
        return res.status(200).json({ success: true, slot: publicSlot(result.slot, config) })
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
        // "Already booked offline": create the hour so parents see it as taken.
        const blocked = body.blocked === true
        const existing = await listSlots()
        const taken = new Set(existing.map((s) => `${s.coachId}|${s.startsAt}`))
        const created = []
        let skipped = 0
        for (const date of dates) {
          for (const startTime of times) {
            const key = `${shape.slot.coachId}|${sydneyIso(date, startTime)}`
            if (taken.has(key)) { skipped += 1; continue }
            const result = await upsertSlot({ ...template, date, startTime }, config)
            if (result.ok) {
              if (blocked) await setSlotStatus(result.slot.id, 'blocked')
              created.push(result.slot.id); taken.add(key)
            }
          }
        }
        if (blocked) await syncRoster()
        return res.status(200).json({ success: true, created: created.length, skipped })
      }

      case 'cancelSlot': {
        const slot = await cancelSlot(body.slotId)
        if (!slot) return fail(res, 404, 'Slot not found.')
        await syncRoster()
        return res.status(200).json({ success: true, slot: publicSlot(slot, config) })
      }

      case 'reopenSlot': {
        const slot = await reopenSlot(body.slotId)
        if (!slot) return fail(res, 404, 'Slot not found.')
        await syncRoster()
        return res.status(200).json({ success: true, slot: publicSlot(slot, config) })
      }

      case 'blockSlot': {
        // Mark an hour as booked offline. Refuses if a family already holds it.
        const owners = await slotOwners([clean(body.slotId, 60)])
        const owner = owners[clean(body.slotId, 60)]
        if (owner?.booked) return fail(res, 409, `That hour already has a booking (${owner.ownerId}). Cancel it first.`)
        const slot = await setSlotStatus(body.slotId, 'blocked')
        if (!slot) return fail(res, 404, 'Slot not found.')
        await syncRoster()
        return res.status(200).json({ success: true, slot: publicSlot(slot, config) })
      }

      case 'refundPreview': {
        const booking = await getBooking(clean(body.bookingId, 60))
        if (!booking) return fail(res, 404, 'Booking not found.')
        const refund = refundFor(booking, await getSlot(booking.slotId))
        return res.status(200).json({ success: true, refund: { ...refund, label: formatAud(refund.cents), paidLabel: formatAud(refund.paidCents) } })
      }

      case 'renameLocation': {
        // Point every slot at a new location name, e.g. after the official
        // address changed. Slots store the name, so this is a bulk rewrite.
        const from = clean(body.from, 120)
        const to = clean(body.to, 120)
        if (!to) return fail(res, 400, 'Give the new location name.')
        const all = await listSlots({ includeCancelled: true })
        let changed = 0
        for (const s of all) {
          if (from && s.location !== from) continue
          await setSlotField(s.id, 'location', to)
          changed += 1
        }
        await syncRoster()
        return res.status(200).json({ success: true, changed })
      }

      case 'setMinPlayers': {
        const slot = await getSlot(clean(body.slotId, 60))
        if (!slot) return fail(res, 404, 'Slot not found.')
        if (slot.type !== 'group') return fail(res, 400, 'Only a group slot can require more than one player.')
        const n = Number(body.minPlayers)
        if (!Number.isInteger(n) || n < 1 || n > slot.capacity) return fail(res, 400, `Minimum must be between 1 and ${slot.capacity}.`)
        const updated = await setSlotField(slot.id, 'minPlayers', n)
        return res.status(200).json({ success: true, slot: publicSlot(updated, config) })
      }

      case 'rebuildRoster': {
        const result = await rebuildRoster()
        return res.status(200).json({ success: true, ...result })
      }

      case 'repairBooking': {
        const result = await repairBooking(clean(body.bookingId, 60))
        if (!result.ok) return fail(res, 400, 'Only paid bookings can be repaired.')
        return res.status(200).json({ success: true, ...result })
      }

      case 'listBookings': {
        const bookings = await listBookings({ limit: Math.min(1000, Number(body.limit) || 500) })
        const slots = await listSlots({ includeCancelled: true })
        const slotsById = Object.fromEntries(slots.map((s) => [s.id, s]))
        return res.status(200).json({ success: true, bookings: bookings.map((b) => adminBooking(b, slotsById, config)), today: sydneyToday() })
      }

      case 'cancelBooking': {
        const booking = await getBooking(body.bookingId)
        if (!booking) return fail(res, 404, 'Booking not found.')
        if (booking.status === 'cancelled') return res.status(200).json({ success: true, booking, changed: false })
        if (booking.status === 'held') await expireCheckoutSession(booking.stripeSessionId)
        await releaseSlot(booking.slotId, booking.id)
        const wasPaid = booking.status === 'paid'
        const policySlot = await getSlot(booking.slotId)
        const refund = wasPaid ? refundFor(booking, policySlot) : null
        const cancelled = { ...booking, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'admin', refundDue: wasPaid, refund }
        await saveBooking(cancelled)
        if (wasPaid) await syncRoster()
        return res.status(200).json({
          success: true,
          changed: true,
          refundDue: wasPaid,
          refund: refund ? { ...refund, label: formatAud(refund.cents), paidLabel: formatAud(refund.paidCents) } : null,
          stripeUrl: booking.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${booking.stripePaymentIntentId}` : '',
        })
      }

      case 'sheetIdentity': {
        // Which Google account the site writes the roster as. Share the sheet
        // with this address (Editor) and the tab appears on the first booking.
        let clientEmail = ''
        try {
          const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || ''
          const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
          clientEmail = JSON.parse(text).client_email || ''
        } catch {}
        return res.status(200).json({ success: true, clientEmail, sheetId: holidaySheetId(), sheetTab: HOLIDAY_SHEET, sheetUrl: `https://docs.google.com/spreadsheets/d/${holidaySheetId()}` })
      }

      case 'checkSheet': {
        // Creates the tab and headers if missing. Fails loudly if the service
        // account cannot see the sheet, which is the usual reason.
        try {
          await ensureSheetTab(holidaySheetId(), HOLIDAY_SHEET, ROSTER_HEADERS)
          return res.status(200).json({ success: true, ok: true, sheetUrl: `https://docs.google.com/spreadsheets/d/${holidaySheetId()}`, sheetTab: HOLIDAY_SHEET })
        } catch (error) {
          return res.status(200).json({ success: true, ok: false, error: error.message, sheetId: holidaySheetId() })
        }
      }

      case 'registerStripeWebhook': {
        // Registers this site's holiday webhook on the Stripe account whose
        // key already lives in Vercel, so the key never leaves the server.
        // Stripe reveals the signing secret only at creation, so it comes back
        // once here for pasting into STRIPE_HOLIDAY_WEBHOOK_SECRET_SYDNEY.
        const url = `${siteUrl(req)}/api/holiday-payment-webhook`
        const existing = await stripeFetch('/webhook_endpoints?limit=100')
        const match = (existing.data || []).find((w) => w.url === url)
        // JFP also needs refunds, so Airtable and the ledger follow refunds made in Stripe.
        const EVENTS = ['checkout.session.completed', 'checkout.session.expired', 'charge.refunded', 'charge.refund.updated']
        if (match) {
          let events = match.enabled_events
          if (EVENTS.some((e) => !events.includes(e)) && !events.includes('*')) {
            const body = {}
            ;[...new Set([...events, ...EVENTS])].forEach((e, i) => { body[`enabled_events[${i}]`] = e })
            events = (await stripeFetch(`/webhook_endpoints/${match.id}`, { method: 'POST', body })).enabled_events
          }
          return res.status(200).json({ success: true, existing: true, id: match.id, url, status: match.status, enabled_events: events, configured: Boolean(process.env.STRIPE_HOLIDAY_WEBHOOK_SECRET_SYDNEY) })
        }
        const created = await stripeFetch('/webhook_endpoints', {
          method: 'POST',
          body: {
            url,
            description: 'Joner Football school holiday bookings',
            ...Object.fromEntries(EVENTS.map((e, i) => [`enabled_events[${i}]`, e])),
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
