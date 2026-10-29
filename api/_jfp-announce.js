// Announcements (Lee, 17 Oct 2026): one-way notices from Lee and Ligia that
// families read on Home in My account. Not a chat: families cannot reply, and
// nothing is emailed or texted from here. Stored in KV only (jfp:announce,
// one hash of id -> JSON), never Airtable.
//
// Audience: everyone, one location (its id) or one group (its id). Each notice
// shows from `from` (a Sydney date) until `until` (optional), newest first.
//
// Who it is from (Lee, 29 Oct 2026): Lee Jones, Joner Football or a coach,
// shown with a photo at the bottom of the card. Lee and Ligia post straight
// away; a coach's notice waits (status 'pending') until Lee or Ligia approves
// it, and a coach edit of a live notice goes back to waiting. Families only
// ever see live ones. Optional red button: words + a link.
import { kvCommand, clean, newId, sydneyToday, dateLabel, audit, locationFor } from './_jfp-store.js'

const KEY = 'jfp:announce'
// Read marks: one field per sign-in email, a JSON list of announcement ids.
const READ = 'jfp:announce-read'
const MAX_TITLE = 90
const MAX_BODY = 1200
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const ANNOUNCE_ACTIONS = new Set(['announceList', 'announceSave', 'announceDelete', 'announceDecide'])
// Coaches may use these too (their own notices only); announceDecide is Lee and Ligia.
export const ANNOUNCE_COACH_ACTIONS = new Set(['announceList', 'announceSave', 'announceDelete'])
// Records from before 29 Oct 2026 have no status: they are live.
export const isLive = (a) => !a.status || a.status === 'live'
const AUTHORS = ['lee', 'jf', 'coach']
const photoUrl = (c) => (c?.photoV ? `/api/jfp-groups?coachPhoto=${encodeURIComponent(c.id)}&v=${c.photoV}` : '')

