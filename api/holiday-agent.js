// Separate, revocable availability access for Barry and Forge. Deliberately
// excludes configuration, prices, bookings, customer data, refunds and deletes.
import { agentIdentity, changeAvailability, moveUnbookedSlot } from './_holiday-agent-access.js'
import { listSlots, getSlot, getConfig, slotOwners, clean } from './_holiday-store.js'
import { rebuildRoster } from './_holiday-email.js'
import { rateLimit } from './_security.js'

const allowed = new Set(['ping', 'listSlots', 'blockSlot', 'reopenSlot', 'moveSlot'])
const project = (slot, owner) => ({ id: slot.id, coachId: slot.coachId, startsAt: slot.startsAt, endsAt: slot.endsAt, location: slot.location, status: slot.status, occupied: Boolean(owner?.booked) })
function reply(res, status, message) { return res.status(status).json({ success: false, error: message }) }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') return reply(res, 405, 'Method not allowed')
  const limited = rateLimit(req, { key: 'holiday-agent', limit: 60, windowMs: 60_000 })
  if (!limited.allowed) return reply(res, 429, 'Slow down a moment')
  const identity = agentIdentity(req.headers?.['x-holiday-agent-token'])
  if (!identity) return reply(res, 401, 'Agent access is missing, expired or invalid')
  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {} } catch { return reply(res, 400, 'Invalid request') }
  const action = clean(body.action, 30)
  if (!allowed.has(action)) return reply(res, 403, 'Action is outside scheduling scope')
  try {
    if (action === 'ping') return res.status(200).json({ success: true, agent: identity, scope: identity === 'barry' ? 'availability,time' : 'availability' })
    if (action === 'listSlots') {
      const slots = await listSlots({ includeCancelled: true })
      const owners = await slotOwners(slots.map(s => s.id))
      const config = await getConfig()
      return res.status(200).json({ success: true, slots: slots.map(s => project(s, owners[s.id])), coaches: config.coaches.map(c => ({ id: c.id, name: c.name })) })
    }
    const slotId = clean(body.slotId, 60)
    if (action === 'moveSlot') {
      if (identity !== 'barry') return reply(res, 403, 'Time editing is outside this agent’s scope')
      const slot = await getSlot(slotId)
      if (!slot) return reply(res, 404, 'Slot not found')
      const moved = await moveUnbookedSlot(slot, body.expectedStartsAt, body.newStartTime)
      if (!moved.ok) return reply(res, moved.reason === 'invalid' ? 400 : 409,
        ({ stale: 'The slot changed; read it again before editing.', owned: 'That slot has a current booking or hold.', overlap: 'The coach has another slot at that time.' })[moved.reason] || 'That time cannot be changed.')
      console.info('holiday agent time changed', { agent: identity, slotId, from: body.expectedStartsAt, to: body.newStartTime })
      try { await rebuildRoster() } catch (error) { console.error('holiday agent roster rebuild failed', error) }
      return res.status(200).json({ success: true, agent: identity, slot: project(await getSlot(slotId)) })
    }
    const change = await changeAvailability(slotId, action === 'blockSlot' ? 'blocked' : 'open')
    if (!change.ok) return reply(res, change.reason === 'owned' || change.reason === 'status' ? 409 : 404, change.reason === 'owned' ? 'That slot has a current booking or hold.' : change.reason === 'status' ? 'Slot status changed; read it again before editing.' : 'Slot not found.')
    console.info('holiday agent availability changed', { agent: identity, action, slotId })
    try { await rebuildRoster() } catch (error) { console.error('holiday agent roster rebuild failed', error) }
    return res.status(200).json({ success: true, agent: identity, slot: project(await getSlot(slotId)) })
  } catch (error) {
    console.error('holiday agent request failed', error)
    return reply(res, 503, 'Could not complete availability request')
  }
}
