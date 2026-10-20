// Coach pay (Lee, 20 Oct 2026: "coaches have to log how many players they
// have coached! we pay hourly rates based on how many players they have !
// match to register 100%"). Each coach's agreed rate card, their own invoice
// details, and the price of each invoice line, worked out from the register.
//
// Private: rate cards and pay details are never in Settings (config), never
// sent to another coach, and never to Hermes. A coach sees only their own
// lines and amounts; Lee and Ligia see everyone's.
//
//   jfp:coach-pay:cards     hash coachId -> rate card (cents)
//   jfp:coach-pay:details   hash coachId -> the coach's own invoice details
//
// A rate card: bands[0..6] = 1 player .. 7 or more, an hour; weekendExtra an
// hour on top for ordinary JFP sessions on Saturday or Sunday (not Joners
// Juniors, not Pathway); pathwayFlat for a 45-minute Pathway class whatever
// the player count; Joners Juniors an hour (one rate for head or shadow, Lee
// 20 Oct 2026: "keep $50 across the board"); office an hour; devSesh flat for
// each Dev Sesh ("per dev sesh"); camps are always agreed with Lee before the
// camp (TBC).
//
// Who counts (Lee, 20 Oct 2026: "if they have paid for the program upfront
// and they dont show, they still get paid for that session!"): players marked
// Present, plus players who paid the term upfront and were marked Absent or
// Notified. Session-by-session, drop-in, Pro and trial players count only
// when Present.
// A line with no agreed rate is never guessed: it waits for Lee or Ligia.
import { kvCommand, clean, audit, sydneyToday, isSessionType } from './_jfp-store.js'

const CARDS = 'jfp:coach-pay:cards'
const DETAILS = 'jfp:coach-pay:details'
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
const centsOk = (c) => Number.isInteger(c) && c > 0 && c <= 100000
export const BAND_LABELS = ['1 player', '2 players', '3 players', '4 players', '5 players', '6 players', '7 or more']
const money = (c) => `A$${(c / 100).toFixed(2)}`

export async function getCard(coachId) { return parse(await kvCommand(['HGET', CARDS, clean(coachId, 30)])) }
export async function allCards() {
  const raw = (await kvCommand(['HGETALL', CARDS])) || []
  const out = {}
  if (Array.isArray(raw)) { for (let i = 1; i < raw.length; i += 2) { const x = parse(raw[i]); if (x) out[raw[i - 1]] = x } }
  else for (const [k, v] of Object.entries(raw)) { const x = parse(v); if (x) out[k] = x }
  return out
}

// Pure: a clean card from what Lee or Ligia typed (dollars or cents). Returns { error } or the card.
export function checkCard(body) {
  const c = (v) => (v === '' || v == null ? null : Math.round(Number(v)))
  const bands = Array.isArray(body.bands) ? body.bands.map(c) : []
  if (bands.length !== 7 || bands.some((b) => !centsOk(b))) return { error: 'Set all seven player-count rates (1 player to 7 or more).' }
  const card = { bands }
  for (const k of ['weekendExtra', 'pathwayFlat', 'jjHead', 'jjShadow', 'office', 'devSesh']) {
    const v = c(body[k])
    if (v == null) continue
    if (!centsOk(v)) return { error: `That ${k} rate is not right.` }
    card[k] = v
  }
  // An agreed rate for one session (Lee, 20 Oct 2026: a coach's custom rate for a 1on1), an hour.
  if (body.custom && typeof body.custom === 'object') {
    const custom = {}
    for (const [gid, v] of Object.entries(body.custom).slice(0, 40)) { const cents = c(v); if (cents == null) continue; if (!centsOk(cents)) return { error: 'That custom session rate is not right.' }; custom[clean(gid, 80)] = cents }
    if (Object.keys(custom).length) card.custom = custom
  }
  card.camps = 'tbc'
  card.source = clean(body.source, 200)
  return card
}

export async function saveCard(principal, coachId, card) {
  const before = await getCard(coachId)
  const next = { ...card, coachId, savedBy: principal.email, savedAt: new Date().toISOString() }
  await kvCommand(['HSET', CARDS, coachId, JSON.stringify(next)])
  // The audit says it changed, never the amounts.
  await audit({ by: principal.email, action: before ? 'coach-pay.card.change' : 'coach-pay.card.set', target: coachId })
  return next
}

// The coach's own details for their invoice (the coaches' own layout: name, ABN,
// address, phone, email, and where to pay).
export const DETAIL_FIELDS = { fullName: 80, abn: 20, address: 160, phone: 30, email: 120, accountName: 80, bsb: 10, accountNumber: 20 }
export async function getDetails(coachId) { return parse(await kvCommand(['HGET', DETAILS, clean(coachId, 30)])) || {} }
export async function saveDetails(principal, coachId, body) {
  const out = {}
  for (const [k, n] of Object.entries(DETAIL_FIELDS)) out[k] = clean(body[k], n)
  if (out.abn && !/^\d{11}$/.test(out.abn.replace(/\s/g, ''))) return { error: 'An ABN is 11 digits.' }
  if (out.bsb && !/^\d{3}-?\d{3}$/.test(out.bsb.replace(/\s/g, ''))) return { error: 'A BSB is 6 digits, like 062-246.' }
  out.updatedAt = new Date().toISOString()
  await kvCommand(['HSET', DETAILS, coachId, JSON.stringify(out)])
  await audit({ by: principal.email, action: 'coach-pay.details', target: coachId })
  return { details: out }
}

