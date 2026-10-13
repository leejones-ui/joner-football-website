// Joners Juniors classes (stage 3): config.juniors.classes edited on the
// Classes page, each with its day, start and finish, place, places, head coach
// and shadow coach. More than one class is allowed.
//
// Each class is also a "Joners Juniors" group on the JFP timetable at the
// same day, time and place (id = slotId, the same as groupId() in
// _jfp-store.js), so the Program, coach hours, My sessions and the register
// find it. Saving the classes keeps those groups in step: made, changed (the
// head coach is the group's coach, the shadow coach its extra coach),
// moved with the class, or taken off when the class goes.
//
// A child is in a class by the day, time and place on their Juniors row (as
// staff and the website write them). Moving a child, or changing a class's
// day, time or place, rewrites those columns on the row, with a note.
// Lee and Ligia only (jfp-portal-data.js checks before sending anything here).
import { saveConfig, audit, coachById, coachLabel, listGroups, saveGroup, deleteGroup, validateGroup, sydneyToday, ageOn, dateLabel } from './_jfp-store.js'
import { readJJTable, getJJRow, writeJJRow, tableFor, isEnrolled, REC, bustJJ, plain } from './_jj-data.js'
import { validateJuniors, juniorsDates, classSlot, slotId, classById, classForRow, classLabelFor, jjTime24 } from './_jj-config.js'

export const isJJGroup = (g) => g?.label === 'Joners Juniors'
const out = (res, data) => res.status(200).json({ success: true, ...data })
const fail = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra })
const minutes = (t) => { const h = jjTime24(t); return h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3)) : null }
export function durationOf(c) {
  const a = minutes(c.time), b = minutes(c.endTime)
  return a != null && b != null && b > a ? Math.min(180, Math.max(15, b - a)) : 45
}
const place = (c) => `${c.day} ${c.time} ${c.location}`

// The timetable group a class has (or would have).
export function groupForClass(groups, c) { return groups.find((g) => isJJGroup(g) && slotId(g.day, g.time, g.location) === classSlot(c)) || null }

// The register's id for a class: its timetable group, else its slot.
export const classGid = (groups, c) => groupForClass(groups, c)?.id || classSlot(c)

// ---------- the timetable, kept in step ----------

// Returns { created, updated, removed, problems }.
export async function syncTimetable(config, before, principal, deps = {}) {
  const list = deps.listGroups || listGroups, save = deps.saveGroup || saveGroup, drop = deps.deleteGroup || deleteGroup
  const groups = await list()
  const jj = config.juniors
  const report = { created: [], updated: [], removed: [], problems: [] }
  const kept = new Set()
  for (const c of jj.classes) {
    const slot = classSlot(c)
    const prev = before ? classById(before, c.id) : null
    let g = groupForClass(groups, c)
    // The class moved: its old group moves with it.
    if (!g && prev && classSlot(prev) !== slot) g = groupForClass(groups, prev)
    const other = groups.find((x) => !isJJGroup(x) && slotId(x.day, x.time, x.location) === slot)
    if (other && !g) { report.problems.push(`A JFP group already runs at ${place(c)}, so the Juniors class is not on the timetable there.`); continue }
    const want = { day: c.day, time: c.time, location: c.location, label: 'Joners Juniors', capacity: c.capacity, coachId: c.coachId || '', extraCoachIds: c.shadowCoachId ? [c.shadowCoachId] : [], durationMin: durationOf(c) }
    const v = validateGroup({ mode: 'closed', minAge: 3, maxAge: 6, ...(g || {}), ...want, byCoach: false }, config, { id: slot })
    if (!v.ok) { report.problems.push(`${place(c)}: ${v.errors.join(' ')}`); continue }
    const next = { ...(g || {}), ...v.group, id: slot, byCoach: false }
    kept.add(slot)
    if (!g) {
      await save({ ...next, createdBy: principal.email, createdAt: new Date().toISOString() })
      report.created.push(slot)
      continue
    }
    const same = g.id === slot && ['day', 'time', 'location', 'capacity', 'coachId', 'durationMin', 'label'].every((k) => g[k] === next[k]) && JSON.stringify(g.extraCoachIds || []) === JSON.stringify(next.extraCoachIds)
    if (same) continue
    await save(next)
    if (g.id !== slot) { await drop(g.id); kept.add(g.id) }
    report.updated.push(slot)
  }
  // A Juniors group for no class any more comes off the timetable.
  for (const g of groups.filter(isJJGroup)) {
    if (kept.has(g.id) || jj.classes.some((c) => classSlot(c) === slotId(g.day, g.time, g.location))) continue
    await drop(g.id)
    report.removed.push(g.id)
  }
  return report
}

