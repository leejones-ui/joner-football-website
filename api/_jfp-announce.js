// Announcements (Lee, 17 Oct 2026): one-way notices from Lee and Ligia that
// families read on Home in My account. Not a chat: families cannot reply, and
// nothing is emailed or texted from here. Stored in KV only (jfp:announce,
// one hash of id -> JSON), never Airtable.
//
// Audience: everyone, one location (its id) or one group (its id). Each notice
// shows from `from` (a Sydney date) until `until` (optional), newest first.
import { kvCommand, clean, newId, sydneyToday, dateLabel, audit, locationFor } from './_jfp-store.js'

const KEY = 'jfp:announce'
// Read marks: one field per sign-in email, a JSON list of announcement ids.
const READ = 'jfp:announce-read'
const MAX_TITLE = 90
const MAX_BODY = 1200
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const ANNOUNCE_ACTIONS = new Set(['announceList', 'announceSave', 'announceDelete'])

const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

export async function allAnnouncements() {
  const raw = (await kvCommand(['HGETALL', KEY])) || []
  const out = []
  if (Array.isArray(raw)) { for (let i = 1; i < raw.length; i += 2) { const a = parse(raw[i]); if (a) out.push(a) } }
  else for (const v of Object.values(raw)) { const a = parse(v); if (a) out.push(a) }
  return out.sort((a, b) => String(b.from || '').localeCompare(String(a.from || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

export function cleanAnnouncement(input = {}, existing = {}) {
  const title = clean(input.title, MAX_TITLE).trim()
  const body = String(input.body || '').replace(/\r\n/g, '\n').slice(0, MAX_BODY).trim()
  if (title.length < 3) return { error: 'Add a short title.' }
  if (body.length < 3) return { error: 'Add the message.' }
  const type = ['all', 'location', 'group'].includes(input.audience?.type) ? input.audience.type : 'all'
  const id = type === 'all' ? '' : clean(input.audience?.id, 80)
  if (type !== 'all' && !id) return { error: type === 'location' ? 'Choose the location.' : 'Choose the group.' }
  const from = ISO.test(input.from || '') ? input.from : sydneyToday()
  const until = ISO.test(input.until || '') ? input.until : ''
  if (until && until < from) return { error: 'The end date is before the start date.' }
  return { value: { ...existing, title, body, audience: { type, id }, from, until, pinned: input.pinned === true } }
}

// Who a notice is for, in words (the staff list).
function audienceLabel(config, a) {
  if (a.audience?.type === 'location') return (config.locations || []).find((l) => l.id === a.audience.id)?.name || 'One location'
  if (a.audience?.type === 'group') return a.audience.label || 'One group'
  return 'Every family'
}

// What one family sees: live notices for everyone, their locations or their
// groups. Only the words, the date and who it is for; never staff emails.
export async function announcementsFor({ groupIds = [], locationIds = [], email = '' } = {}, today = sydneyToday()) {
  let all = [], read = new Set()
  try { all = await allAnnouncements() } catch (error) { console.error('jfp announce read failed', error); return [] }
  if (email) try { read = new Set(await readIds(email)) } catch (error) { console.error('jfp announce read marks failed', error) }
  const g = new Set(groupIds.filter(Boolean)), l = new Set(locationIds.filter(Boolean))
  return all.filter((a) => a.from <= today && (!a.until || a.until >= today))
    .filter((a) => a.audience?.type === 'all' || (a.audience?.type === 'location' && l.has(a.audience.id)) || (a.audience?.type === 'group' && g.has(a.audience.id)))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    .slice(0, 10)
    .map((a) => ({ id: a.id, title: a.title, body: a.body, dateLabel: dateLabel(a.from), from: a.from, pinned: Boolean(a.pinned), read: read.has(a.id), forLabel: a.audience?.type === 'all' ? '' : a.audience.label || '' }))
}

async function readIds(email) {
  const v = parse(await kvCommand(['HGET', READ, String(email).toLowerCase()]))
  return Array.isArray(v) ? v : []
}
// A family opened Announcements: these ids are read for that sign-in email.
// Only real announcement ids are kept, newest 200.
export async function markAnnouncementsRead(email, ids = []) {
  const want = new Set((Array.isArray(ids) ? ids : []).map((x) => clean(x, 40)).filter(Boolean))
  if (!email || !want.size) return readIds(email)
  const live = new Set((await allAnnouncements()).map((a) => a.id))
  const next = [...new Set([...(await readIds(email)), ...[...want].filter((x) => live.has(x))])].filter((x) => live.has(x)).slice(-200)
  await kvCommand(['HSET', READ, String(email).toLowerCase(), JSON.stringify(next)])
  return next
}

// Staff portal actions, Lee and Ligia only (checked by the caller).
export async function announceAction(req, res, principal, config, body, action, groups = []) {
  const ok = (x) => res.status(200).json({ success: true, ...x })
  const no = (status, error) => res.status(status).json({ success: false, error })
  const list = async () => {
    const today = sydneyToday()
    return (await allAnnouncements()).map((a) => ({ ...a, audienceLabel: audienceLabel(config, a), live: a.from <= today && (!a.until || a.until >= today), fromLabel: dateLabel(a.from), untilLabel: a.until ? dateLabel(a.until) : '' }))
  }
  const options = {
    locations: (config.locations || []).map((l) => ({ id: l.id, name: l.name })),
    groups: groups.map((g) => ({ id: g.id, label: `${g.day} ${g.time}, ${locationFor(config, g.location).name}` })),
  }
  if (action === 'announceList') return ok({ announcements: await list(), options })
  if (action === 'announceDelete') {
    const id = clean(body.id, 40)
    const was = parse(await kvCommand(['HGET', KEY, id]))
    if (!was) return no(404, 'That announcement is already gone.')
    await kvCommand(['HDEL', KEY, id])
    await audit({ by: principal.email, action: 'announce.delete', target: id, before: { title: was.title } })
    return ok({ announcements: await list(), options })
  }
  if (action === 'announceSave') {
    const id = clean(body.id, 40)
    const was = id ? parse(await kvCommand(['HGET', KEY, id])) : null
    if (id && !was) return no(404, 'That announcement is gone. Refresh the page.')
    const c = cleanAnnouncement(body, was || {})
    if (c.error) return no(400, c.error)
    const a = c.value
    // A group notice keeps the group's words, so families see "Tuesday 4:20pm, Belrose HQ".
    if (a.audience.type === 'group') {
      const g = options.groups.find((x) => x.id === a.audience.id)
      if (!g) return no(400, 'That group is not on the timetable.')
      a.audience.label = g.label
    } else if (a.audience.type === 'location') {
      const l = options.locations.find((x) => x.id === a.audience.id)
      if (!l) return no(400, 'That location is not set up.')
      a.audience.label = l.name
    }
    const now = new Date().toISOString()
    const rec = was ? { ...a, updatedAt: now, updatedBy: principal.email } : { ...a, id: newId('ANN'), createdAt: now, by: principal.email }
    await kvCommand(['HSET', KEY, rec.id, JSON.stringify(rec)])
    await audit({ by: principal.email, action: was ? 'announce.edit' : 'announce.add', target: rec.id, after: { title: rec.title, audience: rec.audience, from: rec.from, until: rec.until } })
    return ok({ announcement: rec, announcements: await list(), options })
  }
  return no(400, 'Unknown action.')
}
