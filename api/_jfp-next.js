// Next term: current families keep their place before it opens to everyone.
// Each player invited has a status in KV (jfp:next:<term>, field = their
// Term 4 row id) and a row in Airtable "Next term holds":
//   invited  -> held (paid the non-refundable hold fee, taken off next term)
//            -> paid (paid next term in full)
//            -> no   (not returning)
import { kvCommand, keys, audit, formatAud, newId, savePayreq, priceFor, getConfig } from './_jfp-store.js'
import { upsertNextHold } from './_jfp-airtable.js'

export async function nextStatuses(term) {
  const raw = await kvCommand(['HGETALL', keys.next(term)])
  const out = {}
  for (let i = 0; i + 1 < (raw || []).length; i += 2) { try { out[raw[i]] = JSON.parse(raw[i + 1]) } catch {} }
  return out
}
export async function setNextStatus(term, rowId, value) {
  await kvCommand(['HSET', keys.next(term), rowId, JSON.stringify({ ...value, at: new Date().toISOString() })])
}

// Families who said "I want to keep my spot" before next term opened
// (Lee, 13 Oct 2026). Kept apart from the statuses on purpose: a status lets
// a family pay before opening day, interest never does.
export const interestKey = (term) => `jfp:next-interest:${term}`
export async function nextInterest(term) {
  const raw = await kvCommand(['HGETALL', interestKey(term)])
  const out = {}
  for (let i = 0; i + 1 < (raw || []).length; i += 2) { try { out[raw[i]] = JSON.parse(raw[i + 1]) } catch {} }
  return out
}

// What next term costs this player in full, and the hold fee.
export function nextPrices(config, group) {
  const full = priceFor({ ...config, skipDates: [] }, { product: group?.product || 'group', players: 1 }).unitFullCents
  return { fullCents: full, holdCents: config.nextTerm.holdCents, fullLabel: formatAud(full), holdLabel: formatAud(config.nextTerm.holdCents), afterHoldLabel: formatAud(Math.max(0, full - config.nextTerm.holdCents)) }
}

const STATUS_WORD = { invited: 'Invited', held: 'Held', paid: 'Paid in full', no: 'Not returning', interested: 'Wants to keep it' }
export async function recordNext({ term, row, group, status, amountCents, holdCents, paymentId = '', note = '', by }) {
  await upsertNextHold(term, row.id, {
    'Player Name': row.player, 'Parent Name': row.parent, 'Email': row.email, 'Phone': row.phone,
    'Group': group ? `${group.day} ${group.time}, ${group.location}` : [row.day, row.time, row.location].filter(Boolean).join(' '),
    'Coach': row.coach || '', 'Status': STATUS_WORD[status] || status,
    ...(amountCents != null ? { 'Amount Paid': amountCents / 100 } : {}), ...(holdCents != null ? { 'Hold Fee': holdCents / 100 } : {}),
    ...(paymentId ? { 'Payment ID': paymentId } : {}), ...(note ? { 'Notes': note } : {}),
  })
  await audit({ by: by || 'system', action: `next.${status}`, target: row.id, after: { term, player: row.player, amountCents: amountCents ?? null } })
}

