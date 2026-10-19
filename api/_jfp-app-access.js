// Free JF App access for JFP players (Lee, 19 Oct 2026): a family whose player
// holds a paid Term 4 place asks for it in My account and gives the email the
// player will sign in to the app with. Free accounts and trials do not qualify.
//
// It sets itself up (Lee, 19 Oct 2026, second round): the email must be the
// one on this JFP account, the place must be paid, and then that email is put
// in the Uscreen group "JFP", which gives PLUS annual access. If Uscreen says
// no (group full, Uscreen down), the request waits and Lee is told, and Lee or
// Ligia can still set it up by hand and mark it done.
import { kvCommand, clean, audit } from './_jfp-store.js'
import { addToJfpGroup } from './_jfp-uscreen.js'

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
export const familyAppView = (rec, eligible, accountEmail = '') => ({ eligible: eligible.length > 0, players: eligible, request: rec ? { appEmail: rec.appEmail, status: rec.status, at: rec.at } : null, accountEmail })

// A family asks. Returns { ok, record } or { ok: false, status, error }.
export async function requestAppAccess({ parent, fam, body, notify, add = addToJfpGroup }) {
  const players = eligiblePlayers(fam)
  if (!players.length) return { ok: false, status: 403, error: 'Free app access is for players booked into Term 4 with the place paid. If you have just paid, try again tomorrow or contact Ligia.' }
  const appEmail = clean(body.appEmail, 200).toLowerCase()
  const accountEmail = parent.email.toLowerCase()
  if (!EMAIL.test(appEmail)) return { ok: false, status: 400, error: 'Enter the email you sign in here with.' }
  if (appEmail !== accountEmail) return { ok: false, status: 400, error: `Use the same email as this account: ${accountEmail}. That is the email that gets free access.` }
  const was = await appAccessOf(accountEmail)
  if (was && was.status === 'done' && was.appEmail === appEmail) return { ok: true, record: was, already: true }
  let result
  try { result = await add({ email: appEmail, name: fam.parentName || '' }) } catch (e) { result = { ok: false, reason: e.code || 'error' } }
  const now = new Date().toISOString()
  const rec = {
    parentEmail: accountEmail, parentName: fam.parentName || '', players, appEmail, at: now,
    ...(result.ok ? { status: 'done', doneAt: now, doneBy: 'auto (Uscreen group JFP)' } : { status: 'requested', autoFailed: result.reason || 'error' }),
    ...(was && was.appEmail !== appEmail ? { previous: was.appEmail } : {}),
  }
  await kvCommand(['HSET', KEY, rec.parentEmail, JSON.stringify(rec)])
  await audit({ by: parent.email, action: result.ok ? 'app-access.auto' : 'app-access.request', target: rec.parentEmail, after: { players: players.length, ...(result.ok ? {} : { reason: rec.autoFailed }) } })
  if (!result.ok) {
    const why = { 'no-group': 'there is no group called JFP in Uscreen', 'no-seats': 'the JFP group in Uscreen has no seats left', 'no-key': 'Uscreen is not connected' }[result.reason] || `Uscreen said no (${result.reason})`
    await notify(`JF App access could not set itself up for ${players.join(' and ')} (${appEmail}): ${why}. Add them to the JFP group in Uscreen, then mark it done: Players, More, JF App access.`).catch(() => {})
  }
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
