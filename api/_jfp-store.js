// JFP term bookings: groups, place holds, bookings, requests and the audit log.
//
// Airtable Term 4 Players is the roster of record. KV (Upstash) keeps only
// what Airtable cannot: group settings, atomic place holds, sign-in codes and
// sessions, applications, waitlist, payment requests and the audit log.
//
// Places a group has left:
//
//   capacity - Airtable players holding a place - live KV holds
//
// A hold is taken the moment a parent starts a booking and lives in KV until
// the payment is written into Airtable. After that the Airtable row counts
// the place and the hold is let go after a short overlap, so a place can be
// briefly under-sold but never over-sold.
import crypto from 'node:crypto'
import { kvCommand, kvPipeline, kvGetJson, kvSetJson, clean, newId, formatAud, claimOnce, stripeFetch } from './_holiday-store.js'

export { kvCommand, kvPipeline, kvGetJson, kvSetJson, clean, newId, formatAud, claimOnce }

export const RESERVE_MINUTES = 15
export const HOLD_MINUTES = 31
export const CHECKOUT_EXPIRES_MINUTES = 30
// How long a paid hold lingers after Airtable has the row. Covers a reader
// that counted Airtable a moment before the write landed.
export const SETTLE_SECONDS = Number.isFinite(Number(process.env.JFP_SETTLE_SECONDS)) && process.env.JFP_SETTLE_SECONDS !== '' ? Number(process.env.JFP_SETTLE_SECONDS) : 20
export const CONFIRMED_SCORE = 9007199254740000
// direct = book and pay online (players inside the age band). application =
// staff approve: straight in for the term, or a trial first. enquire = 1 to 1, we get in touch. closed = not shown to parents.
export const MODES = ['direct', 'application', 'enquire', 'closed']
// 'Squad' is gone (Lee, 30 Sept: we sell small group training): old groups
// saved as Squad read as Small group.
export const LABELS = ['Small group', 'Pathway', '1 to 1', 'Trial']
// What an application asks, per group. Lee picks the questions in the portal.
export const QUESTIONS = {
  club: 'Club they play for',
  team: 'Team and age group',
  playingUp: 'Playing up, down or at their own age',
  trainedBefore: 'Trained with Joner before',
  position: 'Position',
  videos: 'Links to videos of the player training or playing (optional)',
}
export const DEFAULT_QUESTIONS = ['club', 'team', 'playingUp', 'trainedBefore', 'videos']
// What a group asks of a player, shown to parents under "Who this group is
// for". Level without saying beginner: Lee ticks what fits each group.
export const REQUIREMENTS = {
  club: 'Plays club football this season',
  npl: 'Plays NPL, or Division 1 club football',
  rep: 'In a representative, NPL or academy squad',
  high: 'High level players only',
  committed: 'Can commit to every session this term',
  trialNew: 'New players trial first',
  coach: 'By coach invitation or recommendation',
}
export const ONLINE_TAG = 'JFP-ONLINE'
export const ADMIN_TAG = 'JFP-ADMIN'
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const MAX_PLAYERS = 4
// 1 to 1 coaching is not a timetable slot parents can see (each slot belongs
// to one player). Enquiries go to this stand-in group instead.
export const ONE_TO_ONE = Object.freeze({ id: 'one-to-one', day: '1 to 1 coaching', time: 'times on request', location: 'Belrose HQ', label: '1 to 1', programme: 'JFP 1 on 1', mode: 'enquire', minAge: null, maxAge: null, durationMin: 60, capacity: 1, coachId: '', extraCoachIds: [], girlsOnly: 'no', publicNote: '', questions: [], trials: false, product: 'oneToOne' })

