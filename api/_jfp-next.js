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
  const full = live ? offer.offerCents : offer.normalCents
  return { ...base, fullCents: full, fullLabel: formatAud(full), afterHoldLabel: formatAud(Math.max(0, full - base.holdCents)), normalCents: offer.normalCents, normalLabel: formatAud(offer.normalCents), offer: live, tier: offer.tier || '', kind: offer.kind || '', offerCents: offer.offerCents }
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