// Is the class on the timetable as it should be?
export function timetableState(groups, c) {
  const g = groupForClass(groups, c)
  if (!g) return { ok: false, groupId: '', problem: 'Not on the timetable yet' }
  const bad = []
  if (g.capacity !== c.capacity) bad.push('places')
  if ((g.coachId || '') !== (c.coachId || '')) bad.push('head coach')
  if (JSON.stringify(g.extraCoachIds || []) !== JSON.stringify(c.shadowCoachId ? [c.shadowCoachId] : [])) bad.push('shadow coach')
  return { ok: !bad.length, groupId: g.id, problem: bad.length ? `The timetable has a different ${bad.join(' and ')}` : '' }
}

// ---------- the Classes page ----------

const coachView = (config, id) => { const c = id ? coachById(config, id) : null; return c ? { id: c.id, name: coachLabel(c) } : null }

export async function classesView(config, { fresh = false } = {}) {
  const jj = config.juniors
  const [rows, groups] = await Promise.all([readJJTable(tableFor(config, jj.term), { term: jj.term, fresh }), listGroups()])
  const enrolled = rows.filter(isEnrolled)
  const kid = (r) => ({ rowId: r.id, name: r.player, age: r.dob ? ageOn(r.dob, sydneyToday()) : null })
  const classes = jj.classes.map((c) => {
    const children = enrolled.filter((r) => classForRow(jj, r)?.id === c.id).map(kid).sort((a, b) => a.name.localeCompare(b.name))
    const dates = juniorsDates(jj, c)
    return {
      ...c, label: classLabelFor(jj, c), slot: classSlot(c), durationMin: durationOf(c),
      head: coachView(config, c.coachId), shadow: coachView(config, c.shadowCoachId),
      enrolled: children.length, placesLeft: Math.max(0, c.capacity - children.length), children,
      dates: dates.map((iso) => ({ iso, label: dateLabel(iso) })),
      timetable: timetableState(groups, c),
    }
  })
  const unplaced = enrolled.filter((r) => !classForRow(jj, r)).map((r) => ({ ...kid(r), session: [r.day, r.time, r.location].filter(Boolean).join(' ') || 'No day or time on the row' }))
  return { term: jj.term, classes, unplaced, coaches: config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })) }
}

// Write a child into a class: the same columns the website and staff use.
function classSet(config, c) {
  const jj = config.juniors
  return { day: c.day, time: c.time, location: c.location, className: classLabelFor(jj, c), coach: coachById(config, c.coachId)?.airtableName || '' }
}

