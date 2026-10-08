// "Can't make a session": a family tells JFP a player will miss one session.
//
// What this does and does not do (Lee, Oct 2026):
//   - It is saved in KV only (hash jfp:cancels). Nothing is written to Airtable.
//   - It does not release the place, change a fee or give any credit or refund.
//   - It tells the group's coach(es), Lee and Ligia by email, and Telegram.
//   - One cancellation per row and session date. Saving, withdrawing and
//     sending all run under a short lock, so a double tap or a retry never
//     makes a second record or a second email.
//
// The notice a family gave (session start minus the moment they sent it) is
// stored in minutes so Lee can report on it.
import crypto from 'node:crypto'
import { kvCommand, clean, sessionDates, dateLabel, to24h, coachById, coachByAirtableName, coachLabel, locationFor, audit } from './_jfp-store.js'
import { sendCancelStaffAlert, sendCancelCoachAlert, staffTo } from './_jfp-email.js'
import { telegramAlert, cancelText } from './_jfp-notify.js'

export const REASONS = {
  sick: 'Sick or injured',
  school: 'School or exams',
  family: 'Family or travel',
  other: 'Other',
}
export const NOTE_MAX = 500
export const LATE_MINUTES = 24 * 60
export const VERY_LATE_MINUTES = 2 * 60
// Per family, per hour. Generous for a term of holidays, tight for a script.
export const RATE_LIMIT = Number(process.env.JFP_CANCEL_RATE_LIMIT) > 0 ? Number(process.env.JFP_CANCEL_RATE_LIMIT) : 20
const KEY = 'jfp:cancels'
const LOCK_SECONDS = 30

// ---------- Sydney time ----------

// Minutes Sydney is ahead of UTC at this instant (600 or 660).
function sydneyOffsetMinutes(utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Australia/Sydney', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs))
  const n = (type) => Number(parts.find((p) => p.type === type).value)
  const asIfUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((asIfUtc - Math.floor(utcMs / 1000) * 1000) / 60000)
}

// A Sydney wall clock time (2026-10-13, 16:20) as a UTC instant, daylight
// saving included. Two passes settle the offset on either side of a change.
export function sydneyWallToUtcMs(dateIso, time24) {
  const [y, m, d] = String(dateIso).split('-').map(Number)
  const [hh, mm] = String(time24).split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  let guess = wall - sydneyOffsetMinutes(wall) * 60000
  guess = wall - sydneyOffsetMinutes(guess) * 60000
  return guess
}

// ---------- notice ----------

// How much notice a family gave. Minutes can be negative (already started).
export function noticeFor({ date, time, nowMs = Date.now() }) {
  const t = to24h(time)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !t) return null
  const startMs = sydneyWallToUtcMs(date, t)
  const minutes = Math.floor((startMs - nowMs) / 60000)
  return { startMs, minutes, hours: Math.round((minutes / 60) * 10) / 10, level: noticeLevel(minutes) }
}
export function noticeLevel(minutes) {
  if (minutes < VERY_LATE_MINUTES) return 'very-late'
  if (minutes < LATE_MINUTES) return 'late'
  return 'ok'
}
// "26 h notice", "late: 5 h", "late: 90 min".
export function noticeLabel(minutes) {
  if (minutes >= LATE_MINUTES) return `${Math.floor(minutes / 60)} h notice`
  if (minutes >= VERY_LATE_MINUTES) return `late: ${Math.floor(minutes / 60)} h`
  return `late: ${Math.max(0, minutes)} min`
}
export const noticeTag = (level) => (level === 'very-late' ? 'VERY LATE NOTICE (under 2 hours)' : level === 'late' ? 'LATE NOTICE (under 24 hours)' : '')

// ---------- which dates are real sessions for a row ----------

// The dates this player trains: the group's real dates (holidays skipped),
// from their start date if they joined mid term, or only the trial date.
export function rowSessionDates(config, row, group) {
  const notes = row.notes || ''
  const trialOn = /trial/i.test(row.paymentType || '') ? (notes.match(/Trial offered for (\d{4}-\d{2}-\d{2})/) || [])[1] : ''
  if (trialOn) return [trialOn]
  const from = (notes.match(/(?:from|starts) (\d{4}-\d{2}-\d{2})/) || [])[1] || ''
  return sessionDates(config, group?.day || row.day).filter((d) => !from || d >= from)
}

