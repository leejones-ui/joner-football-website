// "Text and email players that have not filled in their player profile"
// (Lee, 30 Oct 2026). A family is asked when any of their players this term
// has no profile, no photo, or fewer than 4 football details. One email per
// family, sent once (KV hash jfp:profile-nudge, family email -> ISO). The text
// goes separately through quickText, after Lee's yes on the words.
import { kvCommand, audit } from './_jfp-store.js'
import { pickProfile, profileKey } from './_jfp-profiles.js'

const SENT = 'jfp:profile-nudge'
const DETAILS = ['club', 'team', 'level', 'positions', 'foot', 'yearsPlaying']
const first = (s) => String(s || '').trim().split(/\s+/)[0] || ''
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

export function profileGap(p) {
  if (!p) return 'none'
  const filled = DETAILS.filter((k) => (Array.isArray(p[k]) ? p[k].length : p[k])).length
  return filled < 4 ? 'thin' : p.photo ? '' : 'photo'
}

// Families with a player still to fill in: { email, parentName, self, players, rowIds, gaps }.
export function nudgeFamilies(players, profiles, { skip = () => false } = {}) {
  const by = new Map()
  for (const r of players) {
    if (!r.holdsPlace || skip(r) || !r.email) continue
    const gap = profileGap(pickProfile(profiles, { key: profileKey(r.player, r.email), rowIds: [r.id] }))
    if (!gap) continue
    const email = r.email.trim().toLowerCase()
    const f = by.get(email) || { email, parentName: r.ownContact ? r.player : r.parent || '', self: r.ownContact === true, players: [], rowIds: [], gaps: [] }
    if (!f.players.includes(r.player)) f.players.push(r.player)
    f.rowIds.push(r.id); f.gaps.push(gap)
    by.set(email, f)
  }
  return [...by.values()]
}

export function nudgeWords({ parentName = '', players = [], self = false }) {
  const names = and(players.map(first))
  const whose = self ? 'your player profile' : players.length > 1 ? `the player profiles for ${names}` : `${names}'s player profile`
  const them = self ? 'you' : players.length > 1 ? 'them' : names
  const hi = `Hi ${first(parentName) || 'there'}.`
  const wants = self ? 'what you want to work on and develop in your game' : `what ${players.length > 1 ? 'they want' : `${names} wants`} to work on and develop in their game`
  return {
    subject: self ? 'Fill in your player profile' : players.length > 1 ? 'Fill in your player profiles' : `Fill in ${names}'s player profile`,
    heading: `Help us get to know ${self ? 'you' : names}`,
    paras: [
      `${hi} Could you take two minutes to fill in ${whose} in your JFP account?`,
      `Add as much as you can: club, team, level, positions, preferred foot, years playing, a profile photo, and ${wants}. Photos help our coaches learn every name fast.`,
      `It helps us put ${them} in the right group and coach ${them} the right way.`,
      'Any questions, just reply to this email.',
      'Lee',
    ],
    cta: { label: 'Fill in the profile', url: 'https://jonerfootball.com/jfp-account/' },
    text: `Hi ${first(parentName) || 'there'}, it's Lee from Joner Football. Could you fill in ${whose} in your JFP account? Add as much as you can: club, team, level, positions, preferred foot, a profile photo, and ${wants}. It helps us put ${them} in the right group and coach ${them} better. Sign in here: https://jonerfootball.com/jfp-account/ Lee`,
  }
}

export async function sentMap() {
  const flat = (await kvCommand(['HGETALL', SENT])) || []
  const out = {}
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1]
  return out
}

// One email per family not emailed before. send: sendFamilyNotice.
export async function sendNudges({ families, by, send }) {
  const done = await sentMap()
  let sent = 0, held = 0
  const failed = [], heldIds = []
  for (const f of families) {
    if (done[f.email]) continue
    const w = nudgeWords(f)
    try {
      const out = await send({ to: f.email, name: f.parentName, subject: w.subject, heading: w.heading, paras: w.paras, cta: w.cta, kind: 'profile reminder' })
      if (out?.held) { held += 1; heldIds.push(out.heldId) } else sent += 1
      await kvCommand(['HSET', SENT, f.email, new Date().toISOString()])
    } catch (e) { failed.push(f.email); console.error('jfp profile reminder failed', f.email, e.message) }
  }
  await audit({ by, action: 'profiles.nudge', target: 'families', after: { sent, held, failed: failed.length } })
  return { sent, held, heldIds, failed }
}