// Save every class. A class with children cannot be taken away (move them
// first). A class whose day, time or place changes takes its children with
// it; a new head coach goes onto their rows.
export async function saveClasses(res, principal, config, body) {
  const jj = config.juniors
  const input = Array.isArray(body.classes) ? body.classes.slice(0, 6) : null
  if (!input || !input.length) return fail(res, 400, 'Keep at least one class.')
  const bad = input.find((c) => (c?.coachId && !coachById(config, c.coachId)) || (c?.shadowCoachId && !coachById(config, c.shadowCoachId)))
  if (bad) return fail(res, 400, 'Choose the coaches from the list.')
  const checked = validateJuniors({ classes: input }, jj)
  if (!checked.ok) return fail(res, 400, checked.errors.join(' '))
  const next = checked.juniors.classes
  const table = tableFor(config, jj.term)
  const rows = (await readJJTable(table, { term: jj.term, fresh: true })).filter(isEnrolled)
  const inClass = (c) => rows.filter((r) => classForRow(jj, r)?.id === c.id)
  // Taken away while children are still in it: no.
  for (const c of jj.classes) {
    if (next.some((x) => x.id === c.id)) continue
    const n = inClass(c).length
    if (n) return fail(res, 409, `${classLabelFor(jj, c)} still has ${n} ${n === 1 ? 'child' : 'children'}. Move them to another class first.`, { code: 'children' })
  }
  // Fewer places than children: ask first.
  if (body.force !== true) {
    for (const c of next) {
      const before = classById(jj, c.id)
      const n = before ? inClass(before).length : 0
      if (n > c.capacity) return fail(res, 409, `${classLabelFor(checked.juniors, c)} would have ${n} children in ${c.capacity} places. Save anyway?`, { code: 'full' })
    }
  }
  // The rows that move with their class (a new day, time or place, or a new head coach).
  const moves = []
  for (const c of next) {
    const before = classById(jj, c.id)
    if (!before) continue
    const slotMoved = classSlot(before) !== classSlot(c)
    const coachMoved = (before.coachId || '') !== (c.coachId || '')
    const labelMoved = classLabelFor(jj, before) !== classLabelFor(checked.juniors, c)
    if (slotMoved || coachMoved || labelMoved) for (const r of inClass(before)) moves.push({ r, from: before, to: c, slotMoved })
  }
  const saved = await saveConfig({ juniors: { ...jj, classes: next } })
  let rowsWritten = 0
  try {
    for (const m of moves) {
      await writeJJRow(table, { id: m.r.id, set: classSet(saved, m.to), note: m.slotMoved ? `Class changed from ${place(m.from)} to ${place(m.to)} by ${principal.name}.` : '' })
      rowsWritten += 1
    }
  } catch (error) {
    await bustJJ(table).catch(() => {})
    return fail(res, 502, `The classes are saved, but Airtable stopped part way (${String(error.message).slice(0, 80)}): ${rowsWritten} of ${moves.length} children were updated. Press Save again to finish.`)
  }
  await bustJJ(table).catch(() => {})
  const timetable = await syncTimetable(saved, jj, principal)
  await audit({ by: principal.email, action: 'jj.classes', target: 'config.juniors.classes', before: jj.classes, after: { classes: saved.juniors.classes, rowsWritten, timetable } })
  return out(res, { ...(await classesView(saved, { fresh: true })), timetableReport: timetable, rowsWritten })
}

// Put a child in another class. Places are checked unless "anyway".
export async function moveChild(res, principal, config, body) {
  const jj = config.juniors
  const table = tableFor(config, jj.term)
  const row = REC.test(String(body.rowId || '')) ? await getJJRow(table, body.rowId, jj.term) : null
  if (!row) return fail(res, 404, 'That child was not found in the Joners Juniors table. Refresh and try again.')
  if (row.removed) return fail(res, 409, `${row.player} has left. Put them back in Players first.`)
  const to = classById(jj, String(body.classId || ''))
  if (!to) return fail(res, 400, 'Choose the class.')
  const from = jj.classes.length > 1 ? classForRow(jj, row) : null
  if (from?.id === to.id) return fail(res, 409, `${row.player} is already in ${classLabelFor(jj, to)}.`)
  const rows = (await readJJTable(table, { term: jj.term, fresh: true })).filter(isEnrolled)
  const taken = rows.filter((r) => r.id !== row.id && classForRow(jj, r)?.id === to.id).length
  if (taken >= to.capacity && body.force !== true) return fail(res, 409, `${classLabelFor(jj, to)} has ${taken} of ${to.capacity} places taken. Move anyway?`, { code: 'full' })
  const why = plain(body.note, 200)
  await writeJJRow(table, { id: row.id, set: classSet(config, to), note: `Moved ${from ? `from ${place(from)} ` : ''}to ${place(to)} by ${principal.name}.${why ? ` ${why}` : ''}` })
  await bustJJ(table).catch(() => {})
  await audit({ by: principal.email, action: 'jj.player.move', target: row.id, before: { class: from?.id || [row.day, row.time, row.location].join(' ') }, after: { class: to.id, name: row.player } })
  return out(res, { rowId: row.id, classId: to.id })
}
