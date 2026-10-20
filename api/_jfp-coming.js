// "I'm coming" (Lee, 20 Oct 2026): "For all of my session-by-session players
// and pro sessions, can they have the option in their portals to not only tell
// us when they can make a session, but they can easily click a button and say
// they can make a session as well? So that way, us coaches can see which ones
// they're going to be there for and which ones they are not."
//
//   jfp:avail:<groupId>:<date>   hash rowId -> JSON {at, by}
//
// Its own key, never the register (jfp:att:...): Present is only what a coach
// marks on the day, and auto charges and coach pay read the register. Saying
// "I'm coming" bills nothing. "Can't make it" still goes through the
// cancellation (Notified on the register) and clears any "I'm coming" for
// that date. Only rows paid session by session or Pro sessions ask.
import { kvCommand, kvPipeline, isSessionType, clean, audit } from './_jfp-store.js'

export const comingKey = (groupId, date) => `jfp:avail:${groupId}:${date}`
const ISO = /^\d{4}-\d{2}-\d{2}$/

// Whose place asks "are you coming?": session by session and Pro, not trials.
export const asksComing = (row) => Boolean(row) && isSessionType(row.paymentType) && !/trial/i.test(row.paymentType || '')

// The dates this row has said yes to, out of `dates`. -> Set of iso dates
export async function comingDates(row, dates) {
  if (!asksComing(row) || !row.groupId || !dates.length) return new Set()
  const vals = await kvPipeline(dates.map((d) => ['HEXISTS', comingKey(row.groupId, d), row.id]))
  return new Set(dates.filter((d, i) => Number(vals[i]?.result ?? vals[i]) === 1))
}

// For the coach: groupId -> date -> rowId -> true.
export async function comingByGroup(asks) {
  const out = {}
  if (!asks.length) return out
  const raws = await kvPipeline(asks.map(([gid, d]) => ['HGETALL', comingKey(gid, d)]))
  asks.forEach(([gid, d], i) => {
    const flat = raws[i]?.result ?? raws[i]
    if (!Array.isArray(flat) || !flat.length) return
    const day = ((out[gid] ||= {})[d] = {})
    for (let j = 0; j < flat.length; j += 2) day[flat[j]] = true
  })
  return out
}

// The family says yes (on) or takes it back for one or more upcoming dates.
// open: the row's upcoming dates still bookable (not ours off, not started);
// told: dates they already said they can't make.
export async function saveComing({ by, row, dates, on, open, told }) {
  if (!asksComing(row) || !row.groupId) return { status: 404, error: 'That session is not one you need to tell us about.' }
  const want = [...new Set((Array.isArray(dates) ? dates : [dates]).map((d) => clean(d, 10)).filter((d) => ISO.test(d)))].slice(0, 20)
  if (!want.length) return { status: 400, error: 'Pick a date.' }
  const bad = want.filter((d) => !open.includes(d))
  if (bad.length) return { status: 400, error: 'That date is not a session still to come.' }
  const skip = on ? want.filter((d) => told.includes(d)) : []
  const use = want.filter((d) => !skip.includes(d))
  const at = new Date().toISOString()
  if (use.length) await kvPipeline(use.map((d) => on ? ['HSET', comingKey(row.groupId, d), row.id, JSON.stringify({ at, by })] : ['HDEL', comingKey(row.groupId, d), row.id]))
  await audit({ by, action: on ? 'coming.yes' : 'coming.undo', target: row.id, after: { dates: use } })
  return { status: 200, dates: use, skipped: skip }
}

// "Can't make it" wins: clear their yes for that date.
export async function clearComing(row, date) {
  if (!row?.groupId || !ISO.test(date || '')) return
  await kvCommand(['HDEL', comingKey(row.groupId, date), row.id])
}
