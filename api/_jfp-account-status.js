// Has this family actually signed in? (Lee, 19 Oct 2026: "how do we know if
// the player or parent has created an account with us and that we haven't
// just put it in ourselves".) For the Players tab, from what sign-in already
// records:
//   jfp:accounts         email -> { createdAt, kind }  (the first sign-in made the account)
//   jfp:acct-signedin    email -> last sign-in
//   jfp:acct-signins     email -> how many sign-ins (counted from 19 Oct 2026)
//   jfp:acct-invited     email -> account invite sent
//   jfp:player-logins    a player's own login, set up by the parent
// kind 'new': they signed up on the website before we had them on a row.
// kind 'family': we had them on a row and they then signed in themselves.
import { kvCommand } from './_jfp-store.js'

const hash = (raw) => { const o = {}; if (Array.isArray(raw)) for (let i = 0; i + 1 < raw.length; i += 2) o[raw[i]] = raw[i + 1]; else if (raw) Object.assign(o, raw); return o }
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
const DAY = 86400000

export async function accountMaps() {
  const [acc, signed, count, invited, logins] = await Promise.all(['jfp:accounts', 'jfp:acct-signedin', 'jfp:acct-signins', 'jfp:acct-invited', 'jfp:player-logins'].map((k) => kvCommand(['HGETALL', k]).catch(() => [])))
  const accounts = {}
  for (const [e, v] of Object.entries(hash(acc))) { const x = parse(v); if (x) accounts[e] = x }
  return { accounts, signedIn: hash(signed), signIns: hash(count), invited: hash(invited), logins: Object.values(hash(logins)).map(parse).filter(Boolean) }
}

// One player row: emails (the row's parent emails), playerKey (normName of the player).
export function accountFor(maps, { emails = [], playerKey = '' }, nowMs = Date.now()) {
  const es = [...new Set(emails.map((e) => String(e || '').toLowerCase()).filter(Boolean))]
  const latest = (list) => list.filter(Boolean).sort().at(-1) || ''
  const lastSignIn = latest(es.map((e) => maps.signedIn[e]))
  const created = es.map((e) => maps.accounts[e]).filter(Boolean).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0] || null
  const signIns = es.reduce((t, e) => t + (Number(maps.signIns[e]) || 0), 0)
  const invitedAt = latest(es.map((e) => maps.invited[e]))
  const login = maps.logins.find((x) => x.playerKey === playerKey && es.includes(String(x.parentEmail || '').toLowerCase())) || null
  const playerLastSignIn = login ? maps.signedIn[login.email] || '' : ''
  const ever = Boolean(lastSignIn || created)
  const status = !ever ? (invitedAt ? 'invited' : 'never') : lastSignIn && nowMs - Date.parse(lastSignIn) <= 30 * DAY ? 'active' : 'signedin'
  return {
    status,
    createdAt: created?.createdAt || '',
    // Signed up on the website themselves, before we had them on a row.
    selfSignup: created?.kind === 'new',
    lastSignIn, signIns, invitedAt,
    playerLogin: login ? { email: login.email, setAt: login.at, lastSignIn: playerLastSignIn } : null,
  }
}
