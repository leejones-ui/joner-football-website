// The portal Camps tab (Lee and Ligia only; jfp-portal-data.js checks admin
// before it calls here). Every sign-up, places per day, check in on the day,
// add or change a sign-up by hand, cancel, resend the email, the waitlist and
// the camp's own settings. Every change goes in the audit log.
import { clean } from './_holiday-store.js'
import { audit } from './_jfp-store.js'
import {
  listCamps, getCamp, saveCamp, listBookings, getBooking, saveBooking, indexBooking, dayCounts, publicCamp,
  validateBookingInput, holdPlaces, releasePlaces, newCampId, pricePerPlayer, listWaitlist, removeWaitlist,
  daysText, audLabel, runEffects, HEARD_ABOUT, unfinishedFamilies,
} from './_camp-store.js'
import { CONFIRMED_SCORE } from './_holiday-store.js'

export const CAMP_ACTIONS = new Set(['campList', 'campSave', 'campAdd', 'campEdit', 'campCancel', 'campCheckin', 'campMarkPaid', 'campResend', 'campWaitlistRemove', 'campReminderStop'])
const METHODS = ['Cash', 'Bank transfer', 'Stripe', 'Free place', 'Not paid yet']
const ok = (res, data) => res.status(200).json({ success: true, ...data })
const bad = (res, status, error) => res.status(status).json({ success: false, error })
const cents = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : null }

// Paid, not paid yet (added by hand) and the ones that never got through
// Stripe. Abandoned holds older than a day are dropped from the list.
const SHOWN = (b) => b.status === 'paid' || b.status === 'unpaid' || (b.status === 'held' && b.holdExpiresMs > Date.now()) || (b.status === 'cancelled' && b.source === 'portal') || (b.status === 'cancelled' && b.paidAt)

async function listData(campId) {
  const camps = await listCamps()
  const camp = camps.find((c) => c.id === campId) || camps[0]
  const [bookings, counts, waitlist, pub] = await Promise.all([listBookings(camp.id), dayCounts(camp), listWaitlist(camp.id), publicCamp(camp)])
  return {
    camps: camps.map((c) => ({ id: c.id, title: c.title, status: c.status })),
    camp, counts, publicUrl: `/camps/${camp.slug}/`, days: pub.days,
    bookings: bookings.filter(SHOWN).map((b) => ({ ...b, releaseToken: undefined })),
    // Started on the website and never paid: one line per family, newest first.
    unfinished: unfinishedFamilies(bookings).map((b) => ({ ...b, releaseToken: undefined })),
    waitlist, options: { heardAbout: HEARD_ABOUT, methods: METHODS },
  }
}

