// Coach alerts (Lee, 14 Oct 2026). Two things coaches were missing:
//
// 1. A new player in your group. Coach Sam arrived at 7:30am not knowing
//    Charlie Roberts was in his group. When Lee or Ligia add a player to a
//    group (or move one in), the group's coach gets an email and a text.
//    Changes settle for a few minutes first, so a run of drag and drops on the
//    Timetable becomes one message per coach, and a player moved straight
//    back out is never announced.
// 2. The register. Thirty minutes after a session ends, a coach who has not
//    marked anyone gets an email and a text. Still empty four hours after the
//    end: a second one, and Lee hears on Telegram. Each one goes once.
//
// Both are off until Lee switches them on (Coaches page). Texts go from the
// office Mac (0404 780 351) like every portal text, 6am to 9pm for coaches,
// and only to a coach with a mobile saved on the Coaches page. Lee (the
// owner) is never chased for his own sessions.
import { registerTaken } from './_jfp-away.js'
import { kvCommand, listGroups, sessionDates, coachById, dateLabel, sydneyToday, to24h, locationFor, audit } from './_jfp-store.js'
import { loadRoster, playerAge } from './_jfp-airtable.js'
import { coverCoachFor, sydneyWallToUtcMs } from './_jfp-cancel.js'
import { jjDatesForGroup } from './_jj-registers.js'
import { newMsg, saveMsg, event, normalisePhone, maskPhone, sha, routeStatus } from './_jfp-messages.js'
import { sendCoachNotice } from './_jfp-email.js'
import { telegramAlert } from './_jfp-notify.js'
import { allSlots, liveBookings, endMs as extraEnd, markTold } from './_jfp-extra.js'

export const COACH_TEXT_HOURS = { from: 6, to: 21 }
const NEWS = 'jfp:coach-news' // hash coachId -> { items: [...], lastAt }
const NEWS_DONE = 'jfp:coach-news-done' // hash coachId|rowId|groupId -> when told
const REG_DONE = 'jfp:reg-remind' // hash groupId|date|stage -> when sent
const SETTLE_MS = 3 * 60 * 1000
const FIRST_AFTER_MS = 30 * 60 * 1000
const SECOND_AFTER_MS = 4 * 60 * 60 * 1000
const GIVE_UP_MS = 30 * 60 * 60 * 1000
const PORTAL = 'https://jonerfootball.com/jfp-portal/'
const PORTAL_SHORT = 'jonerfootball.com/jfp-portal'

export const alertsOn = (config, what) => config.coachAlerts?.[what] === true
const isJuniors = (g) => g?.label === 'Joners Juniors'
const isTest = (n) => /test/i.test(n || '')
const first = (s) => String(s || '').trim().split(/\s+/)[0] || ''
const hashOf = (raw) => { const o = {}; for (let i = 0; i + 1 < (raw || []).length; i += 2) o[raw[i]] = raw[i + 1]; return o }
const trialDateOf = (r) => (String(r.notes || '').match(/Trial offered for (\d{4}-\d{2}-\d{2})/) || [])[1] || ''
const shortGroup = (config, g) => `${String(g.day).slice(0, 3)} ${g.time} ${locationFor(config, g.location).name}`
const shortDate = (iso) => dateLabel(iso).replace(/\s\d{4}$/, '')
// Lee runs the business: never chased about his own sessions.
const isOwner = (config, coach) => Boolean(coach?.email) && (config.superAdmins || []).includes(coach.email)

export function coachTextHoursOpen(ms = Date.now()) {
  if (process.env.JFP_TEXT_ANYTIME === '1') return true
  const h = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false }).format(new Date(ms))) % 24
  return h >= COACH_TEXT_HOURS.from && h < COACH_TEXT_HOURS.to
}

