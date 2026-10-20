// Open accounts (Lee, 14 Oct 2026, round 2 item 8): ANYONE can make a Joner
// Football account at /jfp-account/ and fill in player profiles, with no
// session booked. Ligia's test account could not: My account only knew
// players with a Term 4 row.
//
//   An account record   KV hash jfp:accounts, email -> { email, createdAt, kind, players }
//                       made on the first sign-in with a code. A new address
//                       with nothing on file is rate limited (per connection
//                       and overall); a family we already know is never held up.
//   Add a player        a profile row in "JFP Player Profiles" (saveProfile),
//                       never a Term 4 row and never a place.
//   Matching            staff add the player later (Accounts with no session,
//                       Add to a group): the profile is found by email and
//                       name (profileKey) and linked to the new row, so staff
//                       see it straight away (linkProfile).
//
// Nothing here writes Term 4.
import { kvCommand, normName, clean, ageOn, sydneyToday, audit } from './_jfp-store.js'
import { familyProfiles, findProfile, saveProfile, cleanProfile, profileKey } from './_jfp-profiles.js'

export const ACCOUNTS = 'jfp:accounts'
// Sign-ups from one connection a day, and from everyone an hour.
export const SIGNUP_PER_IP_DAY = 10
export const SIGNUP_PER_HOUR = 200
// Players added from one account: at most this many with no session, and this many a day.
export const OPEN_PLAYERS_MAX = 8
export const ADD_PER_DAY = 12

