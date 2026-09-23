// What parents see: every open future slot with places remaining and price.
// Never returns who booked what.
import { requireHolidayAccess, getConfig, listSlots, slotOwners, publicSlot, getBookings } from './_holiday-store.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  if (!requireHolidayAccess(req, res)) return

  try {
    const config = await getConfig()
    const nowMs = Date.now()
    const cutoffMs = nowMs + config.bookingCutoffHours * 60 * 60_000
    const slots = (await listSlots()).filter((slot) => new Date(slot.startsAt).getTime() > cutoffMs)
    const owners = await slotOwners(slots.map((s) => s.id), nowMs)
    const ownerIds = [...new Set(Object.values(owners).map((o) => o.ownerId).filter(Boolean))]
    const statuses = Object.fromEntries((await getBookings(ownerIds)).filter(Boolean).map((b) => [b.id, b.status]))
    for (const o of Object.values(owners)) if (o.ownerId) o.pending = statuses[o.ownerId] !== 'paid'
    const coachesWithSlots = new Set(slots.map((s) => s.coachId))

    // Every coach is listed so parents can see who else is coming. A coach
    // with nothing to book (inactive, or no slots yet) is shown but not pickable.
    return res.status(200).json({
      success: true,
      holidayLabel: config.holidayLabel,
      location: config.defaultLocation,
      coaches: config.coaches.map((c) => ({ id: c.id, name: c.name, tier: c.tier, available: c.active && coachesWithSlots.has(c.id) })),
      slots: slots.filter((s) => config.coaches.find((c) => c.id === s.coachId)?.active).map((slot) => publicSlot(slot, config, owners[slot.id])),
    })
  } catch (error) {
    console.error('holiday-slots failed', error)
    return res.status(500).json({ success: false, error: 'Could not load sessions right now. Try again in a moment.' })
  }
}
