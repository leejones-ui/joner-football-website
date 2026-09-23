// Airtable is the JFP roster of record. This module reads Term 4 Players,
// counts who already holds a place in each group, and writes paid online
// bookings back in the same shape staff enter by hand.
//
// The Term 4 session columns are still labelled "Term 3 Day/Time/Location";
// they hold the Term 4 session, exactly as the Joner Dashboard reads them.
import { kvGetJson, kvSetJson, keys, groupId, ONLINE_TAG, coachByAirtableName, to24h } from './_jfp-store.js'

const BASE = process.env.AIRTABLE_BASE_ID || 'apphU4R0BtVIu5YqT'
export const TABLES = {
  term4: 'tbl6OIjkU6UsQCeZV',
  term3: 'Term 3 Players',
  ledger: 'tblfrXQLMhOcE2PWH',
  waiver: 'tblLziUfKOv1N0f40',
}
// Everyone in these states holds a place. "Not Returning" and "Dropped" do not.
const HOLDS_PLACE = new Set(['Confirmed', 'Awaiting Reply', 'Needs Follow-up', 'Not Contacted', ''])
const COUNT_TTL_SECONDS = 60

function token() {
  const t = process.env.JFP_AIRTABLE_TOKEN || process.env.AIRTABLE_API_TOKEN || process.env.AIRTABLE_TOKEN
  if (!t) throw new Error('JFP Airtable connection is not configured')
  return t
}

