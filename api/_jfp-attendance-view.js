// Attendance for families (Lee, 17 Oct 2026): what the coach marked on each
// session already run, read from the register (KV jfp:att:<group>:<date>,
// written only by markAttendance in the portal). Read only, never written here.
//   came    Present, Trial or Make-up
//   missed  Away (Absent, or Notified when the family told us)
//   ''      not marked (left out of "came to N of M")
const CAME = new Set(['Present', 'Trial', 'Make-up'])
const AWAY = new Set(['Absent', 'Notified'])

export function markFor(status) { return CAME.has(status) ? 'came' : AWAY.has(status) ? 'missed' : '' }

// One place: `statusOf(iso)` gives the register status for a past date, or
// undefined for a date still to come. Marks line up with `dates`.
export function attendanceFor(dates = [], statusOf = () => undefined) {
  const marks = dates.map((d) => { const s = statusOf(d); return s === undefined ? 'ahead' : markFor(s) })
  const came = marks.filter((m) => m === 'came').length
  const marked = marks.filter((m) => m === 'came' || m === 'missed').length
  return { came, marked, marks, label: marked ? `Came to ${came} of ${marked}` : '' }
}