// A text to a coach, queued for the office Mac. The number is checked again
// against the Coaches page when the Mac picks it up.
async function textCoach({ coach, text, kind }) {
  const phone = normalisePhone(coach?.phone)
  if (!phone) return { texted: false, why: 'no mobile on the Coaches page' }
  const route = await routeStatus()
  if (!route.verified) return { texted: false, why: 'portal texts are not switched on yet' }
  const m = newMsg({ channel: 'text', family: { email: coach.email || '', parent: `Coach ${coach.name}`, players: [], kind }, content: { text }, target: { ref: maskPhone(phone), hash: sha(phone) }, by: 'coach alerts', route: { id: 'mac', label: 'Messages on the office Mac' } })
  m.coachId = coach.id
  m.quick = true
  m.status = 'queued'
  m.approvedBy = 'coach alerts (switched on by Lee)'
  m.approvedAt = m.createdAt
  m.expiresAt = new Date(Date.now() + 12 * 3600000).toISOString()
  event(m, 'coach alerts', `${kind} for Coach ${coach.name}`)
  await saveMsg(m)
  return { texted: true, id: m.id }
}

async function tell({ coach, subject, heading, paras, list, text, kind }) {
  let emailed = false, emailError = ''
  try { emailed = Boolean(await sendCoachNotice({ coach, subject, heading, paras, list, cta: { label: 'Open my coach portal', url: PORTAL }, kind })) } catch (e) { emailError = e.message }
  let tx = { texted: false, why: '' }
  try { tx = await textCoach({ coach, text, kind }) } catch (e) { tx = { texted: false, why: e.message } }
  return { emailed, emailError, texted: tx.texted, textWhy: tx.why || '' }
}

// ---------- 1. new player in your group ----------

// Called after a player is put in a group by staff (add, move, after a trial,
// an approved request). Nothing is sent here: see flushCoachNews.
export async function noteNewPlayer({ config, group, rowId, player, kind = 'added' }) {
  if (!alertsOn(config, 'newPlayer') || !group?.coachId || !rowId || isTest(player)) return
  const coach = coachById(config, group.coachId)
  if (!coach || isOwner(config, coach)) return
  if (Number(await kvCommand(['HEXISTS', NEWS_DONE, `${coach.id}|${rowId}|${group.id}`])) === 1) return
  let cur = null
  try { cur = JSON.parse((await kvCommand(['HGET', NEWS, coach.id])) || 'null') } catch {}
  const items = (cur?.items || []).filter((x) => x.rowId !== rowId)
  items.push({ rowId, player, groupId: group.id, kind, at: new Date().toISOString() })
  await kvCommand(['HSET', NEWS, coach.id, JSON.stringify({ items: items.slice(-40), lastAt: Date.now() })])
}

export function newPlayerWords({ config, coach, entries }) {
  // entries: [{ group, players: [{ name, age, when }] }]
  const part = (e) => `${e.players.length > 1 ? 'New players' : 'New player'} in your ${shortGroup(config, e.group)} group: ${e.players.map((x) => `${x.name}${x.age != null ? ` (${x.age})` : ''}, ${x.when}`).join('; ')}`
  let body = entries.map(part).join('. ')
  if (body.length > 420) body = `${entries.reduce((n, e) => n + e.players.length, 0)} new players across your groups (${entries.map((e) => shortGroup(config, e.group)).join(', ')})`
  const text = `Hi ${coach.name}, ${body.charAt(0).toLowerCase()}${body.slice(1)}. Check your coach portal before the session: ${PORTAL_SHORT}`
  const n = entries.reduce((t, e) => t + e.players.length, 0)
  return {
    text,
    subject: n === 1 ? `New player: ${entries[0].players[0].name}, ${shortGroup(config, entries[0].group)}` : `${n} new players in your groups`,
    heading: n === 1 ? 'New player in your group' : 'New players in your groups',
    paras: [`Hi Coach ${coach.name}, ${n === 1 ? 'a new player has' : 'new players have'} been added to your ${entries.length === 1 ? 'group' : 'groups'}. They are on your register in the coach portal.`],
    list: entries.flatMap((e) => e.players.map((x) => [shortGroup(config, e.group), `${x.name}${x.age != null ? ` (${x.age})` : ''}, ${x.when}`])),
  }
}

