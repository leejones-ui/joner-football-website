// Everything the JFP portal shows and changes, behind a signed-in staff session.
//
// Roles, checked here on every action:
//   admin  Lee and Ligia: the whole program, players, money, settings
//   coach  the whole program timetable (names and ages), their own sessions
//          and registers. No money, no parent contact details.
//
// Staff changes write straight into Airtable Term 4 Players, so Lee's
// dashboard always matches, and every change is recorded in the audit log.
import crypto from 'node:crypto'
import { siteUrl } from './_holiday-store.js'
import {
  getConfig, saveConfig, listGroups, getGroup, saveGroup, deleteGroup, validateGroup, onlineCounts, placesLeft, listBookings, getBooking,
  saveBooking, releasePlaces, listApplications, getApplication, saveApplication, listPayreqs, getPayreq, savePayreq, coachById,
  coachByAirtableName, sessionDates, dateLabel, formatAud, to24h, clean, newId, audit, listAudit, locationFor, validEmail, ageOn,
  normName, groupId as makeGroupId, kvCommand, keys, ADMIN_TAG, MODES, LABELS, DAYS, sortGroups, closeCheckout, dropParentHold,
  PRODUCTS, QUESTIONS, productFor, priceFor, nextSessionDate, sydneyToday, periodOf,
} from './_jfp-store.js'
import {
  loadRoster, countsFrom, playerAge, waiverFor, createTerm4Rows, updateTerm4Rows, getTerm4Row, appendNote, upsertAttendance, draftAgeBand,
  createWaiverRows, waiverFields, findWaiversByTag, bustRosterCache, findTerm4ByTag,
  getTerm4Fields, findDroppedBySource, createDroppedRow, updateDroppedRow, getDroppedRow, listDropped, deleteTerm4Row, RESTORABLE,
} from './_jfp-airtable.js'
import { repairJfpBooking, effectsSummary, EFFECTS, PAY_EFFECTS } from './_jfp-finalise.js'
import { staffPrincipal, sameOrigin } from './_jfp-people.js'
import { sendFamilyInvite, sendPlaceOffered, sendTrialOffered, sendTermOffered } from './_jfp-email.js'
import { releaseOffer, sweepExpiredOffers } from './_jfp-offers.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }
const cents = (aud) => (typeof aud === 'number' ? Math.round(aud * 100) : 0)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const phoneOk = (v) => String(v || '').replace(/\D/g, '').length >= 8
const isTestName = (n) => /test/i.test(n || '')
const REQUEST_DAYS = 7

// The dashboard's own rule for who counts on the Term 4 page.
function onDashboard(r) {
  return r.confirmation.toLowerCase() === 'confirmed' && !isTestName(r.player) && !/joners juniors/i.test(r.paymentType)
}

function playerView(r, config, roster, { money }) {
  const w = waiverFor(r.player, { emails: [r.email], phones: [r.phone] }, roster.waivers)
  return {
    rowId: r.id,
    name: r.player,
    age: playerAge(r, config.termStart),
    status: r.confirmation || 'No status',
    coach: coachByAirtableName(config, r.coach)?.name || r.coach || '',
    type: r.paymentType,
    trial: /trial/i.test(r.paymentType),
    online: Boolean(r.onlineBookingId),
    addedHere: Boolean(r.adminAddId),
    waiver: Boolean(w),
    dashboard: onDashboard(r),
    ...(money ? {
      parent: r.parent, email: r.email, phone: r.phone,
      paymentStatus: r.paymentStatus || 'Not set', feeCents: cents(r.feeAud), paidCents: cents(r.paidAud), balanceCents: cents(r.balanceAud),
      linkNotes: r.linkNotes,
    } : {}),
  }
}

