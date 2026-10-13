// Joners Juniors registers (stage 3): present or absent for each child, per
// class, per class date (the Juniors term dates, juniorsDates, less the
// days off), and who coached: the head coach and the shadow coach of that
// session. The coaches on each session are what checks the Juniors head and
// shadow lines on a coach's invoice.
//
// Stored the way JFP stores its registers, so one register serves both the
// Juniors page and a coach's My sessions:
//   jfp:att:<gid>:<date>   hash rowId -> Present | Absent   (gid = the class's timetable group)
//   jj:reg:<gid>:<date>    { head, shadow, by, byName, at, auto }  who coached
// plus one row per mark in the Airtable Attendance table (Programme Joners
// Juniors), as JFP does.
//
// Who can mark: Lee and Ligia any class; a coach only a class they are the
// head or shadow coach of, a session they are recorded on, or one they cover
// (the same rule JFP uses for its groups). Changing who coached a session is
// Lee and Ligia only.
import { kvCommand, kvPipeline, kvGetJson, kvSetJson, keys, clean, audit, coachById, coachLabel, dateLabel, sydneyToday, ageOn, listGroups } from './_jfp-store.js'
import { upsertAttendance, clearAttendance } from './_jfp-airtable.js'
import { readJJTable, tableFor, isEnrolled, REC } from './_jj-data.js'
import { juniorsDates, classById, classForRow, classLabelFor, classSlot, slotId, termShort } from './_jj-config.js'
import { classGid, groupForClass } from './_jj-classes.js'

export const JJ_REGISTER_ACTIONS = new Set(['jjRegister', 'jjMark', 'jjSessionCoaches'])
const STATUSES = ['Present', 'Absent', '']
const ISO = /^\d{4}-\d{2}-\d{2}$/
const KEEP = 60 * 60 * 24 * 400
export const sessionKey = (gid, date) => `jj:reg:${gid}:${date}`
const out = (res, data) => res.status(200).json({ success: true, ...data })
const fail = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra })
const hashOf = (raw) => { const o = {}; for (let i = 0; i + 1 < (raw || []).length; i += 2) o[raw[i]] = raw[i + 1]; return o }
const coachView = (config, id) => { const c = id ? coachById(config, id) : null; return c ? { id: c.id, name: coachLabel(c) } : null }

// The class for a timetable group (for My sessions and markAttendance).
export function classForGroup(jj, g) {
  const slot = slotId(g?.day, g?.time, g?.location)
  return (jj.classes || []).find((c) => classSlot(c) === slot) || ((jj.classes || []).length === 1 ? jj.classes[0] : null)
}
// A Juniors group's dates are the Juniors term's, not JFP's.
export const jjDatesForGroup = (config, g) => { const c = classForGroup(config.juniors, g); return c ? juniorsDates(config.juniors, c) : [] }

async function covers() {
  const raw = hashOf(await kvCommand(['HGETALL', 'jfp:cover']))
  return Object.values(raw).map((v) => { try { return JSON.parse(v) } catch { return null } }).filter(Boolean)
}

// Who coached: the record, else the class's coaches (not yet recorded).
export async function sessionCoaches(config, cls, gid, date) {
  const rec = await kvGetJson(sessionKey(gid, date))
  if (rec) return { head: coachView(config, rec.head), shadow: coachView(config, rec.shadow), recorded: true, auto: Boolean(rec.auto), by: rec.byName || '', at: rec.at || '' }
  return { head: coachView(config, cls.coachId), shadow: coachView(config, cls.shadowCoachId), recorded: false, auto: false, by: '', at: '' }
}

// The first mark of a session records the class's coaches, so every session
// that ran says who coached it even if nobody changed it.
export async function ensureSession(cls, gid, date, principal) {
  const key = sessionKey(gid, date)
  if (await kvGetJson(key)) return false
  await kvSetJson(key, { head: cls.coachId || '', shadow: cls.shadowCoachId || '', by: principal.email, byName: principal.name, at: new Date().toISOString(), auto: true }, KEEP)
  return true
}

export async function canMark(principal, config, cls, gid, date) {
  if (principal.role === 'admin') return true
  const me = principal.coachId
  if (!me) return false
  if (cls.coachId === me || cls.shadowCoachId === me) return true
  const rec = date ? await kvGetJson(sessionKey(gid, date)) : null
  if (rec && (rec.head === me || rec.shadow === me)) return true
  return (await covers()).some((c) => c.status === 'active' && c.groupId === gid && (!date || c.date === date) && c.coverCoachId === me)
}

// The register's Airtable row: the same id shape markAttendance has always used for Juniors.
export const attendanceId = (cls, week, playerName) => `JJ-W${week}-${cls.day.slice(0, 3)}-${cls.time}-${playerName}`

