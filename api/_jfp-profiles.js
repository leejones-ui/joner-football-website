// Player information (Lee, 13 Oct 2026): club, team, level, positions, foot,
// contacts, emergency contact, medical notes and goals. One row per player in
// the Airtable table "JFP Player Profiles", kept across terms.
//
// Families edit their own players in My account ("Player information"); Lee
// and Ligia edit anyone on the Players tab. Both write the same row, so a
// club change made by a parent shows on the Players tab at once.
//
// Children's details stay in Airtable: nothing in this file is cached in KV,
// and the audit log records which fields changed, never their values.
import { airtable, fq, uploadAttachment } from './_jfp-airtable.js'
import { normName, clean, validEmail, audit, sydneyToday } from './_jfp-store.js'

export const PROFILES_TABLE = process.env.JFP_PROFILES_TABLE || 'tblTt7jWK3s2me45B'

export const LEVELS = ['A-League academy', 'NPL', 'Youth league (BYL or GYL)', 'JDL (was SAP)', 'Club Division 1', 'Club Division 2', 'Club Division 3 or lower', 'School or social only', 'Not playing club football']
export const PLAYING_UP = ['Own age', 'Playing up', 'Playing down']
export const POSITIONS = ['Goalkeeper', 'Centre back', 'Full back', 'Defensive midfield', 'Central midfield', 'Attacking midfield', 'Winger', 'Striker']
export const FEET = ['Right', 'Left', 'Both']
export const YEARS = ['Under 1 year', '1 to 2 years', '3 to 4 years', '5 or more years']

// The editable values and their Airtable columns.
const FIELD = {
  dob: 'Date of Birth', club: 'Club', team: 'Team', level: 'Level', playingUp: 'Playing Up', positions: 'Positions', foot: 'Preferred Foot',
  association: 'Association', previousClubs: 'Previous Clubs', yearsPlaying: 'Years Playing', repTeam: 'Rep or Academy', otherTraining: 'Other Training',
  parentName: 'Parent Name', parentMobile: 'Parent Mobile', parent2Name: 'Second Parent Name', parent2Email: 'Second Parent Email', parent2Mobile: 'Second Parent Mobile',
  emergencyName: 'Emergency Contact Name', emergencyPhone: 'Emergency Contact Phone', emergencyRelation: 'Emergency Contact Relationship',
  medical: 'Medical Notes', goals: 'Player Goals',
}
export const PROFILE_KEYS = Object.keys(FIELD)
// What the Players tab list shows and filters on. No contacts, no medical.
export const SUMMARY_KEYS = ['dob', 'club', 'team', 'level', 'playingUp', 'positions', 'foot', 'association', 'yearsPlaying', 'repTeam']

export const profileKey = (name, email) => `${normName(name)}|${String(email || '').trim().toLowerCase()}`
const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean)

export function fromRecord(r) {
  const f = r.fields || {}
  const out = { id: r.id, name: f['Player Name'] || '', key: f['Player Key'] || '', emails: list(f['Family Emails']).map((e) => e.toLowerCase()), rowIds: list(f['Term 4 Record IDs']) }
  for (const [k, col] of Object.entries(FIELD)) out[k] = k === 'positions' ? (Array.isArray(f[col]) ? f[col] : list(f[col])) : (f[col] ?? '')
  // Airtable's own link, good for a couple of hours: read fresh on every load.
  const ph = Array.isArray(f.Photo) ? f.Photo[0] : null
  out.photo = ph ? (ph.thumbnails?.large?.url || ph.url || '') : ''
  out.updatedAt = f['Updated At'] || ''
  out.updatedBy = f['Updated By'] || ''
  out.updatedFrom = f['Updated From'] || ''
  return out
}

const phoneOk = (v) => !v || String(v).replace(/\D/g, '').length >= 8
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const DOB_MIN = '1940-01-01'
export const dobMax = () => `${Number(sydneyToday().slice(0, 4)) - 2}${sydneyToday().slice(4)}`

