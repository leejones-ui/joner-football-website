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

// A mobile is needed to make an account (Lee, 3 Nov 2026: "the last 4 or 5
// accounts that have come in is just an email address"). An Australian
// mobile (04..., +61 4...), or a number with its country code from overseas.
// Returns it tidied (+614xxxxxxxx, +<digits>), or '' when it is not one.
export function cleanMobile(raw) {
  const s = String(raw || '').trim()
  let d = s.replace(/[^\d+]/g, '')
  if (d.startsWith('00')) d = `+${d.slice(2)}`
  const digits = d.replace(/\D/g, '')
  if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`
  if (/^614\d{8}$/.test(digits)) return `+${digits}`
  if (/^4\d{8}$/.test(digits) && !d.startsWith('+')) return `+61${digits}`
  if (d.startsWith('+') && !digits.startsWith('61') && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`
  return ''
}
export const MOBILE_ERROR = 'Enter a valid mobile number. In Australia it starts with 04. Outside Australia, start with + and your country code.'

// Too far for weekly sessions in Sydney: the app is the better fit.
export const isAway = (w) => Boolean(w && (w.place === 'australia' || w.place === 'overseas'))

// Ask only someone new to us who has not answered. Term 4 families are not asked.
// Someone new to us with no mobile is asked for one too (accounts made before 3 Nov 2026).
export const shouldAsk = (account) => Boolean(account && account.kind === 'new' && (!account.where || !account.mobile))

export async function saveWhere({ email, body, req }) {
  const e = String(email || '').toLowerCase()
  const was = await accountOf(e)
  // Answered before, only the mobile missing: just the mobile.
  const c = was?.where && !body.place ? { where: was.where } : cleanWhere(body)
  if (c.error) return c
  const mobile = cleanMobile(body.mobile)
  if (was?.kind === 'new' && !was.mobile && !mobile) return { error: MOBILE_ERROR }
  const rec = was || { email: e, createdAt: new Date().toISOString(), kind: 'family', players: [] }
  if (mobile) rec.mobile = mobile
  rec.where = c.where === was?.where ? was.where : { ...c.where, at: new Date().toISOString() }
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