// Lee's price list (September 2026). Every amount is editable in the portal.
// perPlaces: how many places the price covers (two a week, or two siblings).
// proRata: joining after the term starts pays only for the sessions left.
export const PRODUCTS = [
  { key: 'group', label: 'Term, small group', type: 'JFP 10 weeks', proRata: true, perPlaces: 1 },
  { key: 'twoAWeek', label: 'Two a week, or two siblings', type: 'Sibling / 2 sessions per week', proRata: true, perPlaces: 2 },
  { key: 'oneToOneTerm', label: 'Term of 1 to 1s', type: 'JFP 1 on 1, 10 weeks', proRata: true, perPlaces: 1 },
  { key: 'pathway', label: 'JFP Pathway (45 minute class)', type: 'JFP Pathway 10 weeks', proRata: true, perPlaces: 1 },
  { key: 'pathwayOneToOne', label: 'Pathway 1 to 1 private (45 minutes)', type: 'JFP pathway 1 on 1', proRata: true, perPlaces: 1 },
  { key: 'trial', label: 'Trial session', type: 'JFP Trial', proRata: false, perPlaces: 1 },
  { key: 'oneToOne', label: 'One off 1 to 1', type: 'JFP 1 on 1 casual', proRata: false, perPlaces: 1 },
]
export const DEFAULT_PRICES = { group: 85000, twoAWeek: 150000, oneToOneTerm: 110000, pathway: 45000, pathwayOneToOne: 85000, trial: 8500, oneToOne: 12000 }
export function productFor(key) { return PRODUCTS.find((p) => p.key === key) || PRODUCTS[0] }