// One mark, from the Juniors register or a coach's My sessions. Writes KV,
// records who coached (first mark), and the Airtable Attendance row.
export async function markOne(config, principal, { cls, gid, date, row, status }) {
  const key = keys.attendance(gid, date)
  if (status) await kvCommand(['HSET', key, row.id, status]); else await kvCommand(['HDEL', key, row.id])
  if (status) await ensureSession(cls, gid, date, principal)
  const dates = juniorsDates(config.juniors, cls)
  const week = dates.indexOf(date) + 1
  const rec = await kvGetJson(sessionKey(gid, date))
  let airtable = 'skipped'
  try {
    if (status) {
      await upsertAttendance({ attendanceId: attendanceId(cls, week, row.player), playerName: row.player, week, date, group: cls, coachName: coachById(config, rec?.head || cls.coachId)?.name || '', status, markedBy: principal.email, programme: 'Joners Juniors', term: termShort(config.juniors.term) })
      airtable = 'saved'
    } else airtable = (await clearAttendance({ attendanceId: attendanceId(cls, week, row.player), markedBy: principal.email })) ? 'cleared' : 'skipped'
  } catch (error) { console.error('jj attendance airtable failed', error.message); airtable = 'failed' }
  return airtable
}

// The children of a class this term (not those who left).
async function classChildren(config, cls, { fresh = false } = {}) {
  const jj = config.juniors
  const rows = await readJJTable(tableFor(config, jj.term), { term: jj.term, fresh })
  return rows.filter((r) => isEnrolled(r) && classForRow(jj, r)?.id === cls.id).sort((a, b) => a.player.localeCompare(b.player))
}

function pickDate(dates, asked) {
  if (ISO.test(asked || '') && dates.includes(asked)) return asked
  const today = sydneyToday()
  if (dates.includes(today)) return today
  return [...dates].reverse().find((d) => d <= today) || dates[0] || ''
}

// ---------- actions (coaches allowed, checked here) ----------

export async function jjRegisterAction(req, res, principal, config, body, action) {
  const jj = config.juniors
  const groups = await listGroups()
  const isAdmin = principal.role === 'admin'
  // The classes this person can open.
  const mine = []
  for (const c of jj.classes) if (await canMark(principal, config, c, classGid(groups, c), '')) mine.push(c)
  const cls = classById(jj, clean(body.classId, 40)) || mine[0] || null
  if (!cls) return fail(res, 403, 'You are not on a Joners Juniors class.')
  const gid = classGid(groups, cls)
  const dates = juniorsDates(jj, cls)
  const date = pickDate(dates, clean(body.date, 10))

  if (action === 'jjRegister') {
    if (!(await canMark(principal, config, cls, gid, date))) return fail(res, 403, 'Not your class.')
    const [kids, marksRaw, session] = await Promise.all([classChildren(config, cls, { fresh: body.fresh === true }), kvCommand(['HGETALL', keys.attendance(gid, date)]), sessionCoaches(config, cls, gid, date)])
    const marks = hashOf(marksRaw)
    // Which dates have a register taken (any mark), for the date picker.
    const taken = (await kvPipeline(dates.map((d) => ['HGETALL', keys.attendance(gid, d)]))).map((x) => Object.keys(hashOf(x?.result ?? x)).length)
    const children = kids.map((r) => ({ rowId: r.id, name: r.player, age: r.dob ? ageOn(r.dob, sydneyToday()) : null, status: marks[r.id] || '' }))
    const counts = { present: children.filter((c) => c.status === 'Present').length, absent: children.filter((c) => c.status === 'Absent').length }
    counts.unmarked = children.length - counts.present - counts.absent
    return out(res, {
      term: jj.term,
      classes: (isAdmin ? jj.classes : mine).map((c) => ({ id: c.id, label: classLabelFor(jj, c), location: c.location })),
      class: { id: cls.id, label: classLabelFor(jj, cls), location: cls.location, onTimetable: Boolean(groupForClass(groups, cls)) },
      date, dateLabel: date ? dateLabel(date) : '',
      dates: dates.map((d, i) => ({ iso: d, label: dateLabel(d), week: i + 1, past: d <= sydneyToday(), marked: taken[i] > 0 })),
      children, counts, session, canEditCoaches: isAdmin,
      coaches: isAdmin ? config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })) : [],
      ...(isAdmin ? { coachTotals: await coachTotals(config, groups) } : {}),
    })
  }

  if (action === 'jjMark') {
    if (!dates.includes(clean(body.date, 10))) return fail(res, 400, 'That date is not a class date this term.')
    if (!(await canMark(principal, config, cls, gid, date))) return fail(res, 403, 'Not your class.')
    const status = STATUSES.includes(body.status) ? body.status : null
    if (status === null) return fail(res, 400, 'Present or absent?')
    const kid = (await classChildren(config, cls)).find((r) => r.id === clean(body.rowId, 30))
    if (!kid || !REC.test(kid.id)) return fail(res, 404, 'That child is not in this class.')
    const airtable = await markOne(config, principal, { cls, gid, date, row: kid, status })
    return out(res, { airtable })
  }

  if (action === 'jjSessionCoaches') {
    if (!isAdmin) return fail(res, 403, 'Only Lee or Ligia change who coached a session.')
    if (!dates.includes(clean(body.date, 10))) return fail(res, 400, 'That date is not a class date this term.')
    const head = clean(body.headId, 30), shadow = clean(body.shadowId, 30)
    if ((head && !coachById(config, head)) || (shadow && !coachById(config, shadow))) return fail(res, 400, 'Choose the coaches from the list.')
    if (head && head === shadow) return fail(res, 400, 'The head coach and the shadow coach must be two people.')
    const before = await kvGetJson(sessionKey(gid, date))
    const rec = { head, shadow, by: principal.email, byName: principal.name, at: new Date().toISOString(), auto: false, note: clean(body.note, 200) }
    await kvSetJson(sessionKey(gid, date), rec, KEEP)
    await audit({ by: principal.email, action: 'jj.register.coaches', target: `${cls.id}:${date}`, before, after: rec })
    return out(res, { session: await sessionCoaches(config, cls, gid, date) })
  }
  return fail(res, 400, `Unknown action: ${action}`)
}

