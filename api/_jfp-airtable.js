// Airtable is the JFP roster of record. This module reads Term 4 Players (plus
// Term 3 for coaches and dates of birth, and the waiver table), keeps a short
// cache so the parent page stays fast, and writes changes back in the same
// shape staff enter by hand, so Lee's dashboard always shows the truth.
//
// The Term 4 session columns are still labelled "Term 3 Day/Time/Location";
// they hold the Term 4 session, exactly as the Joner Dashboard reads them.
import { kvGetJson, kvSetJson, kvCommand, kvPipeline, keys, groupId, ONLINE_TAG, ADMIN_TAG, coachByAirtableName, ageOn, normName, digits, clean, listGroups, getConfig, locationFor, to24h } from './_jfp-store.js'

const BASE = process.env.AIRTABLE_BASE_ID || 'apphU4R0BtVIu5YqT'
export const TABLES = {
  term4: 'tbl6OIjkU6UsQCeZV',
  term3: 'Term 3 Players',
  ledger: 'tblfrXQLMhOcE2PWH',
  waiver: 'tblLziUfKOv1N0f40',
  attendance: 'tblfwc1VO3ind7cVk',
  // Players removed in the portal: contact, reason and a copy of the Term 4 row.
  dropped: process.env.JFP_DROPPED_TABLE || 'tblLa3AFkRvlUEQEI',
  // Families keeping their place for next term (hold fee, paid, not returning).
  nextHolds: process.env.JFP_NEXT_TABLE || 'tblahicOyFRUCf7bL',
}
// Everyone in these states holds a place. "Not Returning" and "Dropped" do not.
export const HOLDS_PLACE = new Set(['Confirmed', 'Awaiting Reply', 'Needs Follow-up', 'Not Contacted', ''])
const CACHE_SECONDS = 60