// The button link: a web address or a page on this site. Our own site is kept
// as a path so the home screen app stays in the app.
export function cleanLink(v) {
  let t = String(v || '').trim().slice(0, 300)
  if (!t) return ''
  if (t.startsWith('/') && !t.startsWith('//')) return t
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`
  try {
    const u = new URL(t)
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null
    if (/(^|\.)jonerfootball\.com$/i.test(u.hostname)) return u.pathname + u.search + u.hash
    return u.href
  } catch { return null }
}

// Who signs a notice, as families see it: name, a short line and a photo.
export function authorView(config, a) {
  const coaches = config.coaches || []
  const t = a.author?.type
  if (t === 'coach') {
    const c = coaches.find((x) => x.id === a.author.coachId)
    if (c) return { kind: 'coach', name: c.fullName || c.name, line: 'Coach, Joner Football', photo: photoUrl(c) }
  }
  if (t === 'lee') return { kind: 'lee', name: 'Lee Jones', line: 'Founder, Joner Football', photo: photoUrl(coaches.find((x) => x.id === 'lee')) }
  return { kind: 'jf', name: 'Joner Football', line: '', photo: '' }
}

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
  const atype = AUTHORS.includes(input.author?.type) ? input.author.type : 'jf'
  const author = atype === 'coach' ? { type: 'coach', coachId: clean(input.author?.coachId, 30) } : { type: atype }
  if (atype === 'coach' && !author.coachId) return { error: 'Choose the coach it is from.' }
  const label = clean(input.button?.label, 40).trim()
  const url = cleanLink(input.button?.url)
  if (url === null) return { error: 'That button link does not look right. Paste the full web address.' }
  if (label && !url) return { error: 'Add the link for the button.' }
  if (url && !label) return { error: 'Add the words on the button.' }
  const button = label ? { label, url } : null
  return { value: { ...existing, title, body, audience: { type, id }, from, until, pinned: input.pinned === true, author, button } }
}

// Who a notice is for, in words (the staff list).
function audienceLabel(config, a) {
  if (a.audience?.type === 'location') return (config.locations || []).find((l) => l.id === a.audience.id)?.name || 'One location'
  if (a.audience?.type === 'group') return a.audience.label || 'One group'
  return 'Every family'
}

// What one family sees: live notices for everyone, their locations or their
// groups. Only the words, the date and who it is for; never staff emails.
export async function announcementsFor({ groupIds = [], locationIds = [], email = '', config = {} } = {}, today = sydneyToday()) {
  let all = [], read = new Set()
  try { all = await allAnnouncements() } catch (error) { console.error('jfp announce read failed', error); return [] }
  if (email) try { read = new Set(await readIds(email)) } catch (error) { console.error('jfp announce read marks failed', error) }
  const g = new Set(groupIds.filter(Boolean)), l = new Set(locationIds.filter(Boolean))
  return all.filter((a) => isLive(a) && a.from <= today && (!a.until || a.until >= today))
    .filter((a) => a.audience?.type === 'all' || (a.audience?.type === 'location' && l.has(a.audience.id)) || (a.audience?.type === 'group' && g.has(a.audience.id)))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    .slice(0, 10)
    .map((a) => ({ id: a.id, title: a.title, body: a.body, dateLabel: dateLabel(a.from), from: a.from, pinned: Boolean(a.pinned), read: read.has(a.id), forLabel: a.audience?.type === 'all' ? '' : a.audience.label || '', author: authorView(config, a), button: a.button || null }))
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

// Staff portal actions. Lee and Ligia see and change everything and post
// straight away. A coach sees only their own notices, always signed by them,
// and each save waits for Lee or Ligia (announceDecide) before families see it.
export async function announceAction(req, res, principal, config, body, action, groups = []) {
  const ok = (x) => res.status(200).json({ success: true, ...x })
  const no = (status, error) => res.status(status).json({ success: false, error })
  const admin = principal.role === 'admin'
  const me = principal.coachId || (config.coaches || []).find((c) => c.email && c.email === principal.email)?.id || ''
  if (!admin && !me) return no(403, 'Not allowed.')
  const mine = (a) => admin || (a.author?.type === 'coach' && a.author.coachId === me) || a.by === principal.email
  const list = async () => {
    const today = sydneyToday()
    return (await allAnnouncements()).filter(mine)
      .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'))
      .map((a) => ({ ...a, status: a.status || 'live', audienceLabel: audienceLabel(config, a), live: isLive(a) && a.from <= today && (!a.until || a.until >= today), fromLabel: dateLabel(a.from), untilLabel: a.until ? dateLabel(a.until) : '', authorView: authorView(config, a) }))
  }
  const options = {
    locations: (config.locations || []).map((l) => ({ id: l.id, name: l.name })),
    groups: groups.map((g) => ({ id: g.id, label: `${g.day} ${g.time}, ${locationFor(config, g.location).name}` })),
    coaches: admin ? (config.coaches || []).filter((c) => c.id !== 'lee').map((c) => ({ id: c.id, name: c.fullName || c.name })) : [],
    me: admin ? '' : (config.coaches || []).find((c) => c.id === me)?.fullName || (config.coaches || []).find((c) => c.id === me)?.name || '',
    admin,
  }
  const out = async (x = {}) => ok({ ...x, announcements: await list(), options })
  if (action === 'announceList') return out()
  if (action === 'announceDelete') {
    const id = clean(body.id, 40)
    const was = parse(await kvCommand(['HGET', KEY, id]))
    if (!was || !mine(was)) return no(404, 'That announcement is already gone.')
    await kvCommand(['HDEL', KEY, id])
    await audit({ by: principal.email, action: 'announce.delete', target: id, before: { title: was.title } })
    return out()
  }
  if (action === 'announceDecide') {
    if (!admin || principal.via === 'hermes') return no(403, 'Only Lee or Ligia can approve announcements.')
    const id = clean(body.id, 40)
    const was = parse(await kvCommand(['HGET', KEY, id]))
    if (!was) return no(404, 'That announcement is gone. Refresh the page.')
    if (was.status !== 'pending') return no(409, 'That announcement has already been decided.')
    const yes = body.decision === 'approve'
    const now = new Date().toISOString()
    const rec = { ...was, status: yes ? 'live' : 'declined', decidedBy: principal.email, decidedAt: now, declineNote: yes ? '' : clean(body.note, 300) }
    await kvCommand(['HSET', KEY, id, JSON.stringify(rec)])
    await audit({ by: principal.email, action: yes ? 'announce.approve' : 'announce.decline', target: id, after: { title: rec.title, note: rec.declineNote || undefined } })
    // Approved and showing today: phones with notifications on get it now.
    if (yes) try { const { pushAnnouncement } = await import('./_jfp-push.js'); await pushAnnouncement(rec) } catch (error) { console.error('jfp announce push failed', error) }
    return out({ announcement: rec })
  }
  if (action === 'announceSave') {
    const id = clean(body.id, 40)
    const was = id ? parse(await kvCommand(['HGET', KEY, id])) : null
    if (id && (!was || !mine(was))) return no(404, 'That announcement is gone. Refresh the page.')
    // A coach's notice is always signed by that coach.
    const c = cleanAnnouncement(admin ? body : { ...body, author: { type: 'coach', coachId: me } }, was || {})
    if (c.error) return no(400, c.error)
    const a = c.value
    if (a.author.type === 'coach' && !(config.coaches || []).some((x) => x.id === a.author.coachId)) return no(400, 'That coach is not set up.')
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
    // Lee and Ligia: new = live, an edit keeps where it was. A coach: always waits.
    a.status = admin ? (was ? was.status || 'live' : 'live') : 'pending'
    const now = new Date().toISOString()
    const rec = was ? { ...a, updatedAt: now, updatedBy: principal.email } : { ...a, id: newId('ANN'), createdAt: now, by: principal.email }
    await kvCommand(['HSET', KEY, rec.id, JSON.stringify(rec)])
    await audit({ by: principal.email, action: was ? 'announce.edit' : 'announce.add', target: rec.id, after: { title: rec.title, audience: rec.audience, from: rec.from, until: rec.until, status: rec.status } })
    if (!admin && (!was || was.status !== 'pending')) {
      // Lee and Ligia hear about a coach's notice straight away (Telegram, never blocks the save).
      try { const { telegramAlert } = await import('./_jfp-notify.js'); await telegramAlert(`📣 ${authorView(config, rec).name} wants to post an announcement: "${rec.title}". Approve it in the portal, Announcements.`) } catch (error) { console.error('jfp announce alert failed', error) }
    }
    // A new live notice that shows today goes to phones with notifications on (never blocks the save).
    if (!was && rec.status === 'live') try { const { pushAnnouncement } = await import('./_jfp-push.js'); await pushAnnouncement(rec) } catch (error) { console.error('jfp announce push failed', error) }
    return out({ announcement: rec })
  }
  return no(400, 'Unknown action.')
}
