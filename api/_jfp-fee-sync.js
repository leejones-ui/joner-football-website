// A link follows the fee (Lee, 16 Oct 2026): "when we change someone's price,
// their account and any open pay link must update automatically."
//
// An open payment link for a place (a balance, a term, a trial or offer, a
// family invoice, sessions billed) asks for what that place owes NOW: the
// row's Term 4 Fee minus what is already paid on it, less anything another
// open link for the same row is already asking for. Worked out when the link
// is shown or paid (read time) and straight after any fee change (write time).
//
// Each link remembers what its rows owed when it was made (feeSync). A part
// of a link that asked for exactly what its row owed follows the fee up and
// down ('owing'); a part staff typed by hand, or sessions billed on a row that
// owed more besides, only ever comes down to what is owing ('part'). Nothing
// changes while the rows owe what they did.
//
// Charges, invoices, quick links, next term, sessions paid ahead and
// automatic charges have amounts of their own: never touched here.
//
// A changed link: the Stripe page for the old amount is closed, the amount
// (and each place) is updated, and it is in the audit log. A link with
// nothing left owing is cancelled ("fee changed, nothing owing"); the place
// stays. Staff see "Link updated to A$X after the fee changed".
import { getPayreq, savePayreq, listPayreqs, listAudit, closeCheckout, audit, formatAud, isSessionType } from './_jfp-store.js'
import { getTerm4Row } from './_jfp-airtable.js'
import { withPayreqLease } from './_jfp-finalise.js'

export const FEE_REASONS = new Set(['balance', 'term-after-trial', 'trial', 'admin-add', 'application', 'waitlist', 'family', 'sessions'])
export const NOTHING_OWING = 'fee changed, nothing owing'
// Nothing owing because the place was paid another way (bank, cash, a Stripe payment matched by hand).
export const PAID_ELSEWHERE = 'paid another way, nothing owing'
const OPEN = ['open', 'checkout']
// Audit actions that set a row's fee, for links made before feeSync existed.
const FEE_ACTIONS = new Set(['player.edit', 'player.family-prices', 'player.sessions'])

const cents = (aud) => (typeof aud === 'number' && Number.isFinite(aud) ? Math.round(aud * 100) : 0)
const isOpen = (q) => Boolean(q) && OPEN.includes(q.status)

// Is this link's amount the place fee? (Read the reasons in jfp-portal-data.js
// createPayreq callers and _jfp-account-pay.js.)
export function feeTied(q) {
  return Boolean(q) && FEE_REASONS.has(q.reason) && (q.term4Ids || []).length > 0
    && !q.quick && !q.charge && !q.chargeId && !q.invoiceId && !q.next && !q.prepay && !q.autoCharge && !q.savedCharge
}

// What another open link on this row is already asking for (an invoice, a
// quick link, sessions paid ahead): it comes off what this link can ask for.
function heldElsewhere(rowId, selfId, all) {
  let held = 0
  for (const o of all || []) {
    if (!o || o.id === selfId || !isOpen(o) || o.autoCharge || !(o.term4Ids || []).includes(rowId)) continue
    const place = Array.isArray(o.places) ? o.places.find((p) => p.rowId === rowId) : null
    held += place ? Number(place.owingCents) || 0 : Math.floor((Number(o.amountCents) || 0) / o.term4Ids.length)
  }
  return held
}

// What this row owes for this link right now, or null when the fee is not set
// (no fee on the records is unknown, not zero). Session by session with no
// fee is nothing billed yet: zero.
export function rowOwing(row, selfId, all) {
  if (!row || (row.feeAud == null && !isSessionType(row.paymentType))) return null
  const fee = cents(row.feeAud), paid = cents(row.paidAud)
  return { feeCents: fee, paidCents: paid, owingCents: Math.max(0, fee - paid - heldElsewhere(row.id, selfId, all)) }
}

