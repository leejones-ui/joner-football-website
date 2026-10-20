// Player logins (Lee, 17 Oct 2026): a parent can give a player aged 12 or over
// their own sign-in to My account. The player signs in with their own email
// code and sees only their own sessions, "Can't make it", attendance, coach
// notes, announcements and videos. Never money, siblings or the parent's
// contact details (jfp-account.js trims the family view down to them).
//
//   jfp:player-logins   hash playerEmail -> JSON {email, parentEmail, playerKey, name, at}
import { kvCommand, normName, rowEmails, validEmail, audit } from './_jfp-store.js'

const KEY = 'jfp:player-logins'
export const PLAYER_MIN_AGE = 12
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

export async function allPlayerLogins() {
  const raw = (await kvCommand(['HGETALL', KEY])) || []
  const out = []
  if (Array.isArray(raw)) { for (let i = 1; i < raw.length; i += 2) { const x = parse(raw[i]); if (x) out.push(x) } }
  else for (const v of Object.values(raw)) { const x = parse(v); if (x) out.push(x) }
  return out
}
export async function playerLoginOf(email) {
  const e = String(email || '').trim().toLowerCase()
  return e ? parse(await kvCommand(['HGET', KEY, e])) : null
}
// Every login made by any of a family's addresses (both parents see them).
export async function loginsForFamily(familyEmails = []) {
  const fe = new Set(familyEmails.map((e) => String(e).toLowerCase()))
  return (await allPlayerLogins()).filter((x) => fe.has(x.parentEmail))
}
// Player login emails for these Airtable rows (push: the player gets their
// own reminders and coach notes too).
export async function loginsForRows(rows = []) {
  const all = await allPlayerLogins()
  if (!all.length) return []
  return all.filter((x) => rows.some((r) => normName(r.player) === x.playerKey && rowEmails(r).includes(x.parentEmail))).map((x) => x.email)
}

// `fam` is familyFor(parent.email). `age` is the player's age today, checked by the caller.
export async function setPlayerLogin({ parent, fam, player, age, email, isStaffEmail, isFamilyEmail }) {
  const e = validEmail(email)
  if (!e) return { error: 'Type the player\'s own email address.' }
  if (age == null) return { error: `Add ${player.name.split(' ')[0]}'s date of birth in Player information first.` }
  if (age < PLAYER_MIN_AGE) return { error: `Player logins are for players aged ${PLAYER_MIN_AGE} and over.` }
  if (fam.emails.includes(e) || e === parent.email) return { error: 'Use the player\'s own email, not a parent\'s.' }
  if (isStaffEmail || isFamilyEmail) return { error: 'That email already has its own account. Use a different one.' }
  const was = await playerLoginOf(e)
  if (was && !(was.playerKey === player.key && fam.emails.includes(was.parentEmail))) return { error: 'That email is already used for another player.' }
  // One login per player: a new email replaces the old one.
  for (const x of await loginsForFamily(fam.emails)) if (x.playerKey === player.key && x.email !== e) await kvCommand(['HDEL', KEY, x.email])
  const rec = { email: e, parentEmail: parent.email, playerKey: player.key, name: player.name, at: new Date().toISOString() }
  await kvCommand(['HSET', KEY, e, JSON.stringify(rec)])
  await audit({ by: parent.email, action: 'playerLogin.set', target: player.name, after: { email: e } })
  return { login: rec }
}
export async function removePlayerLogin({ parent, fam, playerKey }) {
  const mine = (await loginsForFamily(fam.emails)).filter((x) => x.playerKey === playerKey)
  for (const x of mine) await kvCommand(['HDEL', KEY, x.email])
  if (mine.length) await audit({ by: parent.email, action: 'playerLogin.remove', target: mine[0].name, before: { email: mine[0].email } })
  return { removed: mine.length }
}

// An agent's email changes (Lee edits the agency): the logins they gave their
// players follow them to the new address.
export async function moveLoginsParent(fromEmail, toEmail) {
  const from = String(fromEmail || '').toLowerCase(), to = String(toEmail || '').toLowerCase()
  if (!from || !to || from === to) return 0
  const moved = (await allPlayerLogins()).filter((x) => x.parentEmail === from)
  for (const x of moved) await kvCommand(['HSET', KEY, x.email, JSON.stringify({ ...x, parentEmail: to })])
  return moved.length
}