function token() {
  const t = process.env.JFP_AIRTABLE_TOKEN || process.env.AIRTABLE_API_TOKEN || process.env.AIRTABLE_TOKEN
  if (!t) throw new Error('JFP Airtable connection is not configured')
  return t
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Airtable allows 5 requests a second per base. Back off on 429 and 5xx a
// few times before giving up; callers record anything that still fails.
export async function airtable(path, { method = 'GET', body } = {}, attempt = 0) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch {}
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 400))
    return airtable(path, { method, body }, attempt + 1)
  }
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${data?.error?.message || data?.error?.type || text.slice(0, 160)}`)
  return data
}

export async function readTable(table, fields = []) {
  const rows = []
  let offset = ''
  do {
    const q = new URLSearchParams({ pageSize: '100' })
    for (const f of fields) q.append('fields[]', f)
    if (offset) q.set('offset', offset)
    const d = await airtable(`${encodeURIComponent(table)}?${q}`)
    rows.push(...(d.records || []))
    offset = d.offset || ''
    if (rows.length > 10000) throw new Error('Airtable result exceeds limit')
  } while (offset)
  return rows
}

function text(f, name) {
  const v = f[name]
  if (Array.isArray(v)) return v.join(', ')
  return v == null ? '' : String(v).trim()
}
const num = (f, name) => (typeof f[name] === 'number' ? f[name] : null)

const TERM4_FIELDS = [
  'Player Name', 'Parent Name', 'Email', 'Phone', 'Term 3 Day', 'Term 3 Time', 'Term 3 Location', 'Coach',
  'Term 4 Confirmation', 'Term 4 Fee', 'Term 4 Amount Paid', 'Term 4 Balance', 'Term 4 Payment Status',
  'Term 4 Payment Type', 'Term 4 Notes', 'Source Term 3 Record ID', 'Term 4 Stripe Fee AUD',
  'Term 4 Net Collected AUD', 'Term 4 Fee Reconciliation', 'Term 4 Payment Link Notes', 'Term 4 Payment Evidence',
  'Training Kit',
]
const TERM3_FIELDS = ['Player Name', 'Parent Name', 'Email', 'Parent Email 2', 'Phone Number', 'Date of Birth', 'Coach', 'Session Day', 'Session Time', 'Session Location']
const WAIVER_FIELDS = ['Player Full Name', 'Date of Birth', 'Parent/Guardian Name', 'Parent Email', 'Parent Mobile Number', 'Current Club', 'Term', 'Waiver Version', 'Signed Date', 'Programme', 'Waiver Accepted - Full Terms']

// A value inside a double-quoted Airtable formula string.
export function fq(v) { return String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') }

function tagOf(notes, tag) {
  const m = String(notes || '').match(new RegExp(`\\[${tag}:([A-Za-z0-9-]+)\\]`))
  return m ? m[1] : ''
}

function term4Row({ id, fields: f }) {
  const notes = text(f, 'Term 4 Notes')
  const day = text(f, 'Term 3 Day'), time = text(f, 'Term 3 Time'), location = text(f, 'Term 3 Location')
  return {
    id,
    player: text(f, 'Player Name'),
    parent: text(f, 'Parent Name'),
    email: text(f, 'Email').toLowerCase(),
    phone: text(f, 'Phone'),
    day, time, location,
    // The session as Airtable writes it. Which group that is (one group, or
    // one of several coaches at the same time) is settled in placeInGroups.
    sessionId: day && time && location ? groupId(day, time, location) : '',
    groupId: day && time && location ? groupId(day, time, location) : '',
    coach: text(f, 'Coach'),
    confirmation: text(f, 'Term 4 Confirmation'),
    feeAud: num(f, 'Term 4 Fee'),
    paidAud: num(f, 'Term 4 Amount Paid'),
    balanceAud: num(f, 'Term 4 Balance'),
    paymentStatus: text(f, 'Term 4 Payment Status'),
    paymentType: text(f, 'Term 4 Payment Type'),
    stripeFeeAud: num(f, 'Term 4 Stripe Fee AUD'),
    netAud: num(f, 'Term 4 Net Collected AUD'),
    reconciliation: text(f, 'Term 4 Fee Reconciliation'),
    linkNotes: text(f, 'Term 4 Payment Link Notes'),
    evidence: text(f, 'Term 4 Payment Evidence'),
    // The JF playing kit (required): Ordered or Already has one, from My account.
    kit: text(f, 'Training Kit'),
    notes,
    sourceTerm3: text(f, 'Source Term 3 Record ID'),
    onlineBookingId: tagOf(notes, ONLINE_TAG),
    adminAddId: tagOf(notes, ADMIN_TAG),
    holdsPlace: HOLDS_PLACE.has(text(f, 'Term 4 Confirmation')),
  }
}

// The whole roster, joined the way the Joner Dashboard joins it: coach and
// date of birth come from Term 3 where Term 4 does not say. Cached briefly;
// every write clears the cache so staff changes show at once.
export async function loadRoster({ fresh = false } = {}) {
  const cleared = Number(await kvCommand(['GET', 'jfp:roster-cleared'])) || 0
  if (!fresh) {
    const cached = await kvGetJson(keys.roster())
    // Never a copy read before the last write cleared the cache.
    if (cached && cached.at >= cleared && Date.now() - cached.at < CACHE_SECONDS * 1000) return waiverRules(await placeInGroups(cached))
  }
  const startedAt = Date.now()
  // Term 3 has finished and barely changes: read it at most every 10 minutes,
  // which keeps a busy moment inside Airtable's 5 requests a second.
  let t3 = await kvGetJson('jfp:term3-cache')
  const [t4, wv] = await Promise.all([readTable(TABLES.term4, TERM4_FIELDS), readTable(TABLES.waiver, WAIVER_FIELDS)])
  if (!t3) { t3 = await readTable(TABLES.term3, TERM3_FIELDS); await kvSetJson('jfp:term3-cache', t3, 600) }
  const term3 = t3.map(({ id, fields: f }) => ({
    id, player: text(f, 'Player Name'), parent: text(f, 'Parent Name'),
    emails: [text(f, 'Email'), text(f, 'Parent Email 2')].map((e) => e.toLowerCase()).filter(Boolean),
    phone: text(f, 'Phone Number'), dob: text(f, 'Date of Birth'), coach: text(f, 'Coach'),
    day: text(f, 'Session Day'), time: text(f, 'Session Time'), location: text(f, 'Session Location'),
  }))
  const waivers = wv.map(({ id, fields: f }) => ({
    id, player: text(f, 'Player Full Name'), dob: text(f, 'Date of Birth'), parent: text(f, 'Parent/Guardian Name'),
    email: text(f, 'Parent Email').toLowerCase(), mobile: text(f, 'Parent Mobile Number'), club: text(f, 'Current Club'),
    term: text(f, 'Term'), version: text(f, 'Waiver Version'), signedDate: text(f, 'Signed Date'), programme: text(f, 'Programme'),
    accepted: f['Waiver Accepted - Full Terms'] === true,
  }))
  const t3ById = new Map(term3.map((r) => [r.id, r]))
  const t3ByName = new Map(term3.map((r) => [normName(r.player), r]))
  const sessionCoaches = new Map()
  for (const r of term3) {
    if (!r.coach) continue
    const k = `${r.day}|${r.time}|${r.location}`.toLowerCase()
    sessionCoaches.set(k, new Set([...(sessionCoaches.get(k) || []), r.coach]))
  }
  const wByName = new Map()
  for (const w of waivers) { const k = normName(w.player); wByName.set(k, [...(wByName.get(k) || []), w]) }
  const players = t4.map((raw) => {
    const p = term4Row(raw)
    const src = t3ById.get(p.sourceTerm3) || t3ByName.get(normName(p.player))
    const sess = [...(sessionCoaches.get(`${p.day}|${p.time}|${p.location}`.toLowerCase()) || [])]
    const dob = src?.dob || (wByName.get(normName(p.player)) || []).find((w) => w.dob)?.dob || ''
    return { ...p, coach: p.coach || src?.coach || (sess.length === 1 ? sess[0] : ''), dob, ageFromNotes: ageFromNotes(p.notes) }
  })
  // Stamped with when the read began, so a slow read is never cached as newer than it is.
  const out = { at: startedAt, players, term3, waivers }
  // A slow read that began before a later write must not replace the cache.
  if (startedAt >= (Number(await kvCommand(['GET', 'jfp:roster-cleared'])) || 0)) await kvSetJson(keys.roster(), out, 3600)
  return waiverRules(await placeInGroups(out))
}

// Which waivers count (Settings, "Accept waivers signed in an earlier term"):
// on, any accepted JFP waiver of the family's; off, only this term's.
async function waiverRules(roster) {
  const config = await getConfig()
  if (config.waiverCarryover !== false) return roster
  const term = config.term
  return { ...roster, waivers: roster.waivers.filter((w) => w.term === term || String(w.version || '').includes(term)) }
}

// Put each row in its group. A session with one group is that group. A
// session split by coach (the early morning squads) goes by the row's coach:
// Term 4's Coach column, else Term 3's. A row whose coach has no group at
// that time is left out of every group and shows under "Not in a group".
export async function placeInGroups(roster, groups, config) {
  if (!groups || !config) [groups, config] = await Promise.all([groups ? groups : listGroups(), config ? config : getConfig()])
  const ids = new Set(groups.map((g) => g.id))
  // Rows typed a little differently ("Belrose" for "Belrose HQ", "16:20" or
  // "4.20pm", "wednesday ") still land in their group when exactly one fits.
  const loose = (day, time, location) => `${String(day || '').trim().toLowerCase().slice(0, 3)}|${looseTime(time)}|${locationFor(config, location).id}`
  const byLoose = new Map()
  for (const g of groups) { const k = `${loose(g.day, g.time, g.location)}|${g.byCoach ? g.coachId : ''}`; byLoose.set(k, byLoose.has(k) ? null : g.id) }
  return {
    ...roster,
    players: roster.players.map((p) => {
      const base = p.sessionId ?? p.groupId
      if (!base || ids.has(base)) return { ...p, sessionId: base, groupId: base }
      const c = coachByAirtableName(config, p.coach)?.id || ''
      const mine = c ? groupId(p.day, p.time, p.location, c) : ''
      if (mine && ids.has(mine)) return { ...p, sessionId: base, groupId: mine }
      const k = loose(p.day, p.time, p.location)
      const found = byLoose.get(`${k}|`) || (c ? byLoose.get(`${k}|${c}`) : null)
      return { ...p, sessionId: base, groupId: found || base }
    }),
  }
}

// "4:20pm", "4.20pm", "4:20 PM", "16:20" -> "16:20"; '' if unreadable.
export function looseTime(v) {
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g, '').replace('.', ':')
  const t = to24h(s)
  if (t) return t
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  return m && Number(m[1]) < 24 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

export async function bustRosterCache() {
  await kvPipeline([['SET', 'jfp:roster-cleared', String(Date.now()), 'EX', '86400'], ['DEL', keys.roster(), keys.airtableCounts()]])
}

export function ageFromNotes(notes) { const m = /\bage (\d{1,2})\b/i.exec(notes || ''); return m ? Number(m[1]) : null }
export function playerAge(p, termStart) { return ageOn(p.dob, termStart) ?? p.ageFromNotes ?? null }

// Places taken in Airtable per group. Online bookings count here too once
// they are written; their KV hold lapses shortly after (see settlePlaces).
export function countsFrom(roster) {
  const counts = {}
  for (const r of roster.players) {
    if (!r.groupId || !r.holdsPlace) continue
    // A family that booked the hour as a 1 to 1 takes every place in it.
    counts[r.groupId] = (counts[r.groupId] || 0) + (/\[JFP-1TO1\]/.test(r.notes || '') ? 100 : 1)
  }
  return counts
}
export async function airtableCounts({ fresh = false } = {}) {
  const roster = await loadRoster({ fresh })
  return { at: roster.at, counts: countsFrom(roster) }
}

// ---------- waivers ----------

// A player has a waiver on file only when a waiver row carries their name AND
// this family's email or mobile. A name alone never counts, even when only one
// waiver has it: another family's consent is not this family's (launch review,
// 5 Oct 2026). Anything less is asked to sign again.
export function waiverFor(playerName, family, waivers) {
  const n = normName(playerName)
  if (!n) return null
  const same = waivers.filter((w) => normName(w.player) === n && w.accepted !== false)
  const emails = new Set((family.emails || []).map((e) => e.toLowerCase()))
  const phones = new Set((family.phones || []).map(digits).filter((d) => d.length >= 8).map((d) => d.slice(-9)))
  const ours = (w) => emails.has(w.email) || (digits(w.mobile).length >= 8 && phones.has(digits(w.mobile).slice(-9)))
  const strong = same.find(ours)
  let pick = strong || null
  // A spelling difference inside the same family ("Srestha" and "Shrestha"):
  // accept only a close full name AND a close first name, from a waiver that
  // carries this family's email or mobile, and only if exactly one fits.
  if (!pick) {
    const first = (v) => String(v || '').trim().split(/\s+/)[0]
    const close = waivers.filter((w) => w.accepted !== false && ours(w) && similar(w.player, playerName) >= 0.72 && similar(first(w.player), first(playerName)) >= 0.5)
    if (close.length === 1 || (close.length > 1 && close.every((w) => normName(w.player) === normName(close[0].player)))) pick = close[0]
  }
  return pick ? { id: pick.id, signedDate: pick.signedDate, term: pick.term, version: pick.version, spelling: normName(pick.player) !== n ? pick.player : '' } : null
}

// Bigram overlap (Dice) of two names, 0 to 1, letters only.
export function similar(a, b) {
  a = normName(a); b = normName(b)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const grams = (x) => { const m = new Map(); for (let i = 0; i < x.length - 1; i += 1) { const g = x.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1) } return m }
  const A = grams(a), B = grams(b)
  let common = 0
  for (const [g, k] of A) common += Math.min(k, B.get(g) || 0)
  return (2 * common) / (a.length + b.length - 2)
}

// Waiver rows the system wrote for a booking or request carry a tag in
// Internal Notes, so a retry never writes a second waiver.
export async function findWaiversByTag(tag) {
  const q = new URLSearchParams({ filterByFormula: `FIND("${fq(tag)}", {Internal Notes})`, pageSize: '20' })
  const d = await airtable(`${encodeURIComponent(TABLES.waiver)}?${q}`)
  return (d.records || []).map((r) => r.id)
}

export async function createWaiverRows(rows) {
  const out = []
  for (let i = 0; i < rows.length; i += 10) {
    const d = await airtable(encodeURIComponent(TABLES.waiver), { method: 'POST', body: { typecast: true, records: rows.slice(i, i + 10).map((fields) => ({ fields })) } })
    out.push(...(d.records || []).map((r) => r.id))
  }
  return out
}

export function waiverFields({ player, parent, config, signature, acceptedAt, media, tag = '' }) {
  return {
    'Player Full Name': player.name,
    ...(player.dob ? { 'Date of Birth': player.dob } : {}),
    'Parent/Guardian Name': parent.name,
    'Parent Email': parent.email,
    ...(parent.mobile ? { 'Parent Mobile Number': parent.mobile } : {}),
    ...(player.mobile ? { 'Player Mobile Number': player.mobile } : {}),
    'Current Club': player.club || '',
    'Medical Notes': player.medical || '',
    'Emergency Contact Name': player.emergencyName || '',
    ...(player.emergencyPhone ? { 'Emergency Contact Phone': player.emergencyPhone } : {}),
    'Term': config.term,
    'Waiver Version': config.waiverVersion,
    'Waiver Accepted - Full Terms': true,
    'No Make-Up Sessions Accepted': true,
    'Payment Terms Accepted - Full Term': true,
    'Emergency Treatment Permission': true,
    'Media Permission': media === true,
    'Parent/Guardian Signature': signature,
    'Signed Date': acceptedAt.slice(0, 10),
    'Form Review Status': 'Needs Review',
    ...(tag ? { 'Internal Notes': `Signed online. ${tag}` } : {}),
    'Programme': 'JFP',
    'JFP Program Waiver and Agreement': `JFP Program Waiver and Agreement accepted online for ${config.term} (${config.waiverVersion}). Signed by ${signature} at ${acceptedAt}.`,
  }
}

// ---------- Term 4 writes ----------

export async function createTerm4Rows(fieldsList) {
  const out = []
  for (let i = 0; i < fieldsList.length; i += 10) {
    const d = await airtable(encodeURIComponent(TABLES.term4), { method: 'POST', body: { typecast: true, records: fieldsList.slice(i, i + 10).map((fields) => ({ fields })) } })
    out.push(...(d.records || []).map((r) => r.id))
  }
  await bustRosterCache()
  return out
}

export async function updateTerm4Rows(updates) {
  const out = []
  for (let i = 0; i < updates.length; i += 10) {
    const d = await airtable(encodeURIComponent(TABLES.term4), { method: 'PATCH', body: { typecast: true, records: updates.slice(i, i + 10).map(({ id, fields }) => ({ id, fields })) } })
    out.push(...(d.records || []))
  }
  await bustRosterCache()
  return out
}

// null only when the row really does not exist; any other failure throws.
export async function getTerm4Row(id) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id || '')) return null
  try {
    const row = term4Row(await airtable(`${encodeURIComponent(TABLES.term4)}/${id}`))
    // As loadRoster does: no coach on the Term 4 row means the Term 3 coach,
    // which decides the group in a session split by coach.
    if (!row.coach && /^rec[A-Za-z0-9]{14}$/.test(row.sourceTerm3)) {
      try { row.coach = text((await airtable(`${encodeURIComponent(TABLES.term3)}/${row.sourceTerm3}`)).fields || {}, 'Coach') } catch {}
    }
    if (!row.coach) {
      const roster = await loadRoster()
      row.coach = roster.players.find((p) => p.id === row.id)?.coach || ''
    }
    return (await placeInGroups({ players: [row] })).players[0]
  } catch (error) {
    if (/Airtable 404/.test(error.message)) return null
    throw error
  }
}

// ---------- next term ----------

// One row per player per next term, found by the Term 4 row it came from.
export async function upsertNextHold(term, term4Id, fields) {
  const q = new URLSearchParams({ filterByFormula: `AND({Next Term} = "${fq(term)}", {Source Term 4 Record ID} = "${fq(term4Id)}")`, pageSize: '1' })
  const found = await airtable(`${encodeURIComponent(TABLES.nextHolds)}?${q}`)
  const id = found.records?.[0]?.id
  const all = { ...fields, 'Next Term': term, 'Source Term 4 Record ID': term4Id, 'Updated At': new Date().toISOString() }
  if (id) await airtable(encodeURIComponent(TABLES.nextHolds), { method: 'PATCH', body: { typecast: true, records: [{ id, fields: all }] } })
  else await airtable(encodeURIComponent(TABLES.nextHolds), { method: 'POST', body: { typecast: true, records: [{ fields: all }] } })
}

// ---------- removed players ----------

// Fields a restore may write back. Formula and lookup columns are left out.
export const RESTORABLE = ['Player Name', 'Parent Name', 'Email', 'Phone', 'Term 3 Day', 'Term 3 Time', 'Term 3 Location', 'Coach', 'Confirmation Date', 'Term 4 Fee', 'Term 4 Amount Paid', 'Term 4 Payment Status', 'Term 4 Payment Type', 'Term 4 Notes', 'Source Term 3 Record ID', 'Term 4 Stripe Fee AUD', 'Term 4 Net Collected AUD', 'Term 4 Fee Reconciliation', 'Term 4 Payment Link Notes', 'Term 4 Payment Evidence']

export async function getTerm4Fields(id) { return (await airtable(`${encodeURIComponent(TABLES.term4)}/${id}`)).fields || {} }

export async function findDroppedBySource(term4Id) {
  const q = new URLSearchParams({ filterByFormula: `FIND("${fq(term4Id)}", {Source Term 4 Record ID})`, pageSize: '5' })
  const d = await airtable(`${encodeURIComponent(TABLES.dropped)}?${q}`)
  return (d.records || []).map((r) => r.id)
}
export async function createDroppedRow(fields) {
  const d = await airtable(encodeURIComponent(TABLES.dropped), { method: 'POST', body: { typecast: true, records: [{ fields }] } })
  return d.records?.[0]?.id || ''
}
export async function updateDroppedRow(id, fields) {
  await airtable(encodeURIComponent(TABLES.dropped), { method: 'PATCH', body: { typecast: true, records: [{ id, fields }] } })
}
export async function getDroppedRow(id) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id || '')) return null
  try { const r = await airtable(`${encodeURIComponent(TABLES.dropped)}/${id}`); return { id: r.id, ...r.fields } } catch (error) { if (/Airtable 404/.test(error.message)) return null; throw error }
}
export async function listDropped() {
  return (await readTable(TABLES.dropped)).map((r) => ({ id: r.id, ...r.fields }))
}
export async function deleteTerm4Row(id) {
  await airtable(`${encodeURIComponent(TABLES.term4)}?records[]=${encodeURIComponent(id)}`, { method: 'DELETE' })
  await bustRosterCache()
}

// Rows the system wrote for this booking or admin add, so a retry never
// creates a second enrolment.
export async function findTerm4ByTag(tag, id) {
  const formula = `FIND("${fq(`[${tag}:${id}]`)}", {Term 4 Notes})`
  const q = new URLSearchParams({ filterByFormula: formula, pageSize: '20' })
  const d = await airtable(`${encodeURIComponent(TABLES.term4)}?${q}`)
  return (d.records || []).map((r) => r.id)
}

export function appendNote(existing, line) {
  const stamp = new Date().toISOString().slice(0, 10)
  return `${existing ? `${existing}\n` : ''}${stamp}: ${line}`.slice(-4000)
}

// ---------- ledger ----------

// One ledger row per actual payment, never per player.
export async function createLedgerRow({ paymentId, config, playerNames, amountCents, paidAt, sourceIds, sessionId, intentId, notes, method = 'Stripe' }) {
  const d = await airtable(encodeURIComponent(TABLES.ledger), {
    method: 'POST',
    body: {
      typecast: true,
      records: [{ fields: {
        'Payment ID': paymentId,
        'Term': config.term,
        'Player Name': playerNames.join(', '),
        'Amount Paid': amountCents / 100,
        'Payment Method': ['Stripe', 'Bank Transfer', 'Cash', 'Other'].includes(method) ? method : 'Other',
        'Payment Status': 'Paid',
        'Payment Date': (paidAt || new Date().toISOString()).slice(0, 10),
        'Source Table': 'Term 4 Players',
        'Source Record ID': sourceIds.join(', '),
        'Stripe Checkout Session ID': sessionId || '',
        'Stripe Payment Intent ID': intentId || '',
        'Notes': notes || '',
        'Updated At': new Date().toISOString(),
      } }],
    },
  })
  return d.records?.[0]?.id || ''
}

// This term's ledger: one row per payment (Stripe, bank transfer, cash).
// Joners Juniors: one table per term (Term 3, Term 4), for revenue by venue.
// It changes rarely, so it is read at most every 10 minutes.
export const JUNIORS_TABLES = (process.env.JFP_JUNIORS_TABLES || 'tblMLhYQ126P5uKLB,tblVzW8E9qumQEtXx').split(',').map((x) => x.trim()).filter(Boolean)
const JUNIORS_FIELDS = ['Player Full Name', 'Term', 'Location', 'Session Day', 'Session Time', 'Fee', 'Payment Status', 'Paid Via']
export async function listJuniors() {
  const hit = await kvGetJson('jfp:juniors-cache')
  if (Array.isArray(hit)) return hit
  const out = []
  let complete = true
  for (const t of JUNIORS_TABLES) {
    try {
      for (const { id, fields: f } of await readTable(t, JUNIORS_FIELDS)) {
        out.push({ id, player: text(f, 'Player Full Name'), term: text(f, 'Term'), location: text(f, 'Location'), day: text(f, 'Session Day'), time: text(f, 'Session Time'), fee: num(f, 'Fee'), status: text(f, 'Payment Status'), paidVia: text(f, 'Paid Via') })
      }
    } catch (error) { complete = false; console.error('jfp juniors read failed', t, error.message) }
  }
  // A failed read is never cached, so the next look tries again.
  if (complete) await kvSetJson('jfp:juniors-cache', out, 600)
  return out
}

// Older terms by venue and session, copied from Lee's Money Register (a Google
// Sheet) by the Revenue session's import script. No names. Read at most every 10 minutes.
export const VENUE_HISTORY_TABLE = process.env.JFP_VENUE_HISTORY_TABLE || 'tblgss68pIVTUOttE'
export async function listVenueHistory() {
  const hit = await kvGetJson('jfp:venue-history-cache')
  if (Array.isArray(hit)) return hit
  const rows = await readTable(VENUE_HISTORY_TABLE, ['Term', 'Kind', 'Venue', 'Session', 'Revenue', 'Stripe', 'Bank Transfer', 'Cash', 'Other', 'Payments', 'Imported At'])
  const out = rows.map(({ id, fields: f }) => ({
    id, term: text(f, 'Term'), kind: text(f, 'Kind'), venue: text(f, 'Venue'), session: text(f, 'Session'),
    revenue: num(f, 'Revenue'), stripe: num(f, 'Stripe'), bank: num(f, 'Bank Transfer'), cash: num(f, 'Cash'), other: num(f, 'Other'),
    payments: num(f, 'Payments'), importedAt: text(f, 'Imported At'),
  }))
  await kvSetJson('jfp:venue-history-cache', out, 600)
  return out
}

export async function listLedger(term) {
  const rows = await readTable(TABLES.ledger, ['Payment ID', 'Term', 'Player Name', 'Amount Paid', 'Payment Method', 'Payment Status', 'Payment Date', 'Source Record ID', 'Stripe Checkout Session ID', 'Stripe Payment Intent ID', 'Notes'])
  return rows.map((r) => ({ id: r.id, ...r.fields })).filter((r) => !term || r['Term'] === term)
}

export async function findLedgerByPayment(paymentId) {
  const q = new URLSearchParams({ filterByFormula: `{Payment ID} = "${fq(paymentId)}"`, pageSize: '5' })
  const d = await airtable(`${encodeURIComponent(TABLES.ledger)}?${q}`)
  return (d.records || []).map((r) => r.id)
}

// ---------- attendance ----------

// One Attendance row per player per session, keyed by Attendance ID so a
// second tick updates rather than duplicates.
export async function upsertAttendance({ attendanceId, playerName, week, date, group, coachName, status, markedBy }) {
  const fields = {
    'Attendance ID': attendanceId, 'Player Name': playerName, 'Term': 'Term 4', 'Year': Number(date.slice(0, 4)), 'Week Number': week,
    'Session Date': date, 'Session Day': group.day, 'Session Time': group.time, 'Session Location': group.location,
    'Coach': coachName || '', 'Attendance Status': status, 'Marked By': markedBy, 'Marked At': new Date().toISOString(), 'Programme': 'JFP',
  }
  const q = new URLSearchParams({ filterByFormula: `{Attendance ID} = "${fq(attendanceId)}"`, pageSize: '1' })
  const found = await airtable(`${encodeURIComponent(TABLES.attendance)}?${q}`)
  const id = found.records?.[0]?.id
  if (id) await airtable(encodeURIComponent(TABLES.attendance), { method: 'PATCH', body: { typecast: true, records: [{ id, fields }] } })
  else await airtable(encodeURIComponent(TABLES.attendance), { method: 'POST', body: { typecast: true, records: [{ fields }] } })
}

// ---------- families ----------

// Everything a signed-in parent is allowed to see: the players whose rows
// carry their email, in Term 4, Term 3 or the waiver table. Nothing else.
export function familyFor(email, roster, termStart) {
  const e = clean(email, 200).toLowerCase()
  if (!e) return { emails: [], phones: [], players: [] }
  const t4 = roster.players.filter((r) => r.email === e)
  const t3 = roster.term3.filter((r) => r.emails.includes(e))
  const wv = roster.waivers.filter((w) => w.email === e)
  const family = {
    emails: [e],
    phones: [...t4.map((r) => r.phone), ...t3.map((r) => r.phone), ...wv.map((w) => w.mobile)].filter(Boolean),
    parentName: t4[0]?.parent || t3[0]?.parent || wv[0]?.parent || '',
    mobile: t4[0]?.phone || t3[0]?.phone || wv[0]?.mobile || '',
  }
  const byName = new Map()
  const touch = (name) => {
    const k = normName(name)
    if (!k) return null
    if (!byName.has(k)) byName.set(k, { key: k, name: clean(name, 80), dob: '', term4: [], inTerm3: false })
    return byName.get(k)
  }
  for (const r of t4) {
    const p = touch(r.player)
    if (!p) continue
    p.term4.push(r)
    if (!p.dob && r.dob) p.dob = r.dob
    if (p.ageHint == null && r.ageFromNotes != null) p.ageHint = r.ageFromNotes
  }
  for (const r of t3) { const p = touch(r.player); if (p) { p.inTerm3 = true; if (!p.dob && r.dob) p.dob = r.dob } }
  for (const w of wv) { const p = touch(w.player); if (p && !p.dob && w.dob) p.dob = w.dob }
  family.players = [...byName.values()].map((p) => ({
    ...p,
    age: ageOn(p.dob, termStart) ?? p.ageHint ?? null,
    waiver: waiverFor(p.name, family, roster.waivers),
  })).sort((a, b) => a.name.localeCompare(b.name))
  return family
}

// ---------- draft groups (first set-up only) ----------

export function draftGroupsFromRoster(players, config) {
  const by = new Map()
  for (const p of players) {
    if (!p.groupId || !p.holdsPlace) continue
    const g = by.get(p.groupId) || { day: p.day, time: p.time, location: p.location, n: 0, coaches: new Map(), types: new Map() }
    g.n += 1
    const c = coachByAirtableName(config, p.coach)?.id || ''
    if (c) g.coaches.set(c, (g.coaches.get(c) || 0) + 1)
    g.types.set(p.paymentType, (g.types.get(p.paymentType) || 0) + 1)
    by.set(p.groupId, g)
  }
  return [...by.entries()].map(([id, g]) => {
    const coachRank = [...g.coaches.entries()].sort((a, b) => b[1] - a[1])
    const type = [...g.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    const isBelrose = /belrose/i.test(g.location)
    const oneToOne = /1 on 1/i.test(type)
    const pathway = /pathway/i.test(type)
    return {
      id, day: g.day, time: g.time, location: g.location,
      coachId: coachRank[0]?.[0] || '',
      extraCoachIds: coachRank.slice(1).map(([c]) => c),
      programme: pathway ? 'JFP Pathway 10 weeks' : oneToOne ? 'JFP 1 on 1' : 'JFP 10 weeks',
      label: oneToOne ? '1 to 1' : pathway ? 'Pathway' : 'Small group',
      capacity: oneToOne ? 1 : isBelrose ? 6 : Math.max(g.n, 6),
      mode: oneToOne ? 'enquire' : pathway || !isBelrose ? 'application' : 'direct',
      durationMin: 60,
      currentPlayers: g.n,
    }
  })
}

// A draft age band from the players in a group today: one year either side
// of the youngest and oldest, inside the program range. Staff confirm it.
export function draftAgeBand(ages, config) {
  const list = ages.filter((a) => Number.isInteger(a)).sort((a, b) => a - b)
  if (!list.length) return { minAge: null, maxAge: null }
  return { minAge: Math.max(config.minAge, list[0] - 1), maxAge: Math.min(config.maxAge, list.at(-1) + 1) }
}
