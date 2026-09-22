// What parents see: every open future slot with places remaining and price.
// Never returns who booked what.
import { requireHolidayAccess, getConfig, listSlots, seatCounts, publicSlot } from './_holiday-store.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  if (!requireHolidayAccess(req, res)) return

  try {
    const config = await getConfig()
    const nowMs = Date.now()
    const cutoffMs = nowMs + config.bookingCutoffHours * 60 * 60_000
    const slots = (await listSlots()).filter((slot) => new Date(slot.startsAt).getTime() > cutoffMs)
    const counts = await seatCounts(slots.map((s) => s.id), nowMs)
    const activeCoachIds = new Set(slots.map((s) => s.coachId))

    return res.status(200).json({
      success: true,
      holidayLabel: config.holidayLabel,
      coaches: config.coaches
        .filter((c) => c.active && activeCoachIds.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, tier: c.tier })),
      slots: slots.map((slot) => publicSlot(slot, config, counts[slot.id] || 0)),
    })
  } catch (error) {
    console.error('holiday-slots failed', error)
    return res.status(500).json({ success: false, error: 'Could not load sessions right now. Try again in a moment.' })
  }
}
