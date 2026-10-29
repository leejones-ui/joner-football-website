// Coach profiles (Lee, 20 Oct 2026): each coach fills in their own from My
// profile. Live straight away, no approval. Coaches, Lee and Ligia read them on
// Our coaches; families see their own coach's only while Lee has
// config.coachProfilesFamilies on (it was "no coach names for families"
// from 14 Oct until then). No private or compliance details live here.
import { kvCommand, kvSetJson, clean, audit, coachById, coachLabel, DAYS, locationFor } from './_jfp-store.js'

export const KEY = 'jfp:coach-profiles'
export const GALLERY_MAX = 8
export const galleryKey = (coachId, v) => `jfp:coach-gallery:${coachId}:${v}`
export const galleryUrl = (coachId, v) => `/api/jfp-groups?coachGallery=${encodeURIComponent(coachId)}&g=${v}`
export const ROLES = ['Head coach', 'Senior coach', 'Coach', 'Assistant coach', 'Goalkeeper coach']
export const AGES = ['Under 8s', '8 to 11', '12 to 14', '15 to 17', 'Adults']
// Same ids as the Session ideas topics.
export const SKILLS = [['speed', 'Speed and agility'], ['ball', 'Ball mastery'], ['dribble', 'Dribbling'], ['pass', 'Passing and first touch'], ['shoot', 'Shooting and finishing'], ['1v1', '1v1s and 2v2s'], ['defend', 'Defending'], ['head', 'Heading'], ['aware', 'Awareness and scanning'], ['gk', 'Goalkeeping']]
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const parse = (x) => { try { return JSON.parse(x) } catch { return null } }
// Paragraphs kept (Lee, 29 Oct 2026: the about read as one block).
const para = (v, max) => String(v ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
const list = (v, max, fn) => (Array.isArray(v) ? v : []).slice(0, max).map(fn).filter(Boolean)

// Everything a coach can save, trimmed. Bad values drop out rather than fail.
export function cleanProfile(input = {}, { canSetRole = false, before = {} } = {}) {
  const joined = /^(19|20)\d\d-(0[1-9]|1[0-2])$/.test(String(input.joined || '')) && String(input.joined) <= new Date().toISOString().slice(0, 7) ? String(input.joined) : ''
  return {
    role: canSetRole ? (ROLES.includes(input.role) ? input.role : '') : (before.role || ''),
    joined,
    about: para(input.about, 1600),
    highest: clean(input.highest, 120),
    playing: list(input.playing, 10, (x) => { const club = clean(x?.club, 80); return club ? { club, level: clean(x?.level, 60), years: clean(x?.years, 30) } : null }),
    coaching: list(input.coaching, 10, (x) => { const club = clean(x?.club, 80); return club ? { club, team: clean(x?.team, 60), years: clean(x?.years, 30) } : null }),
    quals: list(input.quals, 12, (x) => { const name = clean(x?.name, 100); return name ? { name, year: /^(19|20)\d\d$/.test(String(x?.year || '')) ? String(x.year) : '' } : null }),
    skills: list(input.skills, 10, (x) => (SKILLS.some(([id]) => id === x) ? x : null)),
    ages: list(input.ages, 5, (x) => (AGES.includes(x) ? x : null)),
    languages: clean(input.languages, 120),
    favourite: clean(input.favourite, 120),
    leaveWith: para(input.leaveWith, 600),
    // Off the pitch (Lee, 29 Oct 2026: "people love this").
    hobbies: para(input.hobbies, 300),
    funFact: para(input.funFact, 300),
    favTeam: clean(input.favTeam, 120),
    favPlayers: clean(input.favPlayers, 200),
    // A favourite drill, linked to it in the JF App (Lee, 29 Oct 2026).
    drill: (() => { const name = clean(input.drill?.name, 80); return name ? { name, url: cleanUrl(input.drill?.url) } : null })(),
    // Coaching photos (up to 8): uploaded one at a time by coachGalleryPhoto, never by the form.
    gallery: list(input.gallery, GALLERY_MAX, (x) => (Number.isInteger(Number(x?.v)) && Number(x.v) > 0 ? { v: Number(x.v), caption: clean(x?.caption, 80) } : null)),
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
// coachesOn: where and when each coach runs a group, by venue ("Belrose HQ: Mon, Tue").
export function coachesOn(config, groups, coachId) {
  const by = new Map()
  for (const g of (groups || []).filter((g) => g.coachId === coachId || (g.extraCoachIds || []).includes(coachId))) {
    const v = locationFor(config, g.location).name || g.location
    if (!by.has(v)) by.set(v, new Set())
    by.get(v).add(g.day)
  }
  return [...by].map(([v, days]) => `${v}: ${[...days].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)).map((d) => String(d).slice(0, 3)).join(', ')}`)
}
export function familyCoaches(config, all, photoUrl, groups = []) {
  const rank = (p) => { const i = ROLES.indexOf(p.role); return i < 0 ? ROLES.length : i }
  return config.coaches.filter((c) => forFamilies(all[c.id]))
    .map((c) => ({ ...profileView(config, c, all[c.id], c.photoV ? photoUrl(c) : ''), coachesOn: coachesOn(config, groups, c.id) }))
    .sort((a, b) => rank(a) - rank(b) || String(a.joined || '9999').localeCompare(String(b.joined || '9999')))
}

export function filled(p) { return Boolean(p && (p.about || p.joined || p.playing?.length || p.coaching?.length || p.quals?.length)) }

// What anyone allowed to see a profile gets. Never an email or phone.
export function profileView(config, c, p = {}, photoUrl = '') {
  const v = cleanProfile(p, { canSetRole: true })
  return { id: c.id, name: coachLabel(c), firstName: c.name, photo: photoUrl, ...v, gallery: v.gallery.map((g) => ({ ...g, url: galleryUrl(c.id, g.v) })), since: sinceLabel(p.joined), filled: filled(p), updatedAt: p.updatedAt || '' }
}

export async function saveProfile({ config, principal, coachId, input, isAdmin }) {
  const c = coachById(config, coachId)
  if (!c) return { error: 'That coach is not on the list.' }
  const before = await getProfile(coachId)
  const next = { ...cleanProfile({ ...input, gallery: before.gallery }, { canSetRole: isAdmin, before }), updatedAt: new Date().toISOString(), updatedBy: principal.email }
  await kvCommand(['HSET', KEY, coachId, JSON.stringify(next)])
  await audit({ by: principal.email, action: 'coach.profile.save', target: coachId, after: { fields: Object.keys(next).filter((k) => next[k] && (!Array.isArray(next[k]) || next[k].length)) } })
  return { profile: next }
}

// One coaching photo in or out (resized in the browser to at most 1400px).
// Stored in KV like the profile photo, served with a versioned, immutable URL.
export async function galleryPhoto({ principal, coachId, body }) {
  const before = await getProfile(coachId)
  let gallery = cleanProfile(before).gallery
  if (body.remove) {
    const v = Number(body.remove)
    gallery = gallery.filter((g) => g.v !== v)
    await kvCommand(['DEL', galleryKey(coachId, v)])
  } else if (body.caption != null && body.v) {
    gallery = gallery.map((g) => (g.v === Number(body.v) ? { ...g, caption: clean(body.caption, 80) } : g))
  } else {
    if (gallery.length >= GALLERY_MAX) return { error: `Up to ${GALLERY_MAX} photos. Remove one first.` }
    const m = String(body.dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
    if (!m) return { error: 'Choose a JPG, PNG or WebP photo.' }
    if (m[2].length > 900000) return { error: 'That photo is too big. Try a smaller one.' }
    const v = Date.now()
    await kvSetJson(galleryKey(coachId, v), { type: m[1], b64: m[2], by: principal.email, at: new Date().toISOString() })
    gallery = [...gallery, { v, caption: clean(body.newCaption, 80) }]
  }
  const next = { ...before, gallery, updatedAt: new Date().toISOString(), updatedBy: principal.email }
  await kvCommand(['HSET', KEY, coachId, JSON.stringify(next)])
  await audit({ by: principal.email, action: body.remove ? 'coach.gallery.remove' : 'coach.gallery', target: coachId })
  return { profile: next }
}