function whenFor(config, row, group, today) {
  const trial = /trial/i.test(row.paymentType || '') ? trialDateOf(row) : ''
  if (trial) return `trial on ${shortDate(trial)}`
  const dates = isJuniors(group) ? jjDatesForGroup(config, group) : sessionDates(config, group.day)
  const from = row.startsFrom && row.startsFrom >= today ? row.startsFrom : dates.find((d) => d >= today)
  return from ? `first session ${from === today ? 'today' : shortDate(from)}` : 'from next term'
}

// Sends what has settled: one email and one text per coach.
export async function flushCoachNews({ config, now = Date.now() }) {
  if (!alertsOn(config, 'newPlayer')) return { told: 0 }
  const pending = hashOf(await kvCommand(['HGETALL', NEWS]))
  const ready = Object.entries(pending).map(([id, v]) => { try { return [id, JSON.parse(v)] } catch { return [id, null] } }).filter(([, v]) => v && now - Number(v.lastAt || 0) >= SETTLE_MS)
  if (!ready.length) return { told: 0 }
  const [roster, groups] = await Promise.all([loadRoster({ fresh: true }), listGroups()])
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, g]))
  const today = sydneyToday(now)
  let told = 0
  for (const [coachId, v] of ready) {
    // Taken off the list first: two runs at once never tell a coach twice.
    if (Number(await kvCommand(['HDEL', NEWS, coachId])) !== 1) continue
    const coach = coachById(config, coachId)
    if (!coach) continue
    const entries = new Map()
    for (const it of v.items || []) {
      const row = roster.players.find((r) => r.id === it.rowId)
      const group = byGroup[it.groupId]
      // Moved out again, removed, or the group changed hands: nothing to say.
      if (!row || !group || row.groupId !== group.id || !row.holdsPlace || group.coachId !== coachId) continue
      if (Number(await kvCommand(['HSETNX', NEWS_DONE, `${coachId}|${row.id}|${group.id}`, new Date(now).toISOString()])) !== 1) continue
      const e = entries.get(group.id) || { group, players: [] }
      e.players.push({ name: row.player, age: playerAge(row, today), when: whenFor(config, row, group, today) })
      entries.set(group.id, e)
    }
    if (!entries.size) continue
    const words = newPlayerWords({ config, coach, entries: [...entries.values()] })
    const out = await tell({ coach, ...words, kind: 'coach new player' })
    told += 1
    await audit({ by: 'coach alerts', action: 'coach.newPlayer', target: coachId, after: { players: [...entries.values()].flatMap((e) => e.players.map((x) => x.name)), emailed: out.emailed, texted: out.texted, why: out.textWhy || out.emailError || undefined } })
  }
  return { told }
}

// ---------- 2. register not filled in ----------

export function registerWords({ config, coach, group, date, stage, today }) {
  const when = date === today ? 'today' : shortDate(date)
  const g = shortGroup(config, group)
  const text = stage === 1
    ? `Hi ${coach.name}, reminder: the register for your ${g} session (${when}) is not filled in yet. Please mark it now in your coach portal: ${PORTAL_SHORT} We use it to match your invoice. Thanks!`
    : `Hi ${coach.name}, reminder: the register for ${g} (${when}) is still empty. Please mark it today so your invoice matches: ${PORTAL_SHORT}`
  return {
    text,
    subject: stage === 1 ? `Register not done: ${g}, ${when}` : `Still not done: the ${g} register, ${when}`,
    heading: stage === 1 ? 'Please fill in your register' : 'Your register is still empty',
    paras: [
      stage === 1 ? `Hi Coach ${coach.name}, the register for your session has not been filled in yet.` : `Hi Coach ${coach.name}, the register for this session is still empty.`,
      'Open your coach portal and mark who came. Lee and Ligia use the registers to match your invoice to your sessions.',
    ],
    list: [['Session', `${group.day} ${group.time}, ${locationFor(config, group.location).name}`], ['Date', dateLabel(date)]],
  }
}