export const keys = {
  config: () => 'jfp:config',
  holdsBy: (email) => `jfp:holds-by:${crypto.createHash('sha256').update(String(email)).digest('hex').slice(0, 32)}`,
  groups: () => 'jfp:groups',
  seats: (gid) => `jfp:seats:${gid}`,
  booking: (id) => `jfp:booking:${id}`,
  bookings: () => 'jfp:bookings',
  application: (id) => `jfp:application:${id}`,
  applications: () => 'jfp:applications',
  payreq: (id) => `jfp:payreq:${id}`,
  payreqs: () => 'jfp:payreqs',
  audit: () => 'jfp:audit',
  roster: () => 'jfp:roster-cache',
  airtableCounts: () => 'jfp:airtable-counts',
  finalised: (id) => `jfp:finalised:${id}`,
  attendance: (gid, date) => `jfp:att:${gid}:${date}`,
  next: (term) => `jfp:next:${String(term).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
}

// ---------- config ----------

export const DEFAULT_LOCATIONS = [
  { id: 'belrose', match: 'belrose', name: 'Belrose HQ', banner: 'BELROSE', address: 'Joner Football HQ, 20 Narabang Way (Unit 2), Belrose NSW 2085', maps: 'https://maps.google.com/?q=20+Narabang+Way+Belrose+NSW+2085', photo: '/images/hq/hq-hero-lee-exterior.webp', blurb: 'Our home ground. Small groups after school and on Saturdays.' },
  { id: 'ntra', match: 'ntra', name: 'North Turramurra', banner: 'NTRA', address: 'North Turramurra Recreation Area, North Turramurra NSW 2074', maps: 'https://maps.google.com/?q=North+Turramurra+Recreation+Area', photo: '/images/training/jfp/jfp-ntra-field.jpg', blurb: 'Early morning small groups, Wednesday and Thursday.' },
  { id: 'rydalmere', match: 'rydalmere', name: 'Rydalmere Park', banner: 'RYDALMERE', address: 'Rydalmere Park, Rydalmere NSW 2116', maps: 'https://maps.google.com/?q=Rydalmere+Park+NSW', photo: '/images/training/jfp/jfp-training-4.webp', blurb: 'Early morning small groups on Fridays.' },
]

export const DEFAULT_CONFIG = {
  term: 'Term 4 2026',
  termStart: '2026-10-12',
  weeks: 10,
  priceCents: 85000,
  prices: DEFAULT_PRICES,
  waiverUrl: 'https://airtable.com/apphU4R0BtVIu5YqT/pagdSqWlCfZJyiPxq/form',
  waiverVersion: 'JFP Term 4 2026 online waiver v1',
  staffEmails: ['ligia@jonerfootball.com'],
  // Super admins: everything, including money. Sign in with an emailed code.
  superAdmins: ['leejones@jonerfootball.com', 'ligia@jonerfootball.com'],
  coaches: [
    { id: 'dean', name: 'Dean', airtableName: 'Dean Mac', email: 'jonerfootballdean@gmail.com' },
    { id: 'sam', name: 'Sam', airtableName: 'Sam Yorks', email: 'jonerfootballsam@gmail.com' },
    { id: 'lee', name: 'Lee', airtableName: 'Lee Jones', email: '' },
    { id: 'ruby', name: 'Ruby', airtableName: 'Ruby Fanoosh', email: '' },
    { id: 'luke', name: 'Luke', airtableName: 'Luke Bakos', email: '' },
  ],
  // Coach logins stay off until Lee says so, even for coaches with an email.
  coachLoginsEnabled: false,
  // The JF playing kit is required for every player (Lee, 30 Sept). It is
  // sold by BE Teamsport, so it always opens in a new tab and the family's
  // Joner page stays open behind it. Families confirm it before they pay.
  kitUrl: 'https://www.besteamsport.com.au/collections/joner-football/products/jf-playing-kit',
  kitPriceLabel: 'A$50',
  // Next term: families keep their place with a non-refundable hold fee
  // (taken off next term's price) or pay in full, before it opens to everyone.
  nextTerm: { name: 'Term 1 2027', holdCents: 10000, open: false },
  kitNote: 'The JF playing kit is required for every JFP player. Order it from BE Teamsport before the first session.',
  locations: DEFAULT_LOCATIONS,
  minAge: 6,
  maxAge: 19,
}

export function ownerEmail() { return (process.env.JFP_OWNER_EMAIL || 'leejones@jonerfootball.com').toLowerCase() }

export function validEmail(v) {
  const e = clean(v, 200).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ''
}

function cleanLocations(list, fallback) {
  if (!Array.isArray(list) || !list.length) return fallback
  const out = list.map((l) => ({
    id: clean(l.id, 30).toLowerCase().replace(/[^a-z0-9-]/g, ''),
    match: clean(l.match, 40).toLowerCase(),
    name: clean(l.name, 60),
    address: clean(l.address, 160),
    maps: /^https:\/\//.test(l.maps || '') ? clean(l.maps, 300) : '',
    photo: /^\/images\/[\w./-]+$/.test(l.photo || '') ? l.photo : '',
    blurb: clean(l.blurb, 160),
    banner: clean(l.banner, 30) || (fallback.find((f) => f.id === clean(l.id, 30).toLowerCase())?.banner ?? ''),
  })).filter((l) => l.id && l.name && l.match)
  return out.length ? out : fallback
}

export function normaliseConfig(input = {}) {
  const b = structuredClone(DEFAULT_CONFIG)
  const price = Number(input.priceCents)
  const emails = (list, fallback) => (Array.isArray(list) ? [...new Set(list.map(validEmail).filter(Boolean))] : fallback)
  const supers = emails(input.superAdmins, b.superAdmins)
  const prices = { ...b.prices }
  for (const k of Object.keys(prices)) { const v = Number(input.prices?.[k]); if (Number.isInteger(v) && v > 0 && v <= 2000000) prices[k] = v }
  // A price saved the old way (one term price) still counts.
  if (!input.prices && Number.isInteger(price) && price > 0) prices.group = price
  return {
    term: clean(input.term, 40) || b.term,
    termStart: /^\d{4}-\d{2}-\d{2}$/.test(input.termStart || '') ? input.termStart : b.termStart,
    weeks: Number.isInteger(Number(input.weeks)) && Number(input.weeks) >= 1 && Number(input.weeks) <= 20 ? Number(input.weeks) : b.weeks,
    skipDates: Array.isArray(input.skipDates) ? [...new Map(input.skipDates.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x?.date || '')).map((x) => [x.date, { date: x.date, reason: clean(x.reason, 60) || 'No session' }])).values()].sort((a, c) => a.date.localeCompare(c.date)) : [],
    priceCents: prices.group,
    prices,
    waiverUrl: /^https:\/\//.test(input.waiverUrl || '') ? clean(input.waiverUrl, 500) : b.waiverUrl,
    waiverVersion: clean(input.waiverVersion, 80) || b.waiverVersion,
    staffEmails: emails(input.staffEmails, b.staffEmails),
    // Lee (the owner) is always a super admin and can never be removed.
    superAdmins: [...new Set([ownerEmail(), ...(supers.length ? supers : b.superAdmins)])],
    coaches: Array.isArray(input.coaches) && input.coaches.length
      ? input.coaches.map((c) => ({ id: clean(c.id, 30).toLowerCase().replace(/[^a-z0-9-]/g, ''), name: clean(c.name, 60), airtableName: clean(c.airtableName, 80), email: validEmail(c.email) })).filter((c) => c.id && c.name)
      : b.coaches,
    coachLoginsEnabled: input.coachLoginsEnabled === true,
    kitUrl: /^https:\/\//.test(input.kitUrl || '') ? clean(input.kitUrl, 500) : (input.kitUrl === '' ? '' : b.kitUrl),
    kitNote: clean(input.kitNote, 300) || b.kitNote,
    kitPriceLabel: clean(input.kitPriceLabel, 20) || b.kitPriceLabel,
    nextTerm: {
      name: clean(input.nextTerm?.name, 40) || b.nextTerm.name,
      holdCents: Number.isInteger(Number(input.nextTerm?.holdCents)) && Number(input.nextTerm.holdCents) > 0 && Number(input.nextTerm.holdCents) <= 200000 ? Number(input.nextTerm.holdCents) : b.nextTerm.holdCents,
      open: input.nextTerm?.open === true,
    },
    locations: cleanLocations(input.locations, b.locations),
    minAge: Number(input.minAge) >= 3 && Number(input.minAge) <= 18 ? Number(input.minAge) : b.minAge,
    maxAge: Number(input.maxAge) >= 5 && Number(input.maxAge) <= 25 ? Number(input.maxAge) : b.maxAge,
  }
}

export async function getConfig() { return normaliseConfig((await kvGetJson(keys.config())) || {}) }
export async function saveConfig(partial) {
  const next = normaliseConfig({ ...(await getConfig()), ...partial })
  await kvSetJson(keys.config(), next)
  return next
}
export function coachById(config, id) { return config.coaches.find((c) => c.id === id) || null }
export function coachByAirtableName(config, name) {
  const n = clean(name, 80).toLowerCase()
  if (!n) return null
  return config.coaches.find((c) => c.airtableName.toLowerCase() === n || c.name.toLowerCase() === n.split(' ')[0]) || null
}
export function locationFor(config, name) {
  const n = clean(name, 80).toLowerCase()
  return config.locations.find((l) => n.includes(l.match)) || { id: n.replace(/[^a-z0-9]+/g, '-') || 'other', match: n, name: clean(name, 80) || 'Other', address: clean(name, 80), maps: '', photo: '', blurb: '' }
}

// ---------- time and dates ----------

// "4:20pm" -> "16:20". Returns '' if it cannot be read.
export function to24h(label) {
  const m = String(label || '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
  if (!m) return ''
  let h = Number(m[1]) % 12
  if (m[3] === 'pm') h += 12
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`
}

