// Removed players stay on file (Lee, 14 Oct 2026: "they shouldn't leave the
// database. If we want to re-add them later in the term or next term, we just
// search their name, add them back, boom").
//
// How the data works (unchanged writes, so Money, registers, coach alerts and
// Lee's Airtable dashboard keep counting exactly as before):
//   - Term 4 Players is the live roster. Removing a player still takes them
//     off it (a row with money paid stays as Dropped, holding no place).
//   - "Players dropped from term 4" (TABLES.dropped) is the permanent record
//     of every removal: contact, reason, details, who, when, the group, and a
//     copy of the whole Term 4 row. It is never deleted.
//   - Player information (JFP Player Profiles) and waivers are their own
//     tables and removal never touches them.
// This module reads those three back together: the Removed list, the "Find
// an existing player" results, the prefill for adding them back (contacts,
// own contact, profile, waiver, the group they were in), and the mark on the
// dropped row once they are back ("Restored", with a line saying where).
import { audit, clean, listAudit, listGroups, locationFor, normName, sydneyToday, groupId as makeGroupId, emailsIn } from './_jfp-store.js'
import { getDroppedRow, listDropped, loadRoster, placeInGroups, updateDroppedRow, waiverFor, isoDate, appendNote } from './_jfp-airtable.js'
import { findProfile, profileKey, profileView } from './_jfp-profiles.js'
import { isOwnContactNotes } from './_jfp-contact.js'

const cents = (aud) => (typeof aud === 'number' ? Math.round(aud * 100) : 0)
const DROPPED_ID = /^rec[A-Za-z0-9]{14}$/

function copyOf(d) {
  try { const c = JSON.parse(d['Term 4 Row Copy'] || ''); return c && typeof c === 'object' ? c : {} } catch { return {} }
}
function dateLabel(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short' }) : ''
}

// The group a removed player was in, if it is still on the Timetable: the
// row copy's session and coach, settled the way the Timetable settles rows.
function groupsFor(list, groups, config) {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const rows = list.map((x) => {
    const base = x.day && x.time && x.location ? makeGroupId(x.day, x.time, x.location) : ''
    return { id: x.key, day: x.day, time: x.time, location: x.location, coach: x.coach, groupId: base, sessionId: base }
  })
  return placeInGroups({ players: rows }, groups, config).then((placed) => Object.fromEntries(placed.players.map((r) => {
    const g = byId.get(r.groupId)
    return [r.id, g ? { groupId: g.id, groupLabel: `${g.day} ${g.time}, ${locationFor(config, g.location).name}` } : { groupId: '', groupLabel: '' }]
  })))
}

// Everyone removed: the dropped table, and players removed before it existed
// (still in Term 4 as Dropped or Not Returning). Newest first. Same fields the
// Admin > Removed players page has always had, plus where they were (groupId)
// and whether they are back.
export async function removedPlayers(config, { roster = null, dropped = null, log = null, groups = null } = {}) {
  ;[roster, dropped, log, groups] = await Promise.all([roster || loadRoster({ fresh: true }), dropped || listDropped(), log || listAudit(2000).then((l) => l.filter((e) => e.action === 'player.remove')), groups || listGroups()])
  const fromTable = dropped.map((d) => {
    const c = copyOf(d)
    return {
      droppedId: d.id, sourceRowId: d['Source Term 4 Record ID'] || '',
      name: d['Player Name'] || '', parent: d['Parent Name'] || '', email: d['Email'] || '', phone: d['Phone Number'] || '',
      term: d['Term Player left'] || '', reason: d['Reason for leaving'] || '', details: d['Reason details'] || '',
      removedAt: d['Removed At'] || '', removedBy: d['Removed By'] || '', session: d['Session'] || '', coach: d['Coach'] || '',
      paymentStatus: d['Payment Status'] || '', type: d['Term 4 Payment Type'] || '', feeCents: cents(d['Term 4 Fee']), paidCents: cents(d['Term 4 Amount Paid']),
      notes: d['Term 4 Notes'] || '', restored: d['Restored'] === true, contacted: d['Contacted'] === true,
      ownContact: isOwnContactNotes(d['Term 4 Notes'] || c['Term 4 Notes']),
      at: { day: c['Term 3 Day'] || '', time: c['Term 3 Time'] || '', location: c['Term 3 Location'] || '', coach: c['Coach'] || d['Coach'] || '' },
    }
  })
  const legacy = roster.players.filter((r) => !r.holdsPlace && !dropped.some((d) => d['Source Term 4 Record ID'] === r.id)).map((r) => {
    const e = log.find((x) => x.target === r.id)
    return { rowId: r.id, name: r.player, parent: r.parent, email: r.email, phone: r.phone, term: config.term, reason: e?.after?.reason || (r.confirmation === 'Not Returning' ? 'Not returning' : ''), details: e?.after?.details || '', removedAt: e?.at || '', removedBy: e?.by || '', session: [r.day, r.time, r.location].filter(Boolean).join(' '), coach: r.coach, paymentStatus: r.paymentStatus, type: r.paymentType, feeCents: cents(r.feeAud), paidCents: cents(r.paidAud), notes: r.notes, status: r.confirmation, legacy: true, ownContact: r.ownContact === true, at: { day: r.day, time: r.time, location: r.location, coach: r.coach } }
  })
  const all = [...fromTable, ...legacy]
  const where = await groupsFor(all.map((p, i) => ({ key: String(i), ...p.at })), groups, config)
  return all.map(({ at, ...p }, i) => ({ ...p, ...where[String(i)] })).sort((x, y) => String(y.removedAt).localeCompare(String(x.removedAt)))
}

