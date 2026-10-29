// Coach profiles (Lee, 20 Oct 2026): each coach fills in their own from My
// profile. Live straight away, no approval. Coaches, Lee and Ligia read them on
// Our coaches; families see their own coach's only while Lee has
// config.coachProfilesFamilies on (it was "no coach names for families"
// from 14 Oct until then). No private or compliance details live here.
import { kvCommand, clean, audit, coachById, coachLabel } from './_jfp-store.js'

export const KEY = 'jfp:coach-profiles'
export const ROLES = ['Head coach', 'Senior coach', 'Coach', 'Assistant coach', 'Goalkeeper coach']
export const AGES = ['Under 8s', '8 to 11', '12 to 14', '15 to 17', 'Adults']
// Same ids as the Session ideas topics.
export const SKILLS = [['speed', 'Speed and agility'], ['ball', 'Ball mastery'], ['dribble', 'Dribbling'], ['pass', 'Passing and first touch'], ['shoot', 'Shooting and finishing'], ['1v1', '1v1s and 2v2s'], ['defend', 'Defending'], ['head', 'Heading'], ['aware', 'Awareness and scanning'], ['gk', 'Goalkeeping']]
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const parse = (x) => { try { return JSON.parse(x) } catch { return null } }
const list = (v, max, fn) => (Array.isArray(v) ? v : []).slice(0, max).map(fn).filter(Boolean)

// Everything a coach can save, trimmed. Bad values drop out rather than fail.
export function cleanProfile(input = {}, { canSetRole = false, before = {} } = {}) {
  const joined = /^(19|20)\d\d-(0[1-9]|1[0-2])$/.test(String(input.joined || '')) && String(input.joined) <= new Date().toISOString().slice(0, 7) ? String(input.joined) : ''
  return {
    role: canSetRole ? (ROLES.includes(input.role) ? input.role : '') : (before.role || ''),
    joined,
    about: clean(input.about, 900),
    highest: clean(input.highest, 120),
    playing: list(input.playing, 10, (x) => { const club = clean(x?.club, 80); return club ? { club, level: clean(x?.level, 60), years: clean(x?.years, 30) } : null }),
    coaching: list(input.coaching, 10, (x) => { const club = clean(x?.club, 80); return club ? { club, team: clean(x?.team, 60), years: clean(x?.years, 30) } : null }),
    quals: list(input.quals, 12, (x) => { const name = clean(x?.name, 100); return name ? { name, year: /^(19|20)\d\d$/.test(String(x?.year || '')) ? String(x.year) : '' } : null }),
    skills: list(input.skills, 10, (x) => (SKILLS.some(([id]) => id === x) ? x : null)),
    ages: list(input.ages, 5, (x) => (AGES.includes(x) ? x : null)),
    languages: clean(input.languages, 120),
    favourite: clean(input.favourite, 120),
    leaveWith: clean(input.leaveWith, 240),
    // Links on the profile (Lee, 29 Oct 2026: his About page and Coaching Pros).
    links: list(input.links, 6, (x) => { const label = clean(x?.label, 60); const url = cleanUrl(x?.url); return label && url ? { label, url } : null }),
  }
}
// https only, or a page on this site ("/about").
function cleanUrl(v) {
  const u = clean(v, 300)
  if (/^\/[^/]/.test(u)) return u
  try { const x = new URL(u); return x.protocol === 'https:' ? x.href : '' } catch { return '' }
}

// "Since March 2021 · 5 years". Under a year: "Since March 2026".
export function sinceLabel(joined, now = new Date()) {
  if (!joined) return ''
  const [y, m] = joined.split('-').map(Number)
  const months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)
  const yrs = Math.floor(months / 12)
  return `Since ${MONTHS[m - 1]} ${y}${yrs >= 1 ? ` · ${yrs} year${yrs === 1 ? '' : 's'}` : ''}`
}

export async function getProfile(coachId) { return parse(await kvCommand(['HGET', KEY, coachId])) || {} }
export async function allProfiles() {
  const flat = (await kvCommand(['HGETALL', KEY])) || []
  const out = {}
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = parse(flat[i + 1]) || {}
  return out
}
// Finished enough for families to see (Lee, 29 Oct 2026: never a half-empty card).
export const forFamilies = (p) => String(p?.about || '').trim().length >= 80

// Our coaches for families: every coach with a finished profile, the head
// coach first, then by role, then longest at Joner Football.
export function familyCoaches(config, all, photoUrl) {
  const rank = (p) => { const i = ROLES.indexOf(p.role); return i < 0 ? ROLES.length : i }
  return config.coaches.filter((c) => forFamilies(all[c.id]))
    .map((c) => profileView(config, c, all[c.id], c.photoV ? photoUrl(c) : ''))
    .sort((a, b) => rank(a) - rank(b) || String(a.joined || '9999').localeCompare(String(b.joined || '9999')))
}

export function filled(p) { return Boolean(p && (p.about || p.joined || p.playing?.length || p.coaching?.length || p.quals?.length)) }

// What anyone allowed to see a profile gets. Never an email or phone.
export function profileView(config, c, p = {}, photoUrl = '') {
  return { id: c.id, name: coachLabel(c), firstName: c.name, photo: photoUrl, ...cleanProfile(p, { canSetRole: true }), since: sinceLabel(p.joined), filled: filled(p), updatedAt: p.updatedAt || '' }
}

export async function saveProfile({ config, principal, coachId, input, isAdmin }) {
  const c = coachById(config, coachId)
  if (!c) return { error: 'That coach is not on the list.' }
  const before = await getProfile(coachId)
  const next = { ...cleanProfile(input, { canSetRole: isAdmin, before }), updatedAt: new Date().toISOString(), updatedBy: principal.email }
  await kvCommand(['HSET', KEY, coachId, JSON.stringify(next)])
  await audit({ by: principal.email, action: 'coach.profile.save', target: coachId, after: { fields: Object.keys(next).filter((k) => next[k] && (!Array.isArray(next[k]) || next[k].length)) } })
  return { profile: next }
}