export function sessionDates(config, day) {
  const idx = DAYS.indexOf(day)
  if (idx < 0) return []
  const start = new Date(`${config.termStart}T00:00:00Z`)
  const startIdx = (start.getUTCDay() + 6) % 7 // Monday = 0
  const first = new Date(start.getTime() + ((idx - startIdx + 7) % 7) * 86400000)
  const off = new Set((config.skipDates || []).map((x) => x.date))
  // Public holidays and cancelled sessions are simply not sessions: the
  // dates, calendars and pro rata all count only the real ones.
  return Array.from({ length: config.weeks }, (_, k) => new Date(first.getTime() + k * 7 * 86400000).toISOString().slice(0, 10)).filter((d) => !off.has(d))
}

// The weekly dates skipped for a day, with why (for calendars and pages).
export function skippedDates(config, day) {
  const idx = DAYS.indexOf(day)
  return (config.skipDates || []).filter((x) => DAYS[(new Date(`${x.date}T00:00:00Z`).getUTCDay() + 6) % 7] === DAYS[idx])
}

// NSW public holidays Lee may want off, offered in Settings with one tap.
export const NSW_HOLIDAYS = [
  { date: '2026-10-05', reason: 'Labour Day' },
  { date: '2026-12-25', reason: 'Christmas Day' },
  { date: '2026-12-28', reason: 'Boxing Day (observed)' },
  { date: '2027-01-01', reason: "New Year's Day" },
  { date: '2027-01-26', reason: 'Australia Day' },
  { date: '2027-03-26', reason: 'Good Friday' },
  { date: '2027-03-27', reason: 'Easter Saturday' },
  { date: '2027-03-29', reason: 'Easter Monday' },
  { date: '2027-04-26', reason: 'Anzac Day (observed)' },
  { date: '2027-06-14', reason: "King's Birthday" },
  { date: '2027-10-04', reason: 'Labour Day' },
  { date: '2027-12-27', reason: 'Christmas Day (observed)' },
  { date: '2027-12-28', reason: 'Boxing Day (observed)' },
]