function playersOn(roster, group, date) {
  return roster.players.filter((r) => r.groupId === group.id && r.holdsPlace && !isTest(r.player) && (!trialDateOf(r) || !/trial/i.test(r.paymentType || '') || trialDateOf(r) === date) && (!r.startsFrom || r.startsFrom <= date)).length
}

export async function registerSweep({ config, now = Date.now() }) {
  if (!alertsOn(config, 'register')) return { sent: 0 }
  const since = Date.parse(config.coachAlerts?.registerSince || '') || now
  const today = sydneyToday(now), yesterday = sydneyToday(now - 86400000)
  const groups = await listGroups()
  let roster = null
  let sent = 0
  for (const g of groups) {
    const dates = (isJuniors(g) ? jjDatesForGroup(config, g) : sessionDates(config, g.day)).filter((d) => d === today || d === yesterday)
    for (const date of dates) {
      const t = to24h(g.time)
      if (!t) continue
      const endMs = sydneyWallToUtcMs(date, t) + (Number(g.durationMin) || 60) * 60000
      // Only sessions that ended after the reminders were switched on.
      if (endMs < since || now - endMs < FIRST_AFTER_MS || now - endMs > GIVE_UP_MS) continue
      const stage = now - endMs >= SECOND_AFTER_MS ? 2 : 1
      if (Number(await kvCommand(['HEXISTS', REG_DONE, `${g.id}|${date}|${stage}`])) === 1) continue
      if (registerTaken(await kvCommand(['HVALS', `jfp:att:${g.id}:${date}`]) || [])) continue
      if (!isJuniors(g)) { roster ||= await loadRoster(); if (!playersOn(roster, g, date)) continue }
      const coach = coachById(config, (await coverCoachFor(g.id, date)) || g.coachId)
      if (!coach || isOwner(config, coach)) continue
      // Once per session per stage, whoever runs first.
      if (Number(await kvCommand(['HSETNX', REG_DONE, `${g.id}|${date}|${stage}`, new Date(now).toISOString()])) !== 1) continue
      if (stage === 2) await kvCommand(['HSETNX', REG_DONE, `${g.id}|${date}|1`, new Date(now).toISOString()])
      const out = await tell({ coach, ...registerWords({ config, coach, group: g, date, stage, today }), kind: stage === 1 ? 'coach register' : 'coach register again' })
      sent += 1
      if (stage === 2) await telegramAlert(`Register still empty: Coach ${coach.name}, ${shortGroup(config, g)}, ${dateLabel(date)}. They have had an email${out.texted ? ' and a text' : ''} twice.`).catch(() => {})
      await audit({ by: 'coach alerts', action: 'coach.register', target: `${g.id}|${date}`, after: { coach: coach.id, stage, emailed: out.emailed, texted: out.texted, why: out.textWhy || out.emailError || undefined } })
    }
  }
  sent += await extraRegisterSweep({ config, now, since, today, yesterday })
  return { sent }
}

// ---------- 3. extra sessions (Lee, 14 Oct 2026) ----------

