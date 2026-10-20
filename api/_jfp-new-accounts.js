// New accounts (Lee, 16 Oct 2026): "can you add something that notifies us in
// the portal like requests do? with a notification to say new account".
// Families now make accounts from the booking page's Create an account button.
//
// The accounts are the records the first sign-in makes (KV jfp:accounts,
// _jfp-account-open.js). "New to us" means nothing was on file for that email
// when they signed up (kind 'new'); a Term 4 family signing in for the first
// time is kind 'family' and never counts on the badge.
// Seen: KV hash jfp:accounts-seen, staff email -> ms. Opening New accounts
// marks them seen for that person.
import { kvCommand, ageOn, sydneyToday, locationFor, rowEmails } from './_jfp-store.js'
import { allAccounts } from './_jfp-account-open.js'
import { whereView } from './_jfp-account-where.js'

export const ACCOUNTS_SEEN = 'jfp:accounts-seen'
const ms = (iso) => Date.parse(iso || '') || 0

async function seenAt(email) { return Number(await kvCommand(['HGET', ACCOUNTS_SEEN, email])) || 0 }

// The red count on New accounts and the Dashboard line.
export async function accountAlerts(principal) {
  const [accounts, since] = await Promise.all([allAccounts(), seenAt(principal.email)])
  const fresh = Object.values(accounts).filter((a) => a.kind === 'new' && ms(a.createdAt) > since).sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
  return { count: fresh.length, latest: fresh.slice(0, 3).map((a) => ({ email: a.email, createdAt: a.createdAt })) }
}

// The list: every account, newest first, with the players they added, any
// session they hold now and when they last signed in.
export async function newAccountsData(principal, config, { profiles, roster, show = 'new' }) {
  const since = await seenAt(principal.email)
  await kvCommand(['HSET', ACCOUNTS_SEEN, principal.email, String(Date.now())])
  const [accounts, signedFlat] = await Promise.all([allAccounts(), kvCommand(['HGETALL', 'jfp:acct-signedin']).catch(() => [])])
  const signedIn = {}
  for (let i = 0; i + 1 < (signedFlat || []).length; i += 2) signedIn[signedFlat[i]] = signedFlat[i + 1]
  const all = Object.values(accounts)
  // Outside Sydney (Lee, 20 Oct 2026): by their answer, or by the connection's country while they have not answered.
  const away = (a) => (a.where ? a.where.place !== 'sydney' : Boolean(a.from?.country && a.from.country !== 'AU'))
  const list = all.filter((a) => show === 'all' || (show === 'away' ? a.kind === 'new' && away(a) : a.kind === 'new')).map((a) => {
    const email = a.email
    const profs = profiles.filter((p) => (p.emails || []).includes(email))
    const rows = roster.players.filter((r) => r.holdsPlace && rowEmails(r).includes(email))
    const selfKeys = new Set((a.players || []).filter((x) => x.self).map((x) => x.key))
    const players = profs.map((p) => {
      const row = rows.find((r) => p.rowIds.includes(r.id))
      return { key: p.key, name: p.name, dob: p.dob || '', age: p.dob ? ageOn(p.dob, sydneyToday()) : null, club: p.club || '', level: p.level || '', self: selfKeys.has(p.key), session: row ? [row.day, row.time, locationFor(config, row.location).name].filter(Boolean).join(' ') : '' }
    })
    for (const r of rows) if (!players.some((p) => p.session && p.name.toLowerCase() === String(r.player).toLowerCase())) players.push({ key: r.id, name: r.player, age: null, club: '', level: '', self: false, session: [r.day, r.time, locationFor(config, r.location).name].filter(Boolean).join(' ') })
    const parent = profs.find((p) => p.parentName)?.parentName || rows[0]?.parent || ''
    const mobile = profs.find((p) => p.parentMobile)?.parentMobile || rows[0]?.phone || ''
    const booked = players.some((p) => p.session)
    return { email, kind: a.kind, createdAt: a.createdAt, isNew: a.kind === 'new' && ms(a.createdAt) > since, parent, mobile, players, booked, status: booked ? 'booked' : players.length ? 'players' : 'empty', lastSignIn: signedIn[email] || '', ...whereView(a) }
  }).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 300)
  const newOnes = all.filter((a) => a.kind === 'new')
  const week = Date.now() - 7 * 86400000
  return { show, accounts: list, totals: { all: all.length, newToUs: newOnes.length, thisWeek: newOnes.filter((a) => ms(a.createdAt) > week).length, notBooked: list.filter((a) => !a.booked).length, away: newOnes.filter(away).length } }
}