// Checks and tidies what a family or staff member typed. Only keys that were
// sent are returned, so a form can save one section without clearing others.
export function cleanProfile(input = {}) {
  const v = {}
  const errors = []
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k)
  for (const k of ['club', 'team', 'parentName', 'parent2Name', 'emergencyName', 'emergencyRelation', 'association', 'previousClubs', 'repTeam', 'otherTraining']) if (has(k)) v[k] = clean(input[k], 120)
  for (const k of ['medical', 'goals']) if (has(k)) v[k] = String(input[k] ?? '').replace(/\r/g, '').trim().slice(0, 1000)
  for (const k of ['parentMobile', 'parent2Mobile', 'emergencyPhone']) {
    if (!has(k)) continue
    v[k] = clean(input[k], 30)
    if (!phoneOk(v[k])) errors.push('Check the phone numbers: they look too short.')
  }
  if (has('parent2Email')) {
    const e = String(input.parent2Email || '').trim()
    v.parent2Email = e ? validEmail(e) : ''
    if (e && !v.parent2Email) errors.push('That second parent email does not look right.')
  }
  if (has('dob')) {
    const d = String(input.dob || '')
    // Children and adults (Pros, parents who train): born 1940 up to 2 years ago.
    if (d && (!ISO.test(d) || d < DOB_MIN || d > dobMax())) errors.push('Check the date of birth.')
    else v.dob = d
  }
  if (has('level')) v.level = LEVELS.includes(input.level) ? input.level : ''
  if (has('playingUp')) v.playingUp = PLAYING_UP.includes(input.playingUp) ? input.playingUp : ''
  if (has('foot')) v.foot = FEET.includes(input.foot) ? input.foot : ''
  if (has('yearsPlaying')) v.yearsPlaying = YEARS.includes(input.yearsPlaying) ? input.yearsPlaying : ''
  if (has('positions')) v.positions = [...new Set((Array.isArray(input.positions) ? input.positions : []).filter((x) => POSITIONS.includes(x)))]
  return { values: v, errors: [...new Set(errors)] }
}

// A family's profiles: rows whose Family Emails holds this exact address.
export async function familyProfiles(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!e) return []
  const q = new URLSearchParams({ filterByFormula: `FIND("${fq(e)}", {Family Emails})`, pageSize: '100' })
  const d = await airtable(`${PROFILES_TABLE}?${q}`)
  return (d.records || []).map(fromRecord).filter((p) => p.emails.includes(e))
}

// Every profile, for the Players tab (staff only).
export async function allProfiles() {
  const out = []
  let offset = ''
  do {
    const q = new URLSearchParams({ pageSize: '100', ...(offset ? { offset } : {}) })
    const d = await airtable(`${PROFILES_TABLE}?${q}`)
    // A copy folded into a family's player (Second parent added) stays in Airtable but out of every list.
    out.push(...(d.records || []).map(fromRecord).filter((p) => !String(p.updatedFrom || '').startsWith('Joined into ')))
    offset = d.offset || ''
  } while (offset)
  return out
}

// The profile for one player: by key, else by one of their Term 4 rows.
export function pickProfile(profiles, { key, rowIds = [] }) {
  return profiles.find((p) => p.key === key) || profiles.find((p) => p.rowIds.some((id) => rowIds.includes(id))) || null
}
export async function findProfile({ key, rowIds = [] }) {
  const q = new URLSearchParams({ filterByFormula: `FIND("${fq(key)}", {Player Key})`, pageSize: '10' })
  const byKey = ((await airtable(`${PROFILES_TABLE}?${q}`)).records || []).map(fromRecord).find((p) => p.key === key)
  if (byKey) return byKey
  for (const id of rowIds) {
    const r = new URLSearchParams({ filterByFormula: `FIND("${fq(id)}", {Term 4 Record IDs})`, pageSize: '10' })
    const hit = ((await airtable(`${PROFILES_TABLE}?${r}`)).records || []).map(fromRecord).find((p) => p.rowIds.includes(id))
    if (hit) return hit
  }
  return null
}

// Create or update a player's profile. Returns the saved profile.
export async function saveProfile({ existing, name, key, emails, rowIds, values, by, from }) {
  const fields = {
    'Player Name': clean(name, 100),
    'Player Key': key,
    'Family Emails': [...new Set([...(existing?.emails || []), ...emails.map((e) => String(e || '').trim().toLowerCase())].filter(Boolean))].join(', '),
    'Term 4 Record IDs': [...new Set([...(existing?.rowIds || []), ...rowIds].filter(Boolean))].join(', '),
    'Updated At': new Date().toISOString(),
    'Updated By': clean(by, 100),
    'Updated From': from,
  }
  for (const [k, val] of Object.entries(values)) {
    if (k === 'dob') fields[FIELD.dob] = val || null
    else if (k === 'positions') fields[FIELD.positions] = val
    else if (['level', 'playingUp', 'foot', 'yearsPlaying'].includes(k)) fields[FIELD[k]] = val || null
    else fields[FIELD[k]] = val
  }
  const body = { typecast: true, records: [existing ? { id: existing.id, fields } : { fields }] }
  const d = await airtable(PROFILES_TABLE, { method: existing ? 'PATCH' : 'POST', body })
  const saved = fromRecord(d.records[0])
  const changed = Object.keys(values).filter((k) => JSON.stringify(values[k] ?? '') !== JSON.stringify(existing?.[k] ?? (k === 'positions' ? [] : '')))
  await audit({ by, action: 'profile.save', target: key, after: { from, fields: changed } })
  return saved
}