export function dateLabel(iso) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00Z`)).replace(',', '')
}

// Today's date in Sydney, as 2026-10-14.
export function sydneyToday(nowMs = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
}

// Sessions from a start date to the end of term, for a weekly group on `day`.
export function sessionsFrom(config, day, fromIso) {
  const all = sessionDates(config, day)
  return fromIso ? all.filter((d) => d >= fromIso) : all
}

// What a player pays. Term products are pro rata: joining in week 4 of 10
// pays for the 7 sessions left. Two players in one booking (siblings) pay the
// two place rate each. Rounded to whole dollars.
export function priceFor(config, { product = 'group', day, fromIso, players = 1 } = {}) {
  const prod = productFor(product)
  let key = prod.key
  if (players >= 2 && key === 'group') key = 'twoAWeek'
  const unitFull = Math.round((config.prices[key] ?? DEFAULT_PRICES[key]) / productFor(key).perPlaces)
  // A day's term is its real sessions: 10 weeks less any holidays that day.
  const of = day ? sessionDates(config, day).length || config.weeks : config.weeks
  const sessions = prod.proRata && day ? sessionsFrom(config, day, fromIso).length : of
  const unit = prod.proRata && sessions < of ? Math.round((unitFull * sessions) / of / 100) * 100 : unitFull
  return { product: key, type: productFor(key).type, unitCents: unit, unitFullCents: unitFull, totalCents: unit * players, sessions, of, proRata: prod.proRata && sessions < of, players }
}

// The first session still to come for this group.
// Today's session counts only until it has started (Sydney time).
export function nextSessionDate(config, day, nowMs = Date.now(), time = '') {
  const today = sydneyToday(nowMs)
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(nowMs))
  const started = time && to24h(time) && to24h(time) <= now
  return sessionDates(config, day).find((d) => d > today || (d === today && !started)) || ''
}

export function dayOrder(day) { const i = DAYS.indexOf(day); return i < 0 ? 9 : i }

// Age on the first day of term, from an ISO date of birth.
export function ageOn(dob, onIso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dob || '')) return null
  const [y, m, d] = dob.slice(0, 10).split('-').map(Number)
  const [oy, om, od] = onIso.split('-').map(Number)
  let age = oy - y
  if (om < m || (om === m && od < d)) age -= 1
  return age >= 0 && age < 100 ? age : null
}

// ---------- groups ----------

// A group is one day, time and place. Where several coaches run the same
// early morning session side by side (North Turramurra, Rydalmere), each
// coach's group is its own group: the id ends with the coach, and Airtable's
// Coach column says which one a player is in.
export function groupId(day, time, location, coachId = '') {
  const base = `${day.slice(0, 3)}-${to24h(time).replace(':', '') || time}-${location}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return coachId ? `${base}-${String(coachId).toLowerCase().replace(/[^a-z0-9]+/g, '')}` : base
}