// Start time of a row's session, from the group if there is one.
export function rowTime(row, group) { return to24h(group?.time) ? group.time : row.time }

// Coaches told about a session: the group's coach and any extra coaches, plus
// whoever is covering that date.
export function coachesFor(config, row, group, coverCoachId = '') {
  const ids = group ? [group.coachId, ...(group.extraCoachIds || [])] : [coachByAirtableName(config, row.coach)?.id]
  if (coverCoachId) ids.push(coverCoachId)
  return [...new Set(ids.filter(Boolean))].map((id) => coachById(config, id)).filter(Boolean)
}

export function cancelId(rowId, date) {
  return `CXL-${crypto.createHash('sha256').update(`${rowId}|${date}`).digest('hex').slice(0, 16).toUpperCase()}`
}

// ---------- validation (pure) ----------

// Everything a request must satisfy before anything is saved. `now` is a
// parameter so the rules are testable at any moment, including either side of
// a daylight saving change.
export function validateCancel({ config, row, group, date, reason, note, nowMs = Date.now() }) {
  if (!row) return { ok: false, status: 404, error: 'We could not find that player on your account.' }
  if (!REASONS[reason]) return { ok: false, status: 400, error: 'Choose a reason.' }
  const text = clean(note, NOTE_MAX)
  if (reason === 'other' && text.length < 3) return { ok: false, status: 400, error: 'Add a short note so the coach knows why.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { ok: false, status: 400, error: 'Choose the session date.' }
  if (!rowSessionDates(config, row, group).includes(date)) return { ok: false, status: 400, error: 'That date is not one of this player\'s sessions.', code: 'not_a_session' }
  const time = rowTime(row, group)
  const notice = noticeFor({ date, time, nowMs })
  if (!notice) return { ok: false, status: 400, error: 'We could not read this session\'s time. Contact Joner Football.' }
  if (notice.minutes <= 0) return { ok: false, status: 400, error: 'That session has already started or passed. Call or text your coach.', code: 'past' }
  return { ok: true, note: text, reason, time, notice }
}

// ---------- storage ----------

function parse(v) { try { return JSON.parse(v) } catch { return null } }
export async function listCancels() {
  const raw = await kvCommand(['HGETALL', KEY])
  const out = []
  for (let i = 0; i + 1 < (raw || []).length; i += 2) { const r = parse(raw[i + 1]); if (r) out.push(r) }
  return out.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
}
export async function getCancel(id) { const r = await kvCommand(['HGET', KEY, clean(id, 40)]); return r ? parse(r) : null }
async function saveCancel(rec) { await kvCommand(['HSET', KEY, rec.id, JSON.stringify(rec)]); return rec }

async function underRateLimit(email) {
  const key = `jfp:cancel-rate:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 24)}`
  const n = Number(await kvCommand(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", '1', key, '3600']))
  return n <= RATE_LIMIT
}

// Run `fn` while holding the lock for one cancellation. { busy: true } if
// another request holds it.
async function withLock(id, fn) {
  const key = `jfp:cancel-lock:${id}`
  if ((await kvCommand(['SET', key, '1', 'NX', 'EX', String(LOCK_SECONDS)])) !== 'OK') return { busy: true }
  try { return { value: await fn() } } finally { await kvCommand(['DEL', key]) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- sending ----------

// Real senders. Tests pass their own.
export const defaultNotifiers = {
  staffRecipients: async (config) => staffTo(config).map((t) => t.email),
  staff: ({ rec, config }) => sendCancelStaffAlert({ rec, config }),
  coach: ({ rec, coach }) => sendCancelCoachAlert({ rec, coach }),
  telegram: ({ rec }) => telegramAlert(cancelText(rec)),
}

// Sends only what has not gone yet, and remembers what did. Called under the
// lock, so a retry after a failed email sends the missing ones and never a
// second copy of one that went.
export async function deliver(rec, config, notifiers) {
  const done = (key) => ['sent', 'off', 'skipped'].includes(rec.deliveries?.[key])
  const jobs = []
  const add = (key, fn) => { if (!done(key)) jobs.push([key, fn]) }
  const staff = await notifiers.staffRecipients(config)
  add('staff', () => notifiers.staff({ rec, config }))
  for (const id of rec.coachIds || []) {
    const coach = coachById(config, id)
    if (!coach?.email) { rec.deliveries = { ...rec.deliveries, [`coach:${id}`]: 'skipped' }; continue }
    // Lee, Ligia and anyone else already on the staff email do not get a second one.
    if (staff.includes(coach.email)) { rec.deliveries = { ...rec.deliveries, [`coach:${id}`]: 'skipped' }; continue }
    add(`coach:${id}`, () => notifiers.coach({ rec, config, coach }))
  }
  add('telegram', () => notifiers.telegram({ rec, config }))
  const results = await Promise.allSettled(jobs.map(([, fn]) => fn()))
  rec.deliveries = { ...rec.deliveries }
  results.forEach((r, i) => {
    const key = jobs[i][0]
    if (r.status === 'rejected') { console.error('jfp cancel notify failed', key, r.reason?.message); rec.deliveries[key] = 'failed'; return }
    // The Telegram helper reports 'off' (not set up), 'sent' or 'failed ...'.
    const v = r.value
    rec.deliveries[key] = v === 'off' ? 'off' : (typeof v === 'string' && v.startsWith('failed')) ? 'failed' : 'sent'
  })
  rec.pending = Object.values(rec.deliveries).includes('failed')
  rec.notifiedAt = rec.pending ? rec.notifiedAt || '' : new Date().toISOString()
  return saveCancel(rec)
}

// ---------- submit and withdraw ----------

// `row` has already been proven to belong to this family by the caller.
export async function submitCancel({ config, parentEmail, parentName, row, group, date, reason, note, coverCoachId = '', nowMs = Date.now(), notifiers = defaultNotifiers }) {
  const v = validateCancel({ config, row, group, date, reason, note, nowMs })
  if (!v.ok) return v
  const id = cancelId(row.id, date)
  const existing = await getCancel(id)
  // A second tap, or a retry: the same record comes back and only anything
  // that failed to send is tried again.
  const again = async (rec) => {
    if (rec.email !== parentEmail) return { ok: false, status: 409, error: 'That session is already marked as cancelled.' }
    if (!rec.pending) return { ok: true, record: rec, already: true }
    const r = await withLock(id, async () => deliver((await getCancel(id)) || rec, config, notifiers))
    return { ok: true, record: r.value || rec, already: true }
  }
  if (existing?.status === 'active') return again(existing)
  const loc = locationFor(config, row.location)
  const coaches = coachesFor(config, row, group, coverCoachId)
  const locked = await withLock(id, async () => {
    const now = (await getCancel(id)) // re-read under the lock
    if (now?.status === 'active') return { rec: now, fresh: false }
    // Counted only for a genuinely new cancellation, never a double tap.
    if (!(await underRateLimit(parentEmail))) return { limited: true }
    const rec = {
      id, rev: (now?.rev || 0) + 1, status: 'active', event: 'cancelled',
      email: parentEmail, parentName: clean(parentName, 100),
      rowId: row.id, player: clean(row.player, 100), groupId: row.groupId || group?.id || '',
      day: group?.day || row.day, time: v.time, location: loc.name,
      coachIds: coaches.map((c) => c.id), coachNames: coaches.map((c) => `Coach ${coachLabel(c)}`),
      date, dateLabel: dateLabel(date), startMs: v.notice.startMs, startAt: new Date(v.notice.startMs).toISOString(),
      reasonKey: v.reason, reason: REASONS[v.reason], note: v.note,
      submittedAt: new Date(nowMs).toISOString(), submittedMs: nowMs,
      noticeMinutes: v.notice.minutes, noticeHours: v.notice.hours, noticeLevel: v.notice.level, noticeLabel: noticeLabel(v.notice.minutes),
      deliveries: {}, pending: true,
    }
    await saveCancel(rec)
    await audit({ by: parentEmail, action: 'session.cancel', target: id, after: { row: row.id, date, notice: v.notice.minutes } })
    return { rec: await deliver(rec, config, notifiers), fresh: true }
  })
  if (locked.busy) {
    // The other request is finishing: wait for its record rather than fail.
    for (let i = 0; i < 6; i += 1) {
      await sleep(400)
      const rec = await getCancel(id)
      if (rec?.status === 'active') return { ok: true, record: rec, already: true }
    }
    return { ok: false, status: 409, error: 'Just a moment, that is still being saved. Refresh in a few seconds.' }
  }
  if (locked.value.limited) return { ok: false, status: 429, error: 'That is a lot of cancellations in a short time. Please call or text your coach instead.' }
  return { ok: true, record: locked.value.rec, already: !locked.value.fresh }
}

// Before the session starts the family may take a cancellation back. The team
// is told, so a coach never expects an empty spot that is full.
export async function withdrawCancel({ config, parentEmail, id, nowMs = Date.now(), notifiers = defaultNotifiers }) {
  const rec = await getCancel(id)
  if (!rec || rec.email !== parentEmail) return { ok: false, status: 404, error: 'We could not find that cancellation.' }
  if (rec.status === 'withdrawn') {
    // A retry after an email failed sends only what is missing.
    if (!rec.pending) return { ok: true, record: rec, already: true }
    const r = await withLock(id, async () => deliver((await getCancel(id)) || rec, config, notifiers))
    return { ok: true, record: r.value || rec, already: true }
  }
  if (rec.startMs <= nowMs) return { ok: false, status: 400, error: 'That session has already started.', code: 'past' }
  const locked = await withLock(id, async () => {
    const cur = await getCancel(id)
    if (cur.status === 'withdrawn') return { rec: cur, fresh: false }
    const next = { ...cur, status: 'withdrawn', event: 'withdrawn', withdrawnAt: new Date(nowMs).toISOString(), deliveries: {}, pending: true }
    await saveCancel(next)
    await audit({ by: parentEmail, action: 'session.cancel.withdraw', target: id })
    return { rec: await deliver(next, config, notifiers), fresh: true }
  })
  if (locked.busy) return { ok: false, status: 409, error: 'Just a moment, that is still being saved. Try again in a few seconds.' }
  return { ok: true, record: locked.value.rec, already: !locked.value.fresh }
}

// ---------- views ----------

// What the family sees of their own cancellation.
export function familyView(rec) {
  return { id: rec.id, rowId: rec.rowId, date: rec.date, label: dateLabel(rec.date), time: rec.time, startMs: rec.startMs, reason: rec.reason, noticeLabel: noticeLabel(rec.noticeMinutes), noticeLevel: rec.noticeLevel, submittedAt: rec.submittedAt }
}

// What staff see. Parent details are Lee and Ligia's only.
export function staffView(rec, { admin, nowMs = Date.now() }) {
  const failed = Object.entries(rec.deliveries || {}).filter(([, v]) => v === 'failed').map(([k]) => k.replace(/^coach:/, 'coach '))
  return {
    id: rec.id, status: rec.status, player: rec.player, group: `${rec.day} ${rec.time}`, location: rec.location, groupId: rec.groupId,
    coaches: rec.coachNames || [], date: rec.date, dateLabel: dateLabel(rec.date), startMs: rec.startMs, upcoming: rec.startMs > nowMs,
    reason: rec.reason, note: rec.note || '', noticeLabel: noticeLabel(rec.noticeMinutes), noticeMinutes: rec.noticeMinutes, noticeLevel: rec.noticeLevel,
    submittedAt: rec.submittedAt, withdrawnAt: rec.withdrawnAt || '',
    ...(admin ? { parentName: rec.parentName || '', email: rec.email, notFullySent: failed } : {}),
  }
}

// How much notice families give, for the Cancellations tab and for reports.
export function noticeSummary(records) {
  const active = records.filter((r) => r.status === 'active')
  const mins = active.map((r) => r.noticeMinutes).sort((a, b) => a - b)
  const median = mins.length ? (mins.length % 2 ? mins[(mins.length - 1) / 2] : Math.round((mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2)) : 0
  return {
    total: active.length,
    under24: active.filter((r) => r.noticeMinutes < LATE_MINUTES).length,
    under2: active.filter((r) => r.noticeMinutes < VERY_LATE_MINUTES).length,
    averageHours: mins.length ? Math.round((mins.reduce((t, m) => t + m, 0) / mins.length / 60) * 10) / 10 : 0,
    medianHours: Math.round((median / 60) * 10) / 10,
  }
}

// Who is covering a group on a date, if anyone (KV jfp:cover).
export async function coverCoachFor(groupId, date) {
  try {
    const raw = await kvCommand(['HGETALL', 'jfp:cover'])
    for (let i = 0; i + 1 < (raw || []).length; i += 2) {
      const c = parse(raw[i + 1])
      if (c && c.status === 'active' && c.groupId === groupId && c.date === date) return c.coverCoachId || ''
    }
  } catch (error) { console.error('jfp cancel cover lookup failed', error) }
  return ''
}