// Only what the browser needs: the values, and who changed them last.
export function profileView(p) {
  if (!p) return null
  const out = {}
  for (const k of PROFILE_KEYS) out[k] = p[k] ?? (k === 'positions' ? [] : '')
  return { ...out, photo: p.photo || '', updatedAt: p.updatedAt, updatedBy: p.updatedFrom === 'Family account' ? 'the family' : p.updatedBy, updatedFrom: p.updatedFrom }
}
export function profileSummary(p) {
  if (!p) return null
  const out = {}
  for (const k of SUMMARY_KEYS) out[k] = p[k] ?? (k === 'positions' ? [] : '')
  return { ...out, photo: p.photo || '', updatedAt: p.updatedAt, updatedFrom: p.updatedFrom }
}

// A profile photo (Lee, 13 Oct 2026): the browser sends a small square JPEG.
// It replaces any earlier photo. remove: true clears it.
const PHOTO = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/
export async function savePhoto({ existing, name, key, emails, rowIds, dataUrl, remove, by, from }) {
  const m = remove ? null : PHOTO.exec(String(dataUrl || ''))
  if (!remove && !m) return { error: 'Choose a photo (JPEG or PNG).' }
  if (m && m[2].length > 2_000_000) return { error: 'That photo is too big. Try another.' }
  // A player with no profile yet gets one, so the photo has a row to sit on.
  const row = existing || await saveProfile({ existing: null, name, key, emails, rowIds, values: {}, by, from })
  await airtable(PROFILES_TABLE, { method: 'PATCH', body: { records: [{ id: row.id, fields: { Photo: [], 'Updated At': new Date().toISOString(), 'Updated By': clean(by, 100), 'Updated From': from } }] } })
  if (m) await uploadAttachment(row.id, 'Photo', { contentType: `image/${m[1]}`, base64: m[2], filename: `${normName(name).replace(/[^a-z0-9]+/g, '-') || 'player'}.${m[1] === 'jpeg' ? 'jpg' : m[1]}` })
  await audit({ by, action: remove ? 'profile.photoRemoved' : 'profile.photo', target: key, after: { from } })
  return { profile: fromRecord(await airtable(`${PROFILES_TABLE}/${row.id}`)) }
}

// Prefill for a player with no profile yet, from the newest signed waiver:
// club, date of birth, emergency contact and medical notes they already gave.
export async function waiverPrefill(waiverId) {
  if (!waiverId) return {}
  try {
    const f = (await airtable(`tblLziUfKOv1N0f40/${waiverId}`)).fields || {}
    return {
      dob: f['Date of Birth'] || '', club: f['Current Club'] || '', parentName: f['Parent/Guardian Name'] || '', parentMobile: f['Parent Mobile Number'] || '',
      emergencyName: f['Emergency Contact Name'] || '', emergencyPhone: f['Emergency Contact Phone'] || '', medical: f['Medical Notes'] || '',
    }
  } catch { return {} }
}

// Coach feedback after a trial, newest first, kept on the player's profile
// so it is there next term too (Lee and Ligia, 13 Oct 2026).
export async function addTrialFeedback({ existing, name, key, emails, rowIds, line, by }) {
  const before = existing ? String((await airtable(`${PROFILES_TABLE}/${existing.id}`)).fields?.['Trial Feedback'] || '') : ''
  const fields = {
    'Player Name': clean(name, 100), 'Player Key': key,
    'Family Emails': [...new Set([...(existing?.emails || []), ...emails.map((e) => String(e || '').trim().toLowerCase())].filter(Boolean))].join(', '),
    'Term 4 Record IDs': [...new Set([...(existing?.rowIds || []), ...rowIds].filter(Boolean))].join(', '),
    'Trial Feedback': `${line}${before ? `\n\n${before}` : ''}`.slice(0, 20000),
  }
  await airtable(PROFILES_TABLE, { method: existing ? 'PATCH' : 'POST', body: { typecast: true, records: [existing ? { id: existing.id, fields } : { fields }] } })
  await audit({ by, action: 'profile.trialFeedback', target: key, after: { rows: rowIds } })
}

// Club names families have already given us (waivers and profiles), most
// common first, so everyone spells a club the same way.
export function clubSuggestions(waivers = [], profiles = []) {
  const count = new Map()
  const add = (c) => { const v = clean(c, 60); if (v.length < 3 || /^(n\/?a|none|no|nil|-)$/i.test(v)) return; const k = v.toLowerCase(); const cur = count.get(k) || { name: v, n: 0 }; cur.n += 1; count.set(k, cur) }
  for (const w of waivers) add(w.club)
  for (const p of profiles) add(p.club)
  return [...count.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 150).map((x) => x.name)
}