const DAY = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${iso}T12:00:00Z`))
const asGroup = (s) => ({ day: DAY(s.date), time: s.time, location: s.location })

// A family booked a public extra session themselves: the coach hears.
export async function flushExtraNews({ config }) {
  if (!alertsOn(config, 'newPlayer')) return { told: 0 }
  let told = 0
  for (const s of await allSlots()) {
    if (s.status !== 'open') continue
    for (const b of liveBookings(s).filter((x) => x.from === 'family' && !x.coachTold)) {
      if (!(await markTold(s.id, b.id))) continue
      const coach = coachById(config, s.coachId)
      if (!coach || isOwner(config, coach)) continue
      const g = shortGroup(config, asGroup(s))
      const out = await tell({
        coach, kind: 'coach extra booking',
        text: `Hi ${coach.name}, ${b.name} has booked your extra session: ${g}, ${shortDate(s.date)}. Details in your coach portal: ${PORTAL_SHORT}`,
        subject: `Extra session booked: ${b.name}, ${shortDate(s.date)}`,
        heading: 'A player booked your extra session',
        paras: [`Hi Coach ${coach.name}, ${b.name} has booked your extra session.`],
        list: [['Session', `${dateLabel(s.date)}, ${s.time}, ${s.location}`], ['Player', b.name]],
      })
      told += 1
      await audit({ by: 'coach alerts', action: 'coach.extraBooking', target: s.id, after: { player: b.name, emailed: out.emailed, texted: out.texted } })
    }
  }
  return { told }
}

// The register for an extra session with players booked, like a group's.
async function extraRegisterSweep({ config, now, since, today, yesterday }) {
  let sent = 0
  for (const s of await allSlots()) {
    if (s.status !== 'open' || ![today, yesterday].includes(s.date) || !liveBookings(s).length) continue
    const end = extraEnd(s)
    if (end < since || now - end < FIRST_AFTER_MS || now - end > GIVE_UP_MS) continue
    const stage = now - end >= SECOND_AFTER_MS ? 2 : 1
    if (Number(await kvCommand(['HEXISTS', REG_DONE, `${s.id}|${s.date}|${stage}`])) === 1) continue
    if (registerTaken(await kvCommand(['HVALS', `jfp:att:${s.id}:${s.date}`]) || [])) continue
    const coach = coachById(config, s.coachId)
    if (!coach || isOwner(config, coach)) continue
    if (Number(await kvCommand(['HSETNX', REG_DONE, `${s.id}|${s.date}|${stage}`, new Date(now).toISOString()])) !== 1) continue
    if (stage === 2) await kvCommand(['HSETNX', REG_DONE, `${s.id}|${s.date}|1`, new Date(now).toISOString()])
    const g = asGroup(s)
    const w = registerWords({ config, coach, group: g, date: s.date, stage, today })
    const out = await tell({ coach, ...w, text: w.text.replace(' session (', ' extra session ('), kind: stage === 1 ? 'coach register' : 'coach register again' })
    sent += 1
    if (stage === 2) await telegramAlert(`Register still empty: Coach ${coach.name}, extra session ${shortGroup(config, g)}, ${dateLabel(s.date)}.`).catch(() => {})
    await audit({ by: 'coach alerts', action: 'coach.register', target: `${s.id}|${s.date}`, after: { coach: coach.id, stage, extra: true, emailed: out.emailed, texted: out.texted } })
  }
  return sent
}

// The five-minute check (Vercel cron). One at a time.
export async function coachTick(config, now = Date.now()) {
  if (!alertsOn(config, 'newPlayer') && !alertsOn(config, 'register')) return { off: true }
  if ((await kvCommand(['SET', 'jfp:coach-tick-lock', '1', 'NX', 'EX', '120'])) !== 'OK') return { busy: true }
  try {
    const news = await flushCoachNews({ config, now }).catch((e) => { console.error('jfp coach news failed', e); return { error: true } })
    const reg = await registerSweep({ config, now }).catch((e) => { console.error('jfp register sweep failed', e); return { error: true } })
    const extra = await flushExtraNews({ config }).catch((e) => { console.error('jfp extra news failed', e); return { error: true } })
    return { news, reg, extra }
  } finally { await kvCommand(['DEL', 'jfp:coach-tick-lock']) }
}

// For the Coaches page: what each coach would get, and whether a text can go.
export async function alertsStatus(config) {
  const route = await routeStatus()
  return {
    newPlayer: alertsOn(config, 'newPlayer'), register: alertsOn(config, 'register'), textsOn: Boolean(route.verified),
    coaches: config.coaches.filter((c) => !isOwner(config, c)).map((c) => ({ id: c.id, name: c.name, email: Boolean(c.email), mobile: Boolean(normalisePhone(c.phone)) })),
  }
}