// Why players left this term, most common first (Lee keeps count). Every
// removal counts, including players since added back.
export function reasonCounts(players, term) {
  const tally = {}
  for (const p of players) if (!term || !p.term || p.term === term) { const k = p.reason || 'No reason recorded'; tally[k] = (tally[k] || 0) + 1 }
  return Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([reason, count]) => ({ reason, count }))
}

// "Find an existing player": removed players not back yet, shaped like the
// other search results. q is already normName'd.
export function removedMatches(players, q) {
  return players.filter((p) => !p.restored && normName(p.name).includes(q)).map((p) => ({
    name: p.name, parentName: p.ownContact ? '' : p.parent, email: emailsIn(p.email)[0] || p.email || '', mobile: p.phone, ownContact: p.ownContact,
    removed: { droppedId: p.droppedId || '', rowId: p.rowId || '', at: p.removedAt, label: `Removed ${dateLabel(p.removedAt) || 'earlier'}: ${p.reason || 'no reason recorded'}`, reason: p.reason, groupId: p.groupId || '', groupLabel: p.groupLabel || '', session: p.session },
    source: `Removed${p.session ? `, was ${p.session}` : ''}`,
  }))
}

// Everything to add a removed player back: contacts, own contact, player
// information, waiver, date of birth, the group they were in, the removal.
export async function removedPrefill(config, body) {
  const players = await removedPlayers(config)
  const droppedId = clean(body.droppedId, 30), rowId = clean(body.rowId, 30)
  const p = players.find((x) => (droppedId && x.droppedId === droppedId) || (!droppedId && rowId && x.rowId === rowId))
  if (!p) return { status: 404, body: { success: false, error: 'That removed player was not found. Refresh and try again.' } }
  const email = emailsIn(p.email)[0] || ''
  const roster = await loadRoster()
  const prof = await findProfile({ key: profileKey(p.name, email), rowIds: [p.sourceRowId || p.rowId].filter(Boolean) }).catch(() => null)
  const waiver = waiverFor(p.name, { emails: [email], phones: [p.phone] }, roster.waivers)
  const t3 = roster.term3.find((r) => normName(r.player) === normName(p.name))
  const profile = profileView(prof)
  const dob = profile?.dob || isoDate(t3?.dob) || waiver?.dob || ''
  return {
    status: 200,
    body: {
      success: true,
      player: {
        name: p.name, parentName: p.ownContact ? '' : p.parent, email, mobile: p.phone, ownContact: p.ownContact, dob,
        profile: profile ? Object.fromEntries(Object.entries(profile).filter(([k]) => !['photo', 'updatedAt', 'updatedBy', 'updatedFrom'].includes(k))) : null,
        waiver: Boolean(waiver),
        removed: { droppedId: p.droppedId || '', rowId: p.rowId || '', at: p.removedAt, by: p.removedBy, reason: p.reason, details: p.details, session: p.session, groupId: p.groupId, groupLabel: p.groupLabel, term: p.term, type: p.type, feeCents: p.feeCents, paidCents: p.paidCents, label: `Removed ${dateLabel(p.removedAt) || 'earlier'}: ${p.reason || 'no reason recorded'}` },
      },
    },
  }
}

// An add that came from a removed player (body.fromRemoved = the dropped
// row id): the dropped row, if it is still open. Never blocks the add.
export async function removedSource(body) {
  const id = clean(body?.fromRemoved, 30)
  if (!DROPPED_ID.test(id)) return null
  try { const d = await getDroppedRow(id); return d && d['Restored'] !== true ? d : null } catch (e) { console.error('jfp removed source read failed', e); return null }
}
export function backNote(notes, d) {
  if (!d) return notes
  return appendNote(notes, `Added back after being removed ${dateLabel(d['Removed At']) || 'earlier'} (${d['Reason for leaving'] || 'no reason recorded'}).`)
}
// After the add: the dropped row says they are back, where, and as which row.
export async function markAddedBack(principal, d, { rowId, where }) {
  if (!d) return
  try {
    await updateDroppedRow(d.id, { 'Restored': true, 'Reason details': `${d['Reason details'] ? `${d['Reason details']}\n` : ''}Added back ${sydneyToday()} by ${principal.name} to ${where || 'no group yet'} as ${rowId}.` })
    await audit({ by: principal.email, action: 'player.addBack', target: rowId, after: { name: d['Player Name'], from: d.id, where: where || '' } })
  } catch (e) { console.error('jfp mark added back failed', e) }
}
