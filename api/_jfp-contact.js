// Who we talk to about a player (Lee, 13 Oct 2026): "many players have no
// parent". A player can be their own contact (the Pro group, adult players):
// then the one email and mobile on the row are the player's, every staff
// button says the player's first name, and every email and family page talks
// to the player ("Your sessions"), never to a parent.
//
// The flag lives on the Term 4 row's notes as [CONTACT:self], next to
// [PERSESSION:...], so every path that already has the row (emails, links,
// invites, texts, the family account) knows it without another read, and no
// new Airtable column is needed. Rows without the tag are parent + player,
// as before.
//
// Pure on purpose: the server and the portal and family pages all import it,
// so the wording is the same everywhere.

export const OWN_CONTACT_TAG = 'CONTACT'
const TAG_RE = /\s*\[CONTACT:[A-Za-z0-9-]+\]/g

export function isOwnContactNotes(notes) { return /\[CONTACT:self\]/.test(String(notes || '')) }
export function withOwnContact(notes, on) {
  const base = String(notes || '').replace(TAG_RE, '')
  return on ? `${base}${base ? ' ' : ''}[CONTACT:self]` : base
}

// 18 or over on the day: offered as their own contact automatically.
export const ADULT_AGE = 18
export function ageFrom(dob, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dob || '') || !/^\d{4}-\d{2}-\d{2}/.test(todayIso || '')) return null
  const [y, m, d] = dob.slice(0, 10).split('-').map(Number)
  const [oy, om, od] = todayIso.slice(0, 10).split('-').map(Number)
  let age = oy - y
  if (om < m || (om === m && od < d)) age -= 1
  return age >= 0 && age < 100 ? age : null
}
export function isAdult(dob, todayIso) { const a = ageFrom(dob, todayIso); return a != null && a >= ADULT_AGE }

export const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || ''
const join = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '')

// Every wording that changes between "the family" and the player, in one
// place. self: the player is their own contact. players: the player names
// (one for a self contact). parent: the parent name on the row, if any.
export function contactWords({ self = false, players = [], parent = '' } = {}) {
  const names = (Array.isArray(players) ? players : [players]).map((x) => String(x?.name ?? x ?? '').trim()).filter(Boolean)
  const firsts = names.map(firstName)
  const one = firsts[0] || ''
  if (self) {
    return {
      self: true,
      // Who the email or text is addressed to.
      toName: names[0] || '',
      hi: one || 'there',
      // Staff side.
      contact: one || 'the player',
      emailWho: one ? `Email ${one}` : 'Email the player',
      textWho: one ? `Text ${one}` : 'Text the player',
      addAndEmail: one ? `Add and email ${one}` : 'Add and email the player',
      theContact: one || 'the player',
      contactNoun: 'player',
      emailLabel: "Player's email (they sign in with this)",
      mobileLabel: "Player's mobile",
      noEmail: 'This player has no email in Airtable.',
      // Family page and emails, talking to the player.
      sessionsOf: 'Your sessions',
      whose: 'your',
      whoseCap: 'Your',
      who: 'you',
      has: 'you have',
      waiverLine: 'sign your waiver',
      greetingName: one,
    }
  }
  return {
    self: false,
    toName: String(parent || '').trim(),
    hi: firstName(parent) || 'there',
    contact: firstName(parent) || 'the family',
    emailWho: 'Email the family',
    textWho: firstName(parent) ? `Text ${firstName(parent)}` : 'Text the family',
    addAndEmail: 'Add and email the family',
    theContact: 'the family',
    contactNoun: 'family',
    emailLabel: 'Parent email (they sign in with this)',
    mobileLabel: 'Parent mobile',
    noEmail: 'This player has no parent email in Airtable.',
    sessionsOf: one ? `${join(firsts)}'s sessions` : 'Your sessions',
    whose: one ? `${join(firsts)}'s` : 'your',
    whoseCap: one ? `${join(firsts)}'s` : 'Your',
    who: join(names) || 'your player',
    has: `${join(names) || 'your player'} ${names.length > 1 ? 'have' : 'has'}`,
    waiverLine: 'sign the player waiver',
    greetingName: firstName(parent),
  }
}
