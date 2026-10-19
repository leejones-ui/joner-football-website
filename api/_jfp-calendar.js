// Calendar feed (Lee, 17 Oct 2026): one private link per sign-in email that
// a phone calendar subscribes to and keeps up to date. The link holds a
// random token, never the email. KV: jfp:cal-token (token -> email) and
// jfp:cal-email (email -> token). Read only: it only lists sessions.
import crypto from 'node:crypto'
import { kvCommand, getConfig, listGroups, locationFor, clean } from './_jfp-store.js'
import { loadRoster, familyFor } from './_jfp-airtable.js'
import { listCancels, rowSessionDates, rowTime, noticeFor } from './_jfp-cancel.js'
import { sessionOffMap } from './_jfp-makeups.js'

const BY_TOKEN = 'jfp:cal-token', BY_EMAIL = 'jfp:cal-email'

export async function calendarToken(email) {
  const e = String(email || '').toLowerCase()
  const have = await kvCommand(['HGET', BY_EMAIL, e])
  if (have) return have
  const t = crypto.randomBytes(18).toString('base64url')
  if (Number(await kvCommand(['HSETNX', BY_EMAIL, e, t])) !== 1) return kvCommand(['HGET', BY_EMAIL, e])
  await kvCommand(['HSET', BY_TOKEN, t, e])
  return t
}
export async function emailForToken(token) {
  const t = clean(token, 60)
  return t ? (await kvCommand(['HGET', BY_TOKEN, t])) || '' : ''
}

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
// Lines over 75 octets are folded, as the format asks.
const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}` } out.push(s); return out.join('\r\n') }
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'JFP'

// Events for one family. Pure (unit tested): rows carry player names.
export function calendarEvents({ config, players, byGroup, cancels = [], nowMs = Date.now(), offMap = new Map() }) {
  const told = new Set(cancels.filter((c) => c.status === 'active').map((c) => `${c.rowId}|${c.date}`))
  const out = []
  for (const p of players) {
    for (const r of p.term4.filter((x) => x.holdsPlace && x.groupId)) {
      const g = byGroup[r.groupId] || null
      const loc = locationFor(config, r.location)
      const time = rowTime(r, g)
      const mins = Number(g?.durationMin) || 60
      for (const d of rowSessionDates(config, r, g)) {
        if (offMap.has(`${r.groupId}|${d}`)) continue // cancelled for an emergency
        const n = noticeFor({ date: d, time, nowMs })
        if (!n) continue
        const off = told.has(`${r.id}|${d}`)
        out.push({ uid: `${r.id}-${d}@jonerfootball.com`, startMs: n.startMs, endMs: n.startMs + mins * 60000, title: `${off ? 'Not going: ' : ''}${firstName(p.name)} JFP session`, location: [loc.name, loc.address].filter((x, i, a) => x && a.indexOf(x) === i).join(', '), cancelled: off })
      }
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs)
}

export function icsText(events, nowMs = Date.now()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Joner Football//My JFP//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:JFP sessions', 'X-WR-TIMEZONE:Australia/Sydney', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H']
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(nowMs)}`, `DTSTART:${stamp(e.startMs)}`, `DTEND:${stamp(e.endMs)}`, fold(`SUMMARY:${esc(e.title)}`), ...(e.location ? [fold(`LOCATION:${esc(e.location)}`)] : []), `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

export async function familyCalendar(email) {
  const config = await getConfig()
  const [roster, groups, cancels] = await Promise.all([loadRoster(), listGroups(), listCancels()])
  // A player's own login (12+): only their own sessions, from the family's rows.
  const { playerLoginOf } = await import('./_jfp-player-logins.js')
  const login = await playerLoginOf(email)
  const famEmail = login ? login.parentEmail : email
  const fam = familyFor(famEmail, roster, config.termStart)
  const players = login ? fam.players.filter((p) => p.key === login.playerKey) : fam.players
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, g]))
  return icsText(calendarEvents({ config, players, byGroup, cancels: cancels.filter((c) => c.email === famEmail), offMap: await sessionOffMap() }))
}