export function validateGroup(input, config, existing = {}) {
  const errors = []
  const merged = { ...existing, ...input }
  if (!DAYS.includes(merged.day)) errors.push('Day must be a weekday name.')
  if (!to24h(merged.time)) errors.push('Time must look like 4:20pm.')
  if (!clean(merged.location, 80)) errors.push('Location is required.')
  if (merged.coachId && !coachById(config, merged.coachId)) errors.push('Unknown coach.')
  const capacity = Number(merged.capacity)
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 60) errors.push('Capacity must be a whole number from 0 to 60.')
  if (!MODES.includes(merged.mode)) errors.push('Mode must be book, apply, enquire or closed.')
  const duration = Number(merged.durationMin ?? 60)
  if (!Number.isInteger(duration) || duration < 15 || duration > 180) errors.push('Duration must be 15 to 180 minutes.')
  const minAge = merged.minAge == null || merged.minAge === '' ? null : Number(merged.minAge)
  const maxAge = merged.maxAge == null || merged.maxAge === '' ? null : Number(merged.maxAge)
  if ((minAge != null && (!Number.isInteger(minAge) || minAge < 3 || minAge > 25)) || (maxAge != null && (!Number.isInteger(maxAge) || maxAge < 3 || maxAge > 25))) errors.push('Ages must be whole numbers from 3 to 25.')
  if (minAge != null && maxAge != null && minAge > maxAge) errors.push('The youngest age cannot be above the oldest.')
  const label = LABELS.includes(merged.label) ? merged.label : 'Small group'
  const requirementsText = String(merged.requirementsText ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200)
  const girls = ['no', 'suggested', 'yes'].includes(merged.girlsOnly) ? merged.girlsOnly : 'no'
  const byCoach = merged.byCoach === true
  if (byCoach && !merged.coachId) errors.push('A coach group needs a coach.')
  const product = PRODUCTS.some((p) => p.key === merged.product) ? merged.product : (label === 'Pathway' ? 'pathway' : label === '1 to 1' ? 'oneToOneTerm' : 'group')
  const questions = Array.isArray(merged.questions) ? merged.questions.filter((q) => QUESTIONS[q]) : DEFAULT_QUESTIONS
  const requirements = Array.isArray(merged.requirements) ? [...new Set(merged.requirements.filter((q) => REQUIREMENTS[q]))] : []
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    group: {
      id: existing.id || groupId(merged.day, merged.time, merged.location, byCoach ? merged.coachId : ''),
      byCoach,
      day: merged.day,
      time: clean(merged.time, 10).toLowerCase().replace(/\s+/g, ''),
      location: clean(merged.location, 80),
      coachId: merged.coachId || '',
      extraCoachIds: Array.isArray(merged.extraCoachIds) ? merged.extraCoachIds.filter((c) => coachById(config, c) && c !== merged.coachId) : [],
      programme: clean(merged.programme, 60) || 'JFP 10 weeks',
      label,
      capacity,
      mode: merged.mode,
      durationMin: duration,
      minAge,
      maxAge,
      // draft: worked out from who is in the group today, Lee still to confirm.
      ageStatus: merged.ageStatus === 'confirmed' ? 'confirmed' : 'draft',
      // suggested: looks girls only from the roster, not enforced until 'yes'.
      girlsOnly: girls,
      publicNote: clean(merged.publicNote, 200),
      // Apply groups: whether we may offer a trial first, and what we ask.
      trials: merged.trials !== false,
      questions,
      requirements,
      // Lee's own words about who the group is for, under the ticked lines.
      requirementsText,
      product,
      updatedAt: new Date().toISOString(),
    },
  }
}

function parse(v) { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return null } }

export function sortGroups(list) {
  return list.sort((a, b) => dayOrder(a.day) - dayOrder(b.day) || to24h(a.time).localeCompare(to24h(b.time)) || a.location.localeCompare(b.location))
}
export async function listGroups() {
  const raw = await kvCommand(['HGETALL', keys.groups()])
  const out = []
  for (let i = 0; i + 1 < (raw || []).length; i += 2) { const g = parse(raw[i + 1]); if (g) out.push(normaliseStoredGroup(g)) }
  return sortGroups(out)
}
// Groups saved before age bands existed still read cleanly.
export function normaliseStoredGroup(g) {
  const out = { label: 'Small group', minAge: null, maxAge: null, ageStatus: 'draft', girlsOnly: 'no', extraCoachIds: [], publicNote: '', byCoach: false, trials: true, questions: DEFAULT_QUESTIONS, requirements: [], requirementsText: '', product: g?.label === 'Pathway' ? 'pathway' : 'group', ...g }
  if (!LABELS.includes(out.label)) out.label = 'Small group'
  return out
}
export async function getGroup(id) { const g = parse(await kvCommand(['HGET', keys.groups(), clean(id, 80)])); return g ? normaliseStoredGroup(g) : null }
export async function saveGroup(group) { await kvCommand(['HSET', keys.groups(), group.id, JSON.stringify(group)]); return group }
export async function deleteGroup(id) { await kvCommand(['HDEL', keys.groups(), clean(id, 80)]) }

// Does this age fit the group? Groups without a band take the whole program range.
export function ageFits(group, age, config) {
  if (!Number.isInteger(age)) return false
  const lo = group.minAge ?? config.minAge
  const hi = group.maxAge ?? config.maxAge
  return age >= lo && age <= hi
}

// ---------- places ----------

// One script for taking and resizing a hold. Purge lapsed holds, count what
// others hold, and take `want` places for this booking only if they fit in
// what is left. Re-running it for the same booking resizes its hold (1 place
// reserved on opening the form can become 3 at Pay) in one atomic step.
// ARGV: now, available (capacity minus Airtable players), want, expiry, bookingId.
export const HOLD_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local own = 0
for i = 1, 20 do
  if redis.call('ZSCORE', KEYS[1], ARGV[5] .. '#' .. i) then own = own + 1 end
