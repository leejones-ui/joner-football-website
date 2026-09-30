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

// What next term costs this player in full, and the hold fee.
export function nextPrices(config, group) {
  const full = priceFor({ ...config, skipDates: [] }, { product: group?.product || 'group', players: 1 }).unitFullCents
  return { fullCents: full, holdCents: config.nextTerm.holdCents, fullLabel: formatAud(full), holdLabel: formatAud(config.nextTerm.holdCents), afterHoldLabel: formatAud(Math.max(0, full - config.nextTerm.holdCents)) }
}

const STATUS_WORD = { invited: 'Invited', held: 'Held', paid: 'Paid in full', no: 'Not returning' }
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
export async function createNextPayreq({ config, row, group, choice, siteUrl }) {
  const p = nextPrices(config, group)
  const q = {
    id: newId('PAY'), email: row.email, parentName: row.parent, playerNames: [row.player], playerKeys: [row.player.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')], term4Ids: [],
    groupId: group?.id || '', groupLabel: group ? `${group.day} ${group.time}` : '', amountCents: choice === 'hold' ? p.holdCents : p.fullCents,
    reason: choice === 'hold' ? 'next-hold' : 'next-full', productLabel: choice === 'hold' ? `Hold my place for ${config.nextTerm.name}` : `${config.nextTerm.name}, full term`,
    next: { term: config.nextTerm.name, rowId: row.id, choice, holdCents: p.holdCents, fullCents: p.fullCents },
    afterpay: choice !== 'hold', status: 'open', createdBy: row.email, createdAt: new Date().toISOString(), expiresAt: '', siteUrl,
  }
  await savePayreq(q)
  return q
}

export async function currentConfig() { return getConfig() }