async function airtable(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch {}
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

const TERM4_FIELDS = [
  'Player Name', 'Parent Name', 'Email', 'Phone', 'Term 3 Day', 'Term 3 Time', 'Term 3 Location', 'Coach',
  'Term 4 Confirmation', 'Term 4 Fee', 'Term 4 Amount Paid', 'Term 4 Balance', 'Term 4 Payment Status',
  'Term 4 Payment Type', 'Term 4 Notes', 'Source Term 3 Record ID', 'Term 4 Stripe Fee AUD',
  'Term 4 Net Collected AUD', 'Term 4 Fee Reconciliation',
]

// Every Term 4 row, normalised. Private: staff views only.
export async function readTerm4() {
  const rows = await readTable(TABLES.term4, TERM4_FIELDS)
  return rows.map(({ id, fields: f }) => {
    const notes = text(f, 'Term 4 Notes')
    const online = notes.match(new RegExp(`\\[${ONLINE_TAG}:([A-Z0-9-]+)\\]`))
    const day = text(f, 'Term 3 Day'), time = text(f, 'Term 3 Time'), location = text(f, 'Term 3 Location')
    return {
      id,
      player: text(f, 'Player Name'),
      parent: text(f, 'Parent Name'),
      email: text(f, 'Email'),
      phone: text(f, 'Phone'),
      day, time, location,
      groupId: day && time && location ? groupId(day, time, location) : '',
      coach: text(f, 'Coach'),
      confirmation: text(f, 'Term 4 Confirmation'),
      feeAud: typeof f['Term 4 Fee'] === 'number' ? f['Term 4 Fee'] : null,
      paidAud: typeof f['Term 4 Amount Paid'] === 'number' ? f['Term 4 Amount Paid'] : null,
      balanceAud: typeof f['Term 4 Balance'] === 'number' ? f['Term 4 Balance'] : null,
      paymentStatus: text(f, 'Term 4 Payment Status'),
      paymentType: text(f, 'Term 4 Payment Type'),
      stripeFeeAud: typeof f['Term 4 Stripe Fee AUD'] === 'number' ? f['Term 4 Stripe Fee AUD'] : null,
      netAud: typeof f['Term 4 Net Collected AUD'] === 'number' ? f['Term 4 Net Collected AUD'] : null,
      reconciliation: text(f, 'Term 4 Fee Reconciliation'),
      notes,
      sourceTerm3: text(f, 'Source Term 3 Record ID'),
      onlineBookingId: online ? online[1] : '',
      holdsPlace: HOLDS_PLACE.has(text(f, 'Term 4 Confirmation')),
    }
  })
}

// Coach per player, filled from Term 3 where Term 4 is blank, the same way
// the Joner Dashboard does it.
export async function readTerm4WithCoaches() {
  const [t4, t3] = await Promise.all([readTerm4(), readTable(TABLES.term3, ['Player Name', 'Coach'])])
  const byId = new Map(t3.map((r) => [r.id, text(r.fields, 'Coach')]))
  const byName = new Map(t3.map((r) => [text(r.fields, 'Player Name').toLowerCase(), text(r.fields, 'Coach')]))
  return t4.map((p) => ({ ...p, coach: p.coach || byId.get(p.sourceTerm3) || byName.get(p.player.toLowerCase()) || '' }))
}

// Players already holding a place in each group, excluding online bookings
// (those are counted from KV). Cached briefly so the parent page stays fast;
// a stale count is at most a minute old and staff edits show up after that.
export async function airtableCounts({ fresh = false } = {}) {
  if (!fresh) {
    const cached = await kvGetJson(keys.airtableCounts())
    if (cached && Date.now() - cached.at < COUNT_TTL_SECONDS * 1000) return cached
  }
  const rows = await readTerm4()
  const counts = {}
  for (const r of rows) {
    if (!r.groupId || !r.holdsPlace || r.onlineBookingId) continue
    counts[r.groupId] = (counts[r.groupId] || 0) + 1
  }
  const out = { at: Date.now(), counts }
  await kvSetJson(keys.airtableCounts(), out, 3600)
  return out
}

// ---------- writes ----------

export async function createTerm4Players({ booking, group, config, coachAirtableName, feeSplit }) {
  const today = new Date().toISOString().slice(0, 10)
  const records = booking.players.map((p, i) => ({
    fields: {
      'Player Name': p.name,
      'Parent Name': booking.parentName,
      'Email': booking.email,
      'Phone': booking.mobile,
      'Term 3 Day': group.day,
      'Term 3 Time': group.time,
      'Term 3 Location': group.location,
      'Coach': coachAirtableName || '',
      'Term 4 Confirmation': 'Confirmed',
      'Confirmation Date': today,
      'Term 4 Fee': booking.unitCents / 100,
      'Term 4 Amount Paid': booking.unitCents / 100,
      'Term 4 Payment Status': 'Paid',
      'Term 4 Payment Type': 'JFP 10 weeks',
      'Term 4 Notes': `Booked online, age ${p.age}. [${ONLINE_TAG}:${booking.id}]${booking.notes ? `\nParent notes: ${booking.notes}` : ''}`,
      ...(feeSplit ? {
        'Term 4 Stripe Fee AUD': feeSplit[i] / 100,
        'Term 4 Net Collected AUD': (booking.unitCents - feeSplit[i]) / 100,
        'Term 4 Fee Reconciliation': 'Verified',
        'Term 4 Payment Evidence': `Stripe ${booking.stripePaymentIntentId} via ${booking.stripeSessionId}. Fee from balance transaction${booking.players.length > 1 ? `, split across ${booking.players.length} players in one payment` : ''}.`,
      } : {
        'Term 4 Fee Reconciliation': 'Pending verification',
        'Term 4 Payment Evidence': `Stripe ${booking.stripePaymentIntentId} via ${booking.stripeSessionId}. Fee not yet read.`,
      }),
    },
  }))
  const out = []
  for (let i = 0; i < records.length; i += 10) {
    const d = await airtable(encodeURIComponent(TABLES.term4), { method: 'POST', body: { records: records.slice(i, i + 10) } })
    out.push(...(d.records || []).map((r) => r.id))
  }
  return out
}

export async function findTerm4ByBooking(bookingId) {
  const formula = `FIND("[${ONLINE_TAG}:${bookingId}]", {Term 4 Notes})`
  const q = new URLSearchParams({ filterByFormula: formula, pageSize: '20' })
  const d = await airtable(`${encodeURIComponent(TABLES.term4)}?${q}`)
  return (d.records || []).map((r) => r.id)
}

// One ledger row per actual payment, never per player.
export async function createLedgerRow({ booking, term4Ids, config }) {
  const d = await airtable(encodeURIComponent(TABLES.ledger), {
    method: 'POST',
    body: {
      typecast: true,
      records: [{ fields: {
        'Payment ID': booking.stripePaymentIntentId || booking.id,
        'Term': config.term,
        'Player Name': booking.players.map((p) => p.name).join(', '),
        'Amount Paid': (booking.amountPaidCents ?? booking.priceCents) / 100,
        'Payment Method': 'Stripe',
        'Payment Status': 'Paid',
        'Payment Date': (booking.paidAt || new Date().toISOString()).slice(0, 10),
        'Source Table': 'Term 4 Players',
        'Source Record ID': term4Ids.join(', '),
        'Stripe Checkout Session ID': booking.stripeSessionId || '',
        'Stripe Payment Intent ID': booking.stripePaymentIntentId || '',
        'Notes': `JFP online booking ${booking.id}${booking.stripeFeeCents != null ? `. Stripe fee A$${(booking.stripeFeeCents / 100).toFixed(2)}` : ''}`,
        'Updated At': new Date().toISOString(),
      } }],
    },
  })
  return d.records?.[0]?.id || ''
}

export async function findLedgerByPayment(paymentId) {
  const q = new URLSearchParams({ filterByFormula: `{Payment ID} = "${String(paymentId).replace(/"/g, '')}"`, pageSize: '5' })
  const d = await airtable(`${encodeURIComponent(TABLES.ledger)}?${q}`)
  return (d.records || []).map((r) => r.id)
}

// Draft groups from who is already booked, for staff to review.
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
    // Only what the records can justify opens. Belrose groups hold 6, as the
    // dashboard assumes. Shared early squads, 1 to 1 slots and anything during
    // school hours stay closed until staff say otherwise.
    const hour = Number((/^(\d{2})/.exec(to24h(g.time)) || [])[1] || 0)
    const schoolHours = hour >= 8 && hour < 15 && !['Saturday', 'Sunday'].includes(g.day)
    // Pathway is approved by staff one family at a time, so a second coach on
    // the roster does not need to close it. A shared standard group does.
    const mode = oneToOne || !isBelrose || schoolHours ? 'closed' : pathway ? 'application' : coachRank.length > 1 ? 'closed' : 'direct'
    return {
      id, day: g.day, time: g.time, location: g.location,
      coachId: coachRank[0]?.[0] || '',
      extraCoachIds: coachRank.slice(1).map(([c]) => c),
      programme: pathway ? 'JFP Pathway 10 weeks' : oneToOne ? 'JFP 1 on 1' : 'JFP 10 weeks',
      capacity: oneToOne ? 1 : isBelrose ? 6 : g.n,
      mode,
      durationMin: 60,
      publicNote: '',
      currentPlayers: g.n,
    }
  })
}
