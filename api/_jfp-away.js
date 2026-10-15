// "Can't make it" marks the register (Lee, 16 Oct 2026: "when a player in
// their portal clicks that they can't make a session on a certain date, can
// that auto click that they are away on the register?").
//
// The register (KV jfp:att:<group>:<date>) gets NOTIFIED for that player, a
// value of its own so it never reads as a coach-marked no-show ('Absent').
// Airtable Attendance gets the same row a coach's tap makes, status Absent,
// Marked By the family's email. The coach can still change it on the day;
// if the family takes it back, the mark is cleared unless a coach changed it.
// The notice itself stays on the cancellation (jfp:cancels): noticeAt,
// noticeMinutes, noticeHours, noticeLevel.
import { kvCommand, keys, sessionDates, coachById } from './_jfp-store.js'
import { upsertAttendance, clearAttendance } from './_jfp-airtable.js'

export const NOTIFIED = 'Notified'

const attendanceId = (group, date, player, week) => `T4-W${week}-${group.day.slice(0, 3)}-${group.time}-${player}`

// Only when nobody has marked this player for that date yet.
export async function markToldAway({ config, group, rec }) {
  if (!group || !rec?.rowId || !rec.date) return 'skipped'
  const set = Number(await kvCommand(['HSETNX', keys.attendance(group.id, rec.date), rec.rowId, NOTIFIED]))
  if (set !== 1) return 'already marked'
  try {
    const week = sessionDates(config, group.day).indexOf(rec.date) + 1
    await upsertAttendance({ attendanceId: attendanceId(group, rec.date, rec.player, week), playerName: rec.player, week, date: rec.date, group, coachName: coachById(config, group.coachId)?.name || '', status: 'Absent', markedBy: rec.email })
    return 'saved'
  } catch (error) { console.error('jfp told-away airtable failed', error); return 'airtable failed' }
}

// The family took it back: clear the mark only if it is still theirs.
export async function clearToldAway({ config, group, rec }) {
  if (!group || !rec?.rowId || !rec.date) return 'skipped'
  const key = keys.attendance(group.id, rec.date)
  if ((await kvCommand(['HGET', key, rec.rowId])) !== NOTIFIED) return 'coach marked'
  await kvCommand(['HDEL', key, rec.rowId])
  try {
    const week = sessionDates(config, group.day).indexOf(rec.date) + 1
    await clearAttendance({ attendanceId: attendanceId(group, rec.date, rec.player, week), markedBy: rec.email })
    return 'cleared'
  } catch (error) { console.error('jfp told-away clear failed', error); return 'airtable failed' }
}

// A register counts as taken once a coach has marked anyone; families' own
// "can't make it" marks do not count.
export function registerTaken(values = []) { return values.some((v) => v && v !== NOTIFIED) }
