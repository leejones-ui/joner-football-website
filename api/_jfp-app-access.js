// Free JF App access for JFP players (Lee, 19 Oct 2026): a family whose player
// holds a paid Term 4 place asks for it in My account and gives the email the
// player will sign in to the app with. Free accounts and trials do not qualify.
//
// Nothing is changed in Uscreen from here. Uscreen is the app's shop, so
// access is granted by hand by Lee or Ligia (or, once Lee names the product
// or team, by a step he approves). This keeps the list: who asked, the app
// email, and whether it has been set up.
import { kvCommand, clean, audit } from './_jfp-store.js'

const KEY = 'jfp:app-access'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

// The players on this family's account who qualify: a Term 4 place, paid, not a trial.
export function eligiblePlayers(fam) {
  return fam.players.filter((p) => p.term4.some((r) => r.holdsPlace && r.groupId && r.paymentStatus === 'Paid' && !/trial/i.test(r.paymentType || ''))).map((p) => p.name)
}

export async function appAccessOf(parentEmail) {
  return parse(await kvCommand(['HGET', KEY, parentEmail.toLowerCase()]))
}
export async function listAppAccess() {
  const raw = (await kvCommand(['HGETALL', KEY])) || []
  const out = []
  for (let i = 1; i < raw.length; i += 2) { const x = parse(raw[i]); if (x) out.push(x) }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)))
}
export const familyAppView = (rec, eligible) => ({ eligible: eligible.length > 0, players: eligible, request: rec ? { appEmail: rec.appEmail, status: rec.status, at: rec.at } : null })

// A family asks. Returns { ok, record } or { ok: false, status, error }.
export async function requestAppAccess({ parent, fam, body, notify }) {
  const players = eligiblePlayers(fam)
  if (!players.length) return { ok: false, status: 403, error: 'Free app access is for players with a paid Term 4 place. If you have just paid, try again tomorrow or contact Ligia.' }
  const appEmail = clean(body.appEmail, 200).toLowerCase()
  if (!EMAIL.test(appEmail)) return { ok: false, status: 400, error: 'Enter the email the player will use to sign in to the app.' }
  const was = await appAccessOf(parent.email)
  if (was && was.status === 'done' && was.appEmail === appEmail) return { ok: true, record: was, already: true }
  const rec = { parentEmail: parent.email.toLowerCase(), parentName: fam.parentName || '', players, appEmail, status: 'requested', at: new Date().toISOString(), ...(was ? { previous: was.appEmail } : {}) }
  await kvCommand(['HSET', KEY, rec.parentEmail, JSON.stringify(rec)])
  await audit({ by: parent.email, action: 'app-access.request', target: rec.parentEmail, after: { players: players.length } })
  if (!was || was.appEmail !== appEmail) await notify(`JF App access asked for: ${players.join(' and ')} (${appEmail}). Set it up in Uscreen, then mark it done in the portal: Players, More, JF App access.`).catch(() => {})
  return { ok: true, record: rec }
}

// Lee or Ligia mark one set up (done) or back to waiting.
export async function markAppAccess({ parentEmail, status, by }) {
  const rec = await appAccessOf(clean(parentEmail, 200))
  if (!rec) return { ok: false, status: 404, error: 'That request is gone.' }
  if (!['done', 'requested'].includes(status)) return { ok: false, status: 400, error: 'Done or waiting.' }
  const next = { ...rec, status, ...(status === 'done' ? { doneAt: new Date().toISOString(), doneBy: by } : {}) }
  await kvCommand(['HSET', KEY, rec.parentEmail, JSON.stringify(next)])
  await audit({ by, action: `app-access.${status}`, target: rec.parentEmail })
  return { ok: true, record: next }
}