// What each row owed when the link was made: the basis every later change is
// measured from. Called when a link is made (no save here).
export function stampFeeBasis(q, rowsById, all = []) {
  if (!feeTied(q)) return q
  const rows = {}
  for (const id of q.term4Ids) {
    const o = rowOwing(rowsById.get ? rowsById.get(id) : rowsById[id], q.id, all)
    if (o) rows[id] = o
  }
  q.feeSync = { at: new Date().toISOString(), rows }
  return q
}
export async function stampFeeBasisFresh(q) {
  if (!feeTied(q)) return q
  const [all, rows] = await Promise.all([listPayreqs().catch(() => []), Promise.all(q.term4Ids.map((id) => getTerm4Row(id).catch(() => null)))])
  return stampFeeBasis(q, new Map(rows.filter(Boolean).map((r) => [r.id, r])), all)
}

// The parts of a link: each place of a family or sessions link, or the whole
// link for one row (or several rows sharing one amount).
function unitsOf(q) {
  if (Array.isArray(q.places) && q.places.length && q.places.every((p) => q.term4Ids.includes(p.rowId))) {
    return q.places.map((p, i) => ({ place: i, rowIds: [p.rowId], amount: Number(p.owingCents) || 0 }))
  }
  return [{ place: -1, rowIds: [...q.term4Ids], amount: Number(q.amountCents) || 0 }]
}

// Did staff change a fee on one of these rows after the link was made? Only
// asked for links made before feeSync existed.
async function feeChangedSince(rowIds, sinceIso, memo) {
  if (!memo.audit) memo.audit = await listAudit(5000).catch(() => [])
  const since = Date.parse(sinceIso || 0) || 0
  return memo.audit.some((e) => FEE_ACTIONS.has(e.action) && Date.parse(e.at || 0) > since
    && String(e.target || '').split(',').some((t) => rowIds.includes(t.trim()))
    && (e.action !== 'player.edit' || 'Term 4 Fee' in (e.after || {}) || 'feeAud' in (e.before || {})))
}

// The plan for one link: { change: false } or { change: true, amountCents,
// places, rows (new basis), dropRows }. Pure apart from the audit read.
export async function planReprice(q, rowsById, all, memo = {}) {
  if (!feeTied(q) || !isOpen(q)) return { change: false }
  if (q.expiresAt && Date.parse(q.expiresAt) < Date.now()) return { change: false }
  const get = (id) => (rowsById.get ? rowsById.get(id) : rowsById[id])
  const basis = q.feeSync?.rows || null
  const nextRows = {}
  const units = []
  let changed = false, feeMoved = false
  for (const u of unitsOf(q)) {
    const live = u.rowIds.map((id) => ({ id, o: rowOwing(get(id), q.id, all) }))
    // A row we cannot read, or with no fee set: this part is left as it is.
    if (live.some((x) => !x.o)) { units.push({ ...u, next: u.amount }); continue }
    const avail = live.reduce((t, x) => t + x.o.owingCents, 0)
    const was = basis && u.rowIds.every((id) => basis[id]) ? u.rowIds.reduce((t, id) => t + basis[id].owingCents, 0) : null
    let mode = basis?.[u.rowIds[0]]?.mode || ''
    let next = u.amount
    if (was != null) {
      if (avail !== was) {
        if (live.some((x) => basis[x.id].feeCents !== x.o.feeCents)) feeMoved = true
        mode ||= u.amount === was ? 'owing' : 'part'
        next = mode === 'owing' ? avail : Math.min(u.amount, avail)
      }
    } else if (u.amount !== avail) {
      // Made before links remembered their basis: it follows the fee when the
      // fee was changed after it was made; otherwise it only comes down.
      mode = (await feeChangedSince(u.rowIds, q.createdAt, memo)) ? 'owing' : 'part'
      if (mode === 'owing') feeMoved = true
      next = mode === 'owing' ? avail : Math.min(u.amount, avail)
    }
    for (const x of live) nextRows[x.id] = { ...x.o, ...(mode ? { mode } : {}) }
    if (next !== u.amount) changed = true
    units.push({ ...u, next, live })
  }
  // A link made before feeSync existed gets its basis once, from here on.
  if (!changed) return { change: false, stamp: !basis && units.every((u) => u.live), rows: nextRows }
  const amountCents = units.reduce((t, u) => t + u.next, 0)
  let places = null
  const dropRows = []
  if (units[0].place >= 0) {
    places = units.map((u) => {
      const p = q.places[u.place]
      if (u.next === u.amount) return p
      const r = u.live[0].o
      // A family place shows its fee and what is paid; a sessions place is the sessions.
      return q.reason === 'family'
        ? { ...p, feeCents: r.feeCents, paidCents: r.paidCents, owingCents: u.next }
        : { ...p, feeCents: Number(p.feeCents) === Number(p.owingCents) ? u.next : p.feeCents, owingCents: u.next }
    })
    // A place with nothing left to pay leaves the link; the others stay.
    if (amountCents > 0) for (const p of places) if (!p.owingCents) dropRows.push(p.rowId)
    if (dropRows.length) places = places.filter((p) => !dropRows.includes(p.rowId))
  }
  const repricedRows = units.filter((u) => u.next !== u.amount).flatMap((u) => u.rowIds)
  return { change: true, amountCents, places, rows: nextRows, dropRows, repricedRows, fromCents: q.amountCents, cancelReason: feeMoved ? NOTHING_OWING : PAID_ELSEWHERE }
}

