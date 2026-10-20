// Where are you based (Lee, 20 Oct 2026): "people from Pakistan creating an
// account... they land on a screen after it saying, hey, you'll struggle to do
// the Joner Football Performance program in Sydney, but the next best thing is
// the Joner Football app". And Lee and Ligia see where each new account is from.
//
// Someone new to us answers once, right after making the account: where they
// are based, who the account is for and how they heard of us. Saved on the
// account record (KV hash jfp:accounts, field `where`). Nobody is emailed.
// The connection's country (Vercel's headers) is kept as a hint for staff on
// every new account, answered or not.
import { kvCommand, clean, audit } from './_jfp-store.js'
import { accountOf, ACCOUNTS } from './_jfp-account-open.js'

export const PLACES = { sydney: 'Sydney', nsw: 'NSW, outside Sydney', australia: 'Elsewhere in Australia', overseas: 'Outside Australia' }
export const STATES = ['ACT', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']
export const FOR = { child: 'My child', me: 'Me, I play', coach: 'I coach' }
export const HEARD = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', google: 'Google', app: 'The Joner Football app', friend: 'A friend or family', club: 'My club', other: 'Somewhere else' }
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

// Country and city of the connection. A hint only: phones on travel, VPNs.
export function connectionPlace(req) {
  const h = req?.headers || {}
  const dec = (v) => { try { return decodeURIComponent(String(v || '')) } catch { return '' } }
  const country = String(h['x-vercel-ip-country'] || '').toUpperCase()
  return { country: /^[A-Z]{2}$/.test(country) ? country : '', region: clean(dec(h['x-vercel-ip-country-region']), 10), city: clean(dec(h['x-vercel-ip-city']), 60) }
}

export function cleanWhere(b = {}) {
  const place = has(PLACES, b.place) ? b.place : ''
  if (!place) return { error: 'Pick where you are based.' }
  const forWho = has(FOR, b.forWho) ? b.forWho : ''
  if (!forWho) return { error: 'Pick who the account is for.' }
  const country = place === 'overseas' ? clean(b.country, 60) : ''
  if (place === 'overseas' && !country) return { error: 'Which country are you in?' }
  return { where: {
    place,
    area: place === 'sydney' || place === 'nsw' ? clean(b.area, 60) : '',
    state: place === 'australia' && STATES.includes(b.state) ? b.state : '',
    country,
    forWho,
    heard: has(HEARD, b.heard) ? b.heard : '',
  } }
}

// Too far for weekly sessions in Sydney: the app is the better fit.
export const isAway = (w) => Boolean(w && (w.place === 'australia' || w.place === 'overseas'))

// Ask only someone new to us who has not answered. Term 4 families are not asked.
export const shouldAsk = (account) => Boolean(account && account.kind === 'new' && !account.where)

export async function saveWhere({ email, body, req }) {
  const e = String(email || '').toLowerCase()
  const c = cleanWhere(body)
  if (c.error) return c
  const rec = (await accountOf(e)) || { email: e, createdAt: new Date().toISOString(), kind: 'family', players: [] }
  rec.where = { ...c.where, at: new Date().toISOString() }
  if (!rec.from) rec.from = connectionPlace(req)
  await kvCommand(['HSET', ACCOUNTS, e, JSON.stringify(rec)])
  await audit({ by: e, action: 'account.where', target: e, after: { place: rec.where.place, forWho: rec.where.forWho } })
  return { where: rec.where, away: isAway(rec.where) }
}

// "Sydney · Belrose", "Outside Australia · Pakistan", "Elsewhere in Australia · VIC".
export function whereLabel(w) {
  if (!w) return ''
  return [PLACES[w.place] || '', w.area || w.state || w.country].filter(Boolean).join(' · ')
}

// What staff see on New accounts.
export function whereView(a) {
  const w = a?.where || null
  return {
    where: w ? { place: w.place, label: whereLabel(w), forWho: FOR[w.forWho] || '', heard: HEARD[w.heard] || '', away: isAway(w), at: w.at || '' } : null,
    from: a?.from?.country ? { country: a.from.country, city: a.from.city || '' } : null,
  }
}