async function boardData(config) {
  const [groups, roster, payreqs, requests] = await Promise.all([listGroups(), loadRoster({ fresh: true }), listPayreqs(), listApplications()])
  const pendingBy = {}
  for (const r of requests) if (r.status === 'pending') pendingBy[r.groupId] = (pendingBy[r.groupId] || 0) + 1
  const counts = countsFrom(roster)
  const online = await onlineCounts(groups.map((g) => g.id))
  const openReqByRow = new Map()
  for (const q of payreqs) if (['open', 'checkout'].includes(q.status)) for (const id of q.term4Ids) openReqByRow.set(id, { id: q.id, amountLabel: formatAud(q.amountCents) })
  const known = new Set(groups.map((g) => g.id))
  const holding = roster.players.filter((r) => r.holdsPlace)
  const view = groups.map((g) => {
    const players = holding.filter((r) => r.groupId === g.id).map((r) => ({ ...playerView(r, config, roster, { money: true }), payreq: openReqByRow.get(r.id) || null }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const loc = locationFor(config, g.location)
    return {
      ...g,
      locationId: loc.id, locationName: loc.name,
      coachName: coachById(config, g.coachId)?.name || '',
      extraCoachNames: (g.extraCoachIds || []).map((c) => coachById(config, c)?.name).filter(Boolean),
      taken: counts[g.id] || 0,
      holds: online[g.id] || 0,
      placesLeft: placesLeft(g, counts[g.id], online[g.id]),
      confirmed: players.filter((p) => p.dashboard).length,
      players,
      sortTime: to24h(g.time),
      period: periodOf(g),
      pendingRequests: pendingBy[g.id] || 0,
    }
  })
  const unassigned = holding.filter((r) => !r.groupId || !known.has(r.groupId)).map((r) => ({ ...playerView(r, config, roster, { money: true }), session: [r.day, r.time, r.location].filter(Boolean).join(' ') || 'No session set' }))
  return {
    at: roster.at,
    term: config.term,
    groups: view,
    unassigned,
    totals: {
      players: holding.length,
      dashboard: roster.players.filter(onDashboard).length,
      awaiting: holding.filter((r) => r.confirmation !== 'Confirmed').length,
      placesLeft: view.filter((g) => ['direct', 'application'].includes(g.mode)).reduce((t, g) => t + g.placesLeft, 0),
      pendingRequests: requests.filter((r) => r.status === 'pending').length,
      waivers: holding.filter((r) => waiverFor(r.player, { emails: [r.email], phones: [r.phone] }, roster.waivers)).length,
    },
  }
}

function groupSummary(g, config) {
  const loc = locationFor(config, g.location)
  return `${g.day} ${g.time}, ${loc.name}`
}

async function capacityCheck(group, adding, force) {
  const roster = await loadRoster()
  const taken = countsFrom(roster)[group.id] || 0
  const holds = (await onlineCounts([group.id]))[group.id] || 0
  const left = placesLeft(group, taken, holds)
  if (left < adding && !force) return { error: `${groupSummary(group, await getConfig())} has ${left} place${left === 1 ? '' : 's'} left. Add anyway?`, code: 'full', left }
  return { left }
}

// ---------- players ----------

// The price for a group and product from a start date, unless staff typed
// an amount. Returns { amountCents, price } or { error }.
function amountFor(config, group, body, players = 1) {
  const product = PRODUCTS.some((x) => x.key === body.product) ? body.product : (group?.product || 'group')
  const from = ISO.test(body.startDate || '') ? body.startDate : (group ? nextSessionDate(config, group.day) : '')
  const price = priceFor(config, { product, day: group?.day, fromIso: from, players })
  const typed = Number(body.amountCents)
  const amountCents = Number.isInteger(typed) && typed > 0 ? typed : price.totalCents
  return { amountCents, price, product, from }
}

async function addPlayer(req, res, principal, config, body) {
  const group = await getGroup(body.groupId)
  if (!group) return fail(res, 404, 'Group not found.')
  const name = clean(body.player?.name, 80)
  if (name.length < 3) return fail(res, 400, 'Enter the player\'s full name.')
  const email = validEmail(body.parent?.email)
  const parentName = clean(body.parent?.name, 100)
  const mobile = clean(body.parent?.mobile, 40)
  const payment = ['offline', 'link', 'trial', 'none'].includes(body.payment) ? body.payment : 'none'
  if ((payment === 'link' || body.sendEmail) && !email) return fail(res, 400, 'Add the parent email so the family can sign in, sign the waiver and pay.')
  const cap = await capacityCheck(group, 1, body.force === true)
  if (cap.error) return fail(res, 409, cap.error, { code: cap.code })
  const dob = ISO.test(body.player?.dob || '') ? body.player.dob : ''
  const age = dob ? ageOn(dob, config.termStart) : (Number.isInteger(Number(body.player?.age)) ? Number(body.player.age) : null)
  const { amountCents, price, product, from } = amountFor(config, group, body)
  const isTrial = payment === 'trial' || product === 'trial'
  const coach = coachById(config, group.coachId)
  const addId = newId('ADD')
  const today = new Date().toISOString().slice(0, 10)
  const fields = {
    'Player Name': name,
    'Parent Name': parentName,
    ...(email ? { 'Email': email } : {}),
    ...(mobile ? { 'Phone': mobile } : {}),
    'Term 3 Day': group.day, 'Term 3 Time': group.time, 'Term 3 Location': group.location,
    'Coach': coach?.airtableName || '',
    // A link is a place held for this family: confirmed once they pay.
    'Term 4 Confirmation': payment === 'link' ? 'Awaiting Reply' : 'Confirmed',
    ...(payment === 'link' ? {} : { 'Confirmation Date': today }),
    'Term 4 Fee': payment === 'trial' ? 0 : amountCents / 100,
    'Term 4 Amount Paid': payment === 'offline' ? amountCents / 100 : 0,
    'Term 4 Payment Status': payment === 'offline' ? 'Paid' : payment === 'trial' ? 'N/A' : 'Unpaid',
    'Term 4 Payment Type': isTrial ? 'JFP Trial' : price.type,
    'Term 4 Notes': `Added by ${principal.name} in the JFP portal${age != null ? `, age ${age}` : ''}${price.proRata && !isTrial ? `, from ${from} (${price.sessions} of ${price.of} sessions, pro rata)` : ''}${payment === 'offline' ? `. Paid offline (${clean(body.method, 30) || 'not stated'})` : ''}. [${ADMIN_TAG}:${addId}]${body.note ? `\n${clean(body.note, 500)}` : ''}`,
    ...(payment === 'offline' ? { 'Term 4 Fee Reconciliation': 'Non-Stripe — verified' } : {}),
  }
  const [rowId] = await createTerm4Rows([fields])
  let payreq = null
  if (payment === 'link') payreq = await createPayreq({ req, principal, config, group, rows: [{ id: rowId, name }], email, parentName, amountCents, reason: isTrial ? 'trial' : 'admin-add', product, startDate: from, afterpay: body.afterpay !== false })
  let emailed = false
  if (body.sendEmail === true && email) {
    const roster = await loadRoster({ fresh: true })
    const hasWaiver = Boolean(waiverFor(name, { emails: [email], phones: [mobile] }, roster.waivers))
    await sendFamilyInvite({ to: email, parentName, playerNames: [name], group, config, url: payreq ? payreqUrl(req, payreq) : `${siteUrl(req)}/jfp-account/`, needs: { details: !hasWaiver && !dob, waiver: !hasWaiver, payment: Boolean(payreq) }, amountCents, trial: isTrial, startDate: from })
    emailed = true
    if (payreq) await savePayreq({ ...payreq, emailedAt: new Date().toISOString() })
  }
  await audit({ by: principal.email, action: 'player.add', target: rowId, after: { name, group: group.id, payment, emailed, payreq: payreq?.id || '', cents: payment === 'none' ? 0 : amountCents } })
  return res.status(200).json({ success: true, rowId, payreq: payreq ? { id: payreq.id, url: payreqUrl(req, payreq), amountLabel: formatAud(amountCents) } : null, emailed })
}

// No email in the link: it would end up in browser history and server logs.
function payreqUrl(req, q) { return `${siteUrl(req)}/jfp-account/?pay=${encodeURIComponent(q.id)}` }

// Offers from requests hold the place for 7 days; balance and term links do not expire.
const EXPIRING = new Set(['application', 'waitlist', 'trial'])

async function createPayreq({ req, principal, config, group, rows, email, parentName, amountCents, reason, requestId, product = '', startDate = '', afterpay = true, trialDate = '', creditCents = 0, restoreFields = null }) {
  const q = {
    id: newId('PAY'),
    email, parentName,
    playerNames: rows.map((r) => r.name),
    playerKeys: rows.map((r) => normName(r.name)),
    term4Ids: rows.map((r) => r.id),
    groupId: group?.id || '',
    groupLabel: group ? groupSummary(group, config) : '',
    amountCents, reason, requestId: requestId || '',
    product, productLabel: product ? productFor(product).label : '', startDate, trialDate, creditCents,
    afterpay: afterpay !== false,
    ...(restoreFields ? { restoreFields } : {}),
    status: 'open',
    createdBy: principal.email,
    createdAt: new Date().toISOString(),
    expiresAt: EXPIRING.has(reason) ? new Date(Date.now() + REQUEST_DAYS * 86400000).toISOString() : '',
    siteUrl: siteUrl(req),
  }
  await savePayreq(q)
  return q
}

async function rowOr404(res, rowId) {
  const row = await getTerm4Row(clean(rowId, 30))
  if (!row) { fail(res, 404, 'Player row not found in Airtable.'); return null }
  return row
}

async function movePlayer(res, principal, config, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  const to = await getGroup(body.toGroupId)
  if (!to) return fail(res, 404, 'Group not found.')
  if (row.groupId === to.id) return fail(res, 400, 'Already in that group.')
  const cap = await capacityCheck(to, 1, body.force === true)
  if (cap.error) return fail(res, 409, cap.error, { code: cap.code })
  const coach = coachById(config, to.coachId)
  await updateTerm4Rows([{ id: row.id, fields: {
    'Term 3 Day': to.day, 'Term 3 Time': to.time, 'Term 3 Location': to.location,
    ...(coach ? { 'Coach': coach.airtableName } : {}),
    'Term 4 Notes': appendNote(row.notes, `Moved from ${row.day} ${row.time} ${row.location} to ${to.day} ${to.time} ${to.location} by ${principal.name}.`),
  } }])
  await audit({ by: principal.email, action: 'player.move', target: row.id, before: { group: row.groupId }, after: { group: to.id, name: row.player } })
  return res.status(200).json({ success: true })
}

// Why players leave: Lee keeps count, because players move in and out.
export const LEAVE_REASONS = ['Cost', 'Time or schedule clash', 'Club or school commitments', 'Injury', 'Not the right group or level', 'Trial was not the right fit', 'Moved away', 'Taking a break', 'Joined another program', 'Moved to 1 to 1', 'No reply from the family', 'Other']

// Remove a player: their Term 4 row leaves Term 4 Players, and a copy with
// the contact details, the reason and the whole row goes to "Players dropped
// from term 4", so nobody is lost and they can be restored.
async function removePlayer(res, principal, config, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  const reason = LEAVE_REASONS.includes(body.reason) ? body.reason : ''
  if (!reason) return fail(res, 400, 'Choose why they are leaving.')
  const details = clean(body.details, 1000)
  // Close any payment page for this player first. If the family has just
  // paid, stop: removing now would leave a payment on a removed row.
  const open = (await listPayreqs()).filter((q) => ['open', 'checkout'].includes(q.status) && q.term4Ids.includes(row.id))
  for (const q of open) {
    const closed = q.status === 'checkout' ? await closeCheckout(q.stripeSessionId) : 'expired'
    if (closed === 'complete') return fail(res, 409, `The family has just paid for ${row.player}. Wait a minute for it to show, then remove and refund in Stripe if needed.`)
    if (closed === 'error') return fail(res, 503, 'Could not close the family\'s payment page. Try again in a minute.')
  }
  const fields = await getTerm4Fields(row.id)
  const coach = coachByAirtableName(config, row.coach)
  const now = new Date().toISOString()
  // A retry after a part-finished removal reuses the copy it already made.
  const [existing] = await findDroppedBySource(row.id)
  const droppedId = existing || await createDroppedRow({
    'Player Name': row.player, 'Parent Name': row.parent, 'Email': row.email, 'Phone Number': row.phone,
    'Term Player left': config.term, 'Reason for leaving': reason, 'Reason details': details,
    'Removed At': now, 'Removed By': principal.name,
    'Session': [row.day, row.time, row.location].filter(Boolean).join(' '), 'Coach': coach ? coach.airtableName : row.coach,
    'Payment Status': row.paymentStatus, 'Term 4 Payment Type': row.paymentType,
    ...(row.feeAud != null ? { 'Term 4 Fee': row.feeAud } : {}), ...(row.paidAud != null ? { 'Term 4 Amount Paid': row.paidAud } : {}),
    'Term 4 Notes': row.notes, 'Source Term 4 Record ID': row.id, 'Term 4 Row Copy': JSON.stringify(fields).slice(0, 90000),
  })
  if (!droppedId) return fail(res, 502, 'Airtable did not save the copy, so the player was not removed. Try again.')
  // Money already paid stays on Term 4 Players (as Dropped), so the term's
  // takings and any payment record keep their row. Everyone else comes off.
  const keepRow = cents(row.paidAud) > 0 || /\[(JFP-ONLINE|PAID):/.test(row.notes)
  if (keepRow) await updateTerm4Rows([{ id: row.id, fields: { 'Term 4 Confirmation': 'Dropped', 'Term 4 Notes': appendNote(row.notes, `Removed by ${principal.name}: ${reason}${details ? `. ${details}` : ''}. Kept here because money was paid.`) } }])
  else await deleteTerm4Row(row.id)
  for (const q of open) await savePayreq({ ...q, status: 'cancelled', cancelledBy: principal.email, cancelledAt: now })
  await audit({ by: principal.email, action: 'player.remove', target: row.id, before: { status: row.confirmation, group: row.groupId }, after: { name: row.player, reason, details, dropped: droppedId } })
  return res.status(200).json({ success: true, wasPaid: row.paymentStatus === 'Paid', kept: keepRow, droppedId })
}

// Put a removed player back in Term 4 Players from their saved copy.
async function restorePlayer(res, principal, body) {
  const d = await getDroppedRow(clean(body.droppedId, 30))
  if (!d) {
    // Players removed before this table existed are still in Term 4 as Dropped.
    const row = await rowOr404(res, body.rowId); if (!row) return
    await updateTerm4Rows([{ id: row.id, fields: { 'Term 4 Confirmation': 'Confirmed', 'Term 4 Notes': appendNote(row.notes, `Restored by ${principal.name}.`) } }])
    await audit({ by: principal.email, action: 'player.restore', target: row.id, before: { status: row.confirmation }, after: { status: 'Confirmed', name: row.player } })
    return res.status(200).json({ success: true })
  }
  if (d['Restored']) return fail(res, 409, 'Already restored.')
  // Kept on Term 4 as Dropped (money was paid): put that same row back.
  const kept = await getTerm4Row(d['Source Term 4 Record ID'] || '')
  if (kept) {
    const g = kept.groupId ? await getGroup(kept.groupId) : null
    if (g) { const cap = await capacityCheck(g, 1, body.force === true); if (cap.error) return fail(res, 409, cap.error, { code: cap.code }) }
    await updateTerm4Rows([{ id: kept.id, fields: { 'Term 4 Confirmation': 'Confirmed', 'Term 4 Notes': appendNote(kept.notes, `Restored by ${principal.name}.`) } }])
    await updateDroppedRow(d.id, { 'Restored': true })
    await audit({ by: principal.email, action: 'player.restore', target: kept.id, after: { name: kept.player, from: d.id } })
    return res.status(200).json({ success: true, rowId: kept.id })
  }
  let copy = null
  try { copy = JSON.parse(d['Term 4 Row Copy'] || '') } catch {}
  if (!copy || typeof copy !== 'object') return fail(res, 422, 'The saved copy of this row cannot be read. Add the player again with Add player.')
  const fields = Object.fromEntries(RESTORABLE.filter((k) => copy[k] != null && copy[k] !== '').map((k) => [k, copy[k]]))
  fields['Player Name'] = fields['Player Name'] || d['Player Name']
  fields['Term 4 Confirmation'] = 'Confirmed'
  fields['Term 4 Notes'] = appendNote(fields['Term 4 Notes'] || '', `Restored by ${principal.name} (had left: ${d['Reason for leaving'] || 'no reason'}). [RESTORED:${d.id}]`)
  if (fields['Term 3 Day'] && fields['Term 3 Time'] && fields['Term 3 Location']) {
    const c = coachByAirtableName(await getConfig(), fields['Coach'] || '')?.id || ''
    const g = (await getGroup(makeGroupId(fields['Term 3 Day'], fields['Term 3 Time'], fields['Term 3 Location']))) || (c ? await getGroup(makeGroupId(fields['Term 3 Day'], fields['Term 3 Time'], fields['Term 3 Location'], c)) : null)
    if (g) { const cap = await capacityCheck(g, 1, body.force === true); if (cap.error) return fail(res, 409, cap.error, { code: cap.code }) }
  }
  // A retry after a part-finished restore reuses the row it already made.
  const [earlier] = await findTerm4ByTag('RESTORED', d.id)
  const rowId = earlier || (await createTerm4Rows([fields]))[0]
  await updateDroppedRow(d.id, { 'Restored': true, 'Reason details': `${d['Reason details'] ? `${d['Reason details']}\n` : ''}Restored ${new Date().toISOString().slice(0, 10)} by ${principal.name} as ${rowId}.` })
  await audit({ by: principal.email, action: 'player.restore', target: rowId, after: { name: fields['Player Name'], from: d.id } })
  return res.status(200).json({ success: true, rowId })
}

async function markPaid(res, principal, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  const fee = cents(row.feeAud) || Number(body.amountCents) || 0
  const amount = Number.isInteger(Number(body.amountCents)) && Number(body.amountCents) > 0 ? Number(body.amountCents) : fee
  const paid = cents(row.paidAud) + amount
  await updateTerm4Rows([{ id: row.id, fields: {
    'Term 4 Amount Paid': paid / 100,
    'Term 4 Payment Status': fee && paid < fee ? 'Partially Paid' : 'Paid',
    'Term 4 Fee Reconciliation': 'Non-Stripe — verified',
    'Term 4 Notes': appendNote(row.notes, `Marked paid offline, ${formatAud(amount)} (${clean(body.method, 30) || 'method not stated'}), by ${principal.name}.`),
  } }])
  await audit({ by: principal.email, action: 'player.markPaid', target: row.id, before: { paidCents: cents(row.paidAud) }, after: { paidCents: paid, name: row.player } })
  return res.status(200).json({ success: true })
}

async function setTrial(res, principal, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  const on = body.trial !== false
  await updateTerm4Rows([{ id: row.id, fields: {
    'Term 4 Payment Type': on ? 'JFP Trial' : 'JFP 10 weeks',
    'Term 4 Notes': appendNote(row.notes, `${on ? 'Set to trial' : 'Trial ended, full term'} by ${principal.name}.`),
  } }])
  await audit({ by: principal.email, action: on ? 'player.trial' : 'player.fullTerm', target: row.id, before: { type: row.paymentType }, after: { name: row.player } })
  return res.status(200).json({ success: true })
}

async function sendPaymentLink(req, res, principal, config, body) {
  const ids = (Array.isArray(body.rowIds) ? body.rowIds : [body.rowId]).map((x) => clean(x, 30)).filter(Boolean).slice(0, 6)
  if (!ids.length) return fail(res, 400, 'Choose a player.')
  const rows = []
  for (const id of ids) { const r = await getTerm4Row(id); if (r) rows.push(r) }
  if (!rows.length) return fail(res, 404, 'Player row not found.')
  const email = validEmail(body.email) || rows[0].email
  if (!email) return fail(res, 400, 'This player has no parent email in Airtable. Add one to send a link.')
  const group = rows[0].groupId ? await getGroup(rows[0].groupId) : null
  // Either what is owing on the rows, or a product from the price list
  // (pro rata from the start date), or an amount staff typed.
  const balance = rows.reduce((t, r) => t + Math.max(0, cents(r.balanceAud ?? ((r.feeAud || 0) - (r.paidAud || 0)))), 0)
  const chosen = PRODUCTS.some((x) => x.key === body.product) ? amountFor(config, group, { ...body, amountCents: undefined }, rows.length) : null
  const typed = Number(body.amountCents)
  // What the family has already paid this term comes off a price-list amount.
  // A trial fee comes off only when staff tick it, and only what was paid.
  const paidSoFar = rows.reduce((t, r) => t + cents(r.paidAud), 0)
  const onTrial = rows.some((r) => /trial/i.test(r.paymentType))
  const credit = !chosen ? 0 : onTrial ? (body.creditTrial === true ? Math.min(paidSoFar, config.prices.trial, chosen.amountCents) : 0) : Math.min(paidSoFar, chosen.amountCents)
  const amountCents = Number.isInteger(typed) && typed > 0 ? typed : chosen ? chosen.amountCents - credit : balance
  if (!amountCents) return fail(res, 400, 'Nothing is owing on this row. Choose what they are paying for, or enter an amount.')
  // The family signs in with this email to pay, so their rows must carry it.
  // Changing it hands the player to that inbox, so it needs a deliberate tick.
  const changed = rows.filter((r) => r.email !== email)
  if (changed.length && body.changeEmail !== true) return fail(res, 409, `Airtable has ${changed[0].email || 'no email'} for this family. Tick "Update the parent email" to change it to ${email}.`, { code: 'email_change' })
  if (changed.length) {
    await updateTerm4Rows(changed.map((r) => ({ id: r.id, fields: { 'Email': email, 'Term 4 Notes': appendNote(r.notes, `Parent email changed from ${r.email || 'none'} to ${email} by ${principal.name} for a payment link.`) } })))
    await audit({ by: principal.email, action: 'player.email', target: changed.map((r) => r.id).join(','), before: { emails: changed.map((r) => r.email) }, after: { email } })
  }
  // A product link sets what the row costs in Airtable, so the balance and
  // the dashboard match what the family is asked to pay.
  // What the rows said before, put back if this link is cancelled unpaid.
  const restoreFields = chosen ? rows.map((r) => ({ id: r.id, fields: { 'Term 4 Fee': r.feeAud ?? 0, 'Term 4 Payment Type': r.paymentType || 'JFP 10 weeks', 'Term 4 Payment Status': r.paymentStatus || 'Unpaid' } })) : null
  if (chosen) {
    const share = splitEven(amountCents, rows.length)
    await updateTerm4Rows(rows.map((r, i) => ({ id: r.id, fields: {
      'Term 4 Fee': (cents(r.paidAud) + share[i]) / 100,
      'Term 4 Payment Type': chosen.price.type,
      'Term 4 Payment Status': cents(r.paidAud) > 0 ? 'Partially Paid' : 'Unpaid',
      'Term 4 Notes': appendNote(r.notes, `Payment link by ${principal.name}: ${productFor(chosen.product).label}${chosen.price.proRata ? `, from ${chosen.from} (${chosen.price.sessions} of ${chosen.price.of} sessions)` : ''}${credit ? `, ${formatAud(credit)} ${onTrial ? 'trial' : 'already paid'} taken off` : ''}, ${formatAud(share[i])}.`),
    } })))
  }
  const reason = body.reason === 'term-after-trial' ? 'term-after-trial' : chosen?.product === 'trial' ? 'trial' : 'balance'
  const q = await createPayreq({ req, principal, config, group, rows: rows.map((r) => ({ id: r.id, name: r.player })), email, parentName: rows[0].parent, amountCents, reason, product: chosen?.product || '', startDate: chosen?.from || '', afterpay: body.afterpay !== false, creditCents: onTrial ? credit : 0, restoreFields })
  let emailed = false
  if (body.sendEmail === true && group) {
    const roster = await loadRoster()
    const needWaiver = rows.some((r) => !waiverFor(r.player, { emails: [email], phones: [r.phone] }, roster.waivers))
    if (reason === 'term-after-trial') await sendTermOffered({ to: email, parentName: rows[0].parent, playerNames: rows.map((r) => r.player), group, config, url: payreqUrl(req, q), amountCents, startDate: chosen?.from || '', creditCents: credit })
    else await sendFamilyInvite({ to: email, parentName: rows[0].parent, playerNames: rows.map((r) => r.player), group, config, url: payreqUrl(req, q), needs: { details: false, waiver: needWaiver, payment: true }, amountCents, trial: reason === 'trial', startDate: chosen?.from || '' })
    emailed = true
    await savePayreq({ ...q, emailedAt: new Date().toISOString() })
  }
  await audit({ by: principal.email, action: 'payreq.create', target: q.id, after: { rows: ids, cents: amountCents, product: chosen?.product || 'balance', emailed } })
  return res.status(200).json({ success: true, payreq: { id: q.id, url: payreqUrl(req, q), amountLabel: formatAud(amountCents) }, emailed })
}

function splitEven(total, n) {
  const base = Math.floor(total / n / 100) * 100
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * (n - 1) : base))
}

// Change what an open link asks for. The link itself stays the same: the
// family opens it and sees the new amount. A payment page already open on
// Stripe is closed first, so nobody pays the old amount.
async function changePayreqAmount(req, res, principal, config, body) {
  const q = await getPayreq(body.id)
  if (!q) return fail(res, 404, 'Payment link not found.')
  if (!['open', 'checkout'].includes(q.status)) return fail(res, 409, `This link is ${q.status}. Make a new one instead.`)
  const amountCents = Number(body.amountCents)
  if (!Number.isInteger(amountCents) || amountCents <= 0) return fail(res, 400, 'Enter the new amount.')
  if (q.status === 'checkout') {
    const closed = await closeCheckout(q.stripeSessionId)
    if (closed === 'complete') return fail(res, 409, 'The family has just paid the old amount. It will show as paid in a minute.')
    if (closed === 'error') return fail(res, 503, 'Could not close the family\'s payment page. Try again in a minute.')
  }
  const next = { ...q, amountCents, status: 'open', stripeSessionId: '', replacedSessionIds: [...new Set([...(q.replacedSessionIds || []), q.stripeSessionId].filter(Boolean))], changedAt: new Date().toISOString(), changedBy: principal.email }
  await savePayreq(next)
  // Keep the Airtable fee in step when the rows only carry this link.
  const rows = []
  for (const id of q.term4Ids) { const r = await getTerm4Row(id); if (r) rows.push(r) }
  const share = splitEven(amountCents, rows.length || 1)
  if (rows.length && q.product) await updateTerm4Rows(rows.map((r, i) => ({ id: r.id, fields: { 'Term 4 Fee': (cents(r.paidAud) + share[i]) / 100, 'Term 4 Notes': appendNote(r.notes, `Payment link changed from ${formatAud(q.amountCents)} to ${formatAud(amountCents)} by ${principal.name}.`) } })))
  let emailed = false
  if (body.sendEmail === true) {
    const group = q.groupId ? await getGroup(q.groupId) : null
    if (group) { await sendFamilyInvite({ to: q.email, parentName: q.parentName, playerNames: q.playerNames, group, config, url: payreqUrl(req, q), needs: { details: false, waiver: false, payment: true }, amountCents, trial: q.reason === 'trial', startDate: q.startDate }); emailed = true }
  }
  await audit({ by: principal.email, action: 'payreq.change', target: q.id, before: { cents: q.amountCents }, after: { cents: amountCents, emailed } })
  return res.status(200).json({ success: true, url: payreqUrl(req, next), amountLabel: formatAud(amountCents), emailed })
}

// After a trial: offer the rest of the term. The trial fee comes off unless
// staff untick it (Lee: taken off). Pro rata from the start date.
async function offerTerm(req, res, principal, config, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  if (!row.email && !validEmail(body.email)) return fail(res, 400, 'This player has no parent email in Airtable.')
  const group = await getGroup(clean(body.groupId, 80) || row.groupId)
  if (!group) return fail(res, 404, 'Put the player in a group first.')
  const out = { ...body, rowIds: [row.id], product: PRODUCTS.some((x) => x.key === body.product && x.key !== 'trial') ? body.product : group.product || 'group', creditTrial: body.creditTrial !== false, reason: 'term-after-trial' }
  if (group.id !== row.groupId) {
    const cap = await capacityCheck(group, 1, body.force === true)
    if (cap.error) return fail(res, 409, cap.error, { code: cap.code })
    const coach = coachById(config, group.coachId)
    await updateTerm4Rows([{ id: row.id, fields: { 'Term 3 Day': group.day, 'Term 3 Time': group.time, 'Term 3 Location': group.location, ...(coach ? { 'Coach': coach.airtableName } : {}), 'Term 4 Notes': appendNote(row.notes, `Moved to ${group.day} ${group.time} ${group.location} after the trial by ${principal.name}.`) } }])
  }
  return sendPaymentLink(req, res, principal, config, out)
}

async function searchPlayers(config, body) {
  const q = normName(body.q)
  if (q.length < 2) return []
  const roster = await loadRoster()
  const seen = new Map()
  const add = (key, v) => { if (!seen.has(key)) seen.set(key, v) }
  for (const r of roster.players) if (normName(r.player).includes(q)) add(`${normName(r.player)}|${r.email}`, { name: r.player, parentName: r.parent, email: r.email, mobile: r.phone, dob: r.dob, age: playerAge(r, config.termStart), source: `Term 4: ${r.confirmation || 'no status'}${r.groupId ? `, ${r.day} ${r.time}` : ''}` })
  for (const r of roster.term3) if (normName(r.player).includes(q)) add(`${normName(r.player)}|${r.emails[0] || ''}`, { name: r.player, parentName: r.parent, email: r.emails[0] || '', mobile: r.phone, dob: r.dob, age: ageOn(r.dob, config.termStart), source: `Term 3${r.day ? `, ${r.day} ${r.time}` : ''}` })
  for (const w of roster.waivers) if (normName(w.player).includes(q)) add(`${normName(w.player)}|${w.email}`, { name: w.player, parentName: w.parent, email: w.email, mobile: w.mobile, dob: w.dob, age: ageOn(w.dob, config.termStart), source: `Waiver ${w.term || ''}`.trim() })
  return [...seen.values()].slice(0, 12).map((p) => ({ ...p, waiver: Boolean(waiverFor(p.name, { emails: [p.email], phones: [p.mobile] }, roster.waivers)) }))
}

// ---------- groups ----------

async function saveGroupAction(res, principal, config, body) {
  const input = body.group || {}
  const existing = body.id ? await getGroup(body.id) : null
  if (body.id && !existing) return fail(res, 404, 'Group not found.')
  const allowed = ['day', 'time', 'location', 'coachId', 'extraCoachIds', 'capacity', 'mode', 'label', 'durationMin', 'minAge', 'maxAge', 'ageStatus', 'girlsOnly', 'publicNote', 'programme', 'byCoach', 'trials', 'questions', 'product']
  const patch = Object.fromEntries(Object.entries(input).filter(([k]) => allowed.includes(k)))
  for (const k of ['capacity', 'durationMin']) if (k in patch) patch[k] = Number(patch[k])
  for (const k of ['minAge', 'maxAge']) if (k in patch) patch[k] = patch[k] === '' || patch[k] == null ? null : Number(patch[k])
  if (!existing) {
    const v = validateGroup({ capacity: 6, mode: 'closed', durationMin: 60, label: 'Small group', ...patch }, config)
    if (!v.ok) return fail(res, 400, v.errors.join(' '))
    if (await getGroup(v.group.id)) return fail(res, 409, v.group.byCoach ? 'That coach already has a group at that day, time and location.' : 'A group already runs at that day, time and location.')
    // One session is either one group, or split by coach: never both.
    const base = makeGroupId(v.group.day, v.group.time, v.group.location)
    const all = await listGroups()
    if (v.group.byCoach && all.some((x) => x.id === base)) return fail(res, 409, 'That session is already one group. Edit it, or tick "one group per coach" on it first.')
    if (!v.group.byCoach && all.some((x) => x.byCoach && makeGroupId(x.day, x.time, x.location) === base)) return fail(res, 409, 'That session is split by coach. Add another coach group instead.')
    await saveGroup({ ...v.group, createdBy: principal.email, createdAt: new Date().toISOString() })
    await audit({ by: principal.email, action: 'group.create', target: v.group.id, after: v.group })
    return res.status(200).json({ success: true, group: v.group })
  }
  const v = validateGroup(patch, config, { ...existing, id: undefined })
  if (!v.ok) return fail(res, 400, v.errors.join(' '))
  const next = { ...existing, ...v.group, byCoach: existing.byCoach === true, id: makeGroupId(v.group.day, v.group.time, v.group.location, existing.byCoach ? v.group.coachId : '') }
  const moved = next.id !== existing.id
  const roster = await loadRoster({ fresh: true })
  const rows = roster.players.filter((r) => r.groupId === existing.id && r.holdsPlace)
  if (moved) {
    if (await getGroup(next.id)) return fail(res, 409, 'A group already runs at that day, time and location.')
    const marker = `[MOVE:${existing.id}>${next.id}]`
    // Rows already at the new time are fine only if an earlier, part-finished
    // save of this same move put them there.
    if (roster.players.some((r) => r.groupId === next.id && r.holdsPlace && !r.notes.includes(marker))) return fail(res, 409, 'Airtable already has players at that day, time and location. Make that a group first, or pick another time.')
    if ((await onlineCounts([existing.id]))[existing.id] > 0) return fail(res, 409, 'A parent is booking this group right now. Try again in 15 minutes.')
    // Every player moves with the group, in Airtable.
    try {
      const nextCoach = coachById(config, next.coachId)
      if (rows.length) await updateTerm4Rows(rows.map((r) => ({ id: r.id, fields: { 'Term 3 Day': next.day, 'Term 3 Time': next.time, 'Term 3 Location': next.location, ...(next.byCoach && nextCoach ? { 'Coach': nextCoach.airtableName } : {}), 'Term 4 Notes': appendNote(r.notes, `Group changed from ${existing.day} ${existing.time} ${existing.location} to ${next.day} ${next.time} ${next.location} by ${principal.name}. ${marker}`) } })))
    } catch (error) {
      return fail(res, 502, `Airtable stopped part way (${String(error.message).slice(0, 80)}). Some players are on the new time and some on the old. Press Save again to finish the move.`)
    }
    await saveGroup(next)
    await deleteGroup(existing.id)
    for (const q of await listPayreqs()) if (q.groupId === existing.id && ['open', 'checkout'].includes(q.status)) await savePayreq({ ...q, groupId: next.id, groupLabel: groupSummary(next, config) })
  } else {
    await saveGroup(next)
  }
  // A single-coach group: keep each player's coach in Airtable in step.
  if (next.coachId !== existing.coachId && !(next.extraCoachIds || []).length) {
    const coach = coachById(config, next.coachId)
    const live = rows.filter((r) => r.holdsPlace)
    if (coach && live.length) await updateTerm4Rows(live.map((r) => ({ id: r.id, fields: { 'Coach': coach.airtableName } })))
  }
  await audit({ by: principal.email, action: moved ? 'group.move' : 'group.update', target: existing.id, before: existing, after: next })
  return res.status(200).json({ success: true, group: next, movedPlayers: moved ? rows.length : 0 })
}

async function deleteGroupAction(res, principal, body) {
  const g = await getGroup(body.id)
  if (!g) return fail(res, 404, 'Group not found.')
  const roster = await loadRoster({ fresh: true })
  if (roster.players.some((r) => r.groupId === g.id && r.holdsPlace)) return fail(res, 409, 'Move or remove the players first.')
  await deleteGroup(g.id)
  await audit({ by: principal.email, action: 'group.delete', target: g.id, before: g })
  return res.status(200).json({ success: true })
}

// Draft age bands from the players in each group, for groups that have none.
async function draftAges(res, principal, config) {
  const [groups, roster] = await Promise.all([listGroups(), loadRoster({ fresh: true })])
  let changed = 0
  for (const g of groups) {
    if (g.minAge != null || g.maxAge != null) continue
    const ages = roster.players.filter((r) => r.groupId === g.id && r.holdsPlace).map((r) => playerAge(r, config.termStart))
    const band = draftAgeBand(ages, config)
    if (band.minAge == null) continue
    await saveGroup({ ...g, ...band, ageStatus: 'draft' })
    changed += 1
  }
  await audit({ by: principal.email, action: 'group.draftAges', target: 'all', after: { changed } })
  return res.status(200).json({ success: true, changed })
}

// ---------- requests: applications, waitlist, enquiries ----------

// Lee's answer to an application or waitlist request:
//   offer   accepted for the term: pay (pro rata from the start date) to lock in
//   trial   one trial session first (A$85); after it, "Offer full term" on the board
//   decline / done
// Either offer holds the place in Airtable as Awaiting Reply for 7 days.
async function decideRequest(req, res, principal, config, body) {
  const r = await getApplication(body.id)
  if (!r) return fail(res, 404, 'Request not found.')
  const offering = body.decision === 'offer' || body.decision === 'trial'
  if (offering ? r.status !== 'pending' : !['pending', 'offered'].includes(r.status)) return fail(res, 409, `Already ${r.status}.`)
  if (body.decision === 'decline') {
    await saveApplication({ ...r, status: 'declined', decidedBy: principal.email, decidedAt: new Date().toISOString(), note: clean(body.note, 300) })
    await audit({ by: principal.email, action: 'request.decline', target: r.id })
    return res.status(200).json({ success: true, status: 'declined' })
  }
  if (body.decision === 'done') {
    await saveApplication({ ...r, status: 'done', decidedBy: principal.email, decidedAt: new Date().toISOString(), note: clean(body.note, 300) })
    await audit({ by: principal.email, action: 'request.done', target: r.id })
    return res.status(200).json({ success: true, status: 'done' })
  }
  if (!offering) return fail(res, 400, 'Choose offer, trial, decline or done.')
  const trial = body.decision === 'trial'
  const group = await getGroup(clean(body.groupId, 80) || r.groupId)
  if (!group) return fail(res, 404, 'Group not found.')
  const cap = await capacityCheck(group, r.players.length, body.force === true)
  if (cap.error) return fail(res, 409, cap.error, { code: cap.code })
  const dates = sessionDates(config, group.day)
  const startDate = dates.includes(body.startDate) ? body.startDate : nextSessionDate(config, group.day)
  const n = r.players.length
  const { amountCents, price, product } = trial
    ? { amountCents: Number.isInteger(Number(body.amountCents)) && Number(body.amountCents) > 0 ? Number(body.amountCents) : config.prices.trial * n, price: priceFor(config, { product: 'trial' }), product: 'trial' }
    : amountFor(config, group, { ...body, startDate }, n)
  const share = splitEven(amountCents, n)
  // The place is held in Airtable as Awaiting Reply until the family pays.
  const coach = coachById(config, group.coachId)
  const tag = newId('ADD')
  // A retry after a part-failed offer reuses the rows it already made.
  const earlier = await findTerm4ByTag('JFP-REQ', r.id)
  const ids = earlier.length ? earlier : await createTerm4Rows(r.players.map((p, i) => ({
    'Player Name': p.name, 'Parent Name': r.parentName, 'Email': r.email, 'Phone': r.mobile,
    'Term 3 Day': group.day, 'Term 3 Time': group.time, 'Term 3 Location': group.location, 'Coach': coach?.airtableName || '',
    'Term 4 Confirmation': 'Awaiting Reply', 'Term 4 Fee': share[i] / 100, 'Term 4 Amount Paid': 0, 'Term 4 Payment Status': 'Unpaid',
    'Term 4 Payment Type': trial ? 'JFP Trial' : price.type,
    'Term 4 Notes': `${trial ? `Trial offered for ${startDate}` : `Offered for the term from ${startDate}${price.proRata ? ` (${price.sessions} of ${price.of} sessions, pro rata)` : ''}`} from ${r.kind} by ${principal.name}${p.age != null ? `, age ${p.age}` : ''}${r.answers?.club ? `, plays for ${r.answers.club}${r.answers.team ? ` ${r.answers.team}` : ''}` : ''}. Holds the place for ${REQUEST_DAYS} days until paid. [${ADMIN_TAG}:${tag}] [JFP-REQ:${r.id}]`,
  })))
  // Any waiver the family signed with the request goes to Airtable now.
  const signed = r.players.filter((p) => p.waiver)
  if (signed.length) {
    const wtag = `[JFP-REQ:${r.id}]`
    if (!(await findWaiversByTag(wtag)).length) {
      await createWaiverRows(signed.map((p) => waiverFields({ player: { ...p, club: p.club || r.answers?.club || r.club }, parent: { name: r.parentName, email: r.email, mobile: r.mobile }, config, signature: p.waiver.signature, acceptedAt: p.waiver.acceptedAt, media: p.waiver.media, tag: wtag })))
      await bustRosterCache()
    }
  }
  const q = await createPayreq({ req, principal, config, group, rows: ids.map((id, i) => ({ id, name: r.players[i].name })), email: r.email, parentName: r.parentName, amountCents, reason: trial ? 'trial' : r.kind, requestId: r.id, product, startDate, trialDate: trial ? startDate : '', afterpay: body.afterpay !== false })
  await saveApplication({ ...r, status: 'offered', offer: trial ? 'trial' : 'term', offeredGroupId: group.id, payreqId: q.id, term4Ids: ids, decidedBy: principal.email, decidedAt: new Date().toISOString() })
  let emailed = false
  if (body.sendEmail !== false) {
    if (trial) await sendTrialOffered({ request: r, group, config, url: payreqUrl(req, q), amountCents, trialDate: startDate })
    else await sendPlaceOffered({ request: r, group, config, url: payreqUrl(req, q), amountCents, startDate, sessions: price.sessions })
    emailed = true
    await savePayreq({ ...q, emailedAt: new Date().toISOString() })
  }
  await audit({ by: principal.email, action: trial ? 'request.trial' : 'request.offer', target: r.id, after: { group: group.id, payreq: q.id, rows: ids, cents: amountCents, emailed } })
  return res.status(200).json({ success: true, status: 'offered', payreq: { id: q.id, url: payreqUrl(req, q), amountLabel: formatAud(amountCents) }, emailed })
}

// ---------- money ----------

function money(config, roster, bookings, payreqs) {
  const holding = roster.players.filter((r) => r.holdsPlace && !isTestName(r.player))
  const sum = (list, k) => list.reduce((t, r) => t + cents(r[k]), 0)
  const byStatus = {}
  for (const r of holding) { const k = r.paymentStatus || 'Not Set'; byStatus[k] = (byStatus[k] || 0) + 1 }
  const stripe = [
    ...bookings.filter((b) => b.status === 'paid').map((b) => ({ kind: 'booking', id: b.id, cents: b.amountPaidCents || 0, fee: b.stripeFeeCents, at: b.paidAt, who: b.players.map((p) => p.name).join(', ') })),
    ...payreqs.filter((q) => q.status === 'paid').map((q) => ({ kind: q.reason, id: q.id, cents: q.paidCents || 0, fee: q.stripeFeeCents, at: q.paidAt, who: q.playerNames.join(', ') })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const gross = stripe.reduce((t, s) => t + s.cents, 0)
  const fees = stripe.filter((s) => s.fee != null).reduce((t, s) => t + s.fee, 0)
  // Owing only where Airtable does not already say Paid: many paid rows carry no amount.
  const owing = holding.filter((r) => (r.balanceAud || 0) > 0 && r.paymentStatus !== 'Paid')
  return {
    airtable: {
      players: holding.length,
      feesCents: sum(holding, 'feeAud'),
      paidCents: sum(holding, 'paidAud'),
      owingCents: sum(owing, 'balanceAud'),
      owingPlayers: owing.length,
      stripeFeesCents: sum(holding, 'stripeFeeAud'),
      netCents: sum(holding, 'netAud'),
      byStatus,
    },
    online: { payments: stripe.length, grossCents: gross, stripeFeesCents: fees, netCents: gross - fees, feesPending: stripe.filter((s) => s.fee == null).length, recent: stripe.slice(0, 30).map((s) => ({ ...s, label: formatAud(s.cents), feeLabel: s.fee != null ? formatAud(s.fee) : 'Pending' })) },
    openRequests: payreqs.filter((q) => ['open', 'checkout'].includes(q.status)).map((q) => ({ id: q.id, who: q.playerNames.join(', '), parent: q.parentName, email: q.email, label: formatAud(q.amountCents), reason: q.reason, createdAt: q.createdAt, expiresAt: q.expiresAt })),
    owing: owing.map((r) => ({ rowId: r.id, player: r.player, parent: r.parent, email: r.email, group: `${r.day} ${r.time} ${r.location}`, balanceCents: cents(r.balanceAud), status: r.paymentStatus, linkNotes: r.linkNotes })).sort((a, b) => b.balanceCents - a.balanceCents),
    notes: 'Airtable totals are as Term 4 Players records them; sibling and shared payments can be split across rows. Stripe fees are exact, from each balance transaction. Net is not profit and is not the bank payout.',
  }
}

// ---------- coaches ----------

function coachSessions(config, groups, roster, coachId, date) {
  const mine = groups.filter((g) => g.coachId === coachId || (g.extraCoachIds || []).includes(coachId))
  const me = coachById(config, coachId)
  return mine.map((g) => {
    const dates = sessionDates(config, g.day)
    const players = roster.players.filter((r) => r.groupId === g.id && r.holdsPlace && !isTestName(r.player)).map((r) => {
      const c = coachByAirtableName(config, r.coach)
      return { rowId: r.id, name: r.player, age: playerAge(r, config.termStart), coach: c?.name || r.coach || '', mine: !c || c.id === coachId || !(g.extraCoachIds || []).length, trial: /trial/i.test(r.paymentType), status: r.confirmation }
    }).sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name))
    const loc = locationFor(config, g.location)
    const next = dates.find((d) => d >= (date || new Date().toISOString().slice(0, 10))) || dates.at(-1)
    return {
      id: g.id, day: g.day, time: g.time, sortTime: to24h(g.time), location: loc.name, address: loc.address, durationMin: g.durationMin,
      label: g.label, minAge: g.minAge, maxAge: g.maxAge, dates: dates.map((d) => ({ iso: d, label: dateLabel(d) })), nextDate: next,
      players, coachName: me?.name || '',
    }
  })
}

async function attendanceFor(gid, date) {
  const raw = await kvCommand(['HGETALL', keys.attendance(gid, date)])
  const out = {}
  for (let i = 0; i + 1 < (raw || []).length; i += 2) out[raw[i]] = raw[i + 1]
  return out
}

// ---------- handler ----------

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (process.env.JFP_PORTAL_ENABLED !== 'true') return fail(res, 503, 'The JFP portal is not open yet.')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  if (!sameOrigin(req)) return fail(res, 403, 'Invalid request origin')
  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }
  const action = clean(body.action, 40)
  try {
    const config = await getConfig()
    const principal = await staffPrincipal(req, config)
    if (!principal) return fail(res, 401, 'Please sign in.')
    const isAdmin = principal.role === 'admin'

    // ---------- coach and admin ----------
    if (action === 'me') return res.status(200).json({ success: true, user: principal, coaches: isAdmin ? config.coaches.map((c) => ({ id: c.id, name: c.name })) : [] })

    if (action === 'coachSessions') {
      const coachId = isAdmin ? clean(body.coachId, 30) : principal.coachId
      if (!coachById(config, coachId)) return fail(res, 400, 'Choose a coach.')
      const [groups, roster] = await Promise.all([listGroups(), loadRoster()])
      const sessions = coachSessions(config, groups, roster, coachId, clean(body.date, 10))
      for (const s of sessions) s.attendance = await attendanceFor(s.id, s.nextDate)
      const perWeek = sessions.reduce((t, s) => t + s.durationMin, 0)
      return res.status(200).json({ success: true, coach: coachById(config, coachId).name, term: config.term, sessions, hours: { perWeekMinutes: perWeek, termMinutes: perWeek * config.weeks, weeks: config.weeks } })
    }

    // The whole program as a timetable: names and ages, no money, no contacts.
    if (action === 'program') {
      const [groups, roster] = await Promise.all([listGroups(), loadRoster()])
      const counts = countsFrom(roster)
      const online = await onlineCounts(groups.map((g) => g.id))
      return res.status(200).json({
        success: true, term: config.term,
        groups: groups.filter((g) => g.mode !== 'closed' || isAdmin).map((g) => {
          const loc = locationFor(config, g.location)
          return {
            id: g.id, day: g.day, time: g.time, sortTime: to24h(g.time), period: periodOf(g), locationId: loc.id, locationName: loc.name,
            coachId: g.coachId, coachName: coachById(config, g.coachId)?.name || '', label: g.label, mode: g.mode, capacity: g.capacity,
            minAge: g.minAge, maxAge: g.maxAge, girlsOnly: g.girlsOnly, taken: counts[g.id] || 0, placesLeft: placesLeft(g, counts[g.id], online[g.id]),
            mine: g.coachId === principal.coachId || (g.extraCoachIds || []).includes(principal.coachId),
            players: roster.players.filter((r) => r.groupId === g.id && r.holdsPlace && !isTestName(r.player)).map((r) => ({ name: r.player, age: playerAge(r, config.termStart), trial: /trial/i.test(r.paymentType), status: r.confirmation })).sort((a, b) => a.name.localeCompare(b.name)),
          }
        }),
      })
    }

    if (action === 'markAttendance') {
      const g = await getGroup(body.groupId)
      if (!g) return fail(res, 404, 'Group not found.')
      if (!isAdmin && g.coachId !== principal.coachId && !(g.extraCoachIds || []).includes(principal.coachId)) return fail(res, 403, 'Not your session.')
      const date = clean(body.date, 10)
      const dates = sessionDates(config, g.day)
      if (!dates.includes(date)) return fail(res, 400, 'That date is not a session for this group.')
      const status = ['Present', 'Absent', 'Trial', 'Make-up', ''].includes(body.status) ? body.status : null
      if (status === null) return fail(res, 400, 'Invalid status.')
      const roster = await loadRoster()
      const row = roster.players.find((r) => r.id === clean(body.rowId, 30) && r.groupId === g.id)
      if (!row) return fail(res, 404, 'That player is not in this session.')
      const key = keys.attendance(g.id, date)
      if (status) await kvCommand(['HSET', key, row.id, status]); else await kvCommand(['HDEL', key, row.id])
      let airtable = 'skipped'
      if (status) {
        try {
          const week = dates.indexOf(date) + 1
          await upsertAttendance({ attendanceId: `T4-W${week}-${g.day.slice(0, 3)}-${g.time}-${row.player}`, playerName: row.player, week, date, group: g, coachName: principal.role === 'coach' ? principal.name.replace('Coach ', '') : (coachById(config, g.coachId)?.name || ''), status, markedBy: principal.email })
          airtable = 'saved'
        } catch (error) { console.error('jfp attendance airtable failed', error); airtable = 'failed' }
      }
      return res.status(200).json({ success: true, airtable })
    }

    if (!isAdmin) return fail(res, 403, 'Not allowed.')

    // ---------- Lee and Ligia ----------
    switch (action) {
      case 'board': await sweepExpiredOffers(principal); return res.status(200).json({ success: true, ...(await boardData(config)), coaches: config.coaches.map((c) => ({ id: c.id, name: c.name })), locations: config.locations.map((l) => ({ id: l.id, name: l.name })) })
      case 'searchPlayers': return res.status(200).json({ success: true, results: await searchPlayers(config, body) })
      case 'addPlayer': return await addPlayer(req, res, principal, config, body)
      case 'movePlayer': return await movePlayer(res, principal, config, body)
      case 'removePlayer': return await removePlayer(res, principal, config, body)
      case 'restorePlayer': return await restorePlayer(res, principal, body)
      case 'markPaid': return await markPaid(res, principal, body)
      case 'setTrial': return await setTrial(res, principal, body)
      case 'sendPaymentLink': return await sendPaymentLink(req, res, principal, config, body)
      case 'changePayreqAmount': return await changePayreqAmount(req, res, principal, config, body)
      case 'offerTerm': return await offerTerm(req, res, principal, config, body)
      case 'pricing': {
        const today = sydneyToday()
        return res.status(200).json({ success: true, weeks: config.weeks, today, prices: config.prices, products: PRODUCTS.map((x) => ({ ...x, cents: config.prices[x.key] })), datesByDay: Object.fromEntries(DAYS.map((d) => [d, sessionDates(config, d).map((iso) => ({ iso, label: dateLabel(iso), past: iso < today }))])) })
      }
      case 'removed': {
        const [roster, dropped] = await Promise.all([loadRoster({ fresh: true }), listDropped()])
        const log = (await listAudit(2000)).filter((e) => e.action === 'player.remove')
        return res.status(200).json({
          success: true,
          reasons: LEAVE_REASONS,
          players: [
            ...dropped.map((d) => ({ droppedId: d.id, name: d['Player Name'] || '', parent: d['Parent Name'] || '', email: d['Email'] || '', phone: d['Phone Number'] || '', term: d['Term Player left'] || '', reason: d['Reason for leaving'] || '', details: d['Reason details'] || '', removedAt: d['Removed At'] || '', removedBy: d['Removed By'] || '', session: d['Session'] || '', coach: d['Coach'] || '', paymentStatus: d['Payment Status'] || '', type: d['Term 4 Payment Type'] || '', feeCents: cents(d['Term 4 Fee']), paidCents: cents(d['Term 4 Amount Paid']), notes: d['Term 4 Notes'] || '', restored: d['Restored'] === true, contacted: d['Contacted'] === true })),
            // Removed before the dropped table existed: still in Term 4 as Dropped or Not Returning.
            ...roster.players.filter((r) => !r.holdsPlace && !dropped.some((d) => d['Source Term 4 Record ID'] === r.id)).map((r) => {
              const e = log.find((x) => x.target === r.id)
              return { rowId: r.id, name: r.player, parent: r.parent, email: r.email, phone: r.phone, term: config.term, reason: e?.after?.reason || (r.confirmation === 'Not Returning' ? 'Not returning' : ''), details: e?.after?.details || '', removedAt: e?.at || '', removedBy: e?.by || '', session: [r.day, r.time, r.location].filter(Boolean).join(' '), coach: r.coach, paymentStatus: r.paymentStatus, type: r.paymentType, feeCents: cents(r.feeAud), paidCents: cents(r.paidAud), notes: r.notes, status: r.confirmation, legacy: true }
            }),
          ].sort((x, y) => String(y.removedAt).localeCompare(String(x.removedAt))),
        })
      }
      case 'groups': {
        const groups = await listGroups()
        return res.status(200).json({ success: true, groups: sortGroups(groups).map((g) => ({ ...g, locationName: locationFor(config, g.location).name })), coaches: config.coaches.map((c) => ({ id: c.id, name: c.name })), modes: MODES, labels: LABELS, days: DAYS.slice(0, 7), locations: config.locations.map((l) => ({ id: l.id, name: l.name, match: l.match })) })
      }
      case 'saveGroup': return await saveGroupAction(res, principal, config, body)
      case 'deleteGroup': return await deleteGroupAction(res, principal, body)
      case 'draftAges': return await draftAges(res, principal, config)

      case 'requests': {
        await sweepExpiredOffers(principal)
        const [list, groups] = await Promise.all([listApplications(), listGroups()])
        const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
        return res.status(200).json({ success: true, requests: list.map((r) => ({ ...r, group: byId[r.groupId] ? groupSummary(byId[r.groupId], config) : r.groupId === 'one-to-one' ? '1 to 1 coaching, times on request' : r.groupId, groupLabel: byId[r.groupId]?.label || (r.groupId === 'one-to-one' ? '1 to 1' : '') })) })
      }
      case 'decideRequest': return await decideRequest(req, res, principal, config, body)

      case 'payments': {
        const [bookings, payreqs, viewsRaw, viewedRaw] = await Promise.all([listBookings(), listPayreqs(), kvCommand(['HGETALL', 'jfp:payreq-views']), kvCommand(['HGETALL', 'jfp:payreq-viewed-at'])])
        const pairs = (raw) => { const o = {}; for (let i = 0; i + 1 < (raw || []).length; i += 2) o[raw[i]] = raw[i + 1]; return o }
        const views = pairs(viewsRaw), viewed = pairs(viewedRaw)
        return res.status(200).json({
          success: true,
          bookings: bookings.filter((b) => !['reserving'].includes(b.status)).map((b) => ({
            id: b.id, kind: 'booking', status: b.status, createdAt: b.createdAt, paidAt: b.paidAt || '', group: b.groupSnapshot ? groupSummary(b.groupSnapshot, config) : b.groupId,
            players: (b.players || []).map((p) => p.name), parentName: b.parentName || '', email: b.email || '', mobile: b.mobile || '',
            amountLabel: formatAud(b.amountPaidCents ?? b.priceCents ?? 0), feeLabel: b.stripeFeeCents != null ? formatAud(b.stripeFeeCents) : '',
            stripeUrl: b.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${b.stripePaymentIntentId}` : '',
            effects: b.status === 'paid' ? effectsSummary(b, EFFECTS) : null, needsAttention: b.needsAttention || '', unexpected: (b.unexpectedPayments || []).map((u) => ({ reason: u.reason, amountLabel: formatAud(u.amountCents), stripeUrl: u.intentId ? `https://dashboard.stripe.com/payments/${u.intentId}` : '' })),
          })),
          payreqs: payreqs.map((q) => ({
            id: q.id, kind: q.reason, status: q.status, createdAt: q.createdAt, paidAt: q.paidAt || '', group: q.groupLabel, players: q.playerNames, amountCents: q.amountCents,
            productLabel: q.productLabel || '', startDate: q.startDate || '', trialDate: q.trialDate || '', emailedAt: q.emailedAt || '', views: Number(views[q.id] || 0), lastViewedAt: viewed[q.id] || '', expiresAt: q.expiresAt || '', afterpay: q.afterpay !== false, term4Ids: q.term4Ids,
            parentName: q.parentName, email: q.email, amountLabel: formatAud(q.paidCents ?? q.amountCents), feeLabel: q.stripeFeeCents != null ? formatAud(q.stripeFeeCents) : '',
            url: payreqUrl(req, q), stripeUrl: q.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${q.stripePaymentIntentId}` : '',
            effects: q.status === 'paid' ? effectsSummary(q, PAY_EFFECTS) : null, createdBy: q.createdBy, needsAttention: q.needsAttention || '', unexpected: (q.unexpectedPayments || []).map((u) => ({ reason: u.reason, amountLabel: formatAud(u.amountCents), stripeUrl: u.intentId ? `https://dashboard.stripe.com/payments/${u.intentId}` : '' })),
          })),
        })
      }
      case 'repair': {
        const r = await repairJfpBooking(clean(body.id, 60))
        await audit({ by: principal.email, action: 'payment.repair', target: body.id })
        if (r.reason === 'busy') return fail(res, 409, 'That payment is being processed right now. Try again in two minutes.')
        return r.ok ? res.status(200).json({ success: true, summary: r.summary }) : fail(res, 400, 'Only paid bookings can be repaired.')
      }
      case 'cancelPayreq': {
        const q = await getPayreq(body.id)
        if (!q) return fail(res, 404, 'Not found.')
        if (q.status === 'paid') return fail(res, 409, 'Already paid. Refunds are made in Stripe.')
        const closed = q.status === 'checkout' ? await closeCheckout(q.stripeSessionId) : 'expired'
        if (closed === 'complete') return fail(res, 409, 'The family has just paid. It will show as paid in a minute; refunds are made in Stripe.')
        if (closed === 'error') return fail(res, 503, 'Could not close the family\'s payment page. Try again in a minute.')
        await savePayreq({ ...q, status: 'cancelled', cancelledBy: principal.email, cancelledAt: new Date().toISOString() })
        // Put back what a price-list link changed on the rows.
        if (q.restoreFields?.length) {
          const still = []
          for (const x of q.restoreFields) if (await getTerm4Row(x.id)) still.push(x)
          if (still.length) await updateTerm4Rows(still)
        }
        const released = ['application', 'waitlist', 'trial', 'admin-add'].includes(q.reason) ? await releaseOffer(q, principal, 'Link cancelled') : 0
        await audit({ by: principal.email, action: 'payreq.cancel', target: q.id, after: { released } })
        return res.status(200).json({ success: true, released })
      }
      case 'cancelBooking': {
        const b = await getBooking(clean(body.id, 60))
        if (!b) return fail(res, 404, 'Booking not found.')
        if (b.status === 'paid') return fail(res, 409, 'A paid booking is in Airtable. Remove the player on the board, then refund in Stripe.')
        const closed = b.status === 'held' ? await closeCheckout(b.stripeSessionId) : 'expired'
        if (closed === 'complete') return fail(res, 409, 'The family has just paid. It will show as paid in a minute.')
        if (closed === 'error') return fail(res, 503, 'Could not close the family\'s payment page. Try again in a minute.')
        await releasePlaces(b.groupId, b.id)
        await dropParentHold(b.email, b.id)
        await saveBooking({ ...b, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: principal.email })
        await audit({ by: principal.email, action: 'booking.cancel', target: b.id })
        return res.status(200).json({ success: true })
      }

      case 'money': {
        const [roster, bookings, payreqs] = await Promise.all([loadRoster({ fresh: true }), listBookings(), listPayreqs()])
        return res.status(200).json({ success: true, money: money(config, roster, bookings, payreqs) })
      }

      case 'audit': return res.status(200).json({ success: true, entries: await listAudit(Number(body.limit) || 300) })

      case 'getSettings': return res.status(200).json({ success: true, config })
      case 'saveSettings': {
        const input = body.config || {}
        const patch = {}
        for (const k of ['term', 'termStart', 'weeks', 'prices', 'waiverUrl', 'staffEmails', 'superAdmins', 'coachLoginsEnabled', 'locations', 'kitUrl', 'kitNote']) if (k in input) patch[k] = input[k]
        if (patch.prices) patch.prices = { ...config.prices, ...patch.prices }
        if (Array.isArray(input.coaches)) patch.coaches = input.coaches
        if ('superAdmins' in patch) {
          const list = (Array.isArray(patch.superAdmins) ? patch.superAdmins : []).map(validEmail).filter(Boolean)
          if (!list.includes(principal.email)) return fail(res, 400, 'You cannot remove your own admin access.')
          patch.superAdmins = list
        }
        const before = config
        const next = await saveConfig(patch)
        await audit({ by: principal.email, action: 'settings.save', target: 'config', before, after: next })
        return res.status(200).json({ success: true, config: next })
      }

      default: return fail(res, 400, `Unknown action: ${action || '(none)'}`)
    }
  } catch (error) {
    console.error(`jfp-portal-data ${action} failed`, error)
    return fail(res, 500, /Airtable/.test(error.message) ? `Airtable did not save that change (${error.message.slice(0, 120)}). Nothing was lost; try again.` : 'Something went wrong. Try again.')
  }
}

export { crypto }