end
local want = tonumber(ARGV[3])
if redis.call('ZCARD', KEYS[1]) - own + want > tonumber(ARGV[2]) then return 0 end
for i = 1, 20 do redis.call('ZREM', KEYS[1], ARGV[5] .. '#' .. i) end
for i = 1, want do
  redis.call('ZADD', KEYS[1], ARGV[4], ARGV[5] .. '#' .. i)
end
return 1`

export function members(bookingId, n) { return Array.from({ length: n }, (_, i) => `${bookingId}#${i + 1}`) }

export async function holdPlaces({ gid, bookingId, want, available, expiresMs, nowMs = Date.now() }) {
  return Number(await kvCommand(['EVAL', HOLD_SCRIPT, '1', keys.seats(gid), String(nowMs), String(available), String(want), String(expiresMs), bookingId])) === 1
}
// Paid: keep the places until Airtable has the rows.
export async function confirmPlaces(gid, bookingId, n) {
  await kvCommand(['ZADD', keys.seats(gid), ...members(bookingId, n).flatMap((m) => [String(CONFIRMED_SCORE), m])])
}
// Airtable now counts these players. Let the KV places lapse shortly, after
// every cached count has had time to refresh.
export async function settlePlaces(gid, bookingId, n, nowMs = Date.now()) {
  const until = String(nowMs + SETTLE_SECONDS * 1000)
  await kvCommand(['ZADD', keys.seats(gid), 'XX', ...members(bookingId, Math.max(n, 1)).flatMap((m) => [until, m])])
}
export async function releasePlaces(gid, bookingId) {
  await kvCommand(['ZREM', keys.seats(gid), ...members(bookingId, 20)])
}
export async function onlineCounts(gids, nowMs = Date.now()) {
  if (!gids.length) return {}
  const res = await kvPipeline(gids.flatMap((g) => [['ZREMRANGEBYSCORE', keys.seats(g), '-inf', String(nowMs)], ['ZCARD', keys.seats(g)]]))
  return Object.fromEntries(gids.map((g, i) => [g, Number(res[i * 2 + 1] || 0)]))
}

// Morning or afternoon on the timetable.
export function periodOf(group) { return (to24h(group.time) || '12:00') < '12:00' ? 'am' : 'pm' }

export function placesLeft(group, airtableCount, onlineCount) {
  return Math.max(0, Number(group.capacity || 0) - Number(airtableCount || 0) - Number(onlineCount || 0))
}

// A parent may hold places in a few groups at once (siblings), not every group.
export const MAX_HOLDS_PER_PARENT = 3
export async function parentHoldCount(email, nowMs = Date.now()) {
  const res = await kvPipeline([['ZREMRANGEBYSCORE', keys.holdsBy(email), '-inf', String(nowMs)], ['ZCARD', keys.holdsBy(email)]])
  return Number(res[1] || 0)
}
export async function noteParentHold(email, bookingId, expiresMs) {
  await kvPipeline([['ZADD', keys.holdsBy(email), String(expiresMs), bookingId], ['EXPIRE', keys.holdsBy(email), '7200']])
}
export async function dropParentHold(email, bookingId) {
  if (email) await kvCommand(['ZREM', keys.holdsBy(email), bookingId])
}

// ---------- Stripe Checkout ----------