// Paid the whole program upfront: a term or half-term fee that is paid (not
// session by session, drop-in, Pro sessions or a trial).
export const paidUpfront = (row) => Boolean(row) && !isSessionType(row.paymentType) && !/trial/i.test(row.paymentType || '') && /^(paid|partially paid)$/i.test(row.paymentStatus || '')

// A group's register on a date. rowOf(rowId) -> { name, paymentType, paymentStatus } | null.
// { marked, present: [{ rowId, name }], paidAway: [{ rowId, name, mark }], counted: [...present, ...paidAway] }
export async function registerFor(groupId, date, rowOf) {
  const raw = (await kvCommand(['HGETALL', `jfp:att:${groupId}:${date}`])) || []
  const marks = {}
  if (Array.isArray(raw)) { for (let i = 1; i < raw.length; i += 2) marks[raw[i - 1]] = raw[i] } else Object.assign(marks, raw)
  const ids = Object.keys(marks)
  const who = (rowId) => ({ rowId, name: rowOf(rowId)?.name || 'Player' })
  const present = ids.filter((id) => marks[id] === 'Present').map(who)
  const paidAway = ids.filter((id) => ['Absent', 'Notified'].includes(marks[id]) && paidUpfront(rowOf(id))).map((id) => ({ ...who(id), mark: marks[id] }))
  return { marked: ids.length > 0, present, paidAway, counted: [...present, ...paidAway], marks }
}

const isWeekend = (iso) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay())
export const isPathwayGroup = (g) => g?.label === 'Pathway' || g?.product === 'pathway'
const isJJGroup = (g) => g?.label === 'Joners Juniors'
const hourly = (rate, minutes) => Math.round((rate * minutes) / 60)

// Pure: the price of one invoice line. line: { kind, minutes, date, groupId, note, players? }.
// ctx: { card, group, register: { marked, counted } | null }. When the coach
// ticked the players on their hours (line.players), that count prices it; the
// register is the check (a flag when they differ).
// Returns { cents (null when Lee or Ligia must set it), basis, players, flags }.
export function priceLine(line, { card, group, register }) {
  const picked = Array.isArray(line.players) && line.players.length ? line.players.length : 0
  const counted = register?.counted?.length ?? 0
  const tbc = (code, text) => ({ cents: null, basis: text, players: picked || (register?.marked ? counted : null), flags: [{ code, text }] })
  if (!card) return tbc('no-card', 'No rate card yet: Lee sets the amount')
  const jj = line.kind === 'juniors' || isJJGroup(group)
  if (jj) {
    const r = card.jjHead || card.jjShadow
    if (!r) return tbc('no-rate', 'No agreed Joners Juniors rate: Lee sets the amount')
    return { cents: hourly(r, line.minutes), basis: `Joners Juniors, ${money(r)} an hour`, players: null, flags: [] }
  }
  if (line.kind === 'devsesh' && !card.devSesh) return tbc('no-rate', 'No agreed Dev Sesh rate: Lee sets the amount')
  if (line.kind === 'camp') return tbc('camp', 'Camps: the rate is agreed with Lee before the camp')
  if (line.kind === 'admin') {
    if (!card.office) return tbc('no-rate', 'No agreed office rate: Lee sets the amount')
    return { cents: hourly(card.office, line.minutes), basis: `Office hours, ${money(card.office)} an hour`, players: null, flags: [] }
  }
  if (['session', 'cover'].includes(line.kind) && line.groupId) {
    if (!group) return tbc('no-group', 'That group is gone: Lee sets the amount')
    const own = card.custom?.[group.id]
    if (own) return { cents: hourly(own, line.minutes), basis: `Agreed rate for this session, ${money(own)} an hour`, players: picked || counted || null, flags: [] }
    if (!register?.marked && !picked) return tbc('register', 'Register not marked for this session. Mark it, or tick your players in My hours')
    const n = picked || counted
    const flags = []
    if (picked && register?.marked && picked !== counted) flags.push({ code: 'register-diff', text: `You ticked ${picked}, the register counts ${counted}` })
    if (picked && !register?.marked) flags.push({ code: 'register', text: 'Register not marked: players ticked by the coach' })
    if (isPathwayGroup(group)) {
      if (!card.pathwayFlat) return tbc('no-rate', 'No agreed Pathway rate: Lee sets the amount')
      return { cents: card.pathwayFlat, basis: `Pathway class, flat ${money(card.pathwayFlat)}`, players: n, flags: n ? flags : [...flags, { code: 'no-players', text: 'Register shows nobody present' }] }
    }
    if (!n) return tbc('no-players', 'Register shows nobody present: Lee or Ligia check')
    const band = card.bands[Math.min(n, 7) - 1]
    const extra = isWeekend(line.date) && card.weekendExtra ? card.weekendExtra : 0
    return { cents: hourly(band + extra, line.minutes), basis: `${BAND_LABELS[Math.min(n, 7) - 1]}, ${money(band)} an hour${extra ? ` + ${money(extra)} weekend` : ''}`, players: n, flags }
  }
  if (card.devSesh && (line.kind === 'devsesh' || /dev\s*sesh/i.test(line.note || ''))) return { cents: card.devSesh, basis: `Dev Sesh, flat ${money(card.devSesh)}`, players: picked || null, flags: [] }
  return tbc('no-rate', 'No agreed rate for this: Lee sets the amount')
}

// The weekly due date: invoices for the week before are in by Monday 9am.
export function dueMonday(today = sydneyToday()) {
  const d = new Date(`${today}T00:00:00Z`)
  const add = (8 - d.getUTCDay()) % 7 || 7
  d.setUTCDate(d.getUTCDate() + (d.getUTCDay() === 1 ? 0 : add))
  return d.toISOString().slice(0, 10)
}