// ---------- the coaches on every session so far (for coach invoices) ----------

// Sessions that ran (a register was taken or the coaches were recorded),
// by coach: how many as head coach and as shadow coach, with the dates.
export async function coachTotals(config, groups = null) {
  const jj = config.juniors
  const gs = groups || await listGroups()
  const today = sydneyToday()
  const out = {}
  for (const c of jj.classes) {
    const gid = classGid(gs, c)
    const dates = juniorsDates(jj, c).filter((d) => d <= today)
    if (!dates.length) continue
    const recs = await kvPipeline(dates.map((d) => ['GET', sessionKey(gid, d)]))
    dates.forEach((d, i) => {
      let rec = null
      try { const raw = recs[i]?.result ?? recs[i]; rec = raw ? JSON.parse(raw) : null } catch {}
      if (!rec) return
      for (const [role, id] of [['head', rec.head], ['shadow', rec.shadow]]) {
        if (!id) continue
        const who = (out[id] ||= { id, name: coachLabel(coachById(config, id)) || id, head: [], shadow: [] })
        who[role].push({ date: d, label: dateLabel(d), classLabel: classLabelFor(jj, c) })
      }
    })
  }
  return Object.values(out).sort((a, b) => a.name.localeCompare(b.name))
}

// ---------- the Dashboard's attendance card ----------

// Per class date so far: present, absent and how many children; and the
// children who missed two or more in a row (Absent on the last registers
// taken, most recent first; a date with no register is skipped).
export async function attendanceSummary(config, { rows = null } = {}) {
  const jj = config.juniors
  const groups = await listGroups()
  const today = sydneyToday()
  const all = rows || (await readJJTable(tableFor(config, jj.term), { term: jj.term })).filter(isEnrolled)
  const byDate = new Map()
  const streaks = []
  for (const c of jj.classes) {
    const gid = classGid(groups, c)
    const kids = all.filter((r) => classForRow(jj, r)?.id === c.id)
    const dates = juniorsDates(jj, c).filter((d) => d <= today)
    if (!dates.length) continue
    const raws = await kvPipeline(dates.map((d) => ['HGETALL', keys.attendance(gid, d)]))
    const marks = dates.map((d, i) => hashOf(raws[i]?.result ?? raws[i]))
    dates.forEach((d, i) => {
      const m = marks[i]
      const w = byDate.get(d) || { date: d, label: dateLabel(d), present: 0, absent: 0, children: 0, registers: 0 }
      w.present += kids.filter((k) => m[k.id] === 'Present').length
      w.absent += kids.filter((k) => m[k.id] === 'Absent').length
      w.children += kids.length
      if (Object.keys(m).length) w.registers += 1
      byDate.set(d, w)
    })
    for (const k of kids) {
      let n = 0, last = ''
      for (let i = dates.length - 1; i >= 0; i -= 1) {
        const m = marks[i]
        if (!Object.keys(m).length) continue
        if (m[k.id] === 'Absent') { n += 1; last ||= dates[i] } else break
      }
      if (n >= 2) streaks.push({ rowId: k.id, name: k.player, classLabel: classLabelFor(jj, c), missed: n, lastDate: last, lastLabel: dateLabel(last) })
    }
  }
  const weeks = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  return { ready: true, weeks, streaks: streaks.sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name)), taken: weeks.filter((w) => w.registers).length }
}