// Close a Checkout Session so it can no longer be paid. Returns
//   'expired'  we closed it, or it had already lapsed: safe to release
//   'complete' it was paid: never cancel, the payment is on its way
//   'error'    we could not tell: leave everything as it is
export async function closeCheckout(sessionId) {
  if (!sessionId) return 'expired'
  try {
    await stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, { method: 'POST', body: {} })
    return 'expired'
  } catch {
    try {
      const s = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionId)}`)
      if (s.status === 'complete' || s.payment_status === 'paid') return 'complete'
      if (s.status === 'expired') return 'expired'
    } catch {}
    return 'error'
  }
}

// ---------- bookings, applications, payment requests ----------

const LONG = 60 * 60 * 24 * 500
export async function saveBooking(b) { await kvSetJson(keys.booking(b.id), b, b.status === 'reserving' ? 86400 : LONG); return b }
export async function getBooking(id) { const c = clean(id, 60); return c ? kvGetJson(keys.booking(c)) : null }
export async function indexBooking(b) { await kvCommand(['ZADD', keys.bookings(), String(Date.parse(b.createdAt)), b.id]) }
async function listIndex(indexKey, recordKey, limit) {
  const ids = await kvCommand(['ZREVRANGE', indexKey, '0', String(limit - 1)])
  if (!ids?.length) return []
  return (await kvPipeline(ids.map((id) => ['GET', recordKey(id)]))).map(parse).filter(Boolean)
}
export async function listBookings(limit = 1000) { return listIndex(keys.bookings(), keys.booking, limit) }

// kind: application (Pathway, squads), waitlist (full groups), enquiry (1 to 1)
export async function saveApplication(a) { await kvSetJson(keys.application(a.id), a, LONG); await kvCommand(['ZADD', keys.applications(), String(Date.parse(a.createdAt)), a.id]); return a }
export async function getApplication(id) { const c = clean(id, 60); return c ? kvGetJson(keys.application(c)) : null }
export async function listApplications(limit = 1000) { return listIndex(keys.applications(), keys.application, limit) }

// A request for a family to pay, raised by staff (admin add, balance) or by
// an approved application. Paying it runs through Stripe like a booking.
export async function savePayreq(p) { await kvSetJson(keys.payreq(p.id), p, LONG); await kvCommand(['ZADD', keys.payreqs(), String(Date.parse(p.createdAt)), p.id]); return p }
export async function getPayreq(id) { const c = clean(id, 60); return c ? kvGetJson(keys.payreq(c)) : null }
export async function listPayreqs(limit = 1000) { return listIndex(keys.payreqs(), keys.payreq, limit) }

// ---------- audit ----------

// Every staff change, newest first. Kept to the last 5000.
export async function audit(entry) {
  const row = { at: new Date().toISOString(), ...entry }
  await kvPipeline([['LPUSH', keys.audit(), JSON.stringify(row)], ['LTRIM', keys.audit(), '0', '4999']])
  return row
}
export async function listAudit(limit = 300) {
  return ((await kvCommand(['LRANGE', keys.audit(), '0', String(limit - 1)])) || []).map(parse).filter(Boolean)
}

// ---------- small helpers ----------

export function tokenMatches(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || supplied.length !== expected.length || !expected) return false
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}
export function normName(v) { return String(v || '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '') }
export function digits(v) { return String(v || '').replace(/\D/g, '') }

// ---------- parent access cookie (the shared booking password) ----------

const PARENT_COOKIE = 'jf_jfp'
function sha(v) { return crypto.createHash('sha256').update(String(v)).digest() }
export function parentPasswordMatches(supplied, expected = process.env.JFP_BOOKING_PASSWORD) {
  if (!expected || typeof supplied !== 'string') return false
  return crypto.timingSafeEqual(sha(supplied), sha(expected))
}
function pv(pw = process.env.JFP_BOOKING_PASSWORD) { return pw ? sha(pw).toString('hex').slice(0, 12) : '' }
function sign(payload, secret) { return crypto.createHmac('sha256', secret).update(`jf-jfp-v1:${payload}`).digest('base64url') }
export function signParentCookie({ secret = process.env.HOLIDAY_SIGNING_SECRET, nowMs = Date.now() } = {}) {
  if (!secret) throw new Error('Signing secret is not configured.')
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(nowMs / 1000) + 14 * 86400, pv: pv() })).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}
export function hasParentAccess(req, { secret = process.env.HOLIDAY_SIGNING_SECRET, nowMs = Date.now() } = {}) {
  const token = String(req.headers?.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${PARENT_COOKIE}=`))?.slice(PARENT_COOKIE.length + 1)
  if (!token || !secret || !process.env.JFP_BOOKING_PASSWORD) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig || !tokenMatches(sig, sign(payload, secret))) return false
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return d.exp * 1000 > nowMs && d.pv === pv()
  } catch { return false }
}
export function parentCookieHeader(token) { return `${PARENT_COOKIE}=${token}; Max-Age=${14 * 86400}; Path=/; SameSite=Lax; Secure; HttpOnly` }
export function requireParentAccess(req, res) {
  if (hasParentAccess(req)) return true
  res.status(401).json({ success: false, error: 'Enter the booking password to continue.', code: 'no_access' })
  return false
}