// Apply a plan to the stored link, under the payment lease, from a fresh read
// of the link and its rows. Returns { q, changed, cancelled, busy, error }.
async function applyReprice(id, { by, why, all: allIn }) {
  const out = await withPayreqLease(id, async () => {
    const q = await getPayreq(id)
    if (!feeTied(q) || !isOpen(q)) return { q, changed: false }
    const rows = await Promise.all(q.term4Ids.map((rid) => getTerm4Row(rid).catch(() => null)))
    const rowsById = new Map(rows.filter(Boolean).map((r) => [r.id, r]))
    const all = allIn || await listPayreqs().catch(() => [])
    const plan = await planReprice(q, rowsById, all)
    if (!plan.change && plan.stamp) { const next = { ...q, feeSync: { at: new Date().toISOString(), rows: plan.rows } }; await savePayreq(next); return { q: next, changed: false } }
    if (!plan.change) return { q, changed: false }
    // The family may be on Stripe's page for the old amount: close it first.
    let base = q
    if (q.status === 'checkout' && q.stripeSessionId) {
      const closed = await closeCheckout(q.stripeSessionId)
      // Paid at the old amount a moment ago: that payment stands, as it was asked for.
      if (closed === 'complete') return { q, changed: false, paying: true }
      if (closed === 'error') return { q, changed: false, error: 'Could not close the payment page for the old amount.' }
      base = { ...q, status: 'open', stripeSessionId: '', replacedSessionIds: [...new Set([...(q.replacedSessionIds || []), q.stripeSessionId])] }
    }
    const at = new Date().toISOString()
    // What a price-list link would put back if cancelled: not over a fee changed since.
    const restoreFields = (base.restoreFields || []).filter((x) => !plan.repricedRows.includes(x.id))
    const trail = [...(base.repriced || []), { at, fromCents: plan.fromCents, toCents: plan.amountCents, by, why }].slice(-10)
    if (plan.amountCents <= 0) {
      const next = { ...base, status: 'cancelled', cancelledBy: by, cancelledAt: at, cancelReason: plan.cancelReason, feeSync: { at, rows: plan.rows }, repriced: trail, ...(base.restoreFields ? { restoreFields } : {}) }
      await savePayreq(next)
      await audit({ by, action: 'payreq.cancel', target: id, before: { cents: q.amountCents }, after: { released: 0, why: plan.cancelReason, cause: why } })
      return { q: next, changed: true, cancelled: true }
    }
    const keep = (arr) => (Array.isArray(arr) ? arr.filter((_, i) => !plan.dropRows.includes(base.term4Ids[i])) : arr)
    const next = {
      ...base, amountCents: plan.amountCents,
      ...(plan.places ? { places: plan.places } : {}),
      ...(plan.dropRows.length ? { term4Ids: keep(base.term4Ids), playerNames: keep(base.playerNames), playerKeys: keep(base.playerKeys) } : {}),
      ...(base.restoreFields ? { restoreFields } : {}),
      feeSync: { at, rows: Object.fromEntries(Object.entries(plan.rows).filter(([rid]) => !plan.dropRows.includes(rid))) },
      repriced: trail, changedAt: at, changedBy: by,
    }
    await savePayreq(next)
    await audit({ by, action: 'payreq.reprice', target: id, before: { cents: q.amountCents }, after: { cents: next.amountCents, why, rows: plan.repricedRows, dropped: plan.dropRows } })
    return { q: next, changed: true }
  })
  if (out.busy) return { q: null, changed: false, busy: true }
  return out
}