// A payment link for next term (hold or full). No Term 4 row changes.
export async function createNextPayreq({ config, row, group, choice, siteUrl, offer = null }) {
  const p = rowNextPrice(config, group, offer)
  const q = {
    id: newId('PAY'), email: row.email, parentName: row.parent, playerNames: [row.player], playerKeys: [row.player.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')], term4Ids: [],
    groupId: group?.id || '', groupLabel: group ? `${group.day} ${group.time}` : '', amountCents: choice === 'hold' ? p.holdCents : p.fullCents,
    reason: choice === 'hold' ? 'next-hold' : 'next-full', productLabel: choice === 'hold' ? `Hold my place for ${config.nextTerm.name}` : `${config.nextTerm.name}, full term`,
    next: { term: config.nextTerm.name, rowId: row.id, choice, holdCents: p.holdCents, fullCents: p.fullCents },
    // The early offer is paid in full: card only, no Afterpay (Lee, 16 Nov 2026).
    afterpay: choice !== 'hold' && !config.nextTerm.fullOnly, status: 'open', createdBy: row.email, createdAt: new Date().toISOString(), expiresAt: '', siteUrl,
  }
  await savePayreq(q)
  return q
}

export async function currentConfig() { return getConfig() }

// ---------- Term 1 2027 offer (Lee, 16 Nov 2026) ----------
// Each current player gets their own early price, kept in KV under
// jfp:next-offer:<term> (field = their Term 4 row id):
//   { tier: 'loyal' | 'current', kind, normalCents, offerCents, note, by, at }
// loyal   = the 24 who trained every term of 2026: one week free (10% off)
// current = everyone else in JFP now: A$50 off per player (Pathway A$25)
// Paid in full by config.nextTerm.offerUntil (Sydney, end of that day), no
// deposit, no instalments. After that date the same player pays normalCents.
export const offerKey = (term) => `jfp:next-offer:${term}`
export const TIER_LABEL = { loyal: 'Loyal 24: first week free', current: 'A$50 off per player' }
export async function nextOffers(term) {
  const raw = await kvCommand(['HGETALL', offerKey(term)])
  const out = {}
  for (let i = 0; i + 1 < (raw || []).length; i += 2) { try { out[raw[i]] = JSON.parse(raw[i + 1]) } catch {} }
  return out
}
// A player off this term's roster (an injury) can keep a next-term place
// that staff marked keep: true on their offer.
export const onNextTerm = (r, offer) => Boolean(r?.holdsPlace || offer?.keep)
export async function saveOffer(term, rowId, value) {
  if (value == null) return kvCommand(['HDEL', offerKey(term), rowId])
  return kvCommand(['HSET', offerKey(term), rowId, JSON.stringify({ ...value, at: new Date().toISOString() })])
}
// Is the early price still on? The whole of offerUntil counts (Sydney time).
export function offerLive(nt, nowMs = Date.now()) {
  if (!nt?.offerUntil) return false
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
  return today <= nt.offerUntil
}
// What this player pays for next term now, with or without an offer.
export function rowNextPrice(config, group, offer, nowMs = Date.now()) {
  const base = nextPrices(config, group)
  if (!offer) return { ...base, normalCents: base.fullCents, normalLabel: base.fullLabel, offer: false, tier: '' }
  const live = offerLive(config.nextTerm, nowMs)
  // A credit carried to next term (Lee, 23 Nov 2026: Lina D'Arrigo, injured,
  // 5 weeks at A$75) comes off both prices, so the "A$50 off" stays true.
  const credit = Math.max(0, Math.round(Number(offer.creditCents) || 0))
  const full = Math.max(0, (live ? offer.offerCents : offer.normalCents) - credit)
  const normal = Math.max(0, offer.normalCents - credit)
  return { ...base, fullCents: full, fullLabel: formatAud(full), afterHoldLabel: formatAud(Math.max(0, full - base.holdCents)), normalCents: normal, normalLabel: formatAud(normal), creditCents: credit, creditLabel: credit ? formatAud(credit) : '', creditNote: credit ? String(offer.creditNote || '') : '', offer: live, tier: offer.tier || '', kind: offer.kind || '', offerCents: offer.offerCents }
}

// One payment for several of a family's players (siblings, two a week).
// next.rows carries each place and its own share, so each is recorded paid.
export async function createNextFamilyPayreq({ config, rows, siteUrl }) {
  const nt = config.nextTerm
  const total = rows.reduce((t, x) => t + x.cents, 0)
  const names = [...new Set(rows.map((x) => x.row.player))]
  const q = {
    id: newId('PAY'), email: rows[0].row.email, parentName: rows[0].row.parent, playerNames: names, playerKeys: names.map((n) => n.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')), term4Ids: [],
    groupId: '', groupLabel: '', amountCents: total, reason: 'next-full', productLabel: `${nt.name}, full term`,
    next: { term: nt.name, rowId: rows[0].row.id, choice: 'full', holdCents: 0, fullCents: total, rows: rows.map((x) => ({ rowId: x.row.id, player: x.row.player, cents: x.cents, groupId: x.row.groupId || '' })) },
    afterpay: nt.fullOnly ? false : true, status: 'open', createdBy: rows[0].row.email, createdAt: new Date().toISOString(), expiresAt: '', siteUrl,
  }
  await savePayreq(q)
  return q
}

// ---------- new families for next term (Lee, 24 Nov 2026: "now ! ASAP") ----------
// Term 1 2027 runs from config.nextTerm.termStart for nextTerm.weeks
// (Lee: "Term 1 starts Mon 2 Feb, 10 weeks"). New families apply on the
// booking page for next term (config.nextTerm.newBookings); Lee or Ligia offer
// a place, and the family pays a no-sign-in link (a quick link with
// next.new). Paid, the place is kept in KV jfp:next-new:<term> and in Airtable
// "Next term holds"; no Term 4 row is touched. Places left for next term:
// every current player still holding a place (until nextTerm.holdUntil, then
// only those who paid or held), plus new families paid or offered.
export const newKey = (term) => `jfp:next-new:${term}`
export function nextTermConfig(config) {
  const nt = config.nextTerm || {}
  return { ...config, term: nt.name || config.term, termStart: nt.termStart || config.termStart, weeks: Number(nt.weeks) || config.weeks, skipDates: Array.isArray(nt.skipDates) ? nt.skipDates : [] }
}
export const newBookingsOpen = (config) => Boolean(config.nextTerm?.open && config.nextTerm?.newBookings && config.nextTerm?.termStart)
export async function nextNew(term) {
  const raw = await kvCommand(['HGETALL', newKey(term)])
  const out = []
  for (let i = 0; i + 1 < (raw || []).length; i += 2) { try { out.push(JSON.parse(raw[i + 1])) } catch {} }
  return out
}
export async function saveNextNew(term, rec) { await kvCommand(['HSET', newKey(term), rec.id, JSON.stringify(rec)]) }
const sydToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
// groupId -> places taken next term. payreqs: open next-new offers count too.
export function nextTaken({ config, roster, statuses, news, payreqs = [], today = sydToday() }) {
  const nt = config.nextTerm || {}
  const holdLive = !nt.holdUntil || today <= nt.holdUntil
  const out = {}
  const add = (gid, n = 1) => { if (gid) out[gid] = (out[gid] || 0) + n }
  for (const r of roster.players) {
    if (!r.holdsPlace || !r.groupId || /trial/i.test(r.paymentType || '')) continue
    const st = statuses[r.id]?.status
    if (st === 'no') continue
    if (holdLive || ['paid', 'held'].includes(st)) add(r.groupId)
  }
  for (const n of news) if (n.status !== 'cancelled') add(n.groupId)
  for (const q of payreqs) if (q.next?.new && ['open', 'checkout'].includes(q.status) && !(q.expiresAt && Date.parse(q.expiresAt) < Date.now())) add(q.next.groupId, (q.next.players || []).length || 1)
  return out
}