export async function campAction(res, principal, body, action) {
  const by = principal.email
  const campId = clean(body.campId, 40) || 'xmas-2026'

  if (action === 'campList') return ok(res, await listData(campId))

  if (action === 'campSave') {
    const camp = await getCamp(campId)
    if (!camp) return bad(res, 404, 'Camp not found.')
    const s = body.settings || {}
    const next = { ...camp }
    for (const k of ['title', 'short', 'location', 'address', 'timesLabel', 'arriveLabel', 'ages']) if (typeof s[k] === 'string') next[k] = s[k]
    if (['open', 'closed', 'hidden'].includes(s.status)) next.status = s.status
    if (s.capacityPerDay != null) next.capacityPerDay = Number(s.capacityPerDay)
    if (s.lowAt != null) next.lowAt = Number(s.lowAt)
    const one = cents(s.oneDay), all = cents(s.allDays)
    if (one != null || all != null) next.prices = { oneDay: one ?? camp.prices.oneDay, allDays: all ?? camp.prices.allDays }
    if (s.bring != null) next.bring = s.bring
    if (s.staffEmails != null) next.staffEmails = s.staffEmails
    if (typeof s.reminders === 'boolean') next.reminders = s.reminders
    if (Array.isArray(s.days)) next.days = camp.days.map((d) => { const x = s.days.find((y) => y.id === d.id) || {}; return { ...d, label: x.label ?? d.label, short: x.short ?? d.short, date: x.date ?? d.date } })
    const saved = await saveCamp(next)
    await audit({ by, action: 'camp.settings', target: camp.id, before: { status: camp.status, prices: camp.prices, capacityPerDay: camp.capacityPerDay }, after: { status: saved.status, prices: saved.prices, capacityPerDay: saved.capacityPerDay } })
    return ok(res, await listData(campId))
  }

  if (action === 'campWaitlistRemove') {
    await removeWaitlist(campId, clean(body.id, 60))
    await audit({ by, action: 'camp.waitlistRemove', target: clean(body.id, 60) })
    return ok(res, await listData(campId))
  }

  const camp = await getCamp(campId)
  if (!camp) return bad(res, 404, 'Camp not found.')

  if (action === 'campAdd') {
    const checked = validateBookingInput({ ...body.booking, agreement: true }, camp, { staff: true })
    if (checked.error) return bad(res, 400, checked.error)
    const v = checked.value
    const method = METHODS.includes(body.method) ? body.method : 'Cash'
    const id = newCampId('CB')
    const held = await holdPlaces({ camp, dayIds: v.dayIds, bookingId: id, players: v.players.length, scoreMs: CONFIRMED_SCORE, force: body.force === true })
    if (!held.ok) return bad(res, 409, `${camp.days.find((d) => d.id === held.fullDay)?.label || 'That day'} is full. Tick "Add even if full" to go over ${camp.capacityPerDay}.`)
    const each = pricePerPlayer(camp, v.dayIds)
    const paid = method !== 'Not paid yet'
    const amount = cents(body.amount)
    const b = {
      id, campId: camp.id, status: paid ? 'paid' : 'unpaid', source: 'portal', createdAt: new Date().toISOString(), addedBy: by, ...v,
      priceEachCents: each, priceCents: each * v.players.length, method, amountPaidCents: paid ? (method === 'Free place' ? 0 : amount ?? each * v.players.length) : 0,
      paidAt: paid ? new Date().toISOString() : '', note: clean(body.note, 300), checkins: {}, effects: body.sendEmail === true ? {} : { parentEmail: 'skipped', staffEmail: 'skipped', telegram: 'skipped' },
    }
    await saveBooking(b)
    await indexBooking(b)
    if (body.sendEmail === true && paid) await runEffects(b, camp)
    await audit({ by, action: 'camp.add', target: id, after: { players: v.players.map((p) => `${p.firstName} ${p.surname}`), days: v.dayIds, method, amount: b.amountPaidCents } })
    return ok(res, { ...(await listData(campId)), added: id })
  }

  const b = await getBooking(clean(body.id, 60))
  if (!b || b.campId !== camp.id) return bad(res, 404, 'Sign-up not found.')

  if (action === 'campEdit') {
    const checked = validateBookingInput({ ...b, ...body.booking, days: body.booking?.days || b.dayIds, agreement: true }, camp, { staff: true })
    if (checked.error) return bad(res, 400, checked.error)
    const v = checked.value
    const before = { days: b.dayIds, players: b.players.length }
    if (['paid', 'unpaid'].includes(b.status) && (v.dayIds.join() !== b.dayIds.join() || v.players.length !== b.players.length)) {
      const held = await holdPlaces({ camp, dayIds: v.dayIds, bookingId: b.id, players: v.players.length, scoreMs: CONFIRMED_SCORE, force: body.force === true })
      if (!held.ok) return bad(res, 409, `${camp.days.find((d) => d.id === held.fullDay)?.label || 'That day'} is full. Tick "Add even if full" to go over ${camp.capacityPerDay}.`)
      await releasePlaces(camp.id, b.dayIds.filter((d) => !v.dayIds.includes(d)), b.id)
    }
    Object.assign(b, v, { note: body.note != null ? clean(body.note, 300) : b.note })
    await saveBooking(b)
    await audit({ by, action: 'camp.edit', target: b.id, before, after: { days: v.dayIds, players: v.players.length } })
    return ok(res, await listData(campId))
  }

  if (action === 'campCancel') {
    if (b.status === 'cancelled') return ok(res, await listData(campId))
    await releasePlaces(camp.id, b.dayIds, b.id)
    const wasPaid = b.status === 'paid'
    b.status = 'cancelled'
    b.cancelledAt = new Date().toISOString()
    b.cancelReason = clean(body.reason, 200) || 'Cancelled in the portal'
    b.cancelledBy = by
    await saveBooking(b)
    await audit({ by, action: 'camp.cancel', target: b.id, after: { reason: b.cancelReason, paid: wasPaid ? b.amountPaidCents : 0 } })
    return ok(res, { ...(await listData(campId)), refund: wasPaid && b.paymentIntent ? { amount: audLabel(b.amountPaidCents), url: `https://dashboard.stripe.com/payments/${b.paymentIntent}` } : null })
  }

  // Stop the reminder emails for a family who started and did not pay.
  if (action === 'campReminderStop') {
    b.noReminders = true
    await saveBooking(b)
    await audit({ by, action: 'camp.reminderStop', target: b.id, after: { email: b.email } })
    return ok(res, await listData(campId))
  }

  if (action === 'campCheckin') {
    const i = Number(body.player)
    const day = clean(body.day, 20)
    if (!b.dayIds.includes(day) || !b.players[i]) return bad(res, 400, 'That player is not booked on that day.')
    const state = ['in', 'out', ''].includes(body.state) ? body.state : null
    if (state === null) return bad(res, 400, 'Invalid state.')
    b.checkins = b.checkins || {}
    if (state) b.checkins[`${day}|${i}`] = { state, at: new Date().toISOString(), by }; else delete b.checkins[`${day}|${i}`]
    await saveBooking(b)
    return ok(res, { booking: { ...b, releaseToken: undefined } })
  }

  if (action === 'campMarkPaid') {
    if (b.status !== 'unpaid') return bad(res, 400, 'Only a sign-up marked "not paid yet" can be marked paid.')
    const method = METHODS.includes(body.method) && body.method !== 'Not paid yet' ? body.method : 'Cash'
    b.status = 'paid'; b.method = method; b.paidAt = new Date().toISOString()
    b.amountPaidCents = method === 'Free place' ? 0 : cents(body.amount) ?? b.priceCents
    await saveBooking(b)
    await audit({ by, action: 'camp.markPaid', target: b.id, after: { method, amount: b.amountPaidCents } })
    return ok(res, await listData(campId))
  }

  if (action === 'campResend') {
    if (b.status !== 'paid') return bad(res, 400, 'Only paid sign-ups get the confirmation email.')
    const { sendCampConfirmation } = await import('./_camp-email.js')
    try { await sendCampConfirmation(b, camp) } catch (error) { return bad(res, 502, `The email did not send (${String(error.message).slice(0, 80)}).`) }
    b.effects = { ...(b.effects || {}), parentEmail: 'done' }
    b.resentAt = new Date().toISOString()
    await saveBooking(b)
    await audit({ by, action: 'camp.resend', target: b.id, after: { to: b.email } })
    return ok(res, { ...(await listData(campId)), sent: `${daysText(camp, b.dayIds)} details sent to ${b.email}.` })
  }
  return bad(res, 400, 'Unknown camp action.')
}