// Read time: these links as they should be now. rowsById may be a cached
// roster; a difference is always checked again from Airtable before anything
// is written. Returns the list with changed links replaced (cancelled ones
// come back cancelled, so callers drop them from what is open).
export async function syncLinks(list, { rowsById, all, by = 'system: fee sync', why = 'fee changed' } = {}) {
  const memo = {}
  const out = []
  for (const q of list || []) {
    if (!feeTied(q) || !isOpen(q)) { out.push(q); continue }
    let rows = rowsById
    if (!rows) {
      const got = await Promise.all(q.term4Ids.map((id) => getTerm4Row(id).catch(() => null)))
      rows = new Map(got.filter(Boolean).map((r) => [r.id, r]))
    }
    const plan = await planReprice(q, rows, all || list, memo).catch((error) => { console.error('jfp fee sync plan failed', q.id, error); return { change: false } })
    if (!plan.change && !plan.stamp) { out.push(q); continue }
    const r = await applyReprice(q.id, { by, why, all }).catch((error) => { console.error('jfp fee sync failed', q.id, error); return { q: null } })
    out.push(r.q || q)
  }
  return out
}

// One link, from fresh Airtable rows: before a checkout is made or a link is sent.
export async function syncLink(q, opts = {}) {
  if (!feeTied(q) || !isOpen(q)) return q
  return (await syncLinks([q], { ...opts, all: opts.all || await listPayreqs().catch(() => []) }))[0]
}

// Write time: a fee (or what is paid) changed on these rows. Every open link
// that includes one of them is worked out again from fresh rows.
// -> { repriced: [{ id, fromCents, amountCents, players }], cancelled: [...], open: [links still open] }
export async function syncRowLinks(rowIds, { by, why = 'fee changed' } = {}) {
  const ids = (rowIds || []).filter(Boolean)
  const all = await listPayreqs().catch(() => [])
  const mine = all.filter((q) => isOpen(q) && (q.term4Ids || []).some((id) => ids.includes(id)))
  const repriced = [], cancelled = [], open = []
  for (const q of mine) {
    const r = feeTied(q) ? await applyReprice(q.id, { by, why }).catch((error) => { console.error('jfp fee sync failed', q.id, error); return { q } }) : { q }
    const now = r.q || q
    if (r.cancelled) cancelled.push({ id: now.id, amountCents: q.amountCents, players: q.playerNames })
    else {
      if (r.changed) repriced.push({ id: now.id, fromCents: q.amountCents, amountCents: now.amountCents, players: now.playerNames })
      open.push(now)
    }
  }
  return { repriced, cancelled, open }
}

// What staff see on a link that was repriced.
export function repricedNote(q) {
  const last = (q?.repriced || []).at(-1)
  return last && isOpen(q) ? `Link updated to ${formatAud(q.amountCents)} after the fee changed` : ''
}