async function under(key, limit, seconds) {
  const n = Number(await kvCommand(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", '1', `jfp:rl:${key}`, String(seconds)]))
  return n <= limit
}

export async function accountOf(email) {
  try { return JSON.parse((await kvCommand(['HGET', ACCOUNTS, String(email || '').toLowerCase()])) || 'null') } catch { return null }
}
async function saveAccount(rec) { await kvCommand(['HSET', ACCOUNTS, rec.email, JSON.stringify(rec)]) }

// First sign-in with a code. known: the address is already on a Term 4 or
// Term 3 row or a waiver (never limited). { ok } or { limited: true }.
export async function noteAccount({ email, ip = 'unknown', known = false, from = null }) {
  const e = String(email || '').toLowerCase()
  if (!e) return { ok: false }
  if (Number(await kvCommand(['HEXISTS', ACCOUNTS, e])) === 1) return { ok: true, created: false }
  if (!known && (!(await under(`signup-ip:${ip}`, SIGNUP_PER_IP_DAY, 86400)) || !(await under('signup-all', SIGNUP_PER_HOUR, 3600)))) return { limited: true }
  const rec = { email: e, createdAt: new Date().toISOString(), kind: known ? 'family' : 'new', players: [], ...(from?.country ? { from } : {}) }
  // Two sign-ins at once: the first record wins.
  await kvCommand(['HSETNX', ACCOUNTS, e, JSON.stringify(rec)])
  if (!known) await audit({ by: e, action: 'account.create', target: e, after: { kind: rec.kind } })
  return { ok: true, created: true }
}

// The account's own players with no Term 4 row: their profiles, not already
// one of the family's players (by name). fam: familyFor(); profs: familyProfiles().
export function openPlayers({ fam, profs, account }) {
  const rowIds = new Set(fam.players.flatMap((p) => p.term4.map((r) => r.id)))
  const known = new Set(fam.players.filter((p) => p.term4.length).map((p) => p.key))
  const selfKeys = new Set((account?.players || []).filter((x) => x.self).map((x) => x.key))
  return profs
    .filter((p) => !p.rowIds.some((id) => rowIds.has(id)) && !known.has(normName(p.name)))
    .map((p) => ({ key: normName(p.name), name: p.name, profile: p, self: selfKeys.has(p.key) }))
}

// "Add a player" in My account: name, date of birth, me or my child, and any
// player information (club, level, positions, contacts). A profile only.
export async function addMyPlayer({ email, fam, body }) {
  const name = clean(body.name, 80).replace(/\s+/g, ' ')
  if (name.length < 3 || !/^[\p{L}][\p{L}'’ .-]*$/u.test(name) || name.split(' ').length < 2) return { ok: false, status: 400, error: "Enter the player's first and last name." }
  const self = body.self === true
  const { values, errors } = cleanProfile({ ...(body.values && typeof body.values === 'object' ? body.values : {}), ...(body.dob != null ? { dob: body.dob } : {}) })
  if (errors.length) return { ok: false, status: 400, error: errors.join(' ') }
  if (!values.dob) return { ok: false, status: 400, error: `Enter ${name.split(' ')[0]}'s date of birth.` }
  if (self) for (const k of ['parentName', 'parentMobile', 'parent2Name', 'parent2Email', 'parent2Mobile']) delete values[k]
  const age = ageOn(values.dob, sydneyToday())
  if (self && age != null && age < 18) return { ok: false, status: 400, error: 'Under 18: a parent or guardian adds the player from their own account.' }
  const profs = await familyProfiles(email)
  const account = await accountOf(email)
  const open = openPlayers({ fam, profs, account })
  if (fam.players.some((p) => p.key === normName(name) && p.term4.length) || open.some((p) => p.key === normName(name))) return { ok: false, status: 409, error: `${name} is already on your account. Open Player information to update them.`, code: 'duplicate' }
  if (open.length >= OPEN_PLAYERS_MAX) return { ok: false, status: 429, error: `You can add up to ${OPEN_PLAYERS_MAX} players before booking. Contact us if you need more.` }
  if (!(await under(`acct-add:${email}`, ADD_PER_DAY, 86400))) return { ok: false, status: 429, error: 'That is a lot of players for one day. Try again tomorrow, or contact us.' }
  const key = profileKey(name, email)
  // A profile Joner Football already has for this player and email (a
  // returning player): add to it rather than make a second one.
  const existing = profs.find((p) => p.key === key) || null
  const saved = await saveProfile({ existing, name, key, emails: [email], rowIds: [], values, by: email, from: 'Family account' })
  const rec = account || { email, createdAt: new Date().toISOString(), kind: 'new', players: [] }
  rec.players = [...(rec.players || []).filter((x) => x.key !== key), { key, name, self, addedAt: new Date().toISOString() }]
  await saveAccount(rec)
  await audit({ by: email, action: 'account.addPlayer', target: key, after: { self, fields: Object.keys(values) } })
  return { ok: true, profile: saved, key: normName(name) }
}

// Staff add a player to a group: the profile they already have is linked to
// the new row (by email and name; by name alone only when exactly one
// unlinked profile has that name), then any new information is saved on it.
export async function linkProfile({ name, email, rowId, values = {}, by }) {
  const key = profileKey(name, email)
  let existing = await findProfile({ key }).catch(() => null)
  if (!existing && email) existing = (await familyProfiles(email).catch(() => [])).find((p) => normName(p.name) === normName(name)) || null
  if (!existing && !Object.keys(values).length) return { linked: false }
  const saved = await saveProfile({ existing, name, key: existing?.key || key, emails: email ? [email] : [], rowIds: [rowId], values, by, from: 'Staff portal' })
  return { linked: Boolean(existing), profile: saved }
}

// Players tab, "Accounts with no session": every profile with no Term 4 row
// that still exists. profiles: allProfiles(); rowIds: every Term 4 row id.
// Removed players stay off this list (Lee, 18 Oct 2026): a profile tied to a
// removed row, or with the same name and email as someone removed, is not
// "No session yet". removed: [{ rowIds: [...], name, email }].
export function accountsWithNoSession(profiles, rowIds, accounts = {}, removed = []) {
  const ids = new Set(rowIds)
  const goneIds = new Set(removed.flatMap((x) => x.rowIds || []).filter(Boolean))
  const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const goneNames = new Set(removed.filter((x) => x.name && x.email).map((x) => `${norm(x.name)}|${norm(x.email)}`))
  const isGone = (p) => p.rowIds.some((id) => goneIds.has(id)) || (p.emails || []).some((e) => goneNames.has(`${norm(p.name)}|${norm(e)}`))
  return profiles.filter((p) => !p.rowIds.some((id) => ids.has(id)) && !isGone(p)).map((p) => {
    const email = p.emails[0] || ''
    const acct = accounts[email] || null
    const self = Boolean(acct?.players?.some((x) => x.key === p.key && x.self))
    return { profileId: p.id, key: p.key, name: p.name, email, emails: p.emails, self, dob: p.dob || '', age: p.dob ? ageOn(p.dob, sydneyToday()) : null, club: p.club || '', level: p.level || '', positions: p.positions || [], parentName: self ? '' : p.parentName || '', mobile: p.parentMobile || '', updatedAt: p.updatedAt || '', signedUpAt: acct?.createdAt || '' }
  }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export async function allAccounts() {
  const flat = (await kvCommand(['HGETALL', ACCOUNTS])) || []
  const out = {}
  for (let i = 0; i + 1 < flat.length; i += 2) { try { out[flat[i]] = JSON.parse(flat[i + 1]) } catch {} }
  return out
}
