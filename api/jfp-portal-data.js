// Everything the JFP portal shows and changes, behind a signed-in staff session.
//
// Roles, checked here on every action:
//   admin  Lee and Ligia: the whole program, players, money, settings
//   coach  the whole program timetable (names and ages), their own sessions
//          and registers. No money, no parent contact details.
//
// Staff changes write straight into Airtable Term 4 Players, so Lee's
// dashboard always matches, and every change is recorded in the audit log.
import { playersHistory, HISTORY_TERMS } from './_jfp-players-history.js'
import { listAppAccess, markAppAccess } from './_jfp-app-access.js'
import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { siteUrl, getConfig as getHolidayConfig } from './_holiday-store.js'
import {
  getConfig, saveConfig, listGroups, getGroup, saveGroup, deleteGroup, validateGroup, onlineCounts, placesLeft, listBookings, getBooking, holdPlaces,
  saveBooking, releasePlaces, listApplications, getApplication, saveApplication, listPayreqs, getPayreq, savePayreq, coachById,
  coachByAirtableName, sessionDates, dateLabel, formatAud, to24h, clean, newId, audit, listAudit, locationFor, validEmail, ageOn,
  normName, cleanPhone, groupId as makeGroupId, kvCommand, kvPipeline, keys, ADMIN_TAG, MODES, LABELS, DAYS, sortGroups, closeCheckout, dropParentHold, PRO_TYPE, isProType,
  PRODUCTS, QUESTIONS, productFor, priceFor, paidSiblings, nextSessionDate, sydneyToday, periodOf, NSW_HOLIDAYS, coachLabel, kvSetJson, kvGetJson, rowEmails, emailsIn, SESSION_TYPE, isSessionType, withPerSession, prepaidOf, withPrepaid,
} from './_jfp-store.js'
import { coachPhotoUrl } from './jfp-groups.js'
import {
  loadRoster, countsFrom, playerAge, waiverFor, isoDate, createTerm4Rows, updateTerm4Rows, getTerm4Row, appendNote, upsertAttendance, clearAttendance, draftAgeBand, placeInGroups,
  createWaiverRows, waiverFields, findWaiversByTag, bustRosterCache, findTerm4ByTag,
  getTerm4Fields, findDroppedBySource, createDroppedRow, updateDroppedRow, getDroppedRow, deleteTerm4Row, RESTORABLE,
  listLedger, createLedgerRow, listJuniors, listVenueHistory, PAINT_MAX_AGE_MS,
  findLedgerByPayment, listPreviousTerm, getPreviousTermRow, updatePreviousTermRow, previousTermSpec,
} from './_jfp-airtable.js'
import { listCancels, staffView, noticeSummary } from './_jfp-cancel.js'
import { repairJfpBooking, effectsSummary, EFFECTS, payEffectsFor } from './_jfp-finalise.js'
import { feeTied, stampFeeBasisFresh, syncRowLinks, syncLinks, repricedNote } from './_jfp-fee-sync.js'
import { staffPrincipal, sameOrigin } from './_jfp-people.js'
import { sendAccountInvite, accountInvite, sendFamilyInvite, sendFamilyWelcome, sendPlaceOffered, sendTrialOffered, sendTermOffered, sendDeclined, sendNextTermInvite, sendFamilyInvoice, sendQuickLinkEmail } from './_jfp-email.js'
import { nextStatuses, setNextStatus, nextPrices, recordNext, nextInterest } from './_jfp-next.js'
import { allProfiles, findProfile, pickProfile, profileKey, profileView, profileSummary, cleanProfile, saveProfile, waiverPrefill, addTrialFeedback, clubSuggestions, LEVELS, PLAYING_UP, POSITIONS, FEET, YEARS } from './_jfp-profiles.js'
import { releaseOffer, sweepExpiredOffers } from './_jfp-offers.js'
import { emailErrorText, emailsTo } from './_jfp-email-log.js'
import { contactWords, withOwnContact, isAdult } from './_jfp-contact.js'
import { telegramAlert } from './_jfp-notify.js'
import { EXTRA_ACTIONS, extraAction } from './_jfp-extra-actions.js'
import { ANNOUNCE_ACTIONS, announceAction } from './_jfp-announce.js'
import { HOURS_ACTIONS, hoursAction } from './_jfp-hours.js'
import { INVOICE_ACTIONS, invoiceAction } from './_jfp-coach-invoices.js'
import { FAMILY_NOTE_ACTIONS, familyNoteAction } from './_jfp-family-notes.js'
import { REPORT_ACTIONS, reportAction } from './_jfp-report-actions.js'
import { pushFamilyNote } from './_jfp-push.js'
import { noteNewPlayer, alertsStatus, newPlayerWords, registerWords } from './_jfp-coach-alerts.js'
import { stripeScan, jfpStripePayments, feeTotals } from './_jfp-stripe.js'
import { juniorsMoneyData, juniorsRoster } from './_jfp-juniors-money.js'
import { JJ_ACTIONS, jjAction, jjMoneyData, jjTableList } from './_jj-portal.js'
import { JJ_REGISTER_ACTIONS, jjRegisterAction, jjDatesForGroup, classForGroup, markOne as jjMarkOne } from './_jj-registers.js'
import { matchBank, cleanItem, csvIds, EXTERNAL_ID, BANK_LIMITS, twinOf, looksJfp, feeSizes, rowScore } from './_jfp-bank-match.js'
import { holidayMoneyData, holidaySizes, HOLIDAY_BANK } from './_holiday-money.js'
import { proMoneyData, isProRow, isProLedger, PRO_BANK } from './_jfp-pro-money.js'
import { billPlan, afterBill, billLine, coveredOf, withQuote } from './_jfp-quote.js'
import { playerQuote, saveQuote, saveDefaultQuote, addQuote, termRun } from './_jfp-quote-staff.js'
import { linkProfile, accountsWithNoSession, allAccounts } from './_jfp-account-open.js'
import { removedPlayers, removedMatches, removedPrefill, reasonCounts, removedSource, backNote, markAddedBack } from './_jfp-removed.js'
import { campsMoneyData, campsStripe } from './_jfp-camps.js'
import { isPeriodId, periodOf as holidayPeriodOf, periodLabel, pickablePeriods, rangeLabel, OTHER, OTHER_LABEL } from './_holiday-periods.js'
import { allocateTermMoney, collectedOf, venuesForTerm, venuesFromLedger, venuesFromHistory, venueTerms, juniorsByVenue, previousTerm, totalOf, emptyVenue, costsOfTerm, withCosts, costTotals, checkCostLines, costTermOk } from './_jfp-venues.js'
import { registerChecks, yearsOf, termsOfYear, termFromLive, termFromLedger, termFromRegister, yearSummary } from './_jfp-years.js'
import { listExtras, setExtraStatus, KINDS as EXTRA_KINDS } from './_jfp-extras.js'
import { MONEY_ACTIONS, moneyAction, applyStripeMatch } from './_jfp-money-actions.js'
import { listStripeClass } from './_jfp-stripe-class.js'
import { listMatches, listRules, ruleFor } from './_jfp-stripe-match.js'
import { listInvoices, openForBank, getInvoice } from './_jfp-invoices.js'
import { feePdfAttachment, docForPayreq, docForInvoice, pdfDownload } from './_jfp-fee-pdf.js'
import { invoiceRefOf } from './_jfp-bank-match.js'
// Saved card or bank account, auto-charge after each session (claude/card-on-file).
import { accountAlerts, newAccountsData } from './_jfp-new-accounts.js'
import { withAgent, inAgent, agentState, setAgentEnabled, listHeld, takeHeld, heldView } from './_jfp-agent.js'
import { sendHeldEmail } from './_jfp-email.js'
import { SAVED_PAY_ACTIONS, savedPayAction, withSavedPay, autoChargeActiveFor } from './_jfp-saved-pay.js'
import { PROGRAMMES, programmeLabel, PRICE_MIN, PRICE_MAX, PRICES_MAX, cleanPrice, allPrices, priceById, quickHolidayPeriods, quickLinkInput, quickStatus, QUICK_STATUS, quickOpen, quickToCheck, quickUrl, QUICK_CHECKED, QUICK_EMAILED } from './_jfp-quick.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }
const cents = (aud) => (typeof aud === 'number' ? Math.round(aud * 100) : 0)
// An email to a family or player: never lets a failed send look like the
// whole action failed (the row or link is already saved), and always says why.
async function trySend(what, fn) {
  try { const r = await fn(); return { emailed: true, messageId: r?.messageId || '' } } catch (error) { console.error(`jfp ${what} email failed`, error); return { emailed: false, emailError: emailErrorText(error) } }
}
// The PDF tax invoice for a fee email (_jfp-fee-pdf.js). Made before the
// send; when it cannot be made the email goes without it and staff are told.
const feePdf = (req, config, q) => feePdfAttachment(q, config, siteUrl(req))
const pdfWarningOf = (sent, pdf) => (sent.emailed && pdf.pdfWarning ? pdf.pdfWarning : '')
// Wording for one set of rows: the player when they are their own contact.
const wordsFor = (rows) => contactWords({ self: rows.length > 0 && rows.every((r) => r.ownContact), players: rows.map((r) => r.player), parent: rows[0]?.parent || '' })
const programmeOfRows = (rows) => (rows.length && rows.every((r) => isProType(r.paymentType)) ? 'pro' : '')
const ISO = /^\d{4}-\d{2}-\d{2}$/
const phoneOk = (v) => String(v || '').replace(/\D/g, '').length >= 8
const isTestName = (n) => /test/i.test(n || '')
const REQUEST_DAYS = 7

// The dashboard's own rule for who counts on the Term 4 page.
function onDashboard(r) {
  return r.confirmation.toLowerCase() === 'confirmed' && !isTestName(r.player) && !/joners juniors/i.test(r.paymentType)
}

function playerView(r, config, roster, { money }) {
  const w = waiverFor(r.player, { emails: rowEmails(r), phones: [r.phone], dob: r.dob }, roster.waivers)
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
    // Which waiver: 'adult' (the player for themselves) or 'guardian'; '' for older ones.
    ...(w?.kind ? { waiverKind: w.kind } : {}),
    kit: r.kit || '',
    dashboard: onDashboard(r),
    ownContact: r.ownContact === true,
    ...(money ? {
      parent: r.parent, email: r.email, phone: r.phone,
      paymentStatus: r.paymentStatus || 'Not set', feeCents: cents(r.feeAud), paidCents: cents(r.paidAud), balanceCents: cents(r.balanceAud),
      linkNotes: r.linkNotes,
    } : {}),
  }
}

// A Joners Juniors group's children are in the Juniors table for this term,
// on the same day, time and place. They are shown, marked, and counted in
// coach hours, but every Term 4 action (move, remove, pay) leaves them alone.
export const isJuniorsGroup = (g) => g?.label === 'Joners Juniors'
// The Juniors table writes dates of birth as 05/03/2020 (day first).
const isoDob = (v) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim()); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(v || '') }
async function juniorsFor(groups, config) {
  if (!groups.some(isJuniorsGroup)) return {}
  let rows = []
  // The Juniors term running now (its own settings), from its own tables.
  try { rows = await juniorsRoster(config.juniors?.term || config.term, { tables: jjTableList(config) }) } catch (error) { console.error('jfp juniors roster failed', error.message); return { error: 'Could not read the Joners Juniors table' } }
  const out = {}
  for (const g of groups.filter(isJuniorsGroup)) {
    out[g.id] = rows.filter((r) => r.day && r.time && r.location && makeGroupId(r.day, r.time, r.location) === makeGroupId(g.day, g.time, g.location))
      .map((r) => ({ rowId: r.id, name: r.player, age: ageOn(isoDob(r.dob), config.termStart), status: 'Confirmed', juniors: true, paidVia: r.paidVia, juniorsStatus: r.status }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  return out
}

// The roster cache is cleared by every change made here, so the board can use
// it; Refresh asks Airtable again (fresh).
async function boardData(config, { fresh = false } = {}) {
  const [groups, roster, payreqs, requests, notes] = await Promise.all([listGroups(), loadRoster({ fresh }), listPayreqs(), listApplications(), coachNotes()])
  const juniors = await juniorsFor(groups, config)
  // Joners Juniors children get the same payment colours as JFP players on the
  // staff timetable (Lee, 13 Oct 2026), from the Juniors money figures.
  if (Object.values(juniors).some((list) => Array.isArray(list) && list.length)) {
    try {
      const jm = await juniorsMoneyData({ quick: !fresh, fresh })
      const byRow = new Map((jm.players || []).map((x) => [x.rowId, x]))
      for (const list of Object.values(juniors)) if (Array.isArray(list)) for (const p of list) { const m = byRow.get(p.rowId); if (m) p.pay = { status: m.status, feeCents: m.feeCents, paidCents: m.paidCents, owingCents: m.owingCents } }
    } catch (error) { console.error('jfp juniors board money failed', error.message) }
  }
  const pendingBy = {}
  for (const r of requests) if (r.status === 'pending') pendingBy[r.groupId] = (pendingBy[r.groupId] || 0) + 1
  const counts = countsFrom(roster)
  const online = await onlineCounts(groups.map((g) => g.id))
  const openReqByRow = new Map()
  for (const q of payreqs) if (['open', 'checkout'].includes(q.status)) for (const id of q.term4Ids) openReqByRow.set(id, { id: q.id, amountLabel: formatAud(q.amountCents) })
  const known = new Set(groups.map((g) => g.id))
  const holding = roster.players.filter((r) => r.holdsPlace)
  const view = groups.map((g) => {
    const players = isJuniorsGroup(g) ? (juniors[g.id] || []) : holding.filter((r) => r.groupId === g.id).map((r) => ({ ...playerView(r, config, roster, { money: true }), ...coachInfo(r, notes, config), payreq: openReqByRow.get(r.id) || null }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const loc = locationFor(config, g.location)
    return {
      ...g,
      locationId: loc.id, locationName: loc.name,
      coachName: coachLabel(coachById(config, g.coachId)),
      extraCoachNames: (g.extraCoachIds || []).map((c) => coachLabel(coachById(config, c))).filter(Boolean),
      taken: isJuniorsGroup(g) ? players.length : counts[g.id] || 0,
      juniorsError: isJuniorsGroup(g) ? juniors.error || '' : undefined,
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
      waivers: holding.filter((r) => waiverFor(r.player, { emails: rowEmails(r), phones: [r.phone], dob: r.dob }, roster.waivers)).length,
    },
  }
}

function groupSummary(g, config) {
  const loc = locationFor(config, g.location)
  return `${g.day} ${g.time}, ${loc.name}`
}

// The sibling rate only when Airtable shows another child of this family
// with a paid place this term.
async function siblingGuard(product, email, names) {
  if (product !== 'sibling') return null
  const roster = await loadRoster({ fresh: true })
  return paidSiblings(roster.players, email, names).length ? null : 'No other child of this family has a paid place this term, so the sibling rate does not apply. Choose another price.'
}

// Staff adding, moving or offering a place take the same atomic hold that
// families take when they book, so a parent and a staff member (or two staff)
// can never both get the last place. The hold lapses on its own after
// STAFF_HOLD_SECONDS, by which time the Airtable row counts instead.
// "Add anyway" (force) skips the check on purpose.
const STAFF_HOLD_SECONDS = 45
// Holds taken during one request; released when it ends (the Airtable row,
// written in the same request, counts from then on).
const requestHolds = new AsyncLocalStorage()
async function capacityCheck(group, adding, force) {
  if (force) return { left: null }
  const roster = await loadRoster()
  const taken = countsFrom(roster)[group.id] || 0
  const holdId = newId('STAFF')
  const ok = await holdPlaces({ gid: group.id, bookingId: holdId, want: adding, available: Math.max(0, Number(group.capacity || 0) - taken), expiresMs: Date.now() + STAFF_HOLD_SECONDS * 1000 })
  if (!ok) {
    const holds = (await onlineCounts([group.id]))[group.id] || 0
    const left = placesLeft(group, taken, holds)
    return { error: `${groupSummary(group, await getConfig())} has ${left} place${left === 1 ? '' : 's'} left. Add anyway?`, code: 'full', left }
  }
  requestHolds.getStore()?.push({ gid: group.id, holdId })
  return { left: placesLeft(group, taken, 0) - adding, holdId }
}

// ---------- players ----------

// The price for a group and product from a start date, unless staff typed
// an amount. Returns { amountCents, price } or { error }.
function amountFor(config, group, body, players = 1) {
  const product = PRODUCTS.some((x) => x.key === body.product) ? body.product : (group?.product || 'group')
  const from = ISO.test(body.startDate || '') ? body.startDate : (group ? nextSessionDate(config, group.day, Date.now(), group.time) : '')
  const price = priceFor(config, { product, day: group?.day, fromIso: from, players })
  const typed = Number(body.amountCents)
  const amountCents = Number.isInteger(typed) && typed > 0 ? typed : price.totalCents
  return { amountCents, price, product, from }
}

// What the Add forms (Timetable and Players tab) send, read the same way:
// the player, the contact (a parent, or the player as their own contact),
// player information for the profile, and how they pay. { ok, v } or { error }.
const ADD_PAYMENTS = ['offline', 'link', 'trial', 'none', 'sessions', 'pro']
function readAdd(config, body, { group = null } = {}) {
  const ownContact = body.ownContact === true
  const name = clean(body.player?.name ?? body.name, 80)
  if (name.length < 3) return { error: "Enter the player's full name." }
  const rawEmail = body.parent?.email ?? body.email ?? ''
  const email = rawEmail ? validEmail(rawEmail) : ''
  if (rawEmail && !email) return { error: 'That email does not look right.' }
  // No parent when the player is their own contact: nothing to ask for.
  const parentName = ownContact ? '' : clean(typeof body.parent === 'object' ? body.parent?.name : body.parent, 100)
  const mobile = clean(body.parent?.mobile ?? body.mobile, 40)
  const dob = ISO.test(body.player?.dob || body.dob || '') ? (body.player?.dob || body.dob) : ''
  const payment = ADD_PAYMENTS.includes(body.payment) ? body.payment : 'none'
  if (payment === 'trial' && !group) return { error: 'A trial needs a group. Add them on the Timetable, or choose another payment.' }
  // Session by session and Pro sessions: their own price per session, nothing
  // owing until sessions are billed from Money (the price can wait until then).
  const perSession = ['sessions', 'pro'].includes(payment) && body.perSessionCents != null && body.perSessionCents !== '' ? Number(body.perSessionCents) : 0
  if (perSession && !(Number.isInteger(perSession) && perSession >= 100 && perSession <= 200000)) return { error: 'Enter the price per session in dollars, for example 80.' }
  // One of Lee's own prices (Money > Prices), for a link or a payment already made.
  const custom = body.priceId ? priceById(config, body.priceId) : null
  if (body.priceId && (!custom || custom.archived)) return { error: 'That price is not on the price list any more. Choose another.' }
  // Player information for the profile, checked before anything is written.
  const profIn = { ...(body.profile && typeof body.profile === 'object' ? body.profile : {}) }
  if (dob) profIn.dob = dob
  for (const k of ['parentName', 'parentMobile', 'parent2Name', 'parent2Email', 'parent2Mobile']) if (ownContact) delete profIn[k]
  if (!ownContact) { if (parentName) profIn.parentName = parentName; if (mobile) profIn.parentMobile = mobile }
  const { values: profile, errors } = cleanProfile(profIn)
  if (errors.length) return { error: errors.join(' ') }
  const words = contactWords({ self: ownContact, players: [name], parent: parentName })
  // A Pro quote typed on the Add form (commitment tiers), checked now (_jfp-quote-staff.js).
  const quote = addQuote('', body.quote, { perSession, sessionPay: ['sessions', 'pro'].includes(payment), maxN: termRun(config, {}, group).left })
  if (quote.error) return { error: quote.error }
  return { ok: true, v: { ownContact, name, email, parentName, mobile, dob, payment, perSession, custom: custom && !custom.builtin ? custom : null, profile, words, quoteTiers: quote.tiers || [] } }
}

// The profile for a player just added, in the same request. The row is
// already written, so a failed profile save is reported, not thrown.
// Round 2 item 8: a profile the family made in My account (or an earlier
// one) is found by email and name and linked to the new row, so staff see
// it straight away; it is never made twice.
async function saveAddedProfile(principal, v, rowId) {
  try {
    const r = await linkProfile({ name: v.name, email: v.email, rowId, values: v.profile, by: principal.email })
    return r.profile ? { profileSaved: true, ...(r.linked ? { profileLinked: true } : {}) } : {}
  } catch (e) {
    console.error('jfp add player profile failed', e)
    return { profileSaved: false, profileError: 'The player was added, but their player information did not save. Open Edit on the Players tab and save it again.' }
  }
}

// The same player's Term 4 row that holds a place but is in no group: same
// name, and the same family (email, else parent name) or no contact on it.
async function unplacedTwin(roster, name, email, parentName) {
  const known = new Set((await listGroups()).map((g) => g.id))
  const n = normName(name)
  const sameFamily = (r) => (email && rowEmails(r).some((e) => e.toLowerCase() === email.toLowerCase()))
    || (!rowEmails(r).length && (!r.parent || !parentName || normName(r.parent) === normName(parentName)))
    || (!email && r.parent && parentName && normName(r.parent) === normName(parentName))
  return roster.players.find((r) => r.holdsPlace && normName(r.player) === n && !(r.groupId && known.has(r.groupId)) && sameFamily(r)) || null
}

// Writes the rows for group adds: a new row, or the player's existing
// no-group row moved into the group. That row keeps its name and contacts,
// and its money when payments are already on it. Ids in the same order.
async function writeGroupAdds(list) {
  const fresh = list.map((x, i) => ({ x, i })).filter(({ x }) => !x.twin)
  const ids = new Array(list.length)
  if (fresh.length) (await createTerm4Rows(fresh.map(({ x }) => x.fields))).forEach((id, k) => { ids[fresh[k].i] = id })
  const updates = []
  for (const [i, x] of list.entries()) {
    if (!x.twin) continue
    const t = x.twin, f = { ...x.fields }
    delete f['Player Name']
    if (t.parent) delete f['Parent Name']
    if (t.email) delete f['Email']
    if (t.phone) delete f['Phone']
    let line = f['Term 4 Notes']
    if (Number(t.paidAud) > 0) {
      for (const k of ['Term 4 Fee', 'Term 4 Amount Paid', 'Term 4 Payment Status', 'Term 4 Fee Reconciliation']) delete f[k]
      line = `${line}\nFee and payments left as they were: this row already has a payment on it.`
    }
    if (t.confirmation === 'Confirmed') { delete f['Term 4 Confirmation']; delete f['Confirmation Date'] }
    f['Term 4 Notes'] = appendNote(t.notes, `Put into ${f['Term 3 Day']} ${f['Term 3 Time']} ${f['Term 3 Location']} (was in no group). ${line}`)
    updates.push({ id: t.id, fields: f })
    ids[i] = t.id
  }
  if (updates.length) await updateTerm4Rows(updates)
  return ids
}

// Who is in a session right now, for deciding a request (Lee, 15 Oct 2026):
// name, age, club and level of each player holding a place, and how full it is.
function sessionNow(config, byId, roster, profiles) {
  const memo = new Map()
  return (gid) => {
    const g = byId[gid]
    if (!g || isJuniorsGroup(g)) return null
    if (memo.has(gid)) return memo.get(gid)
    const players = roster.players.filter((r) => r.groupId === gid && r.holdsPlace && !isTestName(r.player)).map((r) => {
      const prof = profiles ? pickProfile(profiles, { key: profileKey(r.player, r.email), rowIds: [r.id] }) : null
      const w = prof?.club ? null : waiverFor(r.player, { emails: rowEmails(r), phones: [r.phone], dob: r.dob }, roster.waivers)
      const dob = prof?.dob || isoDate(r.dob) || w?.dob || ''
      return {
        name: r.player, age: dob ? ageOn(dob, sydneyToday()) : playerAge(r, config.termStart),
        club: prof?.club || w?.club || '', level: prof?.level || '', positions: prof?.positions || [],
        trial: /trial/i.test(r.paymentType), confirmed: r.confirmation === 'Confirmed',
      }
    }).sort((a, b) => (a.age ?? 99) - (b.age ?? 99) || a.name.localeCompare(b.name))
    const out = { players, taken: players.length, capacity: g.capacity || null, coach: coachLabel(coachById(config, g.coachId)), minAge: g.minAge ?? null, maxAge: g.maxAge ?? null }
    memo.set(gid, out)
    return out
  }
}

// The payment type and notes line for Pro sessions and session by session.
function sessionsLine(payment, perSession) {
  const what = payment === 'pro' ? 'Pro sessions' : 'Session by session'
  return `${what}${perSession ? ` at ${formatAud(perSession)} a session` : ''}.`
}

// One player into a group, checked, nothing written yet (round 2, 14 Oct
// 2026: shared by Add a player and Add a family). { ok, ... } or
// { status, error, code?, rowId? }. family: { size } when several children
// are added in one go (no email of their own, no link of their own).
async function prepGroupAdd({ principal, config, group, body, roster, family = null }) {
  if (isJuniorsGroup(group)) return { status: 400, error: 'Joners Juniors children are added in the Joners Juniors table, not here.' }
  const read = readAdd(config, body, { group })
  if (read.error) return { status: 400, error: read.error }
  const { name, email, payment, perSession, custom, ownContact, dob } = read.v
  if (!family && (payment === 'link' || body.sendEmail) && !email) return { status: 400, error: ownContact ? "Add the player's email so they can sign in, sign the waiver and pay." : 'Add the parent email so the family can sign in, sign the waiver and pay.' }
  // The same player twice in one group (a retry after an error) is refused.
  const already = roster.players.find((r) => r.holdsPlace && normName(r.player) === normName(name) && r.day === group.day && r.time === group.time && r.location === group.location)
  if (already) return { status: 409, error: `${name} is already in this group.`, code: 'duplicate', rowId: already.id }
  // Already on file with no group (added on the Players tab with no session,
  // or a returning player not placed yet): that row goes into the group, not
  // a second row (Massimo Marrone, 15 Oct 2026).
  const twin = await unplacedTwin(roster, name, email, read.v.parentName)
  const cap = await capacityCheck(group, 1, body.force === true)
  if (cap.error) return { status: 409, error: cap.error, code: cap.code }
  const age = dob ? ageOn(dob, config.termStart) : (Number.isInteger(Number(body.player?.age)) ? Number(body.player.age) : null)
  if (payment === 'offline' && !(Number.isInteger(Number(body.amountCents)) && Number(body.amountCents) > 0) && !custom) return { status: 400, error: 'Enter the amount they paid.' }
  const fromPrice = amountFor(config, group, body)
  const { price, product, from } = fromPrice
  const typed = Number(body.amountCents)
  const amountCents = custom ? (Number.isInteger(typed) && typed > 0 ? typed : custom.cents) : fromPrice.amountCents
  // In a family add the other children are the siblings, so the sibling rate is allowed.
  const sibErr = custom || (family && family.size > 1) ? null : await siblingGuard(product, email, [name])
  if (sibErr) return { status: 400, error: sibErr }
  const isTrial = payment === 'trial' || (!custom && product === 'trial')
  if (family && payment === 'link' && isTrial) return { status: 400, error: `A paid trial has its own link. Choose a free trial for ${name}, or add ${name} on their own.` }
  const isPro = payment === 'pro' || custom?.programme === 'pro'
  const perSessionPay = payment === 'sessions' || payment === 'pro'
  const coach = coachById(config, group.coachId)
  const addId = newId('ADD')
  const today = sydneyToday()
  const type = isTrial ? 'JFP Trial' : isPro ? PRO_TYPE : payment === 'sessions' ? SESSION_TYPE : price.type
  let notes = `Added by ${principal.name} in the JFP portal${family ? ' (Add a family)' : ''}${isTrial && from ? `. Trial offered for ${from}` : ''}${age != null ? `, age ${age}` : ''}${!custom && price.fixedSessions && !isTrial && !perSessionPay ? `, half term from ${from} (${price.sessions} sessions)` : !custom && price.proRata && !isTrial && !perSessionPay ? `, from ${from} (${price.sessions} of ${price.of} sessions, pro rata)` : ''}${custom && !perSessionPay ? `, ${custom.name}` : ''}${payment === 'offline' ? `. Paid offline (${clean(body.method, 30) || 'not stated'})` : ''}. [${ADMIN_TAG}:${addId}]${body.note ? `\n${clean(body.note, 500)}` : ''}${perSessionPay ? `\n${sessionsLine(payment, perSession)}` : ''}`
  if (perSession) notes = withPerSession(notes, perSession)
  notes = withQuote(withOwnContact(notes, ownContact), read.v.quoteTiers)
  // Starting later in the term (Lee, 14 Oct 2026): the family's dates, the
  // register, billing and the coach's alert all count from that session.
  const groupDates = sessionDates(config, group.day)
  const startsFrom = !isTrial && ISO.test(body.startsFrom || '') && groupDates.includes(body.startsFrom) && body.startsFrom > (groupDates.find((d) => d >= today) || '') ? body.startsFrom : ''
  if (startsFrom) notes = `${notes}. Starts ${startsFrom}. [STARTS:${startsFrom}]`
  const fields = {
    'Player Name': name,
    'Parent Name': read.v.parentName,
    ...(email ? { 'Email': email } : {}),
    ...(read.v.mobile ? { 'Phone': read.v.mobile } : {}),
    'Term 3 Day': group.day, 'Term 3 Time': group.time, 'Term 3 Location': group.location,
    'Coach': coach?.airtableName || '',
    // A link is a place held for this family: confirmed once they pay.
    'Term 4 Confirmation': payment === 'link' ? 'Awaiting Reply' : 'Confirmed',
    ...(payment === 'link' ? {} : { 'Confirmation Date': today }),
    'Term 4 Fee': payment === 'trial' || perSessionPay ? 0 : amountCents / 100,
    'Term 4 Amount Paid': payment === 'offline' ? amountCents / 100 : 0,
    'Term 4 Payment Status': payment === 'offline' ? 'Paid' : payment === 'trial' ? 'N/A' : 'Unpaid',
    'Term 4 Payment Type': type,
    'Term 4 Notes': notes,
    ...(payment === 'offline' ? { 'Term 4 Fee Reconciliation': 'Non-Stripe — verified' } : {}),
  }
  return { ok: true, v: read.v, group, fields, twin, amountCents, isTrial, isPro, perSessionPay, product, from, custom, payment, what: custom ? custom.name : isTrial ? 'Trial session' : `${productFor(product).label}${price.proRata && from ? `, ${price.sessions} of ${price.of} sessions from ${dateLabel(from)}` : price.fixedSessions && from ? `, ${price.sessions} sessions from ${dateLabel(from)}` : ''}` }
}

export async function addPlayer(req, res, principal, config, body) {
  const group = await getGroup(body.groupId)
  if (!group) return fail(res, 404, 'Group not found.')
  const prep = await prepGroupAdd({ principal, config, group, body, roster: await loadRoster({ fresh: true }) })
  if (!prep.ok) return fail(res, prep.status, prep.error, { ...(prep.code ? { code: prep.code } : {}), ...(prep.rowId ? { rowId: prep.rowId } : {}) })
  const { name, email, parentName, mobile, dob, payment, perSession, custom, ownContact, words } = prep.v
  const { amountCents, isTrial, isPro, perSessionPay, product, from } = prep
  const back = await removedSource(body)
  const [rowId] = await writeGroupAdds([{ ...prep, fields: { ...prep.fields, 'Term 4 Notes': backNote(prep.fields['Term 4 Notes'], back) } }])
  await markAddedBack(principal, back, { rowId, where: groupSummary(group, config) })
  const prof = await saveAddedProfile(principal, prep.v, rowId)
  let payreq = null
  if (payment === 'link') payreq = await createPayreq({ req, principal, config, group, rows: [{ id: rowId, name }], email, parentName, amountCents, reason: isTrial ? 'trial' : 'admin-add', product: custom ? '' : product, startDate: from, afterpay: body.afterpay !== false, programme: isPro ? 'pro' : '', ownContact })
  if (payreq && custom) await savePayreq({ ...payreq, productLabel: custom.name })
  let sent = { emailed: false }, pdf = {}
  if (body.sendEmail === true && email) {
    const roster = await loadRoster({ fresh: true })
    const hasWaiver = Boolean(waiverFor(name, { emails: [email], phones: [mobile], dob }, roster.waivers))
    pdf = payreq ? await feePdf(req, config, { ...payreq, ...(custom ? { productLabel: custom.name } : {}) }) : {}
    // The player is already added: an email failure must not look like the add failed.
    sent = await trySend('add player', () => sendFamilyInvite({ to: email, parentName, playerNames: [name], group, config, url: payreq ? payreqUrl(req, payreq) : `${siteUrl(req)}/jfp-account/`, needs: { details: !hasWaiver && !dob, waiver: !hasWaiver, payment: Boolean(payreq), sessions: perSessionPay, owingCents: !payreq && payment === 'none' && !isTrial ? amountCents : 0 }, amountCents, trial: isTrial, startDate: from, product, self: ownContact, attachment: pdf.attachment }))
    if (payreq && sent.emailed) await savePayreq({ ...payreq, ...(custom ? { productLabel: custom.name } : {}), emailedAt: new Date().toISOString() })
  }
  const emailError = sent.emailError ? `${name} was added, but the email to ${email} did not send. ${sent.emailError} Try again with Account invite on the player.` : ''
  // The group's coach hears about it (Lee, 14 Oct 2026), a few minutes later.
  await noteNewPlayer({ config, group, rowId, player: name, kind: 'added' }).catch((e) => console.error('jfp coach news failed', e))
  await audit({ by: principal.email, action: 'player.add', target: rowId, after: { name, group: group.id, payment, emailed: sent.emailed, payreq: payreq?.id || '', cents: payment === 'none' || perSessionPay ? 0 : amountCents, perSessionCents: perSession || undefined, quote: prep.v.quoteTiers.length ? prep.v.quoteTiers : undefined, ownContact: ownContact || undefined, priceId: custom?.id || undefined } })
  return res.status(200).json({ success: true, rowId, payreq: payreq ? { id: payreq.id, url: payreqUrl(req, payreq), amountLabel: formatAud(amountCents) } : null, emailed: sent.emailed, emailTo: sent.emailed ? email : '', emailError, pdfWarning: pdfWarningOf(sent, pdf), ownContact, words, movedRow: Boolean(prep.twin), ...prof })
}

// ---------- Players tab: one row per player, searchable, with everything ----------

// Every Term 4 player flattened for the Players tab: enough to search, filter
// and show the whole picture without a second call per player.
async function playersList(req, res, config, body = {}) {
  // Player information (club, level, positions) is read with the list, so the
  // tab can filter on it when placing players. A failed read only hides it.
  const [roster, groups, profiles, trialFb] = await Promise.all([loadRoster({ fresh: body.fresh === true }), listGroups(), allProfiles().catch((e) => { console.error('jfp profiles read failed', e); return null }), trialFeedbackAll()])
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, g]))
  // placeInGroups resolves each row's groupId the same way the Timetable does,
  // including the coach-split morning squads. A groupId that is not a real
  // group means the row could not be placed: that is the "Not in a group" list.
  const placed = await placeInGroups(roster, groups, config)
  const players = placed.players.map((r) => {
    const g = byGroup[r.groupId] || null
    const gid = g ? r.groupId : ''
    const coach = coachById(config, g?.coachId) || coachByAirtableName(config, r.coach)
    const loc = locationFor(config, r.location)
    const waiver = waiverFor(r.player, { emails: rowEmails(r), phones: [r.phone], dob: r.dob }, roster.waivers)
    const prof = profiles ? pickProfile(profiles, { key: profileKey(r.player, r.email), rowIds: [r.id] }) : null
    const dob = prof?.dob || isoDate(r.dob) || waiver?.dob || ''
    return {
      rowId: r.id,
      name: r.player,
      // Today's age from the date of birth (player information, Term 3, else
      // the waiver), so it goes up on each birthday. Club the same way.
      dob,
      age: dob ? ageOn(dob, sydneyToday()) : null,
      club: prof?.club || waiver?.club || '',
      profile: profileSummary(prof),
      trial: /trial/i.test(r.paymentType), trialDate: trialDateOf(r), trialFeedback: trialFb[r.id] || null,
      parent: r.parent || '',
      email: r.email || '',
      phone: r.phone || '',
      // No parent: the player is their own contact (wording, emails, texts).
      ownContact: r.ownContact === true,
      pro: isProType(r.paymentType), perSessionCents: r.perSessionCents || null,
      groupId: gid,
      groupLabel: g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : '',
      day: r.day || '', time: r.time || '', location: loc.name || r.location || '',
      coach: coach ? coachLabel(coach) : (r.coach || ''),
      coachId: coach?.id || '',
      confirmation: r.confirmation || '',
      paymentStatus: r.paymentStatus || '',
      paymentType: r.paymentType || '',
      feeAud: r.feeAud, paidAud: r.paidAud, balanceAud: r.balanceAud,
      kit: r.kit || '',
      waiver: waiver ? { onFile: true, term: waiver.term || '', signedDate: waiver.signedDate || '', how: waiver.how || '', spelling: waiver.spelling || '', kind: waiver.kind || '' } : { onFile: false },
      notes: r.notes || '',
      inGroup: Boolean(gid),
      holdsPlace: r.holdsPlace,
    }
  })
  // Card on file / Direct debit on file, auto-charge on or paused (claude/card-on-file).
  await withSavedPay(players)
  const seen = new Map()
  for (const p of players) { const k = (p.email || p.name).toLowerCase(); seen.set(k, (seen.get(k) || 0) + 1) }
  // Accounts with no session (round 2 item 8): profiles families made in My
  // account (or kept from earlier terms) with no Term 4 row now.
  // Removed players are not "No session yet" (Lee, 18 Oct 2026).
  const removed = profiles ? (await removedPlayers(config, { roster }).catch((e) => { console.error('jfp removed read failed', e); return [] })).map((x) => ({ rowIds: [x.sourceRowId, x.rowId], name: x.name, email: x.email })) : []
  const accounts = profiles ? accountsWithNoSession(profiles, roster.players.filter((r) => r.holdsPlace).map((r) => r.id), await allAccounts().catch(() => ({})), removed) : []
  return res.status(200).json({
    success: true,
    accounts,
    players: players.sort((a, b) => a.name.localeCompare(b.name)),
    groups: groups.filter((g) => g.mode !== 'closed').map((g) => ({ id: g.id, label: `${g.day} ${g.time}, ${locationFor(config, g.location).name}`, coachId: g.coachId })),
    coaches: config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })),
    locations: config.locations.map((l) => ({ id: l.id, name: l.name })),
  })
}

// Add a player straight from the Players tab, with no group. For a family who
// has agreed a place but has no session yet, and for test rows. A player added
// here holds no place and takes no capacity until someone puts them in a group.
// It takes the same details as the Timetable add (player information, own
// contact, payment) and can email a sign-in invite or a payment link.
// One player with no group, checked, nothing written yet (shared by the
// Players tab add and Add a family). allowTwin: "Add another row anyway".
async function prepNoGroupAdd({ principal, config, body, roster, family = null, allowTwin = false }) {
  const read = readAdd(config, body)
  if (read.error) return { status: 400, error: read.error }
  const { name, email, parentName, mobile, payment, perSession, custom, ownContact } = read.v
  if (!family && (payment === 'link' || body.sendEmail === true) && !email) return { status: 400, error: ownContact ? "Add the player's email so they can sign in." : 'Add the parent email so the family can sign in.' }
  // The same player twice with no group (a double tap, or a retry) is refused.
  const twin = roster.players.find((r) => r.holdsPlace && normName(r.player) === normName(name) && (email ? rowEmails(r).includes(email) : !rowEmails(r).length))
  if (twin && (!twin.groupId || !allowTwin)) {
    const where = twin.groupId ? `in ${[twin.day, twin.time, twin.location].filter(Boolean).join(' ')}` : 'with no group yet'
    return { status: 409, error: `${name}${email ? ` (${email})` : ''} is already in Term 4 Players ${where}.${twin.groupId && !family ? ' Add another row anyway?' : ' Open that row instead.'}`, code: 'duplicate', rowId: twin.id, inGroup: Boolean(twin.groupId) }
  }
  const feeAud = Number.isFinite(Number(body.feeAud)) && Number(body.feeAud) >= 0 && body.feeAud !== '' && body.feeAud != null ? Number(body.feeAud) : null
  const typed = Number(body.amountCents)
  const chosen = !custom && PRODUCTS.some((x) => x.key === body.product) ? amountFor(config, null, { ...body, amountCents: undefined }) : null
  const amountCents = Number.isInteger(typed) && typed > 0 ? typed : custom ? custom.cents : chosen ? chosen.amountCents : 0
  if (['link', 'offline'].includes(payment) && !amountCents) return { status: 400, error: family ? `Choose what ${name} is paying for, or type the amount.` : 'Choose what they are paying for, or type the amount.' }
  if (family && payment === 'trial') return { status: 400, error: `A trial needs a group. Choose ${name}'s group, or another payment.` }
  const isPro = payment === 'pro' || custom?.programme === 'pro'
  const perSessionPay = payment === 'sessions' || payment === 'pro'
  const note = clean(body.note, 300)
  const what = custom ? custom.name : chosen ? productFor(chosen.product).label : ''
  let notes = `Added by ${principal.name} in the JFP portal ${family ? 'Add a family' : 'Players tab'}, with no session yet.${note ? ` ${note}` : ''}${what && !perSessionPay ? ` ${what}.` : ''}${payment === 'offline' ? ` Paid offline (${clean(body.method, 30) || 'not stated'}).` : ''}${perSessionPay ? ` ${sessionsLine(payment, perSession)}` : ''}`
  if (perSession) notes = withPerSession(notes, perSession)
  notes = withQuote(withOwnContact(notes, ownContact), read.v.quoteTiers)
  const fee = perSessionPay ? 0 : ['link', 'offline'].includes(payment) ? amountCents / 100 : feeAud
  const fields = {
    'Player Name': name,
    ...(parentName ? { 'Parent Name': parentName } : {}),
    ...(email ? { Email: email } : {}),
    ...(mobile ? { Phone: mobile } : {}),
    // No day, time or location on purpose: they are not in a group yet.
    'Term 4 Confirmation': 'Awaiting Reply',
    ...(fee != null ? { 'Term 4 Fee': fee } : {}),
    'Term 4 Amount Paid': payment === 'offline' ? amountCents / 100 : 0,
    'Term 4 Payment Status': payment === 'offline' ? 'Paid' : perSessionPay || payment === 'link' ? 'Unpaid' : 'Not Set',
    ...(isPro ? { 'Term 4 Payment Type': PRO_TYPE } : payment === 'sessions' ? { 'Term 4 Payment Type': SESSION_TYPE } : chosen ? { 'Term 4 Payment Type': chosen.price.type } : {}),
    ...(payment === 'offline' ? { 'Term 4 Fee Reconciliation': 'Non-Stripe — verified' } : {}),
    'Term 4 Notes': notes,
  }
  return { ok: true, v: read.v, group: null, fields, fee, amountCents, isTrial: false, isPro, perSessionPay, product: chosen?.product || '', from: '', custom, payment, what }
}

async function addPlayerNoGroup(req, res, principal, config, body) {
  const roster = await loadRoster({ fresh: true })
  const prep = await prepNoGroupAdd({ principal, config, body, roster, allowTwin: body.force === true })
  if (!prep.ok) return fail(res, prep.status, prep.error, { ...(prep.code ? { code: prep.code, rowId: prep.rowId, inGroup: prep.inGroup } : {}) })
  const { name, email, parentName, mobile, payment, ownContact, words } = prep.v
  const { amountCents, isPro, fee, what, custom } = prep
  const back = await removedSource(body)
  const [rowId] = await writeGroupAdds([{ ...prep, fields: { ...prep.fields, 'Term 4 Notes': backNote(prep.fields['Term 4 Notes'], back) } }])
  await markAddedBack(principal, back, { rowId, where: '' })
  // Term 4 Players has no date of birth column: it goes in player information.
  const prof = await saveAddedProfile(principal, prep.v, rowId)
  await bustRosterCache()
  let payreq = null
  if (payment === 'link') {
    payreq = await createPayreq({ req, principal, config, group: null, rows: [{ id: rowId, name }], email, parentName, amountCents, reason: 'admin-add', product: prep.product, startDate: '', afterpay: body.afterpay !== false, programme: isPro ? 'pro' : '', ownContact })
    if (what) { payreq.productLabel = what; await savePayreq(payreq) }
  }
  let sent = { emailed: false }, pdf = {}
  if (body.sendEmail === true && email) {
    const hasWaiver = Boolean(waiverFor(name, { emails: [email], phones: [mobile], dob: prep.v.dob }, roster.waivers))
    if (payreq) pdf = await feePdf(req, config, payreq)
    sent = payreq
      ? await trySend('add player no group', () => sendFamilyInvite({ to: email, parentName, playerNames: [name], group: null, config, url: payreqUrl(req, payreq), needs: { details: false, waiver: !hasWaiver, payment: true }, amountCents, self: ownContact, attachment: pdf.attachment }))
      : await trySend('add player no group invite', () => sendAccountInvite({ to: email, parentName, players: [{ name, group: 'Group to be confirmed' }], config, signInUrl: `${siteUrl(req)}/jfp-account/`, needsWaiver: !hasWaiver, money: false, email, self: ownContact }))
    if (sent.emailed) {
      if (payreq) await savePayreq({ ...payreq, emailedAt: new Date().toISOString() })
      else await kvCommand(['HSET', 'jfp:acct-only-invited', email, new Date().toISOString()])
    }
  }
  const emailError = sent.emailError ? `${name} was added, but the email to ${email} did not send. ${sent.emailError}` : ''
  await audit({ by: principal.email, action: 'player.add.nogroup', target: rowId, after: { name, email, feeAud: fee, payment, emailed: sent.emailed, payreq: payreq?.id || '', quote: prep.v.quoteTiers.length ? prep.v.quoteTiers : undefined, ownContact: ownContact || undefined, priceId: custom?.id || undefined } })
  return res.status(200).json({ success: true, rowId, payreq: payreq ? { id: payreq.id, url: payreqUrl(req, payreq), amountLabel: formatAud(amountCents) } : null, emailed: sent.emailed, emailTo: sent.emailed ? email : '', emailError, pdfWarning: pdfWarningOf(sent, pdf), ownContact, words, ...prof })
}

// Add a family in one go (round 2, Lee 14 Oct 2026): a brother and sister,
// say, with one parent contact. Each child has their own group (or none yet),
// name, date of birth and price (a term price, session by session or Pro
// with their own quote, a free trial, paid offline, or decide later). Every
// child is checked before anything is written (duplicates, places left,
// prices), then: a Term 4 row each (the group's coach told, as any add),
// ONE payment request for every child with a price to pay (each child's own
// amount on it, split onto their own rows when paid, as a family invoice),
// and ONE email to the parent listing every child and the steps: a waiver
// for each child, one payment, then the player details.
const FAMILY_MAX = 6
export async function addFamily(req, res, principal, config, body) {
  const kids = Array.isArray(body.children) ? body.children : []
  if (!kids.length) return fail(res, 400, 'Add at least one child.')
  if (kids.length > FAMILY_MAX) return fail(res, 400, `Add up to ${FAMILY_MAX} children at a time.`)
  const p = body.parent && typeof body.parent === 'object' ? body.parent : {}
  const email = p.email ? validEmail(p.email) : ''
  if (!email) return fail(res, 400, 'Add the parent email. The whole family signs in with it, one account for every child.')
  const parentName = clean(p.name, 100)
  if (parentName.length < 2) return fail(res, 400, "Enter the parent's name.")
  const seen = new Set()
  for (const k of kids) {
    const n = normName(k?.player?.name || k?.name || '')
    if (n && seen.has(n)) return fail(res, 400, `${clean(k.player?.name || k.name, 80)} is listed twice.`)
    seen.add(n)
  }
  const roster = await loadRoster({ fresh: true })
  const groups = Object.fromEntries((await listGroups()).map((g) => [g.id, g]))
  const preps = []
  for (const [i, k] of kids.entries()) {
    const childBody = { ...k, parent: { name: parentName, email, mobile: p.mobile || '' }, ownContact: false, sendEmail: false, force: body.force === true }
    const group = k.groupId ? groups[clean(k.groupId, 60)] : null
    if (k.groupId && !group) return fail(res, 404, `Child ${i + 1}: that group was not found. Refresh and try again.`, { child: i })
    const prep = group
      ? await prepGroupAdd({ principal, config, group, body: childBody, roster, family: { size: kids.length } })
      : await prepNoGroupAdd({ principal, config, body: childBody, roster, family: { size: kids.length } })
    if (!prep.ok) {
      const who = clean(k.player?.name || k.name, 80) || `Child ${i + 1}`
      return fail(res, prep.status, prep.error.includes(who) ? prep.error : `${who}: ${prep.error}`, { child: i, ...(prep.code ? { code: prep.code } : {}), ...(prep.rowId ? { rowId: prep.rowId } : {}) })
    }
    preps.push(prep)
  }
  const famId = newId('FAM')
  const backs = await Promise.all(kids.map((k) => removedSource(k)))
  const ids = await writeGroupAdds(preps.map((x, i) => ({ ...x, fields: { ...x.fields, 'Term 4 Notes': backNote(`${x.fields['Term 4 Notes']}\nFamily add ${famId}: ${preps.map((y) => y.v.name).join(', ')}.`, backs[i]) } })))
  const added = preps.map((x, i) => ({ ...x, rowId: ids[i], where: x.group ? groupSummary(x.group, config) : 'Group to be confirmed' }))
  for (const [i, x] of added.entries()) await markAddedBack(principal, backs[i], { rowId: x.rowId, where: x.group ? x.where : '' })
  const profiles = []
  for (const x of added) profiles.push(await saveAddedProfile(principal, x.v, x.rowId))
  // ONE payment request for every child with a price to pay.
  const linked = added.filter((x) => x.payment === 'link' && x.amountCents > 0)
  let payreq = null
  if (linked.length) {
    const total = linked.reduce((t, x) => t + x.amountCents, 0)
    payreq = await createPayreq({ req, principal, config, group: linked.length === 1 ? linked[0].group : null, rows: linked.map((x) => ({ id: x.rowId, name: x.v.name })), email, parentName, amountCents: total, reason: 'family', afterpay: body.afterpay !== false, programme: linked.every((x) => x.isPro) ? 'pro' : '' })
    payreq.places = linked.map((x) => ({ rowId: x.rowId, name: x.v.name, label: `${x.where}${x.what ? `, ${x.what}` : ''}`, feeCents: x.amountCents, paidCents: 0, owingCents: x.amountCents }))
    payreq.groupLabel = [...new Set(linked.map((x) => x.where))].join(' · ')
    payreq.familyAdd = famId
    await savePayreq(payreq)
  }
  // ONE email to the parent: every child, then the steps.
  let sent = { emailed: false }, pdf = {}
  if (body.sendEmail !== false) {
    if (payreq) pdf = await feePdf(req, config, payreq)
    const children = added.map((x) => ({
      name: x.v.name, where: x.where,
      pay: x.payment === 'link' ? `${x.what ? `${x.what}, ` : ''}${formatAud(x.amountCents)}` : x.payment === 'offline' ? 'Paid' : x.payment === 'trial' ? `Free trial${x.from ? `, ${dateLabel(x.from)}` : ''}` : x.perSessionPay ? `${x.isPro ? 'Pro sessions' : 'Session by session'}${x.v.perSession ? `, ${formatAud(x.v.perSession)} a session` : ''}` : 'We will confirm the price with you',
      waiver: !waiverFor(x.v.name, { emails: [email], phones: [x.v.mobile], dob: x.v.dob }, roster.waivers),
      sessions: x.perSessionPay, link: x.payment === 'link' && x.amountCents > 0,
    }))
    sent = await trySend('add family', () => sendFamilyWelcome({ to: email, parentName, children, config, url: payreq ? payreqUrl(req, payreq) : `${siteUrl(req)}/jfp-account/`, amountCents: payreq?.amountCents || 0, attachment: pdf.attachment }))
    if (sent.emailed && payreq) await savePayreq({ ...payreq, emailedAt: new Date().toISOString() })
    if (sent.emailed && !payreq) await kvCommand(['HSET', 'jfp:acct-only-invited', email, new Date().toISOString()])
  }
  // Each group's coach hears about their new player, as with any add.
  for (const x of added.filter((y) => y.group)) await noteNewPlayer({ config, group: x.group, rowId: x.rowId, player: x.v.name, kind: 'added' }).catch((e) => console.error('jfp coach news failed', e))
  for (const x of added) await audit({ by: principal.email, action: x.group ? 'player.add' : 'player.add.nogroup', target: x.rowId, after: { name: x.v.name, group: x.group?.id || '', payment: x.payment, family: famId, payreq: payreq?.id || '', cents: x.payment === 'link' || x.payment === 'offline' ? x.amountCents : 0, perSessionCents: x.v.perSession || undefined, quote: x.v.quoteTiers.length ? x.v.quoteTiers : undefined, priceId: x.custom?.id || undefined } })
  await audit({ by: principal.email, action: 'family.add', target: famId, after: { email, rows: ids, payreq: payreq?.id || '', cents: payreq?.amountCents || 0, emailed: sent.emailed } })
  const profileError = profiles.find((x) => x.profileError)?.profileError || ''
  return res.status(200).json({
    success: true, familyId: famId,
    rows: added.map((x) => ({ rowId: x.rowId, name: x.v.name, where: x.where, payment: x.payment, amountLabel: x.payment === 'link' ? formatAud(x.amountCents) : '' })),
    payreq: payreq ? { id: payreq.id, url: payreqUrl(req, payreq), amountLabel: formatAud(payreq.amountCents) } : null,
    emailed: sent.emailed, emailTo: sent.emailed ? email : '', pdfWarning: pdfWarningOf(sent, pdf),
    emailError: sent.emailError ? `The family was added, but the email to ${email} did not send. ${sent.emailError}` : '',
    ...(profileError ? { profileError } : {}),
  })
}

// No email in the link: it would end up in browser history and server logs.
export function payreqUrl(req, q) { return `${siteUrl(req)}/jfp-account/?pay=${encodeURIComponent(q.id)}` }

// Offers from requests hold the place for 7 days; balance and term links do not expire.
const EXPIRING = new Set(['application', 'waitlist', 'trial'])

export async function createPayreq({ req, principal, config, group, rows, email, parentName, amountCents, reason, requestId, product = '', startDate = '', afterpay = true, trialDate = '', creditCents = 0, restoreFields = null, programme = '', ownContact = false }) {
  const q = {
    id: newId('PAY'),
    email, parentName,
    // Pro sessions players' links say so (Money's Pro view); others are JFP.
    ...(programme === 'pro' ? { programme: 'pro' } : {}),
    // The player is their own contact: emails about this link talk to them.
    ...(ownContact ? { ownContact: true } : {}),
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
  // What each row owes as the link is made: a later fee change moves the
  // link from here (_jfp-fee-sync.js). A failed read only means no basis.
  await stampFeeBasisFresh(q).catch((error) => console.error('jfp fee basis failed', q.id, error.message))
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
  if (isJuniorsGroup(to)) return fail(res, 400, 'A JFP player cannot be moved into the Joners Juniors class.')
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
  await noteNewPlayer({ config, group: to, rowId: row.id, player: row.player, kind: 'moved' }).catch((e) => console.error('jfp coach news failed', e))
  return res.status(200).json({ success: true })
}

// Notes for coaches (Lee, 12 Oct 2026: "Frankie King and Alanna Mirigliani
// only start in week 3"). The note text is for coaches only and lives in KV
// (Term 4 Notes holds payment history coaches never see). A start date goes
// on the Airtable row as [STARTS:date], so the family's account, the
// register and cancellations all count from that week.
const COACH_NOTES = 'jfp:coach-notes'
async function coachNotes() {
  const flat = await kvCommand(['HGETALL', COACH_NOTES]) || []
  const out = {}
  for (let i = 0; i < flat.length; i += 2) { try { out[flat[i]] = JSON.parse(flat[i + 1]) } catch {} }
  return out
}
// What a coach is shown about a player: the note and when they start.
function coachInfo(r, notes, config) {
  const n = notes[r.id]
  const groupDates = sessionDates(config, r.day)
  const week = r.startsFrom ? groupDates.indexOf(r.startsFrom) + 1 : 0
  return {
    note: n?.text || '',
    startsFrom: r.startsFrom || '',
    startsLabel: r.startsFrom ? `Starts ${dateLabel(r.startsFrom)}${week > 0 ? ` (week ${week})` : ''}` : '',
  }
}
async function setCoachNote(res, principal, config, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  const text = clean(body.text, 300)
  const start = ISO.test(body.startDate || '') ? body.startDate : ''
  if (start && !sessionDates(config, row.day).includes(start)) return fail(res, 400, 'Choose one of this group\'s session dates.')
  const before = { text: (await coachNotes())[row.id]?.text || '', startsFrom: row.startsFrom }
  if (text) await kvCommand(['HSET', COACH_NOTES, row.id, JSON.stringify({ text, by: principal.email, at: new Date().toISOString() })])
  else await kvCommand(['HDEL', COACH_NOTES, row.id])
  if (start !== row.startsFrom) {
    const base = String(row.notes || '').replace(/\s*\[STARTS:[^\]]*\]/g, '')
    await updateTerm4Rows([{ id: row.id, fields: { 'Term 4 Notes': start ? appendNote(base, `Starts ${start} (set by ${principal.name}). [STARTS:${start}]`) : appendNote(base, `Start week cleared by ${principal.name}: from the start of term.`) } }])
  }
  await audit({ by: principal.email, action: 'player.coachNote', target: row.id, before, after: { text, startsFrom: start } })
  return res.status(200).json({ success: true })
}

// Edit a player's details from Money (Lee, 12 Oct 2026): name, family
// contacts, the fee and the payment type. Payments are not edited here: they
// are recorded or undone on their own. The balance is Airtable's formula.
// If an open payment link no longer matches the new fee, say so.
const PAYMENT_TYPES = [SESSION_TYPE, PRO_TYPE, 'JFP 10 weeks', 'JFP Half term (5 weeks)', 'JFP Pathway 10 weeks', 'Sibling / 2 sessions per week', 'JFP Trial', 'JFP Drop-in', 'JFP 1 on 1 casual', 'JFP 1 on 1, 10 weeks', 'JFP pathway 1 on 1', 'JFP Pathway', 'Additional Term 4 session balance']
async function editPlayer(res, principal, config, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  const f = body.fields || {}
  const fields = {}
  const before = {}
  if ('name' in f) { const v = clean(f.name, 80); if (v.length < 3) return fail(res, 400, "Enter the player's full name."); fields['Player Name'] = v; before.name = row.player }
  if ('parent' in f) { fields['Parent Name'] = clean(f.parent, 80); before.parent = row.parent }
  if ('email' in f) { const v = f.email ? validEmail(f.email) : ''; if (f.email && !v) return fail(res, 400, 'That email does not look right.'); fields['Email'] = v; before.email = row.email }
  if ('phone' in f) { fields['Phone'] = clean(f.phone, 30); before.phone = row.phone }
  if ('feeAud' in f) {
    if (f.feeAud === null || f.feeAud === '') { fields['Term 4 Fee'] = null } else {
      const v = Number(f.feeAud)
      if (!Number.isFinite(v) || v < 0 || v > 20000) return fail(res, 400, 'Enter the fee in dollars, for example 750.')
      fields['Term 4 Fee'] = Math.round(v * 100) / 100
    }
    before.feeAud = row.feeAud
  }
  if ('paymentType' in f) { if (f.paymentType && !PAYMENT_TYPES.includes(f.paymentType)) return fail(res, 400, 'Choose a payment type from the list.'); fields['Term 4 Payment Type'] = f.paymentType || null; before.paymentType = row.paymentType }
  // Switching to session by session: the term fee goes, so nothing is owing
  // until sessions are billed (the fee becomes what they have paid so far).
  if (fields['Term 4 Payment Type'] && isSessionType(fields['Term 4 Payment Type']) && !isSessionType(row.paymentType) && !('feeAud' in f)) {
    fields['Term 4 Fee'] = cents(row.paidAud) / 100
    fields['Term 4 Payment Status'] = cents(row.paidAud) > 0 ? 'Paid' : 'Unpaid'
    before.feeAud = row.feeAud
  }
  if ('perSessionAud' in f) {
    const v = f.perSessionAud === null || f.perSessionAud === '' ? 0 : Number(f.perSessionAud)
    if (!Number.isFinite(v) || v < 0 || v > 2000) return fail(res, 400, 'Enter the price per session in dollars, for example 50.')
    fields['Term 4 Notes'] = withPerSession(row.notes, Math.round(v * 100))
    before.perSessionCents = row.perSessionCents
  }
  // The player is their own contact (no parent): a tag on the row's notes.
  if ('ownContact' in f && Boolean(f.ownContact) !== row.ownContact) {
    fields['Term 4 Notes'] = withOwnContact(fields['Term 4 Notes'] ?? row.notes, f.ownContact === true)
    before.ownContact = row.ownContact
  }
  if (!Object.keys(fields).length) return fail(res, 400, 'Nothing to change.')
  await updateTerm4Rows([{ id: row.id, fields }])
  await audit({ by: principal.email, action: 'player.edit', target: row.id, before, after: fields })
  // A new fee (Lee, 16 Oct 2026): every open link for this place asks for
  // what it owes now, at once (_jfp-fee-sync.js). Switching to session by
  // session leaves nothing owing, so that link is cancelled; the place stays.
  // Charges, invoices and quick links keep their own amounts.
  const synced = await syncRowLinks([row.id], { by: principal.email, why: 'fee changed in Edit player' })
  return res.status(200).json({ success: true, closedLinks: synced.cancelled, repricedLinks: synced.repriced.map((x) => ({ ...x, amountLabel: formatAud(x.amountCents) })), openLinks: synced.open.map((q) => ({ id: q.id, amountCents: q.amountCents, players: q.playerNames })) })
}

// Player information for one player (Players tab Edit): the saved profile,
// else what their waiver told us, plus the Term 4 row's contact fields.
async function getPlayerProfile(res, config, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  const roster = await loadRoster()
  const key = profileKey(row.player, row.email)
  const prof = await findProfile({ key, rowIds: [row.id] })
  const waiver = prof ? null : waiverFor(row.player, { emails: rowEmails(row), phones: [row.phone], dob: row.dob }, roster.waivers)
  const prefill = waiver ? await waiverPrefill(waiver.id) : {}
  return res.status(200).json({ success: true, row: { rowId: row.id, name: row.player, parent: row.parent, email: row.email, phone: row.phone, ownContact: row.ownContact, paymentType: row.paymentType || '', feeAud: row.feeAud, paidAud: row.paidAud, perSessionCents: row.perSessionCents || null, paymentTypes: PAYMENT_TYPES }, profile: profileView(prof), prefill: { ...prefill, dob: prefill.dob || isoDate(row.dob) || '' }, options: { levels: LEVELS, playingUp: PLAYING_UP, positions: POSITIONS, feet: FEET, years: YEARS, clubs: clubSuggestions(roster.waivers) } })
}
async function savePlayerProfile(res, principal, config, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  const { values, errors } = cleanProfile(body.values || {})
  if (errors.length) return fail(res, 400, errors.join(' '))
  const key = profileKey(row.player, row.email)
  const existing = await findProfile({ key, rowIds: [row.id] })
  const saved = await saveProfile({ existing, name: row.player, key, emails: rowEmails(row), rowIds: [row.id], values, by: principal.email, from: 'Staff portal' })
  return res.status(200).json({ success: true, profile: profileView(saved) })
}

// Why players leave: Lee keeps count, because players move in and out.
export const LEAVE_REASONS = ['Added by mistake or twice', 'Cost', 'Time or schedule clash', 'Club or school commitments', 'Injury', 'Not the right group or level', 'Trial was not the right fit', 'Moved away', 'Taking a break', 'Joined another program', 'Moved to 1 to 1', 'No reply from the family', 'Other']

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
  const shared = open.find((q) => q.term4Ids.length > 1)
  if (shared) return fail(res, 409, `${row.player} shares a payment link with ${shared.playerNames.filter((n) => n !== row.player).join(' and ')}. Cancel that link in Payment links first, then remove, and send the others a new one.`, { code: 'shared_link' })
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
  await updateDroppedRow(d.id, { 'Restored': true, 'Reason details': `${d['Reason details'] ? `${d['Reason details']}\n` : ''}Restored ${sydneyToday()} by ${principal.name} as ${rowId}.` })
  await audit({ by: principal.email, action: 'player.restore', target: rowId, after: { name: fields['Player Name'], from: d.id } })
  return res.status(200).json({ success: true, rowId })
}

// One payment, from any source, onto one or more Term 4 rows (siblings): the
// rows' paid amount and status, a note, and one ledger row with the method.
// Cash and bank transfers are the families who do not pay by link (Lee).
const METHODS = { cash: 'Cash', 'bank transfer': 'Bank Transfer', bank: 'Bank Transfer', stripe: 'Stripe', other: 'Other', offline: 'Other' }
async function recordPaymentCore(principal, config, body) {
  const fail = (_res, status, error) => ({ ok: false, status, error })
  const res = null
  const ids = [...new Set((Array.isArray(body.rowIds) ? body.rowIds : [body.rowId]).map((x) => clean(x, 30)).filter(Boolean))].slice(0, 6)
  if (!ids.length) return fail(res, 400, 'Choose a player.')
  const rows = []
  for (const id of ids) { const r = await getTerm4Row(id); if (r) rows.push(r) }
  if (!rows.length) return fail(res, 404, 'Player row not found.')
  // A bank line from Xero or the bank CSV: its own id is the ledger Payment ID.
  const externalId = body.externalId == null || body.externalId === '' ? '' : String(body.externalId)
  if (externalId && (!EXTERNAL_ID.test(externalId) || body.stripeSessionId)) return fail(res, 400, 'That bank line is not valid.')
  const method = externalId ? 'Bank Transfer' : METHODS[String(body.method || '').trim().toLowerCase()] || 'Other'
  const matched = externalId ? ` Bank transfer matched from ${externalId.startsWith('XERO-') ? 'Xero' : 'CSV'}.` : ''
  let date = ISO.test(body.date || '') ? body.date : sydneyToday()
  if (date > sydneyToday()) return fail(res, 400, 'The payment date cannot be in the future.')
  let amount = Number(body.amountCents)
  let stripePay = null
  if (body.stripeSessionId) {
    const sid = clean(body.stripeSessionId, 120)
    stripePay = (await jfpStripePayments({ since: config.moneySince, fresh: true, term: config.term })).payments.find((p) => p.id === sid)
    if (!stripePay) return fail(res, 404, 'That Stripe payment was not found.')
    // Matched to a player as an extra session: it is not term income.
    if ((await listMatches().catch(() => ({})))[stripePay.id]?.as === 'extra') return fail(res, 409, 'That Stripe payment is matched as an extra session, so it is not a term fee.')
    const ledger = await listLedger(config.term)
    if (ledger.some((l) => [l['Payment ID'], l['Stripe Checkout Session ID'], l['Stripe Payment Intent ID']].includes(stripePay.id) || (stripePay.intentId && [l['Payment ID'], l['Stripe Payment Intent ID']].includes(stripePay.intentId)))) return fail(res, 409, 'That Stripe payment is already in the ledger.')
    if (!(amount > 0)) amount = stripePay.amountCents - stripePay.refundedCents
    // The day the family paid, not the day it was recorded.
    if (!ISO.test(body.date || '')) date = sydneyToday(Date.parse(stripePay.at))
  }
  if (!(Number.isInteger(amount) && amount > 0 && amount <= 2000000)) return fail(res, 400, 'Enter the amount received.')
  // A bank line: never twice (the ledger, and the claim kept for good even
  // if the ledger write failed), and not its other copy (Xero / CSV) either,
  // unless Lee says it is a different transfer.
  let bankLine = null
  if (externalId) {
    const ledger = await listLedger(config.term)
    if (ledger.some((l) => String(l['Payment ID'] || '').replace(/#\d+$/, '') === externalId)) return fail(res, 409, 'That bank transfer is already in the ledger.')
    if (await kvCommand(['GET', bankClaim(externalId)])) return fail(res, 409, 'That bank transfer is already recorded.')
    const src = await bankSources()
    const seen = [...src.xero, ...src.csv].find((x) => x.id === externalId)
    bankLine = { id: externalId, source: externalId.startsWith('XERO-') ? 'xero' : 'csv', cents: seen?.cents || amount, date: seen?.date || date, payer: seen?.payer || '', ...(body.confirmTwin === true ? { distinct: true } : {}), at: new Date().toISOString() }
    const twin = body.confirmTwin === true ? null : twinOf(bankLine, await bankRecorded())
    if (twin) return { ok: false, status: 409, code: 'twin', error: `This looks like the same transfer as the ${formatAud(twin.cents)} from ${twin.payer || 'the bank'} on ${twin.date}, already recorded from ${twin.source === 'xero' ? 'Xero' : 'the bank CSV'}. Only record it if it is a different payment.` }
  }
  // The same payment cannot be recorded twice by a double click or by two staff
  // pressing Save together. A Stripe payment is guarded by its own id above.
  // Taken only once the payment has passed every check, so a refused try never blocks the right one.
  const lockOnce = async () => {
    if (stripePay) return true
    const lock = `jfp:paylock:${rows.map((r) => r.id).sort().join(',')}:${amount}:${method}`
    return (await kvCommand(['SET', lock, '1', 'NX', 'EX', '20'])) === 'OK'
  }
  // Already marked paid in Airtable but never put in the ledger (Lee, 12 Oct
  // 2026: Nicholas Casella, A$800 cash): record HOW it was paid, without
  // adding the amount to the row a second time.
  if (body.existing === true) {
    if (rows.length !== 1) return fail(res, 400, 'One player at a time.')
    const r = rows[0]
    const ledger = await listLedger(config.term)
    const inLedger = ledger.filter((l) => String(l['Source Record ID'] || '').split(',').map((x) => x.trim()).includes(r.id)).reduce((t, l) => t + Math.round(Number(l['Amount Paid'] || 0) * 100), 0)
    const room = cents(r.paidAud) - inLedger
    if (amount > room) return fail(res, 400, room > 0 ? `Only ${formatAud(room)} of what ${r.player} has paid is not in the ledger yet.` : `Everything ${r.player} has paid is already in the ledger.`)
    if (!(await lockOnce())) return fail(res, 409, 'That payment was just recorded. Refresh to check before entering it again.')
    await updateTerm4Rows([{ id: r.id, fields: {
      ...(method === 'Stripe' ? {} : { 'Term 4 Fee Reconciliation': 'Non-Stripe — verified' }),
      'Term 4 Notes': appendNote(r.notes, `Payment method recorded: ${formatAud(amount)} of the amount already marked paid was ${method}${stripePay ? ` (Stripe ${stripePay.id})` : ''} on ${date}, by ${principal.name}.${body.note ? ` ${clean(body.note, 200)}` : ''}`),
    } }])
    const paymentId = stripePay ? (stripePay.intentId || stripePay.id) : `${method === 'Cash' ? 'CASH' : method === 'Bank Transfer' ? 'BANK' : 'OFF'}-${newId('T4').slice(3)}`
    let ledgerId = ''
    try { ledgerId = await createLedgerRow({ paymentId, config, playerNames: [r.player], amountCents: amount, paidAt: `${date}T00:00:00+10:00`, sourceIds: [r.id], sessionId: stripePay?.id || '', intentId: stripePay?.intentId || '', method, notes: `Recorded in the JFP portal by ${principal.name}: already marked paid in Airtable, method now recorded.${body.note ? ` ${clean(body.note, 200)}` : ''}` }) } catch (error) { console.error('jfp ledger row failed', error) }
    await bustRosterCache()
    await audit({ by: principal.email, action: 'payment.method', target: r.id, after: { name: r.player, cents: amount, method, date, stripe: stripePay?.id || '', ledger: Boolean(ledgerId) } })
    return { ok: true, ledger: Boolean(ledgerId) }
  }
  // More than the rows still owe is almost always a typo (850 for 85). Rows with no fee set are not checked.
  if (!stripePay && !body.allowOver && rows.every((r) => cents(r.feeAud) > 0)) {
    const owingAll = rows.reduce((t, r) => t + Math.max(0, cents(r.feeAud) - cents(r.paidAud)), 0)
    if (amount > owingAll) return fail(res, 400, `That is more than the ${formatAud(owingAll)} still owing. Enter the amount received, or change the fee first.`)
  }
  if (!(await lockOnce())) return fail(res, 409, 'That payment was just recorded. Refresh to check before entering it again.')
  // Two staff recording the same bank line for different players at once.
  if (externalId && (await kvCommand(['SET', `jfp:paylock:${externalId}`, '1', 'NX', 'EX', '20'])) !== 'OK') return fail(res, 409, 'That bank transfer was just recorded. Refresh to check.')
  // Claimed for good before any row changes; given back only if the rows could not be written.
  if (bankLine && (await kvCommand(['SET', bankClaim(externalId), JSON.stringify(bankLine), 'NX'])) !== 'OK') return fail(res, 409, 'That bank transfer is already recorded.')
  // Fill each row up to what it owes, in order; anything over goes on the last row.
  let left = amount
  const updates = rows.map((r, i) => {
    const owe = Math.max(0, cents(r.feeAud) - cents(r.paidAud))
    const share = i === rows.length - 1 ? left : Math.min(left, owe || Math.floor(amount / rows.length))
    left -= share
    const paid = cents(r.paidAud) + share
    const fee = cents(r.feeAud) || paid
    return { r, share, fields: {
      ...(cents(r.feeAud) ? {} : { 'Term 4 Fee': fee / 100 }),
      'Term 4 Amount Paid': paid / 100,
      'Term 4 Payment Status': paid >= fee ? 'Paid' : 'Partially Paid',
      ...(method === 'Stripe' ? {} : { 'Term 4 Fee Reconciliation': 'Non-Stripe — verified' }),
      'Term 4 Notes': appendNote(r.notes, `Payment recorded: ${formatAud(share)} by ${method} on ${date}${stripePay ? ` (Stripe ${stripePay.id})` : ''}, by ${principal.name}.${matched}${body.note ? ` ${clean(body.note, 200)}` : ''}`),
    } }
  })
  try {
    await updateTerm4Rows(updates.map((u) => ({ id: u.r.id, fields: u.fields })))
  } catch (error) {
    if (bankLine) await kvCommand(['DEL', bankClaim(externalId)]).catch(() => {})
    throw error
  }
  // The list the matcher reads; the claim above is what guards.
  if (bankLine) await kvCommand(['HSET', BANK.recorded, externalId, JSON.stringify({ ...bankLine, rowIds: rows.map((r) => r.id) })]).catch((error) => console.error('jfp bank recorded list failed', error))
  const paymentId = externalId || (stripePay ? (stripePay.intentId || stripePay.id) : `${method === 'Cash' ? 'CASH' : method === 'Bank Transfer' ? 'BANK' : 'OFF'}-${newId('T4').slice(3)}`)
  let ledgerId = ''
  try {
    // One ledger line per player, each with their part (Lee, 12 Oct 2026).
    const parts = updates.filter((u) => u.share > 0)
    for (const [i, u] of parts.entries()) {
      const id = await createLedgerRow({ paymentId: i ? `${paymentId}#${i + 1}` : paymentId, config, playerNames: [u.r.player], amountCents: u.share, paidAt: `${date}T00:00:00+10:00`, sourceIds: [u.r.id], sessionId: stripePay?.id || '', intentId: stripePay?.intentId || '', method, notes: `Recorded in the JFP portal by ${principal.name}${parts.length > 1 ? `: ${u.r.player}'s part, ${i + 1} of ${parts.length}, of ${formatAud(amount)} for ${parts.map((x) => x.r.player).join(', ')}` : ''}.${matched}${body.note ? ` ${clean(body.note, 200)}` : ''}` })
      ledgerId = ledgerId || id
    }
  } catch (error) { console.error('jfp ledger row failed', error) }
  await bustRosterCache()
  await audit({ by: principal.email, action: 'payment.record', target: rows.map((r) => r.id).join(','), after: { name: rows.map((r) => r.player).join(', '), cents: amount, method, date, stripe: stripePay?.id || '', ...(externalId ? { bank: externalId } : {}), ledger: Boolean(ledgerId) } })
  return { ok: true, ledger: Boolean(ledgerId) }
}
async function recordPayment(res, principal, config, body) {
  const r = await recordPaymentCore(principal, config, body)
  return r.ok ? res.status(200).json({ success: true, ledger: r.ledger }) : fail(res, r.status, r.error, r.code ? { code: r.code } : undefined)
}

// Every family whose Stripe payments Airtable does not show yet: record
// each unrecorded payment against their rows, never more than the gap.
// Runs on its own (Stripe webhook straight away, hourly cron as a backstop,
// Lee 11 Oct: Stripe, Airtable and the portal must never disagree) and from
// the Money tab button. Only exact email matches are recorded; anything else
// is left for staff and, with alert on, flagged once on Telegram.
const AUTO = { email: 'auto: Stripe sync', name: 'Auto Stripe sync' }
export async function reconcileStripe(config, principal = AUTO, { alert = false } = {}) {
  if ((await kvCommand(['SET', 'jfp:stripe-reconcile-lock', '1', 'NX', 'EX', '120'])) !== 'OK') return { busy: true, recorded: 0, failed: [] }
  try {
    const m = await moneyData(config, { fresh: true })
    const ledger = await listLedger(config.term)
    const known = new Set(ledger.flatMap((l) => [l['Payment ID'], l['Stripe Checkout Session ID'], l['Stripe Payment Intent ID']].filter(Boolean)))
    const matches = await listMatches().catch(() => ({}))
    const all = (await jfpStripePayments({ since: config.moneySince, term: config.term })).payments.filter((p) => matches[p.id]?.as !== 'extra')
    const pays = all.filter((p) => !p.jfpRef && !known.has(p.id) && !(p.intentId && known.has(p.intentId)))
    const byEmail = new Map()
    for (const p of m.players.filter((x) => x.status === 'stripe' && x.email)) byEmail.set(p.email, [...(byEmail.get(p.email) || []), p])
    let recorded = 0
    const failed = [], done = [], skipped = []
    for (const [email, rows] of byEmail) {
      const fam = m.players.filter((x) => x.email === email)
      let gap = Math.max(0, rows[0].stripeCents - fam.reduce((t, x) => t + x.paidCents, 0))
      for (const p of pays.filter((x) => x.email === email).sort((a, b) => a.at.localeCompare(b.at))) {
        const net = p.amountCents - p.refundedCents
        if (net <= 0) continue
        if (net > gap) { skipped.push({ p, who: rows.map((x) => x.player).join(', ') }); continue }
        const r = await recordPaymentCore(principal, config, { rowIds: rows.map((x) => x.rowId), method: 'Stripe', stripeSessionId: p.id })
        if (r.ok) { recorded += 1; gap -= net; done.push(`${rows.map((x) => x.player).join(', ')}: ${formatAud(net)}`) } else failed.push(`${rows[0].player}: ${r.error}`)
      }
    }
    // Match to player, remembered (14 Oct 2026): a payment through a payment
    // link, or from an email, staff matched before goes to the same player.
    const rules = await listRules().catch(() => ({}))
    const autoMatched = new Set()
    for (const u of m.unmatched) {
      const rule = matches[u.id] ? null : ruleFor(rules, u)
      const p = rule ? all.find((x) => x.id === u.id) : null
      if (!p) continue
      const rows = []
      for (const id of rule.rowIds || []) { const r = await getTerm4Row(id); if (r) rows.push(r) }
      if (!rows.length) { failed.push(`${(rule.players || []).join(', ')}: the remembered player is not on Term 4 any more`); continue }
      const r = await applyStripeMatch({ config, principal, payment: p, rows, as: rule.as || 'jfp', label: rule.label || '', rule: rule.key, recordPaymentCore })
      if (r.ok) { autoMatched.add(u.id); recorded += 1; done.push(`${rows.map((x) => x.player).join(', ')}: ${formatAud(u.cents)} (matched by the remembered ${rule.key.startsWith('link:') ? 'payment link' : 'email'}${rule.as === 'extra' ? ', extra session' : ''})`) } else failed.push(`${rows[0].player}: ${r.error}`)
    }
    if (alert) {
      // New payments only (last 3 days), each flagged once.
      const fresh = (p) => Date.now() - Date.parse(p.at) < 3 * 86400000
      const once = async (id) => (await kvCommand(['SET', `jfp:stripe-flagged:${id}`, '1', 'NX', 'EX', String(60 * 86400)])) === 'OK'
      const lines = []
      if (done.length) lines.push(`Recorded in Airtable automatically:\n${done.join('\n')}`)
      for (const u of m.unmatched.filter(fresh)) if (!autoMatched.has(u.id) && !matches[u.id] && await once(u.id)) lines.push(`Paid but not matched to a player (different email?): ${u.name || 'no name'}, ${formatAud(u.cents)}. Match it in the portal: Money tab.`)
      for (const x of skipped.filter((y) => fresh(y.p))) if (await once(x.p.id)) lines.push(`Paid more than Airtable says they owe, not recorded: ${x.who}, ${formatAud(x.p.amountCents - x.p.refundedCents)}. Check the fee in Money.`)
      for (const f of failed) lines.push(`Could not record: ${f}`)
      if (lines.length) await telegramAlert(`JFP Stripe sync\n${lines.join('\n')}`)
    }
    return { recorded, failed, done }
  } finally {
    await kvCommand(['DEL', 'jfp:stripe-reconcile-lock'])
  }
}
async function recordStripeAll(res, principal, config) {
  const r = await reconcileStripe(config, principal)
  if (r.busy) return fail(res, 409, 'The automatic Stripe sync is running right now. Try again in a minute.')
  return res.status(200).json({ success: true, recorded: r.recorded, failed: r.failed })
}
async function markPaid(res, principal, body) {
  return recordPayment(res, principal, await getConfig(), { rowIds: [body.rowId], amountCents: body.amountCents, method: body.method, note: body.note, date: body.date })
}

// ---------- money: live from Stripe and Airtable ----------

// A row with no venue written on it is shown as exactly that.
const venueNamed = (loc) => (loc.id === 'other' ? { ...loc, name: 'No venue set' } : loc)
// The venue a holiday slot's location is ("Joner Football HQ, Belrose" is Belrose HQ).
export const holidayVenue = (config) => (name) => { const l = venueNamed(locationFor(config, name || '')); return { id: l.id, name: l.name } }

const weekOf = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

// paint: a first paint on Money (13 Oct 2026): copies up to 15 minutes old
// that no write has overtaken, then the page reads again behind it.
export async function moneyData(config, { since, fresh = false, quick = false, paint = false } = {}) {
  // quick (first paint): the last Stripe read and the 60 second roster cache.
  const first = paint && quick && !fresh
  const [rosterAll, groups, ledgerAll, juniors, history, payreqs, matches, rules] = await Promise.all([loadRoster({ fresh: !quick, ...(first ? { maxAgeMs: PAINT_MAX_AGE_MS } : {}) }), listGroups(), listLedger(config.term, { quick, paint: first }).catch(() => []), listJuniors().catch(() => []), listVenueHistory().catch(() => []), listPayreqs().catch(() => []), listMatches().catch(() => ({})), listRules().catch(() => ({}))])
  // Pro sessions are their own money (Money > Pro sessions): their rows and
  // the cash or bank transfers recorded on them are not JFP term income, and
  // Pro Stripe payments come back apart (stripe.pro).
  const proIds = new Set(rosterAll.players.filter((r) => isProRow(r.paymentType)).map((r) => r.id))
  const roster = proIds.size ? { ...rosterAll, players: rosterAll.players.filter((r) => !proIds.has(r.id)) } : rosterAll
  const ledger = proIds.size ? ledgerAll.filter((l) => !isProLedger(l, proIds)) : ledgerAll
  // What each row's paid amount has in the ledger, so a row marked paid by
  // hand can have its cash, bank or Stripe payment recorded.
  const ledgerByRow = new Map()
  for (const l of ledger) for (const id of String(l['Source Record ID'] || '').split(',').map((x) => x.trim()).filter(Boolean)) ledgerByRow.set(id, (ledgerByRow.get(id) || 0) + Math.round(Number(l['Amount Paid'] || 0) * 100))
  const openLinkFor = new Map()
  // Each open link at what it asks for now: a fee changed since it was made
  // moves it (_jfp-fee-sync.js), and staff see that it moved.
  const live = await syncLinks(payreqs.filter((q) => ['open', 'checkout'].includes(q.status)), { rowsById: new Map(rosterAll.players.map((r) => [r.id, r])), all: payreqs, by: 'system: fee sync (Money)' })
  for (const q of live) if (['open', 'checkout'].includes(q.status)) for (const id of q.term4Ids || []) openLinkFor.set(id, { id: q.id, amountCents: q.amountCents, players: q.playerNames, family: q.reason === 'family', createdAt: q.createdAt, ...(repricedNote(q) ? { note: repricedNote(q) } : {}) })
  let stripe = { payments: [], next: [], other: { count: 0, cents: 0 }, since: since || config.moneySince, error: '' }
  try { stripe = { ...(await jfpStripePayments({ since: since || config.moneySince, fresh, quick: quick && !fresh, term: config.term })), error: '' } } catch (error) { console.error('jfp stripe read failed', error); stripe.error = 'Stripe could not be read just now. Airtable figures only.' }
  // The Sydney day each payment was made (before 11 am in summer is still
  // yesterday in UTC), as cash and bank transfers are dated.
  // Matched to a player as an extra session (Match to player): Extra sessions money, not JFP.
  const extraIds = new Set(Object.values(matches).filter((x) => x.as === 'extra').map((x) => x.id))
  if (extraIds.size) stripe = { ...stripe, payments: stripe.payments.filter((p) => !extraIds.has(p.id)), next: (stripe.next || []).filter((p) => !extraIds.has(p.id)) }
  for (const p of [...stripe.payments, ...(stripe.next || [])]) p.day = sydneyToday(Date.parse(p.at))
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
  const holding = roster.players.filter((r) => r.holdsPlace && !isTestName(r.player))
  const net = (p) => p.amountCents - p.refundedCents
  // A JFP quick link paid with no player named (Lee, 13 Oct 2026): it waits
  // on the not matched list for Lee to match, and is never put on a family
  // just because the email that paid is on a row.
  const unplacedIds = new Set(payreqs.filter((q) => q.quick && !(q.term4Ids || []).length).map((q) => q.id))
  const unplaced = (p) => Boolean(p.jfpRef) && unplacedIds.has(p.jfpRef)
  const stripeByEmail = new Map()
  for (const p of stripe.payments) if (p.email && !unplaced(p)) stripeByEmail.set(p.email, [...(stripeByEmail.get(p.email) || []), p])
  const familyEmails = new Set(holding.flatMap(rowEmails))
  // Each family: what Stripe received against what Airtable records as paid.
  const families = new Map()
  for (const r of holding) {
    const k = r.email || `row:${r.id}`
    if (!families.has(k)) families.set(k, [])
    families.get(k).push(r)
  }
  const players = []
  for (const [email, rows] of families) {
    // Payments from either parent's address count for the family.
    const pays = [...new Map([email, ...rows.flatMap(rowEmails)].flatMap((e) => stripeByEmail.get(e) || []).map((p) => [p.id, p])).values()]
    const stripeCents = pays.reduce((t, p) => t + net(p), 0)
    const recorded = rows.reduce((t, r) => t + cents(r.paidAud), 0)
    let unrecorded = Math.max(0, stripeCents - recorded)
    for (const r of rows.slice().sort((a, b) => (cents(b.feeAud) - cents(b.paidAud)) - (cents(a.feeAud) - cents(a.paidAud)))) {
      const fee = cents(r.feeAud), paid = cents(r.paidAud), owe = Math.max(0, fee - paid)
      const markedPaid = /^paid$/i.test(r.paymentStatus || '')
      let status, applied = 0
      if (isSessionType(r.paymentType)) status = 'session'
      else if (fee > 0 && paid >= fee) status = 'paid'
      // Marked Paid by hand with no amount, and the family's Stripe payment is
      // not on the row yet (Ligia's links, Sept 2026): record it, so the
      // amount shows, the ledger has it and the venues add up.
      else if (unrecorded > 0 && (owe > 0 || !fee)) { status = 'stripe'; applied = Math.min(unrecorded, owe || unrecorded); unrecorded -= applied }
      else if (markedPaid) status = 'paid'
      else if (paid > 0) status = 'part'
      else if (fee > 0) status = 'unpaid'
      else status = 'unpriced'
      const g = byId[r.groupId]
      const loc = g ? locationFor(config, g.location) : locationFor(config, r.location || '')
      players.push({
        rowId: r.id, player: r.player, parent: r.parent, email: r.email, phone: r.phone || '', ownContact: r.ownContact === true, familyKey: email, openLink: openLinkFor.get(r.id) || null, unledgeredCents: Math.max(0, paid - (ledgerByRow.get(r.id) || 0)), product: productOfRow(r, g),
        group: g ? `${g.day} ${g.time}, ${loc.name}` : [r.day, r.time, r.location].filter(Boolean).join(' ') || 'Not in a group',
        groupId: r.groupId, locationId: loc.id, locationName: loc.name, coach: g ? coachLabel(coachById(config, g.coachId)) : r.coach,
        feeCents: fee, paidCents: paid, owingCents: status === 'paid' || status === 'stripe' ? 0 : owe, perSessionCents: r.perSessionCents || null,
        // Sessions prepaid from My account, still to come off the next billing.
        ...(r.prepaidSessions ? { prepaidSessions: r.prepaidSessions } : {}),
        airtableStatus: r.paymentStatus || 'Not set', type: r.paymentType || '', status,
        // 'stripe': the Stripe money not on the row yet that counts for it,
        // and what is still owing after it (owingCents shows 0 until recorded).
        stripeAppliedCents: applied, stillOwingCents: status === 'stripe' ? Math.max(0, owe - applied) : (status === 'paid' ? 0 : owe),
        stripeCents, stripeCount: pays.length, hasNotes: Boolean((r.notes || '').trim() || (r.linkNotes || '').trim()),
      })
    }
  }
  players.sort((a, b) => a.player.localeCompare(b.player))
  // Paid from an email not on any row, and not already put on a row in the ledger.
  const inLedger = new Set(ledger.flatMap((l) => [l['Payment ID'], l['Stripe Checkout Session ID'], l['Stripe Payment Intent ID']].filter(Boolean)))
  const unmatched = stripe.payments.filter((p) => (unplaced(p) || !p.email || !familyEmails.has(p.email)) && !inLedger.has(p.id) && !(p.intentId && inLedger.has(p.intentId)) && p.amountCents - p.refundedCents > 0)
  // Cash, bank transfer and other: the ledger, plus rows marked paid offline before the ledger had them.
  const offlineLedger = ledger.filter((l) => l['Payment Method'] && l['Payment Method'] !== 'Stripe')
  const ledgerRowIds = new Set(offlineLedger.flatMap((l) => String(l['Source Record ID'] || '').split(',').map((x) => x.trim())))
  const legacyOffline = holding.filter((r) => r.reconciliation === 'Non-Stripe — verified' && !ledgerRowIds.has(r.id))
  const offline = [
    ...offlineLedger.map((l) => ({ date: String(l['Payment Date'] || '').slice(0, 10), method: l['Payment Method'], cents: Math.round(Number(l['Amount Paid'] || 0) * 100), who: l['Player Name'] || '' })),
    ...legacyOffline.map((r) => ({ date: '', method: 'Other', cents: cents(r.paidAud), who: r.player })),
  ]
  const stripeGross = stripe.payments.reduce((t, p) => t + p.amountCents, 0)
  const stripeRefunds = stripe.payments.reduce((t, p) => t + p.refundedCents, 0)
  const offlineCents = offline.reduce((t, o) => t + o.cents, 0)
  // What Stripe kept. Bank transfer, cash and other cost nothing.
  const fees = feeTotals(stripe.payments)
  const feeOf = (p) => (p.feeKnown ? p.feeCents || 0 : 0)
  // Next term paid early: shown apart, never in this term's income.
  const nextTerm = stripe.next || []
  // Income by week: Stripe (live) and recorded cash / bank transfer, with Stripe's fee.
  const weeks = new Map()
  const start = weekOf(stripe.since || config.moneySince)
  const blankWeek = (week) => ({ week, stripe: 0, bank: 0, cash: 0, fee: 0 })
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= sydneyToday(); d.setUTCDate(d.getUTCDate() + 7)) weeks.set(d.toISOString().slice(0, 10), blankWeek(d.toISOString().slice(0, 10)))
  for (const p of stripe.payments) { const w = weeks.get(weekOf(p.day)); if (w) { w.stripe += net(p); w.fee += feeOf(p) } }
  for (const o of offline) { if (!o.date) continue; const w = weeks.get(weekOf(o.date)); if (w) w[o.method === 'Cash' ? 'cash' : 'bank'] += o.cents }
  const count = (s) => players.filter((p) => p.status === s).length
  // Revenue by venue: the same money as "Income this term", on the rows it
  // paid for, so the venues add up to the income total (Lee, 6 Oct 2026).
  const venueOf = (r) => { const g = byId[r.groupId]; return venueNamed(g ? locationFor(config, g.location) : locationFor(config, r.location || '')) }
  const groupOf = (r) => {
    const g = byId[r.groupId]
    return g ? { key: g.id, label: `${g.day} ${g.time}`, coach: coachLabel(coachById(config, g.coachId)) } : { key: `none:${r.day}|${r.time}`, label: [r.day, r.time].filter(Boolean).join(' ') || 'Not in a group', coach: r.coach || '' }
  }
  const alloc = allocateTermMoney({ rows: roster.players.filter((r) => !isTestName(r.player)), stripe: stripe.payments.map((p) => (unplaced(p) ? { ...p, email: '' } : p)), ledger, legacy: legacyOffline })
  for (const p of players) {
    const m = alloc.byRow.get(p.rowId)
    p.receivedCents = totalOf(m)
    p.stripeFeeCents = m?.fee || 0
    p.netReceivedCents = p.receivedCents - p.stripeFeeCents
    // Stripe payments on this row whose fee is not known yet.
    p.stripeFeePending = m?.feePending || 0
  }
  // Marked paid in Airtable, but less money on the row this term than Airtable
  // says (paid last term, typed in, or never came in). For Lee to check.
  const paidNoMoney = players.flatMap((p) => {
    const says = p.paidCents > 0 ? p.paidCents : /^paid$/i.test(p.airtableStatus) && p.feeCents > 0 ? p.feeCents : 0
    if (says <= p.receivedCents) return []
    return [{ rowId: p.rowId, player: p.player, locationId: p.locationId, group: p.group, status: p.status, feeCents: p.feeCents, airtableSaysCents: says, foundCents: p.receivedCents, missingCents: says - p.receivedCents }]
  }).sort((a, b) => b.missingCents - a.missingCents || a.player.localeCompare(b.player))
  const jj = juniorsByVenue(juniors, config.term, (r) => locationFor(config, r.location || ''))
  const locations = venuesForTerm({ locations: config.locations, rows: roster.players, players, alloc, venueOf, groupOf })
  for (const j of jj) if (!locations.some((l) => l.id === j.id)) locations.push(emptyVenue(j))
  for (const l of locations) l.juniors = jj.find((j) => j.id === l.id) || null
  // Venue costs this term. A venue with costs and no players yet still shows.
  const costs = costsOfTerm(config.venueCosts, config.term)
  for (const loc of config.locations) if (costs[loc.id] && !locations.some((l) => l.id === loc.id)) locations.push({ ...emptyVenue(loc), juniors: null })
  // Only a real venue can have costs ("No venue set" cannot).
  for (const l of locations) Object.assign(l, withCosts(l, costs[l.id]), { canCost: config.locations.some((c) => c.id === l.id) })
  // Each venue's income by week, so its chart follows the venue picked.
  const venueOfRow = new Map(roster.players.map((r) => [r.id, venueOf(r).id]))
  const weeklyByVenue = Object.fromEntries(locations.map((l) => [l.id, new Map([...weeks.keys()].map((k) => [k, blankWeek(k)]))]))
  for (const e of alloc.entries) {
    const w = weeklyByVenue[venueOfRow.get(e.rowId)]?.get(weekOf(e.at))
    if (!w) continue
    // Same columns as the weekly total: anything not Stripe or cash sits with bank transfer.
    w[e.kind === 'stripe' ? 'stripe' : e.kind === 'cash' ? 'cash' : 'bank'] += e.cents
    w.fee += e.fee
  }
  // One line per payment per venue it paid for (or not linked), for the
  // accountant's download: taken, refunded, Stripe's fee and the GST in it.
  const payById = new Map(stripe.payments.map((p) => [p.id, p]))
  const lines = new Map()
  for (const x of alloc.parts) {
    const venueId = (x.rowId && venueOfRow.get(x.rowId)) || ''
    const key = `${x.kind}|${x.id}|${venueId}`
    const l = lines.get(key) || { id: x.id, at: x.at, kind: x.kind, venueId, who: new Set(), cents: 0, fee: 0, refunded: 0, gst: 0 }
    if (x.who) l.who.add(x.who)
    for (const k of ['cents', 'fee', 'refunded', 'gst']) l[k] += x[k] || 0
    lines.set(key, l)
  }
  const METHOD_LABEL = { stripe: 'Stripe', bank: 'Bank transfer', cash: 'Cash', other: 'Other' }
  const payments = [...lines.values()].map((l) => {
    const p = l.kind === 'stripe' ? payById.get(l.id) : null
    const known = !p || p.feeKnown
    return { id: l.id, at: l.at, method: METHOD_LABEL[l.kind], payMethod: p?.payMethod || '', who: [...l.who].join(', '), venueId: l.venueId, takenCents: l.cents + l.refunded, refundedCents: l.refunded, feeCents: known ? l.fee : null, feeGstCents: known ? l.gst : null, keptCents: known ? l.cents - l.fee : null }
  }).sort((a, b) => (a.at || '9').localeCompare(b.at || '9') || a.id.localeCompare(b.id))
  // What the places should bring in this term, and how much of it is in.
  const expecting = players.filter((p) => !['session', 'unpriced'].includes(p.status))
  const expectedCents = expecting.reduce((t, p) => t + p.feeCents, 0)
  const collectedCents = expecting.reduce((t, p) => t + collectedOf(p), 0)
  const incomeCents = stripeGross - stripeRefunds + offlineCents
  const costed = costTotals(locations, incomeCents - fees.stripeFeesCents)
  const lastTerm = previousTerm(config.term)
  return {
    since: stripe.since, stripeError: stripe.error, stripeAt: stripe.at || '', term: config.term,
    // For the family invoice price buttons. Family rate: every place at the
    // two-a-week price per place once a family has two or more (Lee, 12 Oct).
    prices: { ...config.prices, familyPlace: Math.round(config.prices.twoAWeek / 2) },
    venueTerms: venueTerms({ current: config.term, previous: previousTerm(config.term), history }),
    kpis: {
      incomeCents, stripeCents: stripeGross - stripeRefunds, stripeGrossCents: stripeGross, refundsCents: stripeRefunds,
      offlineCents, cashCents: offline.filter((o) => o.method === 'Cash').reduce((t, o) => t + o.cents, 0), bankCents: offline.filter((o) => o.method === 'Bank Transfer').reduce((t, o) => t + o.cents, 0),
      otherCents: offline.filter((o) => o.method !== 'Cash' && o.method !== 'Bank Transfer').reduce((t, o) => t + o.cents, 0),
      owingCents: players.reduce((t, p) => t + p.owingCents, 0), stripeUnrecordedCents: players.filter((p) => p.status === 'stripe').length,
      players: players.length, stripePayments: stripe.payments.length,
      venuesCents: locations.reduce((t, l) => t + l.receivedCents, 0), unlinkedCents: totalOf(alloc.unlinked),
      // Income less Stripe's fees (the real fee on each payment, refunded ones included).
      stripeFeesCents: fees.stripeFeesCents, feeGstCents: fees.feeGstCents, feesPendingCount: fees.feesPendingCount, netIncomeCents: incomeCents - fees.stripeFeesCents,
      unlinkedFeeCents: alloc.unlinked.fee, feesByMethod: fees.feesByMethod,
      expectedCents, collectedCents, collectedPct: expectedCents ? Math.floor((collectedCents * 100) / expectedCents) : null,
      nextTermCents: nextTerm.reduce((t, p) => t + net(p), 0), nextTermCount: nextTerm.length, nextTermFeeCents: nextTerm.reduce((t, p) => t + feeOf(p), 0),
      // Kept after fees less every venue's costs.
      venueCostsCents: costed.venueCostsCents, profitCents: costed.profitCents, venuesWithCosts: costed.venuesWithCosts,
      paidNoMoneyCount: paidNoMoney.length, paidNoMoneyCents: paidNoMoney.reduce((t, x) => t + x.missingCents, 0),
    },
    paidNoMoney,
    // Last term's lines, for "Copy last term's costs".
    venueCostsLast: { term: lastTerm, byVenue: costsOfTerm(config.venueCosts, lastTerm) },
    unlinked: { cents: totalOf(alloc.unlinked), items: alloc.unlinked.items.slice(0, 40) },
    status: { paid: count('paid'), stripe: count('stripe'), part: count('part'), unpaid: count('unpaid'), unpriced: count('unpriced'), session: count('session') },
    weekly: [...weeks.values()],
    weeklyByVenue: Object.fromEntries(Object.entries(weeklyByVenue).map(([id, m]) => [id, [...m.values()]])),
    payments,
    nextTermPayments: nextTerm.slice(0, 60).map((p) => ({ id: p.id, at: p.at, name: p.name, email: p.email, cents: net(p), feeCents: p.feeKnown ? p.feeCents : null, product: p.product, forTerm: p.forTerm })),
    locations,
    players,
    unmatched: unmatched.map((p) => { const rule = ruleFor(rules, p); return { id: p.id, at: p.at, name: p.name, email: p.email, cents: net(p), product: p.product, linkId: p.linkId || '', ...(rule ? { remembered: { key: rule.key, players: rule.players, as: rule.as } } : {}), ...(unplaced(p) ? { quickLink: p.jfpRef } : {}) } }),
    otherStripe: stripe.other,
    // Stripe payments marked holiday training, Pro sessions or not JFP (18 Oct 2026), newest first, to put back.
    stripeMarked: (await listStripeClass()).sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id)).slice(0, 60).map((x) => ({ id: x.id, kind: x.kind, cents: x.cents, date: x.date, name: x.payer || x.email || '', product: x.product || '', ...(x.period ? { periodLabel: periodLabel(x.period) } : {}), ...(x.player ? { player: x.player } : {}) })),
  }
}

// ---------- bank transfers to check (Lee, 12 Oct 2026) ----------
// Money in from the bank, matched to the players who probably sent it. Lee
// confirms each with one tap (recordPayment with externalId). Read only when
// the panel is opened, never by the two minute refresh.
// recorded: every bank line recorded so far, kept for good (a hash of
// { id, source, cents, date, payer, distinct }); claim: one key per line, set
// before the rows are written, so no line is ever recorded twice.
const BANK = { xero: 'jfp:xero-bank-in', csv: 'jfp:bank-csv', ignored: 'jfp:bank-ignored', recorded: 'jfp:bank-recorded', refreshReq: 'jfp:bank-refresh-req', feedStatus: 'jfp:bank-feed-status' }
// "Check payments from the bank" (Lee, 15 Oct 2026): the button writes a
// request; the Mac polls for it every minute, runs the Xero feed and writes
// jfp:bank-feed-status { at (when the run started), ok, latestLineDate, count, error? }.
const isoAt = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '')
const cleanFeedStatus = (x) => (x && isoAt(x.at) ? { at: x.at, ok: x.ok === true, latestLineDate: ISO.test(x.latestLineDate || '') ? x.latestLineDate : '', count: Number.isInteger(x.count) ? x.count : 0, ...(x.ok === true ? {} : { error: String(x.error || 'The bank check did not finish.').slice(0, 120) }) } : null)
async function bankRefreshState() {
  const [req, status] = await Promise.all([kvGetJson(BANK.refreshReq).catch(() => null), kvGetJson(BANK.feedStatus).catch(() => null)])
  const request = req && isoAt(req.at) ? { at: req.at } : null
  const feed = cleanFeedStatus(status)
  // Done once the Mac has started a run at or after the request.
  return { request, status: feed, done: Boolean(request && feed && Date.parse(feed.at) >= Date.parse(request.at)) }
}
async function bankRefresh(res, principal) {
  const now = new Date().toISOString()
  // A second press while one is waiting reuses it (one run is enough).
  const cur = await bankRefreshState()
  if (cur.request && !cur.done && Date.now() - Date.parse(cur.request.at) < 3 * 60000) return res.status(200).json({ success: true, request: cur.request, status: cur.status, reused: true })
  await kvSetJson(BANK.refreshReq, { at: now, by: principal.email }, 86400)
  await audit({ by: principal.email, action: 'money.bankRefresh', target: 'xero' })
  return res.status(200).json({ success: true, request: { at: now }, status: cur.status })
}
const bankClaim = (id) => `jfp:bank-recorded:${id}`
async function bankSources() {
  const [xero, csv] = await Promise.all([kvGetJson(BANK.xero).catch(() => null), kvGetJson(BANK.csv).catch(() => null)])
  const list = (x, source) => (Array.isArray(x?.items) ? x.items.map((i) => cleanItem(i, source)).filter(Boolean) : [])
  const latest = (x) => (Array.isArray(x?.items) ? x.items.map((i) => String(i?.date || '')).filter((d) => ISO.test(d)).sort().at(-1) || '' : '')
  return { xero: list(xero, 'xero'), csv: list(csv, 'csv'), xeroAt: typeof xero?.at === 'string' ? xero.at : '', csvAt: typeof csv?.at === 'string' ? csv.at : '', xeroLatest: latest(xero), csvLatest: latest(csv) }
}
async function bankRecorded() {
  const flat = await kvCommand(['HGETALL', BANK.recorded]).catch(() => [])
  const out = []
  for (let i = 1; Array.isArray(flat) && i < flat.length; i += 2) { try { const r = JSON.parse(flat[i]); if (r?.id) out.push(r) } catch {} }
  return out
}
// Last term's rows and every holiday price, for the hints and the two
// buttons (Holiday revenue, Previous term). Either can be missing: the panel
// still works without it.
async function bankExtras(config) {
  const term = previousTerm(config.term)
  const [prev, hol] = await Promise.all([
    listPreviousTerm(term).catch((error) => { console.error('jfp previous term read failed', error.message); return null }),
    holidaySizes().catch((error) => { console.error('jfp holiday prices read failed', error.message); return null }),
  ])
  return { term, prev, hol }
}
async function bankCheck(config) {
  const [src, m, ledger, ignored, recorded, extra, roster, invoices, refresh] = await Promise.all([bankSources(), moneyData(config, { quick: true }), listLedger(config.term).catch(() => []), kvCommand(['SMEMBERS', BANK.ignored]).catch(() => []), bankRecorded(), bankExtras(config), loadRoster().catch(() => ({ players: [] })), listInvoices().catch(() => []), bankRefreshState().catch(() => ({}))])
  const { items, counts, hidden, before } = matchBank({ items: [...src.xero, ...src.csv], players: m.players, ledger, ignored: Array.isArray(ignored) ? ignored : [], since: config.moneySince, recorded, previous: extra.prev || [], holidaySizes: extra.hol?.sizes || null, termStart: config.termStart, invoices: openForBank(invoices) })
  const coaches = (extra.hol?.config.coaches || []).slice().sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name }))
  return {
    sources: { xeroAt: src.xeroAt, xeroItems: src.xero.length, csvAt: src.csvAt, csvItems: src.csv.length, xeroLatest: src.xeroLatest, csvLatest: src.csvLatest },
    // The newest bank line we have and when the Mac last checked Xero (the button).
    feed: { latestLineDate: [src.xeroLatest, src.csvLatest].sort().at(-1) || '', status: refresh.status || null, request: refresh.request || null, today: sydneyToday() }, items: items.slice(0, 300), counts, hidden: hidden.slice(0, 60),
    // Older than this term's window: shown in their own fold (Lee, 13 Oct 2026).
    before: before.slice(0, 300), termStart: config.termStart,
    holiday: { periods: [...pickablePeriods(sydneyToday()).map((p) => ({ id: p.id, label: p.label, range: rangeLabel(p) })), { id: OTHER, label: OTHER_LABEL, range: '' }], coaches, locations: config.locations.map((l) => l.name), defaultLocation: locationFor(config, 'Belrose HQ').name },
    previousTerm: extra.prev ? { term: extra.term } : null,
    // For "Pro session": the Pro players a line can be for.
    pro: { players: roster.players.filter((r) => isProRow(r.paymentType) && r.holdsPlace).map((r) => ({ rowId: r.id, player: r.player })).sort((a, b) => a.player.localeCompare(b.player)) },
  }
}
async function bankUpload(res, principal, config, body) {
  const lines = body.lines
  if (!Array.isArray(lines) || !lines.length) return fail(res, 400, 'No money in found in that file.')
  if (lines.length > BANK_LIMITS.lines) return fail(res, 400, `That is more than ${BANK_LIMITS.lines} lines. Export a shorter date range.`)
  const today = sydneyToday()
  const parsed = []
  for (const l of lines) {
    const date = String(l?.date || ''), cents = Number(l?.cents), description = String(l?.description || '').replace(/\s+/g, ' ').trim().slice(0, BANK_LIMITS.description)
    if (!ISO.test(date) || date > today || !Number.isInteger(cents) || cents <= 0 || cents > BANK_LIMITS.cents) return fail(res, 400, 'A line in that file has a date or amount that does not look right.')
    parsed.push({ date, cents, description })
  }
  // Two identical lines in one file are two transfers: each gets its own id.
  const ids = csvIds(parsed)
  // Only money that could be JFP is kept: anything else on the account stays out.
  const players = (await moneyData(config, { quick: true })).players
  const sizes = feeSizes(players)
  // Holiday training and last term's families count as JFP money too.
  const extra = await bankExtras(config)
  const keep = (x) => looksJfp(x, players, sizes) || Boolean(extra.hol?.sizes.has(x.cents)) || (extra.prev || []).some((r) => rowScore(x, r).score >= 1) || Boolean(invoiceRefOf(x))
  const fresh = parsed.map((l, i) => ({ id: ids[i], date: l.date, cents: l.cents, payer: l.description, description: l.description })).filter(keep)
  if ((await kvCommand(['SET', 'jfp:bank-csv-lock', '1', 'NX', 'EX', '10'])) !== 'OK') return fail(res, 409, 'Another upload is saving. Try again in a moment.')
  try { return await bankSave(res, principal, fresh, parsed.length) } finally { await kvCommand(['DEL', 'jfp:bank-csv-lock']) }
}
async function bankSave(res, principal, fresh, read) {
  // Kept with what is there, for 45 days from the last upload; lines older
  // than csvKeepDays drop off (long enough for last term and the holidays).
  const old = await kvGetJson(BANK.csv).catch(() => null)
  const keepFrom = new Date(Date.now() - BANK_LIMITS.csvKeepDays * 86400000).toISOString().slice(0, 10)
  const byId = new Map((Array.isArray(old?.items) ? old.items : []).filter((x) => x?.date >= keepFrom).map((x) => [x.id, x]))
  const before = byId.size
  for (const x of fresh) byId.set(x.id, x)
  const items = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5000)
  await kvSetJson(BANK.csv, { at: new Date().toISOString(), source: 'csv', items }, BANK_LIMITS.csvDays * 86400)
  await audit({ by: principal.email, action: 'money.bankUpload', target: 'csv', after: { lines: read, kept: fresh.length, added: byId.size - before } })
  return res.status(200).json({ success: true, lines: read, kept: fresh.length, added: byId.size - before, total: items.length })
}
async function bankIgnore(res, principal, body, undo) {
  const id = String(body.id || '')
  if (!EXTERNAL_ID.test(id)) return fail(res, 400, 'That bank line is not valid.')
  await kvCommand([undo ? 'SREM' : 'SADD', BANK.ignored, id])
  await audit({ by: principal.email, action: undo ? 'money.bankUnignore' : 'money.bankIgnore', target: id })
  return res.status(200).json({ success: true, id })
}

// ---------- a bank line that paid for holiday training or last term (Lee, 13 Oct 2026) ----------
// Both claim the line exactly as recording it for a player does (the claim
// key, kept for good, and the recorded list), so it can never also be
// recorded for a player, and it leaves Bank transfers to check.
const claimKind = (raw) => { try { return JSON.parse(raw || '{}').kind || '' } catch { return '' } }
async function bankLineFor(id) {
  if (!EXTERNAL_ID.test(id)) return { status: 400, error: 'That bank line is not valid.' }
  const src = await bankSources()
  const seen = [...src.xero, ...src.csv].find((x) => x.id === id)
  if (!seen) return { status: 404, error: 'That bank transfer is not in the bank feed any more. Refresh Bank transfers to check.' }
  if (seen.date > sydneyToday()) return { status: 400, error: 'The payment date cannot be in the future.' }
  return { seen }
}
// The checks recordPayment makes for a bank line, in the same order: not in
// any term's ledger, not claimed, not the other copy of a recorded line
// (unless Lee says so), and not being saved by someone else this second.
async function bankGuard(id, seen, body) {
  if ((await findLedgerByPayment(id)).length) return { status: 409, error: 'That bank transfer is already in the ledger.' }
  const claim = await kvCommand(['GET', bankClaim(id)])
  if (claim) return { status: 409, error: claimKind(claim) === 'holiday' ? 'That bank transfer is already marked as holiday training.' : claimKind(claim) === 'pro' ? 'That bank transfer is already marked as Pro sessions.' : 'That bank transfer is already recorded.' }
  const line = { id, source: id.startsWith('XERO-') ? 'xero' : 'csv', cents: seen.cents, date: seen.date, payer: seen.payer || '', ...(body.confirmTwin === true ? { distinct: true } : {}), at: new Date().toISOString() }
  const twin = body.confirmTwin === true ? null : twinOf(line, await bankRecorded())
  if (twin) return { status: 409, code: 'twin', error: `This looks like the same transfer as the ${formatAud(twin.cents)} from ${twin.payer || 'the bank'} on ${twin.date}, already recorded from ${twin.source === 'xero' ? 'Xero' : 'the bank CSV'}. Only save it if it is a different payment.` }
  if ((await kvCommand(['SET', `jfp:paylock:${id}`, '1', 'NX', 'EX', '20'])) !== 'OK') return { status: 409, error: 'That bank transfer was just recorded. Refresh to check.' }
  return { line }
}
const refuse = (res, r) => fail(res, r.status, r.error, r.code ? { code: r.code } : undefined)

// "Holiday revenue": the line counts in Money > Holiday training under Bank
// transfer, in the holiday Lee picks. Kept in jfp:holiday-bank by line id.
async function bankHoliday(res, principal, config, body) {
  const id = String(body.id || '')
  const period = clean(body.period, 20)
  if (!isPeriodId(period)) return fail(res, 400, 'Pick the school holiday it was for, or Other dates.')
  const sessionDate = clean(body.sessionDate, 10)
  if (sessionDate && !ISO.test(sessionDate)) return fail(res, 400, 'The session date does not look right.')
  if (sessionDate && period !== OTHER && holidayPeriodOf(sessionDate) !== period) return fail(res, 400, `That session date is not in the ${periodLabel(period)}. Pick the right holiday, or leave the date blank.`)
  const hc = await getHolidayConfig()
  const coachIn = clean(body.coach, 60).toLowerCase()
  const coach = coachIn ? hc.coaches.find((c) => c.id === coachIn || c.name.toLowerCase() === coachIn) : null
  if (coachIn && !coach) return fail(res, 400, 'Pick a coach from the list, or leave it blank.')
  const locIn = clean(body.location, 80).toLowerCase() || 'belrose'
  const loc = config.locations.find((l) => l.id === locIn || l.name.toLowerCase() === locIn)
  if (!loc) return fail(res, 400, 'Pick a location from the list.')
  const note = clean(body.note, 200)
  const found = await bankLineFor(id)
  if (found.error) return refuse(res, found)
  const g = await bankGuard(id, found.seen, body)
  if (g.error) return refuse(res, g)
  // The claim guards from here on, so the 20 second lock is let go at the end
  // (Lee can put a line back and save it again straight away).
  try { return await bankHolidaySave(res, principal, { id, g, period, sessionDate, coach, loc, note }) } finally { await kvCommand(['DEL', `jfp:paylock:${id}`]).catch(() => {}) }
}
async function bankHolidaySave(res, principal, { id, g, period, sessionDate, coach, loc, note }) {
  const claimed = { ...g.line, kind: 'holiday', period }
  if ((await kvCommand(['SET', bankClaim(id), JSON.stringify(claimed), 'NX'])) !== 'OK') return fail(res, 409, 'That bank transfer is already recorded.')
  const rec = { id, date: g.line.date, cents: g.line.cents, payer: g.line.payer, period, sessionDate, coach: coach?.name || '', location: loc.name, note, by: principal.email, at: g.line.at }
  try { await kvCommand(['HSET', HOLIDAY_BANK, id, JSON.stringify(rec)]) } catch (error) { await kvCommand(['DEL', bankClaim(id)]).catch(() => {}); throw error }
  await kvCommand(['HSET', BANK.recorded, id, JSON.stringify(claimed)]).catch((error) => console.error('jfp bank recorded list failed', error))
  await audit({ by: principal.email, action: 'money.bankHoliday', target: id, after: { cents: rec.cents, date: rec.date, period, sessionDate, coach: rec.coach, location: rec.location } })
  return res.status(200).json({ success: true, line: rec, periodLabel: periodLabel(period) })
}
// Put a holiday line back on Bank transfers to check. Never a line recorded for a player.
async function bankHolidayUndo(res, principal, body) {
  const id = String(body.id || '')
  if (!EXTERNAL_ID.test(id)) return fail(res, 400, 'That bank line is not valid.')
  const raw = await kvCommand(['HGET', HOLIDAY_BANK, id])
  if (!raw) return fail(res, 404, 'That bank transfer is not marked as holiday training.')
  const claim = await kvCommand(['GET', bankClaim(id)])
  if (claim && claimKind(claim) !== 'holiday') return fail(res, 409, 'That bank transfer is recorded for a player, so it cannot be put back from here.')
  // Out of the holiday figures first, the claim last, so it is never in both.
  await kvCommand(['HDEL', HOLIDAY_BANK, id])
  if (claimKind(await kvCommand(['HGET', BANK.recorded, id])) === 'holiday') await kvCommand(['HDEL', BANK.recorded, id])
  await kvCommand(['DEL', bankClaim(id)])
  let before = null
  try { before = JSON.parse(raw) } catch {}
  await audit({ by: principal.email, action: 'money.bankHolidayUndo', target: id, before: before ? { cents: before.cents, date: before.date, period: before.period } : null })
  return res.status(200).json({ success: true, id })
}

// "Pro session" (Lee, 13 Oct 2026): the line counts in Money > Pro sessions
// as a bank transfer, optionally for one Pro player. Claimed exactly like
// holiday training, so it can never also be recorded for a JFP player.
async function bankPro(res, principal, config, body) {
  const id = String(body.id || '')
  const sessionDate = clean(body.sessionDate, 10)
  if (sessionDate && !ISO.test(sessionDate)) return fail(res, 400, 'The session date does not look right.')
  const note = clean(body.note, 200)
  let player = null
  const rowId = clean(body.rowId, 30)
  if (rowId) {
    const r = (await loadRoster()).players.find((x) => x.id === rowId)
    if (!r || !isProRow(r.paymentType)) return fail(res, 400, 'Pick a Pro player from the list, or leave it blank.')
    player = { rowId: r.id, player: r.player }
  }
  const found = await bankLineFor(id)
  if (found.error) return refuse(res, found)
  const g = await bankGuard(id, found.seen, body)
  if (g.error) return refuse(res, g)
  try {
    const claimed = { ...g.line, kind: 'pro' }
    if ((await kvCommand(['SET', bankClaim(id), JSON.stringify(claimed), 'NX'])) !== 'OK') return fail(res, 409, 'That bank transfer is already recorded.')
    const rec = { id, date: g.line.date, cents: g.line.cents, payer: g.line.payer, sessionDate, rowId: player?.rowId || '', player: player?.player || '', note, by: principal.email, at: g.line.at }
    try { await kvCommand(['HSET', PRO_BANK, id, JSON.stringify(rec)]) } catch (error) { await kvCommand(['DEL', bankClaim(id)]).catch(() => {}); throw error }
    await kvCommand(['HSET', BANK.recorded, id, JSON.stringify(claimed)]).catch((error) => console.error('jfp bank recorded list failed', error))
    await audit({ by: principal.email, action: 'money.bankPro', target: id, after: { cents: rec.cents, date: rec.date, sessionDate, rowId: rec.rowId } })
    return res.status(200).json({ success: true, line: rec })
  } finally { await kvCommand(['DEL', `jfp:paylock:${id}`]).catch(() => {}) }
}
async function bankProUndo(res, principal, body) {
  const id = String(body.id || '')
  if (!EXTERNAL_ID.test(id)) return fail(res, 400, 'That bank line is not valid.')
  const raw = await kvCommand(['HGET', PRO_BANK, id])
  if (!raw) return fail(res, 404, 'That bank transfer is not marked as Pro sessions.')
  const claim = await kvCommand(['GET', bankClaim(id)])
  if (claim && claimKind(claim) !== 'pro') return fail(res, 409, 'That bank transfer is recorded for something else, so it cannot be put back from here.')
  await kvCommand(['HDEL', PRO_BANK, id])
  if (claimKind(await kvCommand(['HGET', BANK.recorded, id])) === 'pro') await kvCommand(['HDEL', BANK.recorded, id])
  await kvCommand(['DEL', bankClaim(id)])
  let before = null
  try { before = JSON.parse(raw) } catch {}
  await audit({ by: principal.email, action: 'money.bankProUndo', target: id, before: before ? { cents: before.cents, date: before.date, rowId: before.rowId || '' } : null })
  return res.status(200).json({ success: true, id })
}

// "Previous term": a bank transfer for last term's place. One ledger row
// under last term (Payment ID = the line id), and the money onto last term's
// row only while it still owes. Marked paid already: the ledger row only
// (the "marked paid but missing from the ledger" fix).
async function bankPreviousTerm(res, principal, config, body) {
  const term = previousTerm(config.term)
  const spec = previousTermSpec(term)
  if (!spec) return fail(res, 400, `${term || 'Last term'}'s player list is not set up in the portal yet.`)
  const id = String(body.id || '')
  const found = await bankLineFor(id)
  if (found.error) return refuse(res, found)
  const { seen } = found
  const amount = body.amountCents == null || body.amountCents === '' ? seen.cents : Number(body.amountCents)
  if (!(Number.isInteger(amount) && amount > 0 && amount <= seen.cents)) return fail(res, 400, `Enter the amount, up to the ${formatAud(seen.cents)} that came in.`)
  const row = await getPreviousTermRow(term, clean(body.rowId, 30))
  if (!row) return fail(res, 404, `That player is not on the ${term} list.`)
  const note = clean(body.note, 200)
  const g = await bankGuard(id, seen, body)
  if (g.error) return refuse(res, g)
  try { return await bankPreviousSave(res, principal, config, { id, g, seen, amount, row, note, term, spec }) } finally { await kvCommand(['DEL', `jfp:paylock:${id}`]).catch(() => {}) }
}
async function bankPreviousSave(res, principal, config, { id, g, seen, amount, row, note, term, spec }) {
  const claimed = { ...g.line, kind: 'previousTerm', term, rowIds: [row.rowId] }
  if ((await kvCommand(['SET', bankClaim(id), JSON.stringify(claimed), 'NX'])) !== 'OK') return fail(res, 409, 'That bank transfer is already recorded.')
  const date = seen.date
  const from = id.startsWith('XERO-') ? 'Xero' : 'the bank CSV'
  // The ledger row first: it is what the term's money adds up. If Airtable
  // refuses it, nothing has changed and the line is free again.
  let ledgerId = ''
  try {
    ledgerId = await createLedgerRow({ paymentId: id, config, term, sourceTable: spec.source, playerNames: [row.player], amountCents: amount, paidAt: `${date}T00:00:00+10:00`, sourceIds: [row.rowId], sessionId: '', intentId: '', method: 'Bank Transfer', notes: `Recorded in the JFP portal by ${principal.name}: a ${term} payment, bank transfer matched from ${from}.${note ? ` ${note}` : ''}` })
  } catch (error) { await kvCommand(['DEL', bankClaim(id)]).catch(() => {}); throw error }
  const add = Math.min(amount, row.owingCents)
  const why = add > 0 ? `${formatAud(add)} added to the amount paid.${amount > add ? ` The other ${formatAud(amount - add)} was more than was owing, so it is only in the ledger.` : ''}`
    : row.markedPaid ? 'Already marked paid, so it was only added to the payment ledger.'
      : row.feeCents == null ? 'No fee is set on the row, so it was only added to the payment ledger.' : 'Nothing was owing, so it was only added to the payment ledger.'
  const fields = { [spec.notes]: appendNote(row.notes, `Bank transfer of ${formatAud(amount)} on ${date} recorded for ${term} in the JFP portal by ${principal.name} (${id}). ${why}${note ? ` ${note}` : ''}`) }
  if (add > 0) {
    const paid = row.paidCents + add
    fields[spec.paid] = paid / 100
    fields[spec.status] = row.feeCents != null && paid >= row.feeCents ? 'Paid' : 'Partially Paid'
  }
  let rowUpdated = true
  try { await updatePreviousTermRow(term, row.rowId, fields) } catch (error) { console.error('jfp previous term row failed', error); rowUpdated = false }
  await kvCommand(['HSET', BANK.recorded, id, JSON.stringify(claimed)]).catch((error) => console.error('jfp bank recorded list failed', error))
  // The year view is kept for 10 minutes: this term's year has to show it now.
  await kvCommand(['DEL', yearKey(config, Number(/(\d{4})\s*$/.exec(term)?.[1]) || 0)]).catch(() => {})
  await audit({ by: principal.email, action: 'money.bankPreviousTerm', target: row.rowId, after: { name: row.player, term, cents: amount, added: add, date, bank: id, ledger: Boolean(ledgerId), rowUpdated } })
  return res.status(200).json({ success: true, term, ledger: Boolean(ledgerId), rowUpdated, addedCents: add, ...(rowUpdated ? {} : { warning: `Saved in the payment ledger, but ${row.player}'s ${term} row could not be updated. Add the payment to the row in Airtable.` }) })
}

// An earlier term by venue, from its payment ledger (Term 3 was reconciled to
// Stripe). Ledger rows name Term 3 rows, and now and then a Term 4 row.
async function pastVenues(config, asked) {
  const previous = previousTerm(config.term)
  // Older terms: the copy of Lee's Money Register (Google Sheet).
  if (asked && asked !== previous) {
    const history = await listVenueHistory()
    if (!history.some((r) => r.term === asked)) return null
    const out = venuesFromHistory({ locations: config.locations, rows: history, term: asked, venueOf: (r) => venueNamed(locationFor(config, r.venue || '')) })
    // Lee's typed totals (HQ, the fields, the term) beside the payments listed.
    const hqId = locationFor(config, 'Belrose HQ').id
    return pastCosts(config, { term: asked, source: 'register', netIncomeCents: null, ...out, hqId, registerChecks: registerChecks({ register: out.register, venues: out.venues, listedCents: out.incomeCents, hqId }) })
  }
  const term = previous
  const [roster, ledger, juniors] = await Promise.all([loadRoster(), listLedger(term).catch(() => []), listJuniors().catch(() => [])])
  const venueOf = (r) => venueNamed(locationFor(config, r.location || ''))
  const groupOf = (r) => ({ key: `${r.day}|${r.time}`.toLowerCase(), label: [r.day, r.time].filter(Boolean).join(' ') || 'Not in a group', coach: r.coach || '' })
  const out = venuesFromLedger({ locations: config.locations, ledger, rows: [...roster.term3, ...roster.players], venueOf, groupOf })
  const incomeCents = ledger.reduce((t, l) => t + Math.round(Number(l['Amount Paid'] || 0) * 100), 0)
  const jj = juniorsByVenue(juniors, term, venueOf)
  for (const l of out.venues) l.juniors = jj.find((j) => j.id === l.id) || null
  return pastCosts(config, { term, source: 'ledger', incomeCents, netIncomeCents: incomeCents - out.stripeFeesCents, ...out })
}

// An earlier term's venue costs; with no Stripe fees known, profit is taken less costs.
function pastCosts(config, v) {
  const costs = costsOfTerm(config.venueCosts, v.term)
  for (const loc of config.locations) if (costs[loc.id] && !v.venues.some((x) => x.id === loc.id)) v.venues.push({ ...emptyVenue(loc), stripeFeeCents: v.netIncomeCents == null ? null : 0, netCents: v.netIncomeCents == null ? null : 0, juniors: null })
  v.venues = v.venues.map((x) => withCosts(x, costs[x.id]))
  const lastTerm = previousTerm(v.term)
  return { ...v, ...costTotals(v.venues, v.netIncomeCents ?? v.incomeCents), profitBeforeFees: v.netIncomeCents == null, venueCostsLast: { term: lastTerm, byVenue: costsOfTerm(config.venueCosts, lastTerm) } }
}

// ---------- money by year (Lee, 12 Oct 2026) ----------
// A whole year on Money: this term from moneyData (live), earlier terms from
// pastVenues (the ledger, then the Money Register copy), added up by
// _jfp-years with the year before for the comparison. Kept in KV for 10
// minutes per year; fresh reads everything again. Never kept when Stripe
// could not be read, so the next look tries again.
const YEAR_SECONDS = 600
const yearKey = (config, year) => `jfp:money-year:v1:${config.term}:${year}`
async function termsForYear(config, terms, year, { fresh }) {
  const out = []
  for (const t of termsOfYear(terms, year)) {
    if (t === config.term) { out.push(termFromLive(await moneyData(config, { fresh }))); continue }
    const v = await pastVenues(config, t)
    if (v) out.push(v.source === 'register' ? termFromRegister(v) : termFromLedger(v))
  }
  return out
}
export async function moneyYear(config, year, { fresh = false } = {}) {
  if (!fresh) {
    const hit = await kvGetJson(yearKey(config, year)).catch(() => null)
    if (hit?.year === year) return hit
  }
  const history = await listVenueHistory().catch(() => [])
  const terms = venueTerms({ current: config.term, previous: previousTerm(config.term), history })
  const years = yearsOf(terms)
  if (!years.includes(year)) return null
  const [mine, before] = await Promise.all([termsForYear(config, terms, year, { fresh }), years.includes(year - 1) ? termsForYear(config, terms, year - 1, { fresh }) : []])
  const out = { ...yearSummary({ year, terms: mine, before }), years, terms, term: config.term, at: new Date().toISOString() }
  if (!out.sources.some((s) => s.error)) await kvSetJson(yearKey(config, year), out, YEAR_SECONDS).catch(() => {})
  return out
}

// Lee's costs for one venue in one term. An empty list clears them.
async function saveVenueCosts(res, principal, body) {
  const term = clean(body.term, 40)
  if (!costTermOk(term)) return fail(res, 400, 'Pick the term, like "Term 4 2026".')
  // One costs save at a time, so two venues saved together both keep.
  if ((await kvCommand(['SET', 'jfp:costlock', '1', 'NX', 'EX', '10'])) !== 'OK') return fail(res, 409, 'Costs are being saved just now. Try again in a moment.')
  try { return await saveVenueCostsLocked(res, principal, body, term) } finally { await kvCommand(['DEL', 'jfp:costlock']).catch(() => {}) }
}
async function saveVenueCostsLocked(res, principal, body, term) {
  const config = await getConfig()
  const venueId = clean(body.venueId, 30)
  const loc = config.locations.find((l) => l.id === venueId)
  if (!loc) return fail(res, 400, 'Pick a venue.')
  const checked = checkCostLines(body.lines)
  if (checked.error) return fail(res, 400, checked.error)
  const all = structuredClone(config.venueCosts || {})
  const key = Object.keys(all).find((k) => k.toLowerCase() === term.toLowerCase()) || term
  const before = all[key]?.[venueId] || []
  all[key] = { ...(all[key] || {}) }
  if (checked.lines.length) all[key][venueId] = checked.lines
  else delete all[key][venueId]
  if (!Object.keys(all[key]).length) delete all[key]
  const next = await saveConfig({ venueCosts: all })
  const lines = next.venueCosts[key]?.[venueId] || []
  await audit({ by: principal.email, action: 'money.venueCosts', target: `${key}:${venueId}`, before, after: lines })
  return res.status(200).json({ success: true, term: key, venueId, lines, costsCents: lines.reduce((t, x) => t + x.cents, 0) })
}

// One player's payment story: the row, Stripe payments from the family's
// email, ledger rows, payment links and what staff changed.
async function playerPayments(config, rowId) {
  const r = await getTerm4Row(rowId)
  if (!r) return null
  const [ledger, payreqs, auditLog] = await Promise.all([listLedger(config.term).catch(() => []), listPayreqs(), listAudit(1500)])
  let stripe = []
  try {
    const all = await jfpStripePayments({ since: config.moneySince, term: config.term })
    stripe = [...all.payments, ...all.next.map((p) => ({ ...p, isNext: true })), ...(all.pro || [])].filter((p) => p.email && rowEmails(r).includes(p.email))
  } catch {}
  const recordedIds = new Set(ledger.flatMap((l) => [l['Payment ID'], l['Stripe Checkout Session ID'], l['Stripe Payment Intent ID']].filter(Boolean)))
  return {
    rowId: r.id, player: r.player, parent: r.parent, email: r.email, phone: r.phone,
    feeCents: cents(r.feeAud), paidCents: cents(r.paidAud), status: r.paymentStatus || 'Not set', type: r.paymentType || '',
    notes: r.notes || '', linkNotes: r.linkNotes || '',
    stripe: stripe.map((p) => ({ id: p.id, at: p.at, cents: p.amountCents, refundedCents: p.refundedCents, product: p.product, recorded: recordedIds.has(p.id) || (p.intentId && recordedIds.has(p.intentId)) || Boolean(p.jfpRef), feeCents: p.feeKnown ? p.feeCents : null, payMethod: p.payMethod || '', nextTerm: Boolean(p.isNext) })),
    ledger: ledger.filter((l) => String(l['Source Record ID'] || '').includes(r.id) || (l['Player Name'] || '').split(',').map((x) => x.trim()).includes(r.player)).map((l) => ({ date: l['Payment Date'] || '', method: l['Payment Method'] || '', cents: Math.round(Number(l['Amount Paid'] || 0) * 100), status: l['Payment Status'] || '', notes: l['Notes'] || '' })),
    links: payreqs.filter((q) => (q.term4Ids || []).includes(r.id)).map((q) => ({ id: q.id, status: q.status, cents: q.amountCents, createdAt: q.createdAt, paidAt: q.paidAt || '' })),
    history: auditLog.filter((e) => String(e.target || '').includes(r.id)).slice(0, 30).map((e) => ({ at: e.at, by: e.by, action: e.action })),
  }
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
  if (!email) return fail(res, 400, `${wordsFor(rows).noEmail} Add one to send a link.`)
  // One open link per player, so nobody can pay the same place twice.
  const openLinks = (await listPayreqs()).filter((q) => ['open', 'checkout'].includes(q.status) && q.term4Ids.some((id) => ids.includes(id)))
  if (openLinks.length && body.replace !== true) return fail(res, 409, `${rows.map((r) => r.player).join(' and ')} already ${openLinks.length > 1 ? 'have open links' : `has an open link for ${formatAud(openLinks[0].amountCents)}`}. Replace it with this new one?`, { code: 'link_open' })
  for (const q of openLinks) {
    const c = await cancelLink(q, principal, 'Replaced by a new link')
    if (c.error) return fail(res, c.status, c.error)
    for (const r of rows) { const fresh = await getTerm4Row(r.id); if (fresh) Object.assign(r, fresh) }
  }
  const group = rows[0].groupId ? await getGroup(rows[0].groupId) : null
  // Either what is owing on the rows, or a product from the price list
  // (pro rata from the start date), or an amount staff typed.
  const balance = rows.reduce((t, r) => t + Math.max(0, cents(r.balanceAud ?? ((r.feeAud || 0) - (r.paidAud || 0)))), 0)
  const chosen = PRODUCTS.some((x) => x.key === body.product) ? amountFor(config, group, { ...body, amountCents: undefined }, rows.length) : null
  if (chosen) { const sibErr = await siblingGuard(chosen.product, rows[0].email, rows.map((r) => r.player)); if (sibErr) return fail(res, 400, sibErr) }
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
      'Term 4 Notes': appendNote(r.notes, `Payment link by ${principal.name}: ${productFor(chosen.product).label}${chosen.price.fixedSessions ? `, from ${chosen.from} (${chosen.price.sessions} sessions)` : chosen.price.proRata ? `, from ${chosen.from} (${chosen.price.sessions} of ${chosen.price.of} sessions)` : ''}${credit ? `, ${formatAud(credit)} ${onTrial ? 'trial' : 'already paid'} taken off` : ''}, ${formatAud(share[i])}.`),
    } })))
  }
  const reason = body.reason === 'term-after-trial' ? 'term-after-trial' : chosen?.product === 'trial' ? 'trial' : 'balance'
  const w = wordsFor(rows)
  const q = await createPayreq({ req, principal, config, group, rows: rows.map((r) => ({ id: r.id, name: r.player })), email, parentName: rows[0].parent, amountCents, reason, product: chosen?.product || '', startDate: chosen?.from || '', afterpay: body.afterpay !== false, creditCents: onTrial ? credit : 0, restoreFields, programme: programmeOfRows(rows), ownContact: w.self })
  let sent = { emailed: false }, pdf = {}
  // A player with no group yet gets the link too (it used to send nothing).
  if (body.sendEmail === true) {
    pdf = await feePdf(req, config, q)
    const roster = await loadRoster()
    const needWaiver = rows.some((r) => !waiverFor(r.player, { emails: [email], phones: [r.phone], dob: r.dob }, roster.waivers))
    if (reason === 'term-after-trial' && group) sent = await trySend('term offered', () => sendTermOffered({ to: email, parentName: rows[0].parent, playerNames: rows.map((r) => r.player), group, config, url: payreqUrl(req, q), amountCents, startDate: chosen?.from || '', creditCents: credit, self: w.self, attachment: pdf.attachment }))
    else sent = await trySend('payment link', () => sendFamilyInvite({ to: email, parentName: rows[0].parent, playerNames: rows.map((r) => r.player), group, config, url: payreqUrl(req, q), needs: { details: false, waiver: needWaiver, payment: true }, amountCents, trial: reason === 'trial' && Boolean(group), startDate: chosen?.from || '', product: chosen?.product || '', self: w.self, attachment: pdf.attachment }))
    if (sent.emailed) await savePayreq({ ...q, emailedAt: new Date().toISOString() })
  }
  await audit({ by: principal.email, action: 'payreq.create', target: q.id, after: { rows: ids, cents: amountCents, product: chosen?.product || 'balance', emailed: sent.emailed } })
  return res.status(200).json({ success: true, payreq: { id: q.id, url: payreqUrl(req, q), amountLabel: formatAud(amountCents) }, emailed: sent.emailed, emailTo: sent.emailed ? email : '', emailError: sent.emailError ? `The link is made, but the email to ${email} did not send. ${sent.emailError} Copy the link and send it yourself.` : '', pdfWarning: pdfWarningOf(sent, pdf) })
}

// The PDF tax invoice, for Lee and Ligia to download (Money > Invoices, a
// player's open link): a custom invoice by its number, or any payment request.
async function staffInvoicePdf(req, res, config, body) {
  let doc = null
  if (body.id) {
    const inv = await getInvoice(body.id)
    if (!inv) return fail(res, 404, 'Invoice not found.')
    doc = docForInvoice(inv, config, siteUrl(req))
  } else {
    const q = await getPayreq(clean(body.payreqId, 60))
    if (!q || q.quick) return fail(res, 404, 'Payment link not found.')
    doc = await docForPayreq(q, config, siteUrl(req))
  }
  return res.status(200).json({ success: true, ...(await pdfDownload(doc)) })
}

// What a row's place is, for the family invoice price buttons.
function productOfRow(r, g) {
  const t = String(r.paymentType || '').toLowerCase()
  if (/pathway/.test(t) && /1 on 1/.test(t)) return 'pathwayOneToOne'
  if (/pathway/.test(t)) return 'pathway'
  if (/1 on 1/.test(t)) return 'oneToOneTerm'
  if (/trial/.test(t)) return 'trial'
  if (/half term/.test(t)) return 'halfTerm'
  return g?.product || 'group'
}

// One invoice for a family (Lee, 12 Oct 2026): every place keeps its own
// price on its own Term 4 row, the family gets one link for what all of them
// still owe, and when it is paid the money goes onto each row by what that
// row owed, with one ledger line per player. Any open link for these places
// is replaced (after Lee says yes); the places themselves are never released.
async function familyInvoice(req, res, principal, config, body) {
  const asked = (Array.isArray(body.places) ? body.places : []).slice(0, 10)
  if (!asked.length) return fail(res, 400, 'Choose the places to invoice.')
  const rows = []
  for (const a of asked) {
    const r = await getTerm4Row(clean(a.rowId, 30))
    if (!r) return fail(res, 404, 'A player row was not found in Airtable. Refresh and try again.')
    const feeCents = Number(a.feeCents)
    if (!Number.isInteger(feeCents) || feeCents < 0 || feeCents > 2000000) return fail(res, 400, `Enter a price for ${r.player}.`)
    const type = a.paymentType && PAYMENT_TYPES.includes(a.paymentType) ? a.paymentType : ''
    rows.push({ row: r, feeCents, type })
  }
  if (new Set(rows.map((x) => x.row.id)).size !== rows.length) return fail(res, 400, 'A place is listed twice.')
  const email = validEmail(body.email) || rows[0].row.email
  if (!email) return fail(res, 400, 'This family has no parent email in Airtable. Add one with Edit first.')
  const strangers = rows.filter((x) => !rowEmails(x.row).includes(email))
  if (strangers.length) return fail(res, 400, `${strangers.map((x) => x.row.player).join(' and ')} ${strangers.length > 1 ? 'are' : 'is'} under a different parent email. Make the emails match with Edit first.`)
  const ids = rows.map((x) => x.row.id)
  const openLinks = (await listPayreqs()).filter((q) => ['open', 'checkout'].includes(q.status) && q.term4Ids.some((id) => ids.includes(id)))
  // A link that also covers a place not on this invoice would leave that place unpaid.
  const outside = openLinks.filter((q) => q.term4Ids.some((id) => !ids.includes(id)))
  if (outside.length) return fail(res, 409, `${outside[0].playerNames.join(' and ')} share an open link with someone not on this invoice. Add them here, or cancel that link in Payment links first.`)
  if (openLinks.length && body.replace !== true) {
    return fail(res, 409, `This family already has ${openLinks.length === 1 ? 'an open link' : `${openLinks.length} open links`} (${openLinks.map((q) => `${q.playerNames.join(' + ')} ${formatAud(q.amountCents)}`).join(', ')}). Replace ${openLinks.length === 1 ? 'it' : 'them'} with this one invoice?`, { code: 'link_open' })
  }
  for (const q of openLinks) {
    const c = await cancelLink(q, principal, 'Replaced by a family invoice', { keepPlace: true })
    if (c.error) return fail(res, c.status, c.error)
  }
  // Each place's price on its own row. The balance is Airtable's formula.
  const updates = []
  for (const x of rows) {
    const r = await getTerm4Row(x.row.id) || x.row
    x.row = r
    const paid = cents(r.paidAud)
    const fields = {}
    if (cents(r.feeAud) !== x.feeCents || r.feeAud == null) fields['Term 4 Fee'] = x.feeCents / 100
    if (x.type && x.type !== r.paymentType) fields['Term 4 Payment Type'] = x.type
    const status = x.feeCents > 0 && paid >= x.feeCents ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid'
    if (Object.keys(fields).length && status !== r.paymentStatus) fields['Term 4 Payment Status'] = status
    if (Object.keys(fields).length) {
      fields['Term 4 Notes'] = appendNote(r.notes, `Family invoice by ${principal.name}: this place ${formatAud(x.feeCents)}${x.type ? ` (${x.type})` : ''}${r.feeAud != null && cents(r.feeAud) !== x.feeCents ? `, was ${formatAud(cents(r.feeAud))}` : ''}.`)
      updates.push({ id: r.id, fields, before: { fee: r.feeAud, type: r.paymentType, status: r.paymentStatus } })
    }
    x.owingCents = Math.max(0, x.feeCents - paid)
    x.paidCents = paid
  }
  if (updates.length) await updateTerm4Rows(updates.map(({ id, fields }) => ({ id, fields })))
  const owing = rows.filter((x) => x.owingCents > 0)
  const amountCents = owing.reduce((t, x) => t + x.owingCents, 0)
  await audit({ by: principal.email, action: 'player.family-prices', target: ids.join(','), before: updates.map((u) => ({ id: u.id, ...u.before })), after: rows.map((x) => ({ id: x.row.id, cents: x.feeCents, type: x.type })) })
  if (!amountCents) return res.status(200).json({ success: true, payreq: null, saved: updates.length, message: 'Prices saved. Nothing is owing, so no invoice was made.' })
  const groups = Object.fromEntries((await listGroups()).map((g) => [g.id, g]))
  const placeLabel = (r) => { const g = groups[r.groupId]; return g ? groupSummary(g, config) : [r.day, r.time, r.location].filter(Boolean).join(' ') }
  const fw = wordsFor(owing.map((x) => x.row))
  const q = await createPayreq({ req, principal, config, group: null, rows: owing.map((x) => ({ id: x.row.id, name: x.row.player })), email, parentName: rows[0].row.parent, amountCents, reason: 'family', afterpay: body.afterpay !== false, programme: programmeOfRows(owing.map((x) => x.row)), ownContact: fw.self })
  q.places = owing.map((x) => ({ rowId: x.row.id, name: x.row.player, label: placeLabel(x.row), feeCents: x.feeCents, paidCents: x.paidCents, owingCents: x.owingCents }))
  q.groupLabel = [...new Set(q.places.map((x) => x.label))].join(' · ')
  await savePayreq(q)
  let sent = { emailed: false }, pdf = {}
  if (body.sendEmail === true) {
    pdf = await feePdf(req, config, q)
    const roster = await loadRoster()
    const needWaiver = owing.some((x) => !waiverFor(x.row.player, { emails: rowEmails(x.row), phones: [x.row.phone], dob: x.row.dob }, roster.waivers))
    sent = await trySend('family invoice', () => sendFamilyInvoice({ to: email, parentName: rows[0].row.parent, places: q.places, config, url: payreqUrl(req, q), amountCents, needWaiver, self: fw.self, attachment: pdf.attachment }))
    if (sent.emailed) await savePayreq({ ...q, emailedAt: new Date().toISOString() })
  }
  const emailed = sent.emailed
  await audit({ by: principal.email, action: 'payreq.create', target: q.id, after: { rows: q.term4Ids, cents: amountCents, product: 'family', emailed, replaced: openLinks.map((x) => x.id) } })
  return res.status(200).json({ success: true, payreq: { id: q.id, url: payreqUrl(req, q), amountCents, amountLabel: formatAud(amountCents) }, emailed, emailTo: emailed ? email : '', emailError: sent.emailError ? `The invoice link is made, but the email to ${email} did not send. ${sent.emailError}` : '', pdfWarning: pdfWarningOf(sent, pdf), replaced: openLinks.length })
}

// Session by session (Lee, 12 Oct 2026): bill the sessions a player came to,
// at their own price per session. The sessions are added to the row's fee
// (so the balance, Money and the ledger stay right), then either a payment
// link for exactly that, or recorded as already paid by bank or cash.
// Several rows of one family (sisters) can go on one link.
async function sessionInvoice(req, res, principal, config, body) {
  const asked = (Array.isArray(body.rows) ? body.rows : []).slice(0, 6)
  if (!asked.length) return fail(res, 400, 'Choose a player.')
  const rows = []
  for (const a of asked) {
    const r = await getTerm4Row(clean(a.rowId, 30))
    if (!r) return fail(res, 404, 'Player row not found in Airtable.')
    const sessions = Number(a.sessions), per = Number(a.perSessionCents)
    if (!Number.isInteger(sessions) || sessions < 1 || sessions > 20) return fail(res, 400, `How many sessions for ${r.player}? (1 to 20)`)
    if (!Number.isInteger(per) || per < 100 || per > 200000) return fail(res, 400, `Enter the price per session for ${r.player}.`)
    // Sessions the player prepaid from My account come off first ([PREPAID:n]);
    // a commitment's dates are never billed, missed ones count as paid (_jfp-quote.js).
    const plan = billPlan({ prepaid: prepaidOf(r.notes), covered: coveredOf(r.notes), sessions, today: sydneyToday() })
    rows.push({ row: r, sessions, per, plan, covered: plan.covered, cents: (sessions - plan.covered) * per })
  }
  // Charged automatically after each session (claude/card-on-file): never billed by hand as well.
  const auto = await autoChargeActiveFor(config, rows.map((x) => x.row))
  if (auto.length) return fail(res, 409, `${auto.map((r) => r.player).join(' and ')} ${auto.length > 1 ? 'are' : 'is'} charged automatically after each session (saved card or bank account). To bill by hand instead, turn auto charge off for them in Edit player first.`, { code: 'auto_charge' })
  const what = clean(body.what, 120)
  const amountCents = rows.reduce((t, x) => t + x.cents, 0)
  // Every session asked for was paid in advance: nothing to bill, the
  // prepaid count goes down and that is all.
  if (!amountCents) {
    await updateTerm4Rows(rows.map((x) => ({ id: x.row.id, fields: { 'Term 4 Notes': appendNote(afterBill(x.row.notes, x.plan, withPrepaid), `Sessions billed by ${principal.name}: ${x.sessions}, all prepaid from My account${billLine(x.plan)}${what ? ` (${what})` : ''}.`) } })))
    await audit({ by: principal.email, action: 'player.sessions', target: rows.map((x) => x.row.id).join(','), after: { rows: rows.map((x) => ({ id: x.row.id, sessions: x.sessions, per: x.per, prepaid: x.covered })), what, mode: 'prepaid' } })
    return res.status(200).json({ success: true, payreq: null, covered: rows.reduce((t, x) => t + x.covered, 0), message: `Nothing to bill: ${rows.map((x) => `${x.row.player}'s ${x.covered} session${x.covered > 1 ? 's were' : ' was'}`).join(', ')} paid in advance from their account.` })
  }
  const paidNow = body.mode === 'paid'
  const email = rows[0].row.email
  if (!paidNow && !email) return fail(res, 400, `${wordsFor(rows.map((x) => x.row)).noEmail} Add one with Edit first.`)
  if (!paidNow && rows.some((x) => !rowEmails(x.row).includes(email))) return fail(res, 400, 'These players are under different parent emails. Send them one at a time.')
  const ids = rows.map((x) => x.row.id)
  let openLinks = []
  if (!paidNow) {
    openLinks = (await listPayreqs()).filter((q) => ['open', 'checkout'].includes(q.status) && q.term4Ids.some((id) => ids.includes(id)))
    if (openLinks.some((q) => q.term4Ids.some((id) => !ids.includes(id)))) return fail(res, 409, 'One of these players shares an open link with someone else. Cancel it in Payment links first.')
    if (openLinks.length && body.replace !== true) return fail(res, 409, `There is already an open link (${openLinks.map((q) => `${q.playerNames.join(' + ')} ${formatAud(q.amountCents)}`).join(', ')}). Replace it with this one?`, { code: 'link_open' })
    // A replaced session link takes its sessions back off the fee (restoreFields).
    for (const q of openLinks) { const c = await cancelLink(q, principal, 'Replaced by a new session link'); if (c.error) return fail(res, c.status, c.error) }
  }
  const restoreFields = []
  const updates = []
  for (const x of rows) {
    const r = (await getTerm4Row(x.row.id)) || x.row
    x.row = r
    restoreFields.push({ id: r.id, fields: { 'Term 4 Fee': r.feeAud ?? 0, 'Term 4 Payment Status': r.paymentStatus || 'Unpaid' } })
    // Not yet session by session: the term fee goes; sessions build up from what is paid.
    const fee = (isSessionType(r.paymentType) ? cents(r.feeAud) : cents(r.paidAud)) + x.cents
    const prepaidLine = `${x.covered ? `, ${x.covered} of them prepaid from My account so ${x.sessions - x.covered} billed` : ''}${billLine(x.plan)}`
    updates.push({ id: r.id, fields: {
      'Term 4 Fee': fee / 100,
      'Term 4 Payment Status': cents(r.paidAud) >= fee ? 'Paid' : cents(r.paidAud) > 0 ? 'Partially Paid' : 'Unpaid',
      ...(isSessionType(r.paymentType) ? {} : { 'Term 4 Payment Type': SESSION_TYPE }),
      'Term 4 Notes': appendNote(afterBill(withPerSession(r.notes, x.per), x.plan, withPrepaid), `Sessions billed by ${principal.name}: ${x.sessions} x ${formatAud(x.per)}${prepaidLine} = ${formatAud(x.cents)}${what ? ` (${what})` : ''}${paidNow ? ', paid' : ', payment link'}.`),
    } })
  }
  await updateTerm4Rows(updates)
  await audit({ by: principal.email, action: 'player.sessions', target: ids.join(','), after: { rows: rows.map((x) => ({ id: x.row.id, sessions: x.sessions, per: x.per })), what, mode: paidNow ? 'paid' : 'link' } })
  if (paidNow) {
    const out = await recordPaymentCore(principal, config, { rowIds: ids, amountCents, method: body.method, date: body.date, note: `${rows.map((x) => `${x.row.player} ${x.sessions} x ${formatAud(x.per)}`).join(', ')}${what ? ` (${what})` : ''}` })
    if (!out.ok) { await updateTerm4Rows(restoreFields); return fail(res, out.status, out.error) }
    await syncRowLinks(ids, { by: principal.email, why: 'sessions billed and paid' })
    return res.status(200).json({ success: true, recorded: formatAud(amountCents) })
  }
  const sw = wordsFor(rows.map((x) => x.row))
  const q = await createPayreq({ req, principal, config, group: null, rows: rows.map((x) => ({ id: x.row.id, name: x.row.player })), email, parentName: rows[0].row.parent, amountCents, reason: 'sessions', afterpay: false, restoreFields, programme: programmeOfRows(rows.map((x) => x.row)), ownContact: sw.self })
  q.places = rows.filter((x) => x.cents > 0).map((x) => { const n = x.sessions - x.covered; return { rowId: x.row.id, name: x.row.player, label: `${n} session${n > 1 ? 's' : ''} at ${formatAud(x.per)}${x.covered ? ` (${x.covered} more prepaid)` : ''}${what ? `, ${what}` : ''}`, feeCents: x.cents, paidCents: 0, owingCents: x.cents } })
  q.groupLabel = 'Session by session'
  await savePayreq(q)
  let sent = { emailed: false }, pdf = {}
  if (body.sendEmail === true) {
    pdf = await feePdf(req, config, q)
    sent = await trySend('sessions invoice', () => sendFamilyInvoice({ to: email, parentName: rows[0].row.parent, places: q.places, config, url: payreqUrl(req, q), amountCents, needWaiver: false, sessions: true, self: sw.self, attachment: pdf.attachment }))
    if (sent.emailed) await savePayreq({ ...q, emailedAt: new Date().toISOString() })
  }
  const emailed = sent.emailed
  await audit({ by: principal.email, action: 'payreq.create', target: q.id, after: { rows: ids, cents: amountCents, product: 'sessions', emailed } })
  return res.status(200).json({ success: true, payreq: { id: q.id, url: payreqUrl(req, q), amountCents, amountLabel: formatAud(amountCents) }, emailed, emailTo: emailed ? email : '', emailError: sent.emailError ? `The link is made, but the email to ${email} did not send. ${sent.emailError}` : '', pdfWarning: pdfWarningOf(sent, pdf) })
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
  // Staff's amount is what the link asks for now: a family link's places go
  // to one line, and the fee basis is taken again from here.
  const next = { ...q, amountCents, status: 'open', stripeSessionId: '', replacedSessionIds: [...new Set([...(q.replacedSessionIds || []), q.stripeSessionId].filter(Boolean))], changedAt: new Date().toISOString(), changedBy: principal.email }
  delete next.repriced
  if (Array.isArray(next.places) && next.places.reduce((t, x) => t + x.owingCents, 0) !== amountCents) delete next.places
  await savePayreq(next)
  // Keep the Airtable fee in step when the rows only carry this link.
  const rows = []
  for (const id of q.term4Ids) { const r = await getTerm4Row(id); if (r) rows.push(r) }
  const share = splitEven(amountCents, rows.length || 1)
  if (rows.length && q.product) await updateTerm4Rows(rows.map((r, i) => ({ id: r.id, fields: { 'Term 4 Fee': (cents(r.paidAud) + share[i]) / 100, 'Term 4 Notes': appendNote(r.notes, `Payment link changed from ${formatAud(q.amountCents)} to ${formatAud(amountCents)} by ${principal.name}.`) } })))
  if (feeTied(next)) await savePayreq(await stampFeeBasisFresh(next))
  let sent = { emailed: false }
  if (body.sendEmail === true) {
    const group = q.groupId ? await getGroup(q.groupId) : null
    // A quick link has its own page and its own email (13 Oct 2026).
    if (q.quick && q.email) { sent = await trySend('quick link', () => sendQuickLinkEmail({ to: q.email, parentName: q.parentName, forText: q.forText, amountCents, url: quickUrl(siteUrl(req), q), expiresAt: q.expiresAt, afterpay: q.afterpay !== false })); if (sent.emailed) await kvCommand(['HSET', QUICK_EMAILED, q.id, new Date().toISOString()]) }
    else if (!q.quick && q.email) sent = await trySend('changed link', () => sendFamilyInvite({ to: q.email, parentName: q.parentName, playerNames: q.playerNames, group, config, url: payreqUrl(req, q), needs: { details: false, waiver: false, payment: true }, amountCents, trial: q.reason === 'trial' && Boolean(group), startDate: q.startDate, self: q.ownContact === true }))
    else sent = { emailed: false, emailError: 'There is no email on this link.' }
  }
  const emailed = sent.emailed
  await audit({ by: principal.email, action: 'payreq.change', target: q.id, before: { cents: q.amountCents }, after: { cents: amountCents, emailed } })
  return res.status(200).json({ success: true, url: q.quick ? quickUrl(siteUrl(req), next) : payreqUrl(req, next), amountLabel: formatAud(amountCents), emailed, emailTo: emailed ? q.email : '', emailError: sent.emailError ? `The amount is changed, but the email did not send. ${sent.emailError}` : '' })
}

// After a trial: offer the rest of the term. The trial fee comes off unless
// staff untick it (Lee: taken off). Pro rata from the start date.
async function offerTerm(req, res, principal, config, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  if (!row.email && !validEmail(body.email)) return fail(res, 400, wordsFor([row]).noEmail)
  const group = await getGroup(clean(body.groupId, 80) || row.groupId)
  if (!group) return fail(res, 404, 'Put the player in a group first.')
  const out = { ...body, rowIds: [row.id], product: PRODUCTS.some((x) => x.key === body.product && x.key !== 'trial') ? body.product : group.product || 'group', creditTrial: body.creditTrial !== false, reason: 'term-after-trial' }
  if (group.id !== row.groupId) {
    const cap = await capacityCheck(group, 1, body.force === true)
    if (cap.error) return fail(res, 409, cap.error, { code: cap.code })
    const coach = coachById(config, group.coachId)
    await updateTerm4Rows([{ id: row.id, fields: { 'Term 3 Day': group.day, 'Term 3 Time': group.time, 'Term 3 Location': group.location, ...(coach ? { 'Coach': coach.airtableName } : {}), 'Term 4 Notes': appendNote(row.notes, `Moved to ${group.day} ${group.time} ${group.location} after the trial by ${principal.name}.`) } }])
    await noteNewPlayer({ config, group, rowId: row.id, player: row.player, kind: 'moved' }).catch((e) => console.error('jfp coach news failed', e))
  }
  return sendPaymentLink(req, res, principal, config, out)
}

async function searchPlayers(config, body) {
  const q = normName(body.q)
  if (q.length < 2) return []
  const roster = await loadRoster()
  const seen = new Map()
  const add = (key, v) => { if (!seen.has(key)) seen.set(key, v) }
  for (const r of roster.players) if (r.holdsPlace && normName(r.player).includes(q)) add(`${normName(r.player)}|${r.email}`, { name: r.player, parentName: r.parent, email: r.email, mobile: r.phone, dob: r.dob, age: playerAge(r, config.termStart), source: `Term 4: ${r.confirmation || 'no status'}${r.groupId ? `, ${r.day} ${r.time}` : ''}` })
  // Removed players stay findable, with when and why (Lee, 14 Oct 2026).
  for (const x of removedMatches(await removedPlayers(config, { roster }), q)) add(`${normName(x.name)}|${x.email}`, x)
  for (const r of roster.term3) if (normName(r.player).includes(q)) add(`${normName(r.player)}|${r.emails[0] || ''}`, { name: r.player, parentName: r.parent, email: r.emails[0] || '', mobile: r.phone, dob: r.dob, age: ageOn(r.dob, config.termStart), source: `Term 3${r.day ? `, ${r.day} ${r.time}` : ''}` })
  for (const w of roster.waivers) if (normName(w.player).includes(q)) add(`${normName(w.player)}|${w.email}`, { name: w.player, parentName: w.parent, email: w.email, mobile: w.mobile, dob: w.dob, age: ageOn(w.dob, config.termStart), source: `Waiver ${w.term || ''}`.trim() })
  return [...seen.values()].slice(0, 12).map((p) => ({ ...p, waiver: Boolean(waiverFor(p.name, { emails: [p.email], phones: [p.mobile] }, roster.waivers)) }))
}

// ---------- groups ----------

export async function saveGroupAction(res, principal, config, body) {
  const input = body.group || {}
  const existing = body.id ? await getGroup(body.id) : null
  if (body.id && !existing) return fail(res, 404, 'Group not found.')
  const allowed = ['day', 'time', 'location', 'coachId', 'extraCoachIds', 'capacity', 'mode', 'label', 'durationMin', 'minAge', 'maxAge', 'ageStatus', 'girlsOnly', 'publicNote', 'programme', 'byCoach', 'trials', 'questions', 'requirements', 'requirementsText', 'product', 'showFull', 'applyWhenFull', 'allowOneToOne']
  const patch = Object.fromEntries(Object.entries(input).filter(([k]) => allowed.includes(k)))
  for (const k of ['capacity', 'durationMin']) if (k in patch) patch[k] = Number(patch[k])
  for (const k of ['minAge', 'maxAge']) if (k in patch) patch[k] = patch[k] === '' || patch[k] == null ? null : Number(patch[k])
  if (!existing) {
    let v = validateGroup({ capacity: 6, mode: 'application', durationMin: 60, label: 'Small group', ...patch }, config)
    if (!v.ok) return fail(res, 400, v.errors.join(' '))
    // A second coach at a session that already runs: it becomes that coach's
    // own group (id ends in the coach), never one group that takes everyone's
    // players (Dean, Wed 6:30am NTRA, 12 Oct 2026).
    const all = await listGroups()
    const base = makeGroupId(v.group.day, v.group.time, v.group.location)
    const sameSession = all.filter((x) => makeGroupId(x.day, x.time, x.location) === base)
    if (sameSession.length && !v.group.byCoach) {
      if (!v.group.coachId) return fail(res, 400, 'A group already runs at that day, time and location. Choose the coach for this extra group.')
      if (sameSession.some((x) => x.coachId === v.group.coachId)) return fail(res, 409, 'That coach already has a group at that day, time and location.')
      v = validateGroup({ capacity: 6, mode: 'application', durationMin: 60, label: 'Small group', ...patch, byCoach: true }, config)
      if (!v.ok) return fail(res, 400, v.errors.join(' '))
      // The groups already there keep their ids from now on when edited.
      for (const x of sameSession) if (!x.byCoach) await saveGroup({ ...x, byCoach: true })
    }
    if (await getGroup(v.group.id)) return fail(res, 409, 'That coach already has a group at that day, time and location.')
    await saveGroup({ ...v.group, createdBy: principal.email, createdAt: new Date().toISOString() })
    await audit({ by: principal.email, action: 'group.create', target: v.group.id, after: v.group })
    return res.status(200).json({ success: true, group: v.group })
  }
  const v = validateGroup(patch, config, { ...existing, id: undefined })
  if (!v.ok) return fail(res, 400, v.errors.join(' '))
  // A coach group is one whose id carries its coach, or is flagged as one.
  const coachGroup = existing.byCoach === true || existing.id !== makeGroupId(existing.day, existing.time, existing.location)
  const next = { ...existing, ...v.group, byCoach: coachGroup, id: makeGroupId(v.group.day, v.group.time, v.group.location, coachGroup ? v.group.coachId : '') }
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

// ---------- prices and quick payment links (Lee, 13 Oct 2026) ----------
// "We want to be able to create custom prices here, add as many as we want,
// and be able to create payment links straight away."

function pricesView(config) {
  return {
    priceList: allPrices(config).map((p) => ({ ...p, amountLabel: formatAud(p.cents), programmeLabel: programmeLabel(p.programme) })),
    programmes: PROGRAMMES.map(([id, label]) => ({ id, label })),
    holidayPeriods: quickHolidayPeriods(sydneyToday()),
  }
}

// One change to the price list at a time, read again inside, so two people
// adding prices together never lose one.
async function withPrices(res, fn) {
  if ((await kvCommand(['SET', 'jfp:prices-lock', '1', 'NX', 'EX', '10'])) !== 'OK') return fail(res, 409, 'Someone is saving a price right now. Try again in a moment.')
  try { return await fn(await getConfig()) } finally { await kvCommand(['DEL', 'jfp:prices-lock']) }
}

// A JFP price list amount (jfp:<key>), or one of Lee's own prices (new or edited).
async function savePrice(res, principal, body) {
  const input = body.price || {}
  const id = clean(input.id, 50)
  return withPrices(res, async (config) => {
    if (id.startsWith('jfp:')) {
      const key = id.slice(4)
      if (!PRODUCTS.some((x) => x.key === key)) return fail(res, 404, 'Price not found.')
      const cents = Number(input.amountCents)
      if (!Number.isInteger(cents) || cents < PRICE_MIN || cents > PRICE_MAX) return fail(res, 400, 'Enter an amount from A$1 to A$20,000.')
      const next = await saveConfig({ prices: { ...config.prices, [key]: cents } })
      await audit({ by: principal.email, action: 'price.save', target: id, before: { cents: config.prices[key] }, after: { cents } })
      return res.status(200).json({ success: true, ...pricesView(next) })
    }
    const list = config.customPrices || []
    const before = id ? list.find((p) => p.id === id) : null
    if (id && !before) return fail(res, 404, 'Price not found.')
    if (!before && list.length >= PRICES_MAX) return fail(res, 400, `That is ${PRICES_MAX} prices. Archive some you no longer use first.`)
    const r = cleanPrice(input, { id: before?.id || newId('PR'), before })
    if (!r.ok) return fail(res, 400, r.error)
    const next = await saveConfig({ customPrices: before ? list.map((p) => (p.id === id ? r.price : p)) : [...list, r.price] })
    await audit({ by: principal.email, action: before ? 'price.edit' : 'price.add', target: r.price.id, before: before || null, after: r.price })
    return res.status(200).json({ success: true, price: r.price, ...pricesView(next) })
  })
}

// Archived prices leave the lists and the link form; old links keep working.
async function archivePrice(res, principal, body) {
  const id = clean(body.id, 50)
  if (id.startsWith('jfp:')) return fail(res, 400, 'The JFP price list stays. Change its amount instead.')
  return withPrices(res, async (config) => {
    const list = config.customPrices || []
    const before = list.find((p) => p.id === id)
    if (!before) return fail(res, 404, 'Price not found.')
    const archived = body.undo !== true
    const next = await saveConfig({ customPrices: list.map((p) => (p.id === id ? { ...p, archived, updatedAt: new Date().toISOString() } : p)) })
    await audit({ by: principal.email, action: archived ? 'price.archive' : 'price.restore', target: id, after: { name: before.name } })
    return res.status(200).json({ success: true, ...pricesView(next) })
  })
}

// What the Payment links page shows of a quick link.
function quickFields(req, q, { views = 0, emailedAt = '', checkedAt = '' } = {}) {
  const st = quickStatus(q, { views, emailedAt })
  return {
    quick: true, quickStatus: st, quickStatusLabel: QUICK_STATUS[st], programmeLabel: programmeLabel(q.programme), forText: q.forText, priceName: q.priceName || '',
    sessions: q.sessions || null, holidayPeriod: q.holidayPeriod || '', rowId: q.rowId || '', emailedAt: emailedAt || q.emailedAt || '', checkedAt,
    toCheck: quickToCheck(q, checkedAt ? { [q.id]: checkedAt } : {}), payerName: q.status === 'paid' ? q.payerName || '' : '', payerEmail: q.status === 'paid' ? q.payerEmail || '' : '',
    // The link families open: its own page, not the account.
    url: quickUrl(siteUrl(req), q), quickUrl: quickUrl(siteUrl(req), q),
  }
}

// A quick link: a price or an amount, what it is for, the programme, and
// maybe a player and a parent email. Nothing is emailed here.
async function quickLink(req, res, principal, config, body) {
  const price = body.priceId ? priceById(config, body.priceId) : null
  if (body.priceId && !price) return fail(res, 404, 'That price is not on the list any more.')
  if (price?.archived) return fail(res, 400, 'That price is archived. Restore it first, or type an amount.')
  let row = null
  if (body.rowId) {
    row = await getTerm4Row(clean(body.rowId, 30))
    if (!row) return fail(res, 404, 'Player row not found.')
  }
  // Every portal link is tied to a player, or says why not (Ligia, 14 Oct 2026).
  const r = quickLinkInput(body, { price, row, today: sydneyToday(), requirePlayer: true })
  if (!r.ok) return fail(res, r.status, r.error, r.code ? { code: r.code } : {})
  const group = r.link.groupId ? await getGroup(r.link.groupId) : null
  const q = { ...r.link, id: newId('PAY'), groupLabel: group ? groupSummary(group, config) : '', createdBy: principal.email, siteUrl: siteUrl(req) }
  // A JFP link for a player records on their row, so one open link per
  // player, as for every other link: a second needs replace.
  if (q.term4Ids.length) {
    const open = (await listPayreqs()).filter((x) => ['open', 'checkout'].includes(x.status) && (x.term4Ids || []).includes(row.id))
    if (open.length && body.replace !== true) return fail(res, 409, `${row.player} already has an open link for ${formatAud(open[0].amountCents)}. Replace it with this new one?`, { code: 'link_open' })
    for (const o of open) {
      const c = await cancelLink(o, principal, 'Replaced by a quick link')
      if (c.error) return fail(res, c.status, c.error)
    }
  }
  await savePayreq(q)
  await audit({ by: principal.email, action: 'quick.create', target: q.id, after: { cents: q.amountCents, programme: q.programme, price: q.priceId, row: q.rowId, email: Boolean(q.email), ...(q.noPlayerReason ? { noPlayer: q.noPlayerReason } : {}) } })
  return res.status(200).json({ success: true, link: { id: q.id, url: quickUrl(siteUrl(req), q), amountLabel: formatAud(q.amountCents), forText: q.forText, programme: q.programme, programmeLabel: programmeLabel(q.programme), email: q.email, players: q.playerNames, expiresAt: q.expiresAt } })
}

// "Email it": only when Lee taps it, only to the email on the link.
async function emailQuickLink(req, res, principal, body) {
  const q = await getPayreq(clean(body.id, 60))
  if (!q?.quick) return fail(res, 404, 'Payment link not found.')
  if (!quickOpen(q)) return fail(res, 409, `This link is ${QUICK_STATUS[quickStatus(q)].toLowerCase()}. Make a new one instead.`)
  if (!q.email) return fail(res, 400, 'This link has no parent email. Copy the link and send it yourself.')
  // A double tap sends one email.
  if ((await kvCommand(['SET', `jfp:quick-email-lock:${q.id}`, '1', 'NX', 'EX', '60'])) !== 'OK') return fail(res, 409, 'It was just emailed. Wait a minute before sending it again.')
  const sent = await trySend('quick link', () => sendQuickLinkEmail({ to: q.email, parentName: q.parentName, forText: q.forText, amountCents: q.amountCents, url: quickUrl(siteUrl(req), q), expiresAt: q.expiresAt, afterpay: q.afterpay !== false }))
  if (!sent.emailed) { await kvCommand(['DEL', `jfp:quick-email-lock:${q.id}`]); return fail(res, 502, `Not sent to ${q.email}. ${sent.emailError}`, { code: 'email' }) }
  const at = new Date().toISOString()
  // Kept on its own key, never by rewriting the link, which may be being paid right now.
  await kvCommand(['HSET', QUICK_EMAILED, q.id, at])
  await audit({ by: principal.email, action: 'quick.email', target: q.id })
  return res.status(200).json({ success: true, emailedAt: at, emailTo: q.email, messageId: sent.messageId })
}

// A paid quick link with no player, looked at: off the to check lists.
async function quickLinkChecked(res, principal, body) {
  const q = await getPayreq(clean(body.id, 60))
  if (!q?.quick) return fail(res, 404, 'Payment link not found.')
  if (q.status !== 'paid') return fail(res, 409, 'Only a paid link can be checked.')
  if (body.undo === true) await kvCommand(['HDEL', QUICK_CHECKED, q.id])
  else await kvCommand(['HSET', QUICK_CHECKED, q.id, new Date().toISOString()])
  await audit({ by: principal.email, action: body.undo === true ? 'quick.uncheck' : 'quick.check', target: q.id })
  return res.status(200).json({ success: true })
}

// ---------- requests: applications, waitlist, enquiries ----------

// Close a payment link so it can no longer be paid: shut the Stripe page,
// put back what a price-list link changed, and give back a place it held.
async function cancelLink(q, principal, why, { keepPlace = false } = {}) {
  if (q.status === 'paid') return { status: 409, error: 'Already paid. Refunds are made in Stripe.' }
  if (!['open', 'checkout'].includes(q.status)) return { released: 0 }
  const closed = q.status === 'checkout' ? await closeCheckout(q.stripeSessionId) : 'expired'
  if (closed === 'complete') return { status: 409, error: 'The family has just paid. It will show as paid in a minute; refunds are made in Stripe.' }
  if (closed === 'error') return { status: 503, error: 'Could not close the family\'s payment page. Try again in a minute.' }
  await savePayreq({ ...q, status: 'cancelled', cancelledBy: principal.email, cancelledAt: new Date().toISOString(), ...(keepPlace ? { cancelReason: why } : {}) })
  // Replaced by a family invoice: the place and the new prices stay as they are.
  if (keepPlace) { await audit({ by: principal.email, action: 'payreq.cancel', target: q.id, after: { released: 0, why } }); return { released: 0 } }
  if (q.restoreFields?.length) {
    const still = []
    for (const x of q.restoreFields) if (await getTerm4Row(x.id)) still.push(x)
    if (still.length) await updateTerm4Rows(still)
  }
  const released = ['application', 'waitlist', 'trial', 'admin-add'].includes(q.reason) ? await releaseOffer(q, principal, why) : 0
  await audit({ by: principal.email, action: 'payreq.cancel', target: q.id, after: { released, why } })
  return { released }
}

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
  // Saying no (or done) to an offer already made closes its link and gives
  // the held place back, so a declined family cannot still pay.
  if (!offering && r.status === 'offered' && r.payreqId) {
    const q = await getPayreq(r.payreqId)
    if (q && q.status === 'paid') return fail(res, 409, 'They have already paid for this offer. Remove the player on the timetable instead, and refund in Stripe.')
    if (q) { const c = await cancelLink(q, principal, body.decision === 'decline' ? 'Offer declined' : 'Offer closed'); if (c.error) return fail(res, c.status, c.error) }
  }
  if (body.decision === 'decline') {
    // Up to three groups that would suit better (Lee, 5 Oct 2026).
    const ids = [...new Set([...(Array.isArray(body.suggestGroupIds) ? body.suggestGroupIds : []), body.suggestGroupId].map((x) => clean(x, 80)).filter((x) => x && x !== r.groupId))].slice(0, 3)
    const suggestions = (await Promise.all(ids.map((x) => getGroup(x)))).filter(Boolean)
    let sent = { emailed: false }
    if (body.sendEmail === true) {
      const group = (await getGroup(r.groupId)) || (r.groupId === 'one-to-one' ? { day: '1 to 1', time: 'coaching', location: 'Belrose HQ' } : null)
      sent = group ? await trySend('declined', () => sendDeclined({ request: r, group, config, message: clean(body.message, 800), suggestions, siteUrl: siteUrl(req) })) : { emailed: false, emailError: 'The group is gone, so no email was sent.' }
    }
    const emailed = sent.emailed
    await saveApplication({ ...r, status: 'declined', decidedBy: principal.email, decidedAt: new Date().toISOString(), note: clean(body.message || body.note, 800), suggestedGroupId: suggestions[0]?.id || '', suggestedGroupIds: suggestions.map((g) => g.id) })
    await audit({ by: principal.email, action: 'request.decline', target: r.id, after: { emailed, suggest: suggestions.map((g) => g.id).join(', ') } })
    return res.status(200).json({ success: true, status: 'declined', emailed, emailTo: emailed ? r.email : '', emailError: sent.emailError ? `Declined, but the email did not send. ${sent.emailError}` : '' })
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
  const startDate = dates.includes(body.startDate) ? body.startDate : nextSessionDate(config, group.day, Date.now(), group.time)
  const n = r.players.length
  const { amountCents, price, product } = trial
    ? { amountCents: Number.isInteger(Number(body.amountCents)) && Number(body.amountCents) > 0 ? Number(body.amountCents) : config.prices.trial * n, price: priceFor(config, { product: 'trial' }), product: 'trial' }
    : amountFor(config, group, { ...body, startDate }, n)
  if (!trial) { const sibErr = await siblingGuard(product, r.email, r.players.map((p) => p.name)); if (sibErr) return fail(res, 400, sibErr) }
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
  // Any waiver the family signed with the request goes to Airtable now. A
  // waiver signed once for several sessions (a batch) is written once, with
  // the batch's tag, however many of its requests are accepted.
  let signed = r.players.filter((p) => p.waiver)
  // Already on file (a booking paid from the same batch, say): not twice.
  if (signed.length && r.batchId) {
    const roster = await loadRoster({ fresh: true })
    signed = signed.filter((p) => !waiverFor(p.name, { emails: [r.email], phones: [r.mobile], dob: p.dob }, roster.waivers))
  }
  if (signed.length) {
    const wtag = `[JFP-REQ:${r.batchId || r.id}]`
    if (!(await findWaiversByTag(wtag)).length) {
      await createWaiverRows(signed.map((p) => waiverFields({ player: { ...p, club: p.club || r.answers?.club || r.club }, parent: { name: r.parentName, email: r.email, mobile: r.mobile }, config, signature: p.waiver.signature, acceptedAt: p.waiver.acceptedAt, media: p.waiver.media, tag: wtag })))
      await bustRosterCache()
    }
  }
  const q = await createPayreq({ req, principal, config, group, rows: ids.map((id, i) => ({ id, name: r.players[i].name })), email: r.email, parentName: r.parentName, amountCents, reason: trial ? 'trial' : r.kind, requestId: r.id, product, startDate, trialDate: trial ? startDate : '', afterpay: body.afterpay !== false })
  await saveApplication({ ...r, status: 'offered', offer: trial ? 'trial' : 'term', offeredGroupId: group.id, payreqId: q.id, term4Ids: ids, decidedBy: principal.email, decidedAt: new Date().toISOString() })
  let sent = { emailed: false }
  if (body.sendEmail !== false) {
    sent = trial
      ? await trySend('trial offered', () => sendTrialOffered({ request: r, group, config, url: payreqUrl(req, q), amountCents, trialDate: startDate }))
      : await trySend('place offered', () => sendPlaceOffered({ request: r, group, config, url: payreqUrl(req, q), amountCents, startDate, sessions: price.sessions }))
    if (sent.emailed) await savePayreq({ ...q, emailedAt: new Date().toISOString() })
  }
  const emailed = sent.emailed
  for (const [i, id] of ids.entries()) await noteNewPlayer({ config, group, rowId: id, player: r.players[i]?.name || '', kind: trial ? 'trial' : 'offered' }).catch((e) => console.error('jfp coach news failed', e))
  await audit({ by: principal.email, action: trial ? 'request.trial' : 'request.offer', target: r.id, after: { group: group.id, payreq: q.id, rows: ids, cents: amountCents, emailed } })
  return res.status(200).json({ success: true, status: 'offered', payreq: { id: q.id, url: payreqUrl(req, q), amountCents, amountLabel: formatAud(amountCents) }, emailed, emailTo: emailed ? r.email : '', emailError: sent.emailError ? `The offer is made, but the email to ${r.email} did not send. ${sent.emailError} Copy the link and send it yourself.` : '' })
}

// ---------- money ----------


// ---------- coaches ----------

// Staff see each coach's full name and photo. Emails only for admins.
function coachList(config, isAdmin = true) {
  return config.coaches.map((c) => ({ id: c.id, name: coachLabel(c), firstName: c.name, photo: c.photoV ? coachPhotoUrl(c) : '', ...(isAdmin ? { email: c.email, alerts: c.alerts } : {}) }))
}

// A profile photo, resized in the browser to at most 600 x 750. Stored in KV
// (not Airtable): it is a picture for the timetable, not a record.
async function saveCoachPhoto(res, principal, config, body, isAdmin) {
  // An admin may be setting someone else's photo, or their own from My
  // profile, where there is no coachId to send.
  const ownCoachId = config.coaches.find((c) => c.email && c.email === principal.email)?.id || ''
  const coachId = isAdmin ? (clean(body.coachId, 30) || ownCoachId) : principal.coachId
  const coach = coachById(config, coachId)
  if (!coach) return fail(res, 400, 'Choose a coach.')
  let v = 0
  if (body.remove === true) {
    await kvCommand(['DEL', `jfp:coach-photo:${coach.id}`])
  } else {
    const m = String(body.dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
    if (!m) return fail(res, 400, 'Choose a JPG, PNG or WebP photo.')
    if (m[2].length > 700000) return fail(res, 413, 'That photo is too big. Try a smaller one.')
    await kvSetJson(`jfp:coach-photo:${coach.id}`, { type: m[1], b64: m[2], by: principal.email, at: new Date().toISOString() })
    v = Date.now()
  }
  const fresh = await getConfig()
  const next = await saveConfig({ coaches: fresh.coaches.map((c) => (c.id === coach.id ? { ...c, photoV: v } : c)) })
  await audit({ by: principal.email, action: body.remove === true ? 'coach.photo.remove' : 'coach.photo', target: coach.id })
  const c = coachById(next, coach.id)
  return res.status(200).json({ success: true, photo: c.photoV ? coachPhotoUrl(c) : '' })
}

// Parent cancellations a staff member may see: Lee and Ligia see all of them,
// a coach only the sessions of their own groups (or ones they were told about,
// as the cover coach).
function visibleCancels(all, groupsById, principal, config, isAdmin) {
  if (isAdmin) return all
  const me = principal.coachId || config.coaches.find((c) => c.email && c.email === principal.email)?.id || ''
  if (!me) return []
  return all.filter((r) => {
    const g = groupsById[r.groupId]
    return (r.coachIds || []).includes(me) || (g && (g.coachId === me || (g.extraCoachIds || []).includes(me)))
  })
}

// New cancellations for this person since they last opened Cancellations
// (Lee, 12 Oct 2026: coaches notified in their portal too, not only by email).
// Upcoming sessions only; a withdrawn one is no longer news.
const CANCEL_SEEN = 'jfp:cancel-seen'
async function cancelAlerts(res, principal, config, isAdmin) {
  const [all, groups, seen] = await Promise.all([listCancels(), listGroups(), kvCommand(['HGET', CANCEL_SEEN, principal.email])])
  const groupsById = Object.fromEntries(groups.map((g) => [g.id, g]))
  const since = Number(seen) || 0, nowMs = Date.now()
  const fresh = visibleCancels(all, groupsById, principal, config, isAdmin)
    .filter((r) => r.status === 'active' && r.startMs > nowMs && (r.submittedMs || Date.parse(r.submittedAt) || 0) > since)
    .sort((a, b) => a.startMs - b.startMs)
  return res.status(200).json({
    success: true, count: fresh.length,
    latest: fresh.slice(0, 5).map((r) => ({ player: r.player, dateLabel: r.dateLabel, time: r.time, day: r.day, location: r.location, reason: r.reason, noticeLabel: r.noticeLabel, noticeLevel: r.noticeLevel })),
  })
}

async function cancellationsData(res, principal, config, body, isAdmin) {
  // Opening the list counts as having seen them.
  await kvCommand(['HSET', CANCEL_SEEN, principal.email, String(Date.now())])
  const [all, groups] = await Promise.all([listCancels(), listGroups()])
  const groupsById = Object.fromEntries(groups.map((g) => [g.id, g]))
  const mine = visibleCancels(all, groupsById, principal, config, isAdmin)
  const nowMs = Date.now()
  const when = ['upcoming', 'past', 'all'].includes(body.when) ? body.when : 'upcoming'
  const pick = { upcoming: (r) => r.startMs > nowMs, past: (r) => r.startMs <= nowMs, all: () => true }
  return res.status(200).json({
    success: true, when, admin: isAdmin,
    counts: { upcoming: mine.filter(pick.upcoming).length, past: mine.filter(pick.past).length, all: mine.length },
    summary: noticeSummary(mine),
    cancellations: mine.filter(pick[when]).slice(0, 500).map((r) => staffView(r, { admin: isAdmin, nowMs })),
  })
}

function coachSessions(config, groups, roster, coachId, date, juniors = {}, notes = {}) {
  const mine = groups.filter((g) => g.coachId === coachId || (g.extraCoachIds || []).includes(coachId))
  const me = coachById(config, coachId)
  return mine.map((g) => {
    // A Joners Juniors class runs on the Juniors term's dates.
    const dates = isJuniorsGroup(g) ? jjDatesForGroup(config, g) : sessionDates(config, g.day)
    const players = isJuniorsGroup(g) ? (juniors[g.id] || []).map((p) => ({ rowId: p.rowId, name: p.name, age: p.age, coach: me?.name || '', mine: true, trial: false, status: 'Confirmed', juniors: true })) : roster.players.filter((r) => r.groupId === g.id && r.holdsPlace && !isTestName(r.player)).map((r) => {
      const c = coachByAirtableName(config, r.coach)
      const trial = /trial/i.test(r.paymentType)
      return { rowId: r.id, name: r.player, age: playerAge(r, config.termStart), coach: c?.name || r.coach || '', mine: !c || c.id === coachId || !(g.extraCoachIds || []).length, trial, trialDate: trial ? trialDateOf(r) : '', status: r.confirmation, ...coachInfo(r, notes, config) }
    }).sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name))
    const loc = locationFor(config, g.location)
    const next = dates.find((d) => d >= (date || sydneyToday())) || dates.at(-1)
    return {
      id: g.id, day: g.day, time: g.time, sortTime: to24h(g.time), location: loc.name, address: loc.address, durationMin: g.durationMin,
      label: g.label, minAge: g.minAge, maxAge: g.maxAge, dates: dates.map((d) => ({ iso: d, label: dateLabel(d) })), nextDate: next,
      players, coachName: coachLabel(me), coachId,
    }
  })
}

// ---------- trials: the coach tells Lee and Ligia how it went ----------
// Ligia, 13 Oct 2026: coaches must know a player is on trial, and Lee and
// Ligia need to hear from the coach after it. Saved in KV (the coach portal
// reads it fast) and on the player's profile in Airtable, and Lee and Ligia
// get a Telegram message.
const TRIAL_FEEDBACK = 'jfp:trial-feedback'
const trialDateOf = (r) => (String(r.notes || '').match(/Trial offered for (\d{4}-\d{2}-\d{2})/) || [])[1] || ''
export const TRIAL_VERDICTS = ['Ready for this group', 'Better in another group', 'Needs a lower level', 'Not the right fit yet']
async function trialFeedbackAll() {
  const raw = (await kvCommand(['HGETALL', TRIAL_FEEDBACK])) || []
  const out = {}
  for (let i = 0; i + 1 < raw.length; i += 2) { try { out[raw[i]] = JSON.parse(raw[i + 1]) } catch {} }
  return out
}
// The trial players in this coach's sessions, and whether feedback is due.
function coachTrials(sessions, feedback, today) {
  const out = []
  for (const s of sessions) for (const p of s.players) {
    if (!p.trial || !p.mine) continue
    const date = p.trialDate || ''
    const fb = feedback[p.rowId] || null
    out.push({ rowId: p.rowId, name: p.name, age: p.age, groupId: s.id, session: `${s.day} ${s.time}, ${s.location}`, date, dateLabel: date ? dateLabel(date) : '', due: !fb && (!date || date <= today), upcoming: Boolean(date && date > today), feedback: fb ? { at: fb.at, by: fb.byName, verdict: fb.verdict } : null })
  }
  return out.sort((a, b) => Number(b.due) - Number(a.due) || (a.date || '').localeCompare(b.date || ''))
}
async function saveTrialFeedback(res, principal, config, isAdmin, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  if (!/trial/i.test(row.paymentType)) return fail(res, 400, 'That player is not on a trial.')
  const groups = await listGroups()
  const g = groups.find((x) => x.id === row.groupId) || null
  if (!isAdmin && !(g && (g.coachId === principal.coachId || (g.extraCoachIds || []).includes(principal.coachId)))) return fail(res, 403, 'Not your session.')
  const verdict = TRIAL_VERDICTS.includes(body.verdict) ? body.verdict : ''
  if (!verdict) return fail(res, 400, 'Choose how the trial went.')
  const level = ['Below the group', 'About right', 'Above the group'].includes(body.level) ? body.level : ''
  const best = clean(body.best, 120)
  const notes = String(body.notes || '').replace(/\r/g, '').trim().slice(0, 1500)
  if (notes.length < 10) return fail(res, 400, 'Add a few words for Lee and Ligia: strengths, what to work on, attitude.')
  const byName = principal.name || principal.email
  const fb = { at: new Date().toISOString(), by: principal.email, byName, verdict, level, best, notes, date: trialDateOf(row) }
  await kvCommand(['HSET', TRIAL_FEEDBACK, row.id, JSON.stringify(fb)])
  const where = g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : [row.day, row.time, row.location].filter(Boolean).join(' ')
  const line = `${sydneyToday()}, Coach ${byName} (trial ${fb.date || 'date not set'}, ${where}): ${verdict}${level ? `. Level: ${level.toLowerCase()}` : ''}${best ? `. Best group: ${best}` : ''}.\n${notes}`
  const key = profileKey(row.player, row.email)
  try { await addTrialFeedback({ existing: await findProfile({ key, rowIds: [row.id] }), name: row.player, key, emails: rowEmails(row), rowIds: [row.id], line, by: principal.email }) } catch (e) { console.error('jfp trial feedback airtable failed', e) }
  if (!isTestName(row.player)) await telegramAlert(`Trial feedback: ${row.player} (${where}) from Coach ${byName}: ${verdict}${best ? `, best group: ${best}` : ''}. Read it in the portal: Program > Trial feedback.`)
  await audit({ by: principal.email, action: 'trial.feedback', target: row.id, after: { verdict, level } })
  return res.status(200).json({ success: true })
}

// ---------- Trial feedback for Lee and Ligia (15 Oct 2026) ----------
// Coach Sam's feedback on Lina D'Arrigo sat hidden in Registers. Every trial
// player is listed here with the coach's feedback; a new one is counted on
// the nav (red mark) until Lee or Ligia accept, move, decline or mark it read.
const TRIAL_DECISION = 'jfp:trial-decision'
const TRIAL_DECISIONS = ['accepted', 'moved', 'declined', 'seen']
async function trialDecisionsAll() {
  const raw = (await kvCommand(['HGETALL', TRIAL_DECISION])) || []
  const out = {}
  for (let i = 0; i + 1 < raw.length; i += 2) { try { out[raw[i]] = JSON.parse(raw[i + 1]) } catch {} }
  return out
}
async function trialsData(config, { fresh = false } = {}) {
  const [roster, groups, fb, dec] = await Promise.all([loadRoster({ fresh }), listGroups(), trialFeedbackAll(), trialDecisionsAll()])
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
  const today = sydneyToday()
  const ids = new Set([...roster.players.filter((r) => r.holdsPlace && /trial/i.test(r.paymentType)).map((r) => r.id), ...Object.keys(fb)])
  const items = []
  for (const id of ids) {
    const r = roster.players.find((x) => x.id === id)
    if (!r || isTestName(r.player)) continue
    const g = byId[r.groupId] || null
    const f = fb[id] || null
    const d = dec[id] || null
    // A decision older than the latest feedback does not hide it.
    const decided = d && (!f || d.at >= f.at) ? d : null
    const date = trialDateOf(r)
    items.push({
      rowId: r.id, name: r.player, age: playerAge(r, config.termStart), parent: r.parent, email: r.email, phone: r.phone, ownContact: r.ownContact === true,
      groupId: g ? g.id : '', group: g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : [r.day, r.time, r.location].filter(Boolean).join(' ') || 'No group',
      day: g?.day || r.day, time: g?.time || r.time, place: g ? locationFor(config, g.location).name : r.location,
      coach: g ? coachLabel(coachById(config, g.coachId)) : r.coach, trialDate: date, trialDateLabel: date ? dateLabel(date) : '',
      stillTrial: /trial/i.test(r.paymentType), paymentType: r.paymentType, paymentStatus: r.paymentStatus || '', paidCents: cents(r.paidAud),
      // Brothers and sisters holding a place under the same email: they can be billed together.
      family: r.email ? roster.players.filter((o) => o.id !== r.id && o.holdsPlace && normName(o.player) !== normName(r.player) && rowEmails(o).some((e) => rowEmails(r).includes(e)) && byId[o.groupId]).map((o) => ({ name: o.player, group: `${byId[o.groupId].day} ${byId[o.groupId].time}` })) : [],
      feedback: f, decision: decided,
      state: decided ? decided.decision : f ? 'new' : date && date > today ? 'upcoming' : 'waiting',
    })
  }
  const order = { new: 0, waiting: 1, upcoming: 2 }
  items.sort((a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3) || (b.feedback?.at || '').localeCompare(a.feedback?.at || '') || (a.trialDate || '').localeCompare(b.trialDate || ''))
  return { items, newCount: items.filter((x) => x.state === 'new').length }
}
async function decideTrial(res, principal, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  if (body.decision === 'undo') { await kvCommand(['HDEL', TRIAL_DECISION, row.id]); await audit({ by: principal.email, action: 'trial.decision', target: row.id, after: { decision: 'undo' } }); return res.status(200).json({ success: true }) }
  if (!TRIAL_DECISIONS.includes(body.decision)) return fail(res, 400, 'Choose accept, move, decline or mark as read.')
  const d = { decision: body.decision, at: new Date().toISOString(), by: principal.email, byName: principal.name, groupId: clean(body.groupId, 80), note: clean(body.note, 300) }
  await kvCommand(['HSET', TRIAL_DECISION, row.id, JSON.stringify(d)])
  await audit({ by: principal.email, action: 'trial.decision', target: row.id, after: { decision: d.decision, groupId: d.groupId } })
  return res.status(200).json({ success: true, decision: d })
}

// Every date's marks for each session, read in one go. A player moved from
// another group at the same day, time and place (Lee rearranges the Friday
// Rydalmere coaches) keeps the marks taken there: own group first, then the
// others. s.attendance stays the next date's marks.
async function attendanceByDate(sessions, groups) {
  const asks = []
  for (const s of sessions) {
    const g = groups.find((x) => x.id === s.id)
    const sibs = g ? groups.filter((x) => x.id !== g.id && x.day === g.day && x.time === g.time && x.location === g.location).map((x) => x.id) : []
    s._ids = [s.id, ...sibs]
    for (const d of s.dates) for (const id of s._ids) asks.push([s, d.iso, id])
  }
  const raws = asks.length ? await kvPipeline(asks.map(([, d, id]) => ['HGETALL', keys.attendance(id, d)])) : []
  const hash = (x) => { const a = x?.result ?? x ?? []; const o = {}; for (let i = 0; i + 1 < a.length; i += 2) o[a[i]] = a[i + 1]; return o }
  const got = new Map()
  asks.forEach(([s, d, id], i) => got.set(`${s.id}|${id}|${d}`, hash(raws[i])))
  for (const s of sessions) {
    const rows = new Set(s.players.map((p) => p.rowId))
    s.attendanceByDate = {}
    for (const d of s.dates) {
      const own = got.get(`${s.id}|${s.id}|${d.iso}`) || {}
      const out = { ...own }
      for (const id of s._ids.slice(1)) for (const [row, v] of Object.entries(got.get(`${s.id}|${id}|${d.iso}`) || {})) if (rows.has(row) && !(row in out)) out[row] = v
      s.attendanceByDate[d.iso] = out
    }
    s.attendance = s.attendanceByDate[s.nextDate] || {}
    delete s._ids
  }
}

// ---------- staff: cover, time off, session plans (Lee, 5 Oct 2026) ----------

// Cover: a coach hands one session date to another coach. It applies at
// once (the cover coach sees it in My sessions and takes the register);
// Lee and Ligia see every cover and can cancel it.
async function listHash(key) {
  const raw = await kvCommand(['HGETALL', key])
  const out = []
  for (let i = 0; i + 1 < (raw || []).length; i += 2) { try { out.push(JSON.parse(raw[i + 1])) } catch {} }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}
const listCovers = () => listHash('jfp:cover')
const listTimeOff = () => listHash('jfp:timeoff')
const saveCover = (c) => kvCommand(['HSET', 'jfp:cover', c.id, JSON.stringify(c)])
const saveTimeOff = (t) => kvCommand(['HSET', 'jfp:timeoff', t.id, JSON.stringify(t)])
export const PLAN_DEFAULT = { structure: '', weeks: Array.from({ length: 10 }, (_, i) => ({ week: i + 1, title: '', focus: '', link: '' })) }
async function getPlans() { const p = await kvGetJson('jfp:plans'); return p && Array.isArray(p.weeks) ? p : structuredClone(PLAN_DEFAULT) }

function coverView(c, config, groupsById) {
  const g = groupsById[c.groupId]
  return { ...c, group: g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : c.groupId, coach: coachLabel(coachById(config, c.coachId)), cover: coachLabel(coachById(config, c.coverCoachId)), dateLabel: dateLabel(c.date) }
}

// What Session ideas shows until Lee or Ligia change it. Lee's training video
// spreadsheet goes here once Lee sends the link.
const SESSION_IDEAS = [
  { label: 'The JF App', url: 'https://apps.apple.com/au/app/joner-football-app/id6737069275', note: 'Drills and full sessions to follow. Android: search Joner Football in Google Play.' },
  { label: 'Joner Football on YouTube', url: 'https://www.youtube.com/@jonerfootball', note: 'Free drills, Shorts and full sessions.' },
]

async function staffAction(req, res, principal, config, body, isAdmin, action) {
  const me = principal.coachId || ''
  const groups = await listGroups()
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
  if (action === 'staffOverview') {
    const [covers, timeOff, plans] = await Promise.all([listCovers(), listTimeOff(), getPlans()])
    const mine = (x) => isAdmin || x.coachId === me || x.coverCoachId === me
    return res.status(200).json({
      success: true,
      covers: covers.filter(mine).map((c) => coverView(c, config, byId)),
      timeOff: timeOff.filter(mine).map((t) => ({ ...t, coach: coachLabel(coachById(config, t.coachId)) })),
      coaches: config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })),
      mySessions: groups.filter((g) => g.mode !== 'closed' && (isAdmin || g.coachId === me || (g.extraCoachIds || []).includes(me))).map((g) => ({ id: g.id, coachId: g.coachId, label: `${g.day} ${g.time}, ${locationFor(config, g.location).name}`, dates: sessionDates(config, g.day).filter((d) => d >= sydneyToday()).map((d) => ({ iso: d, label: dateLabel(d) })) })),
      plans,
    })
  }
  // Session ideas (Lee, 19 Oct 2026): where coaches go for drills. Lee and
  // Ligia keep the list; every coach reads it.
  if (action === 'ideasGet' || action === 'ideasSave') {
    if (action === 'ideasSave') {
      if (!isAdmin) return fail(res, 403, 'Only Lee or Ligia change this list.')
      const list = (Array.isArray(body.ideas) ? body.ideas : []).slice(0, 30).map((x) => ({ label: clean(x?.label, 80), url: clean(x?.url, 600), note: clean(x?.note, 240) })).filter((x) => x.label && /^https:\/\/\S+$/.test(x.url))
      await saveConfig({ sessionIdeas: list })
      await audit({ by: principal.email, action: 'ideas.save', target: 'config', after: { count: list.length } })
      return res.status(200).json({ success: true, ideas: list })
    }
    return res.status(200).json({ success: true, ideas: Array.isArray(config.sessionIdeas) ? config.sessionIdeas : SESSION_IDEAS, admin: isAdmin })
  }
  // Lee and Ligia: covers and time off asked for since they last opened Cover
  // and time off (Lee, 19 Oct 2026: "This is key"). Time off still waiting
  // always counts. seen: true marks it read for this person.
  if (action === 'staffAlerts') {
    if (!isAdmin) return res.status(200).json({ success: true, count: 0, latest: [] })
    const seenKey = 'jfp:staff-seen'
    const last = (await kvCommand(['HGET', seenKey, principal.email])) || ''
    if (body.seen === true) await kvCommand(['HSET', seenKey, principal.email, new Date().toISOString()])
    const [covers, timeOff] = await Promise.all([listCovers(), listTimeOff()])
    const fresh = [
      ...covers.filter((c) => c.status === 'active' && c.createdAt > last).map((c) => ({ kind: 'cover', id: c.id, at: c.createdAt, text: `${coachLabel(coachById(config, c.coachId))} covered by ${coachLabel(coachById(config, c.coverCoachId))}, ${dateLabel(c.date)}` })),
      ...timeOff.filter((t) => t.status === 'pending').map((t) => ({ kind: 'timeoff', id: t.id, at: t.createdAt, text: `${coachLabel(coachById(config, t.coachId))} asks for time off, ${dateLabel(t.from)}${t.to !== t.from ? ` to ${dateLabel(t.to)}` : ''}` })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const count = body.seen === true ? fresh.filter((x) => x.kind === 'timeoff').length : fresh.length
    return res.status(200).json({ success: true, count, latest: fresh.slice(0, 5) })
  }
  if (action === 'requestCover') {
    const g = byId[clean(body.groupId, 80)]
    if (!g) return fail(res, 404, 'Session not found.')
    const owner = isAdmin ? (clean(body.coachId, 30) || g.coachId) : me
    if (!isAdmin && g.coachId !== me && !(g.extraCoachIds || []).includes(me)) return fail(res, 403, 'Not your session.')
    const date = clean(body.date, 10)
    if (!sessionDates(config, g.day).includes(date) || date < sydneyToday()) return fail(res, 400, 'Choose an upcoming date for this session.')
    const cover = coachById(config, clean(body.coverCoachId, 30))
    if (!cover || cover.id === owner) return fail(res, 400, 'Choose the coach who will cover.')
    const clash = (await listCovers()).find((c) => c.status === 'active' && c.groupId === g.id && c.date === date)
    if (clash) return fail(res, 409, `${coachLabel(coachById(config, clash.coverCoachId))} is already covering that session.`)
    const c = { id: newId('COV'), groupId: g.id, date, coachId: owner, coverCoachId: cover.id, note: clean(body.note, 300), status: 'active', createdAt: new Date().toISOString(), by: principal.email }
    await saveCover(c)
    await audit({ by: principal.email, action: 'cover.request', target: c.id, after: { group: g.id, date, cover: cover.id } })
    await telegramAlert(`JFP cover: ${coachLabel(coachById(config, owner))} is covered by ${coachLabel(cover)}\n${g.day} ${g.time}, ${locationFor(config, g.location).name}, ${dateLabel(date)}${c.note ? `\n${c.note}` : ''}`)
    return res.status(200).json({ success: true, cover: coverView(c, config, byId) })
  }
  if (action === 'cancelCover') {
    const c = (await listCovers()).find((x) => x.id === clean(body.id, 40))
    if (!c) return fail(res, 404, 'Not found.')
    if (!isAdmin && c.coachId !== me) return fail(res, 403, 'Only the coach who asked, Lee or Ligia can cancel a cover.')
    await saveCover({ ...c, status: 'cancelled', cancelledBy: principal.email, cancelledAt: new Date().toISOString() })
    await audit({ by: principal.email, action: 'cover.cancel', target: c.id })
    return res.status(200).json({ success: true })
  }
  if (action === 'requestTimeOff') {
    const coachId = isAdmin ? (clean(body.coachId, 30) || me) : me
    if (!coachById(config, coachId)) return fail(res, 400, 'Choose a coach.')
    const from = clean(body.from, 10), to = clean(body.to, 10) || from
    if (!ISO.test(from) || !ISO.test(to) || to < from) return fail(res, 400, 'Choose the first and last day off.')
    const t = { id: newId('OFF'), coachId, from, to, reason: clean(body.reason, 300), status: 'pending', createdAt: new Date().toISOString(), by: principal.email }
    await saveTimeOff(t)
    await audit({ by: principal.email, action: 'timeoff.request', target: t.id, after: { from, to } })
    await telegramAlert(`JFP time off request: ${coachLabel(coachById(config, coachId))}\n${dateLabel(from)}${to !== from ? ` to ${dateLabel(to)}` : ''}${t.reason ? `\n${t.reason}` : ''}\nApprove in the portal: Staff tab`)
    return res.status(200).json({ success: true, timeOff: t })
  }
  if (action === 'decideTimeOff') {
    if (!isAdmin) return fail(res, 403, 'Only Lee or Ligia approve time off.')
    const t = (await listTimeOff()).find((x) => x.id === clean(body.id, 40))
    if (!t) return fail(res, 404, 'Not found.')
    const status = ['approved', 'declined', 'cancelled'].includes(body.status) ? body.status : null
    if (!status) return fail(res, 400, 'Approve or decline.')
    await saveTimeOff({ ...t, status, decidedBy: principal.email, decidedAt: new Date().toISOString(), decisionNote: clean(body.note, 300) })
    await audit({ by: principal.email, action: `timeoff.${status}`, target: t.id })
    return res.status(200).json({ success: true })
  }
  // On The Go planner sessions (Lee, 5 Oct 2026): each coach's own, Lee and
  // Ligia see everyone's. The planner page saves its native document here.
  if (action === 'planList') {
    const raw = await kvCommand(['HGETALL', 'jfp:otg:index'])
    const list = []
    for (let i = 0; i + 1 < (raw || []).length; i += 2) { try { list.push(JSON.parse(raw[i + 1])) } catch {} }
    return res.status(200).json({ success: true, plans: list.filter((p) => isAdmin || p.owner === principal.email).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))) })
  }
  if (action === 'planSave') {
    const doc = body.plan
    const text = JSON.stringify(doc ?? null)
    if (!doc || typeof doc !== 'object') return fail(res, 400, 'Nothing to save.')
    if (text.length > 900000) return fail(res, 413, 'This session is too big to save. Remove an image and try again.')
    const id = newId('OTG')
    const summary = { id, title: clean(body.title, 120) || 'On The Go session', owner: principal.email, ownerName: principal.name, savedAt: new Date().toISOString() }
    await kvCommand(['SET', `jfp:otg:doc:${id}`, text])
    await kvCommand(['HSET', 'jfp:otg:index', id, JSON.stringify(summary)])
    await audit({ by: principal.email, action: 'plan.save', target: id, after: { name: summary.title } })
    return res.status(200).json({ success: true, plan: summary })
  }
  if (action === 'planGet' || action === 'planDelete') {
    const id = clean(body.id, 60)
    const summary = JSON.parse((await kvCommand(['HGET', 'jfp:otg:index', id])) || 'null')
    if (!summary || (!isAdmin && summary.owner !== principal.email)) return fail(res, 404, 'Session not found.')
    if (action === 'planDelete') {
      await kvCommand(['DEL', `jfp:otg:doc:${id}`])
      await kvCommand(['HDEL', 'jfp:otg:index', id])
      await audit({ by: principal.email, action: 'plan.delete', target: id, after: { name: summary.title } })
      return res.status(200).json({ success: true })
    }
    return res.status(200).json({ success: true, plan: { ...summary, onTheGo: JSON.parse((await kvCommand(['GET', `jfp:otg:doc:${id}`])) || 'null') } })
  }
  if (action === 'savePlans') {
    if (!isAdmin) return fail(res, 403, 'Only Lee or Ligia edit session plans.')
    const link = (v) => (/^https:\/\//.test(v || '') ? clean(v, 500) : '')
    const plans = {
      structure: String(body.plans?.structure || '').replace(/\r/g, '').slice(0, 6000),
      weeks: (Array.isArray(body.plans?.weeks) ? body.plans.weeks : []).slice(0, 20).map((w, i) => ({ week: i + 1, title: clean(w.title, 120), focus: String(w.focus || '').slice(0, 1500), link: link(w.link) })),
      updatedAt: new Date().toISOString(), updatedBy: principal.email,
    }
    await kvSetJson('jfp:plans', plans)
    await audit({ by: principal.email, action: 'plans.save', target: 'plans' })
    return res.status(200).json({ success: true, plans })
  }
  return null
}

// ---------- current families: invite them to their account ----------

// Every family holding a Term 4 place, by parent email: paid families get
// "see your sessions", families with a balance get their pay link. Rows with
// no fee set are left for staff to price first. Nothing sends until staff
// press Send; each family is emailed once unless staff resend.
export async function familyPlan(req, config) {
  const [roster, groups, invitedRaw, payreqs, signedRaw, acctRaw] = await Promise.all([loadRoster({ fresh: true }), listGroups(), kvCommand(['HGETALL', 'jfp:acct-invited']), listPayreqs(), kvCommand(['HGETALL', 'jfp:acct-signedin']), kvCommand(['HGETALL', 'jfp:acct-only-invited'])])
  const hash = (raw) => { const o = {}; for (let i = 0; i + 1 < (raw || []).length; i += 2) o[raw[i]] = raw[i + 1]; return o }
  const invited = hash(invitedRaw), signedIn = hash(signedRaw), acctInvited = hash(acctRaw)
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
  const fams = new Map()
  const noEmail = []
  for (const r of roster.players.filter((x) => x.holdsPlace && !isTestName(x.player))) {
    if (!validEmail(r.email)) { noEmail.push({ name: r.player, parent: r.parent }); continue }
    if (!fams.has(r.email)) fams.set(r.email, [])
    fams.get(r.email).push(r)
  }
  const list = [...fams.entries()].map(([email, rows]) => {
    // Marked Paid in Airtable means paid, even when no amount was typed in.
    const owe = (r) => (/^paid$/i.test(r.paymentStatus || '') ? 0 : Math.max(0, cents(r.balanceAud ?? ((r.feeAud || 0) - (r.paidAud || 0)))))
    const owingRows = rows.filter((r) => owe(r) > 0)
    const unpriced = rows.filter((r) => !owe(r) && r.paymentStatus !== 'Paid' && !(cents(r.paidAud) > 0) && !(cents(r.feeAud) > 0))
    const open = payreqs.find((q) => ['open', 'checkout'].includes(q.status) && q.term4Ids.some((id) => owingRows.some((r) => r.id === id)))
    return {
      email, parent: rows[0].parent, mobile: rows.find((r) => r.phone)?.phone || '',
      players: rows.map((r) => ({ rowId: r.id, name: r.player, group: byId[r.groupId] ? `${byId[r.groupId].day} ${byId[r.groupId].time}, ${locationFor(config, byId[r.groupId].location).name}` : [r.day, r.time, r.location].filter(Boolean).join(' ') || 'Group to be confirmed' })),
      owingCents: owingRows.reduce((t, r) => t + owe(r), 0), owingRowIds: owingRows.map((r) => r.id), openLink: open ? (open.quick ? quickUrl(siteUrl(req), open) : payreqUrl(req, open)) : '',
      kind: owingRows.length ? 'pay' : unpriced.length ? 'noPrice' : 'paid',
      needsWaiver: rows.some((r) => !waiverFor(r.player, { emails: [email], phones: [r.phone], dob: r.dob }, roster.waivers)),
      invitedAt: invited[email] || '', accountInvitedAt: acctInvited[email] || '', signedInAt: signedIn[email] || '', groupId: rows[0].groupId,
      // The player is their own contact: the invite talks to them.
      self: rows.every((r) => r.ownContact),
    }
  }).sort((a, b) => a.parent.localeCompare(b.parent))
  return { list, noEmail }
}

async function familyInvites(req, res, principal, config, body) {
  const plan = await familyPlan(req, config)
  const signInUrl = `${siteUrl(req)}/jfp-account/`
  const sample = (f) => accountInvite({ parentName: f.parent, players: f.players, config, signInUrl, payUrl: f.kind === 'pay' ? signInUrl : '', amountCents: f.owingCents, needsWaiver: f.needsWaiver, self: f.self })
  const accountOnly = body.mode === 'account'
  if (body.send !== true) {
    const pay = plan.list.find((f) => f.kind === 'pay'), paid = plan.list.find((f) => f.kind === 'paid')
    const one = plan.list.find((f) => f.players.length === 1) || plan.list[0]
    return res.status(200).json({ success: true, ...plan, previews: { pay: pay ? sample(pay) : null, paid: paid ? sample(paid) : null, account: one ? accountInvite({ parentName: one.parent, players: one.players, config, signInUrl, needsWaiver: one.needsWaiver, money: false, email: one.email, self: one.self }) : null } })
  }
  // Account only: every family with an email, paid or not, no amounts. Skips
  // anyone who has already signed in, and anyone already sent this one unless resend.
  if (accountOnly) {
    const want = new Set((Array.isArray(body.emails) ? body.emails : []).map(validEmail).filter(Boolean))
    // Every family asked for is answered: sent, failed (with why) or skipped (with why).
    const skipped = []
    const todo = []
    for (const e of want) {
      const f = plan.list.find((x) => x.email === e)
      if (!f) skipped.push({ email: e, why: 'Not found as a Term 4 family with that email.' })
      else if (f.signedInAt) skipped.push({ email: e, why: 'Already signed in, so not chased. Use Account invite on the player to send it anyway.' })
      else if (f.accountInvitedAt && body.resend !== true) skipped.push({ email: e, why: 'Already sent this invite.' })
      else todo.push(f)
    }
    const sent = [], failed = [], errors = {}
    for (const f of todo.slice(0, 20)) {
      // One claim per family per 10 minutes: a double click or two staff never email twice.
      if ((await kvCommand(['SET', `jfp:acct-only-lock:${f.email}`, '1', 'NX', 'EX', '600'])) !== 'OK') { skipped.push({ email: f.email, why: 'Sent in the last 10 minutes.' }); continue }
      const r = await trySend('account invite', () => sendAccountInvite({ to: f.email, parentName: f.parent, players: f.players, config, signInUrl, needsWaiver: f.needsWaiver, money: false, email: f.email, self: f.self }))
      if (r.emailed) { await kvCommand(['HSET', 'jfp:acct-only-invited', f.email, new Date().toISOString()]); sent.push(f.email) } else { failed.push(f.email); errors[f.email] = r.emailError; await kvCommand(['DEL', `jfp:acct-only-lock:${f.email}`]) }
    }
    await audit({ by: principal.email, action: 'family.accountInvite', target: 'term4', after: { sent: sent.length, failed: failed.length, skipped: skipped.length } })
    return res.status(200).json({ success: true, sent, failed, errors, skipped })
  }
  // A batch of families per call, so a big send never times out.
  const want = new Set((Array.isArray(body.emails) ? body.emails : []).map(validEmail).filter(Boolean))
  const todo = plan.list.filter((f) => want.has(f.email) && f.kind !== 'noPrice' && (!f.invitedAt || body.resend === true)).slice(0, 20)
  const sent = [], failed = [], errors = {}
  for (const f of todo) {
    try {
      let payUrl = ''
      if (f.kind === 'pay') {
        if (f.openLink) payUrl = f.openLink
        else {
          const rowsFull = []
          for (const id of f.owingRowIds) { const r = await getTerm4Row(id); if (r) rowsFull.push(r) }
          const group = rowsFull[0]?.groupId ? await getGroup(rowsFull[0].groupId) : null
          const q = await createPayreq({ req, principal, config, group, rows: rowsFull.map((r) => ({ id: r.id, name: r.player })), email: f.email, parentName: f.parent, amountCents: f.owingCents, reason: 'balance', product: '', startDate: '', afterpay: true, creditCents: 0, restoreFields: null, programme: programmeOfRows(rowsFull), ownContact: f.self })
          payUrl = payreqUrl(req, q)
          await savePayreq({ ...q, emailedAt: new Date().toISOString() })
        }
      }
      await sendAccountInvite({ to: f.email, parentName: f.parent, players: f.players, config, signInUrl, payUrl, amountCents: f.owingCents, needsWaiver: f.needsWaiver, self: f.self })
      await kvCommand(['HSET', 'jfp:acct-invited', f.email, new Date().toISOString()])
      sent.push(f.email)
    } catch (error) { console.error('jfp family invite failed', f.email, error); failed.push(f.email); errors[f.email] = emailErrorText(error) }
  }
  await audit({ by: principal.email, action: 'family.invite', target: 'term4', after: { sent: sent.length, failed: failed.length } })
  return res.status(200).json({ success: true, sent, failed, errors, remaining: [...want].filter((e) => !sent.includes(e) && !failed.includes(e) && plan.list.some((f) => f.email === e && f.kind !== 'noPrice' && (!f.invitedAt || body.resend === true))).length })
}

// Account invite for one player, from their Players record (Lee, 13 Oct
// 2026: "account invite did nothing" for a player with no group). Works for
// any row with an email, holding a place or not, signed in before or not,
// and always says what happened: "Sent to x@y" or the real reason.
async function inviteAccount(req, res, principal, config, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  const w = wordsFor([row])
  const email = rowEmails(row)[0] || ''
  if (!email) return fail(res, 400, `${w.noEmail} Add one with Edit, then send the invite.`, { code: 'no_email' })
  if ((await kvCommand(['SET', `jfp:acct-one-lock:${email}`, '1', 'NX', 'EX', '60'])) !== 'OK') return fail(res, 409, `An invite went to ${email} less than a minute ago. Check the Emails list on the player before sending again.`, { code: 'just_sent' })
  const [roster, groups] = await Promise.all([loadRoster({ fresh: true }), listGroups()])
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
  // Everyone on this email, so a family invite names every player.
  const rows = roster.players.filter((r) => rowEmails(r).includes(email) && (r.holdsPlace || r.id === row.id))
  const all = rows.length ? rows : [row]
  const players = all.map((r) => ({ rowId: r.id, name: r.player, group: byId[r.groupId] ? groupSummary(byId[r.groupId], config) : [r.day, r.time, r.location].filter(Boolean).join(' ') || 'Group to be confirmed' }))
  const needsWaiver = all.some((r) => !waiverFor(r.player, { emails: [email], phones: [r.phone], dob: r.dob }, roster.waivers))
  const self = all.every((r) => r.ownContact)
  const sent = await trySend('account invite (one)', () => sendAccountInvite({ to: email, parentName: all[0].parent, players, config, signInUrl: `${siteUrl(req)}/jfp-account/`, needsWaiver, money: false, email, self }))
  if (!sent.emailed) { await kvCommand(['DEL', `jfp:acct-one-lock:${email}`]); await audit({ by: principal.email, action: 'family.accountInvite.one', target: row.id, after: { sent: false } }); return fail(res, 502, `Not sent to ${email}. ${sent.emailError}`, { code: 'email' }) }
  const at = new Date().toISOString()
  await kvCommand(['HSET', 'jfp:acct-only-invited', email, at])
  const signedIn = await kvCommand(['HGET', 'jfp:acct-signedin', email])
  await audit({ by: principal.email, action: 'family.accountInvite.one', target: row.id, after: { sent: true } })
  return res.status(200).json({ success: true, sentTo: email, at, messageId: sent.messageId, signedInBefore: Boolean(signedIn), words: w })
}

// The last emails to this player or family, from the send log (Lee: "my
// biggest worry is making sure these emails reach the players and parents").
async function emailLogFor(res, body) {
  const row = await rowOr404(res, body.rowId); if (!row) return
  const prof = await findProfile({ key: profileKey(row.player, row.email), rowIds: [row.id] }).catch(() => null)
  const addresses = [...rowEmails(row), prof?.parent2Email].filter(Boolean)
  const list = await emailsTo(addresses, { limit: 20 })
  if (list === null) return fail(res, 503, 'Could not read the email log. Try again in a minute.')
  return res.status(200).json({ success: true, addresses, emails: list.map((e) => ({ at: e.at, to: e.to, subject: e.subject, kind: e.kind || '', status: e.status, messageId: e.messageId || '', error: e.error || '' })) })
}

// The words coaches get, shown on the Coaches page before anything is switched on.
function coachAlertSamples(config) {
  const coach = { name: 'Sam' }
  const g = { day: 'Wednesday', time: '7:30am', location: 'NTRA' }
  const today = sydneyToday()
  return {
    newPlayer: newPlayerWords({ config, coach, entries: [{ group: g, players: [{ name: 'Charlie Roberts', age: 14, when: 'first session Wed 15 Oct' }] }] }),
    register: registerWords({ config, coach, group: g, date: today, stage: 1, today }),
    registerAgain: registerWords({ config, coach, group: g, date: today, stage: 2, today }),
  }
}

// ---------- handler ----------

export default async function handler(req, res) {
  const holds = []
  try {
    return await requestHolds.run(holds, () => withAgent(req, 'portal', () => handle(req, res), res))
  } finally {
    for (const h of holds) await releasePlaces(h.gid, h.holdId).catch((e) => console.error('jfp staff hold release failed', e))
  }
}

async function handle(req, res) {
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
    if (action === 'me') {
      // Lee and Ligia have no coachId, but Lee also coaches. Fall back to the
      // coach record carrying their email so My profile works for them too.
      const myCoachId = principal.coachId || config.coaches.find((c) => c.email && c.email === principal.email)?.id || ''
      const mine = myCoachId ? coachList(config, false).find((c) => c.id === myCoachId) : null
      return res.status(200).json({ success: true, user: { ...principal, coachId: myCoachId, photo: mine?.photo || '' }, coaches: isAdmin ? coachList(config) : [] })
    }
    if (action === 'coachPhoto') return await saveCoachPhoto(res, principal, config, body, isAdmin)
    if (INVOICE_ACTIONS.has(action)) return await invoiceAction(res, principal, config, body, action, { isAdmin, myCoachId: principal.coachId || config.coaches.find((c) => c.email && c.email === principal.email)?.id || '', listCovers })
    if (HOURS_ACTIONS.has(action)) return await hoursAction(res, principal, config, body, action, { isAdmin, myCoachId: principal.coachId || config.coaches.find((c) => c.email && c.email === principal.email)?.id || '', listCovers })
    if (['ideasGet', 'ideasSave', 'staffOverview', 'staffAlerts', 'requestCover', 'cancelCover', 'requestTimeOff', 'decideTimeOff', 'savePlans', 'planList', 'planSave', 'planGet', 'planDelete'].includes(action)) return await staffAction(req, res, principal, config, body, isAdmin, action)

    if (action === 'cancellations') return await cancellationsData(res, principal, config, body, isAdmin)
    if (action === 'cancelAlerts') return await cancelAlerts(res, principal, config, isAdmin)

    if (action === 'coachSessions') {
      const coachId = isAdmin ? clean(body.coachId, 30) : principal.coachId
      // The whole program (Lee, 19 Oct 2026): Lee and Ligia see every coach's sessions at once.
      const all = isAdmin && coachId === 'all'
      if (!all && !coachById(config, coachId)) return fail(res, 400, 'Choose a coach.')
      const [groups, roster, notes] = await Promise.all([listGroups(), loadRoster(), coachNotes()])
      const juniors = await juniorsFor(groups, config)
      let sessions = all
        ? groups.flatMap((g) => coachSessions(config, [g], roster, g.coachId, clean(body.date, 10), juniors, notes))
        : coachSessions(config, groups, roster, coachId, clean(body.date, 10), juniors, notes)
      // A week (its Monday): each session on its day that week; no session that week, not shown.
      const week = ISO.test(body.week || '') ? body.week : ''
      const weekEnd = week ? new Date(Date.parse(`${week}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10) : ''
      if (week) sessions = sessions.map((x) => ({ ...x, nextDate: x.dates.find((d) => d.iso >= week && d.iso <= weekEnd)?.iso || '' })).filter((x) => x.nextDate)
      // Sessions this coach is covering, and covers on their own sessions.
      const covers = (await listCovers()).filter((c) => c.status === 'active' && c.date >= sydneyToday())
      for (const s of sessions) s.coveredBy = covers.filter((c) => c.groupId === s.id).map((c) => ({ date: c.date, dateLabel: dateLabel(c.date), coach: coachLabel(coachById(config, c.coverCoachId)) }))
      for (const c of all ? [] : covers.filter((x) => x.coverCoachId === coachId && (!week || (x.date >= week && x.date <= weekEnd)))) {
        const g = groups.find((x) => x.id === c.groupId)
        if (!g) continue
        const [s] = coachSessions(config, [{ ...g, coachId }], roster, coachId, c.date, juniors, notes)
        sessions.push({ ...s, id: g.id, dates: [{ iso: c.date, label: dateLabel(c.date) }], nextDate: c.date, covering: { for: coachLabel(coachById(config, c.coachId)), dateLabel: dateLabel(c.date) } })
      }
      // Faces for the register: the photo a family added in My account.
      const profs = await allProfiles().catch(() => [])
      const photoByRow = new Map(profs.filter((x) => x.photo).flatMap((x) => x.rowIds.map((id) => [id, x.photo])))
      for (const s of sessions) for (const p of s.players) if (photoByRow.has(p.rowId)) p.photo = photoByRow.get(p.rowId)
      // The register for every date of the term (Lee, 19 Oct 2026): a past date
      // picked in the list shows what was marked, and the Whole term grid.
      await attendanceByDate(sessions, groups)
      // Parents who said a player cannot make a date, so the register can mark
      // them. Display only: attendance is saved exactly as before.
      const away = (await listCancels()).filter((r) => r.status === 'active')
      for (const s of sessions) {
        s.cancelledBy = {}
        for (const r of away) if (r.groupId === s.id) (s.cancelledBy[r.date] ||= {})[r.rowId] = { reason: r.reason, notice: r.noticeLabel }
      }
      const trials = coachTrials(sessions, await trialFeedbackAll(), sydneyToday())
      const perWeek = sessions.reduce((t, s) => t + s.durationMin, 0)
      return res.status(200).json({ success: true, trials, verdicts: TRIAL_VERDICTS, coach: all ? 'Whole program' : coachLabel(coachById(config, coachId)), coachPhoto: all ? '' : coachList(config, false).find((c) => c.id === coachId)?.photo || '', all, week, term: config.term, sessions, hours: { perWeekMinutes: perWeek, termMinutes: perWeek * config.weeks, weeks: config.weeks } })
    }

    // A player's football information for their coach (Lee, 15 Oct 2026):
    // club, team, age, level, positions, foot, what they want to work on and
    // the note from Lee and Ligia. Only players in this coach's own sessions
    // (or one they are covering). Never contacts or money. Medical notes yes
    // (Lee, 18 Oct 2026: "coaches can see medical notes"): the profile's, else
    // what the signed waiver said.
    if (action === 'coachPlayer') {
      const coachId = isAdmin ? clean(body.coachId, 30) || principal.coachId : principal.coachId
      const rowId = clean(body.rowId, 30)
      const [groups, roster, notes, covers] = await Promise.all([listGroups(), loadRoster(), coachNotes(), listCovers()])
      const r = roster.players.find((x) => x.id === rowId && x.holdsPlace)
      const g = r && groups.find((x) => x.id === r.groupId)
      const coversIt = (gid) => covers.some((c) => c.status === 'active' && c.groupId === gid && c.coverCoachId === coachId && c.date >= sydneyToday())
      if (!r || !g || isJuniorsGroup(g) || (!isAdmin && !(g.coachId === coachId || (g.extraCoachIds || []).includes(coachId) || coversIt(g.id)))) return fail(res, 404, 'That player is not in your sessions.')
      const prof = pickProfile(await allProfiles().catch(() => []), { key: profileKey(r.player, r.email), rowIds: [r.id] })
      const w = prof?.club ? null : waiverFor(r.player, { emails: rowEmails(r), phones: [r.phone], dob: r.dob }, roster.waivers)
      const dob = prof?.dob || isoDate(r.dob) || w?.dob || ''
      const trial = /trial/i.test(r.paymentType)
      const info = coachInfo(r, notes, config)
      const wv = prof ? null : (w || waiverFor(r.player, { emails: rowEmails(r), phones: [r.phone], dob: r.dob }, roster.waivers))
      const medical = String(prof ? prof.medical || '' : wv ? (await waiverPrefill(wv.id).catch(() => ({}))).medical || '' : '').trim()
      return res.status(200).json({ success: true, player: {
        rowId: r.id, name: r.player, age: dob ? ageOn(dob, sydneyToday()) : playerAge(r, config.termStart), photo: prof?.photo || '',
        session: `${g.day} ${g.time}, ${locationFor(config, g.location).name}`, trial, trialDate: trial && trialDateOf(r) ? dateLabel(trialDateOf(r)) : '',
        club: prof?.club || w?.club || '', team: prof?.team || '', level: prof?.level || '', playingUp: prof?.playingUp || '', positions: prof?.positions || [], foot: prof?.foot || '',
        yearsPlaying: prof?.yearsPlaying || '', repTeam: prof?.repTeam || '', otherTraining: prof?.otherTraining || '', goals: prof?.goals || '',
        note: info.note, startsLabel: info.startsLabel, updatedAt: prof?.updatedAt || '', medical,
      } })
    }

    // The whole program as a timetable: names and ages, no money, no contacts.
    if (action === 'program') {
      const [groups, roster, notes] = await Promise.all([listGroups(), loadRoster(), coachNotes()])
      const juniors = await juniorsFor(groups, config)
      const counts = countsFrom(roster)
      const online = await onlineCounts(groups.map((g) => g.id))
      return res.status(200).json({
        success: true, term: config.term,
        // A Juniors class is closed to JFP bookings but is still on the program.
        groups: groups.filter((g) => g.mode !== 'closed' || isAdmin || isJuniorsGroup(g)).map((g) => {
          const loc = locationFor(config, g.location)
          return {
            id: g.id, day: g.day, time: g.time, sortTime: to24h(g.time), period: periodOf(g), locationId: loc.id, locationName: loc.name,
            coachId: g.coachId, coachName: coachLabel(coachById(config, g.coachId)), label: g.label, mode: g.mode, capacity: g.capacity,
            minAge: g.minAge, maxAge: g.maxAge, girlsOnly: g.girlsOnly, taken: isJuniorsGroup(g) ? (juniors[g.id] || []).length : counts[g.id] || 0, placesLeft: placesLeft(g, counts[g.id], online[g.id]),
            mine: g.coachId === principal.coachId || (g.extraCoachIds || []).includes(principal.coachId),
            players: isJuniorsGroup(g) ? (juniors[g.id] || []).map((p) => ({ name: p.name, age: p.age, trial: false, status: 'Confirmed', juniors: true })) : roster.players.filter((r) => r.groupId === g.id && r.holdsPlace && !isTestName(r.player)).map((r) => ({ name: r.player, age: playerAge(r, config.termStart), trial: /trial/i.test(r.paymentType), status: r.confirmation, ...coachInfo(r, notes, config) })).sort((a, b) => a.name.localeCompare(b.name)),
          }
        }),
      })
    }

    if (action === 'markAttendance') {
      const g = await getGroup(body.groupId)
      if (!g) return fail(res, 404, 'Group not found.')
      const date = clean(body.date, 10)
      const covering = (await listCovers()).some((c) => c.status === 'active' && c.groupId === g.id && c.date === date && c.coverCoachId === principal.coachId)
      if (!isAdmin && !covering && g.coachId !== principal.coachId && !(g.extraCoachIds || []).includes(principal.coachId)) return fail(res, 403, 'Not your session.')
      const dates = isJuniorsGroup(g) ? jjDatesForGroup(config, g) : sessionDates(config, g.day)
      if (!dates.includes(date)) return fail(res, 400, 'That date is not a session for this group.')
      const status = ['Present', 'Absent', 'Trial', 'Make-up', ''].includes(body.status) ? body.status : null
      if (status === null) return fail(res, 400, 'Invalid status.')
      let row
      if (isJuniorsGroup(g)) {
        const kid = ((await juniorsFor([g], config))[g.id] || []).find((p) => p.rowId === clean(body.rowId, 30))
        if (!kid) return fail(res, 404, 'That player is not in this session.')
        // The Juniors register (stage 3): the same KV, who coached, and the Juniors Attendance row.
        const cls = classForGroup(config.juniors, g)
        if (cls && ['Present', 'Absent', ''].includes(status)) return res.status(200).json({ success: true, airtable: await jjMarkOne(config, principal, { cls, gid: g.id, date, row: { id: kid.rowId, player: kid.name }, status }) })
        row = { id: kid.rowId, player: kid.name }
      } else {
        const roster = await loadRoster()
        row = roster.players.find((r) => r.id === clean(body.rowId, 30) && r.groupId === g.id)
      }
      if (!row) return fail(res, 404, 'That player is not in this session.')
      const key = keys.attendance(g.id, date)
      if (status) await kvCommand(['HSET', key, row.id, status]); else await kvCommand(['HDEL', key, row.id])
      let airtable = 'skipped'
      if (status) {
        try {
          const week = dates.indexOf(date) + 1
          await upsertAttendance({ attendanceId: `${isJuniorsGroup(g) ? 'JJ' : 'T4'}-W${week}-${g.day.slice(0, 3)}-${g.time}-${row.player}`, playerName: row.player, week, date, group: g, coachName: coachById(config, principal.role === 'coach' ? principal.coachId : g.coachId)?.name || '', status, markedBy: principal.email })
          airtable = 'saved'
        } catch (error) { console.error('jfp attendance airtable failed', error); airtable = 'failed' }
      } else {
        try {
          const week = dates.indexOf(date) + 1
          airtable = (await clearAttendance({ attendanceId: `${isJuniorsGroup(g) ? 'JJ' : 'T4'}-W${week}-${g.day.slice(0, 3)}-${g.time}-${row.player}`, markedBy: principal.email })) ? 'cleared' : 'skipped'
        } catch (error) { console.error('jfp attendance clear failed', error); airtable = 'failed' }
      }
      return res.status(200).json({ success: true, airtable })
    }

    // Coach notes for families (Lee, 17 Oct 2026): a coach writes to the family
    // of a player in their own sessions (or one they cover); Lee and Ligia any.
    if (FAMILY_NOTE_ACTIONS.has(action)) {
      const access = async (rowId) => {
        const [groups, roster, covers] = await Promise.all([listGroups(), loadRoster(), listCovers()])
        const r = roster.players.find((x) => x.id === rowId && x.holdsPlace)
        const g = r && groups.find((x) => x.id === r.groupId)
        if (!r || !g || isJuniorsGroup(g)) return null
        const coachId = principal.coachId
        const covering = covers.some((c) => c.status === 'active' && c.groupId === g.id && c.coverCoachId === coachId && c.date >= sydneyToday())
        if (!isAdmin && !(g.coachId === coachId || (g.extraCoachIds || []).includes(coachId) || covering)) return null
        return { row: r, group: g }
      }
      return await familyNoteAction(res, principal, body, action, { isAdmin, access, onNew: (rec, row) => pushFamilyNote(rec, row) })
    }
    if (action === 'trialFeedback') return await saveTrialFeedback(res, principal, config, isAdmin, body)
    // Joners Juniors registers (stage 3): a coach marks their own Juniors class, as in JFP.
    if (JJ_REGISTER_ACTIONS.has(action)) return await jjRegisterAction(req, res, principal, config, body, action)

    // Player reports (Lee, 18 Oct 2026): coaches for their own players only;
    // Lee and Ligia for anyone (_jfp-report-actions.js).
    if (REPORT_ACTIONS.has(action)) {
      const [groups, roster] = await Promise.all([listGroups(), loadRoster({ fresh: ['reportSend', 'reportRecipients'].includes(action) })])
      return await reportAction(req, res, principal, config, body, action, { isAdmin, groups, roster, isJuniorsGroup })
    }

    // Extra sessions (Lee, 14 Oct 2026): coaches run their own; Lee and Ligia see all.
    if (EXTRA_ACTIONS.has(action)) return await extraAction(req, res, principal, config, body, action, isAdmin)

    if (!isAdmin) return fail(res, 403, 'Not allowed.')

    // ---------- Lee and Ligia ----------
    // Joners Juniors: Dashboard, Players, Settings and their changes (_jj-portal.js).
    if (JJ_ACTIONS.has(action)) return await jjAction(req, res, principal, config, body, action)
    // Announcements to families, one way (Lee, 17 Oct 2026; _jfp-announce.js).
    if (ANNOUNCE_ACTIONS.has(action)) return await announceAction(req, res, principal, config, body, action, await listGroups())
    // Player charges, invoices and Match to player (_jfp-money-actions.js).
    if (MONEY_ACTIONS.has(action)) return await moneyAction(req, res, principal, config, body, action, { recordPaymentCore, bankLineFor, bankGuard, bankClaim, BANK })
    // Auto charges and saved payment methods (claude/card-on-file, _jfp-saved-pay.js).
    if (SAVED_PAY_ACTIONS.has(action)) return await savedPayAction(req, res, principal, config, body, action)
    switch (action) {
      case 'board': await sweepExpiredOffers(principal); return res.status(200).json({ success: true, ...(await boardData(config, { fresh: body.fresh === true })), coaches: coachList(config), locations: config.locations.map((l) => ({ id: l.id, name: l.name })) })
      case 'familyInvites': return await familyInvites(req, res, principal, config, body)
      case 'inviteAccount': return await inviteAccount(req, res, principal, config, body)
      case 'emailLog': return await emailLogFor(res, body)
      case 'searchPlayers': return res.status(200).json({ success: true, results: await searchPlayers(config, body) })
      case 'addPlayer': return await addPlayer(req, res, principal, config, body)
      case 'playersList': return await playersList(req, res, config, body)
      // JF App access asked for by JFP families (Lee, 19 Oct 2026). Set up in Uscreen by hand.
      case 'appAccessList': return res.status(200).json({ success: true, list: await listAppAccess() })
      case 'appAccessMark': { const out = await markAppAccess({ parentEmail: body.parentEmail, status: body.status, by: principal.email }); if (!out.ok) return fail(res, out.status, out.error); return res.status(200).json({ success: true, record: out.record }) }
      // Past and present players and JF Master Players (Lee, 19 Oct 2026): Lee and Ligia only.
      case 'playersHistory': {
        if (!isAdmin) return fail(res, 403, 'Only Lee or Ligia can see past players.')
        const out = await playersHistory({ body, roster: await loadRoster(), termLabel: config.term })
        if (out.error) return fail(res, 400, out.error)
        return res.status(200).json({ success: true, terms: HISTORY_TERMS, ...out })
      }
      case 'addPlayerNoGroup': return await addPlayerNoGroup(req, res, principal, config, body)
      case 'addFamily': return await addFamily(req, res, principal, config, body)
      case 'movePlayer': return await movePlayer(res, principal, config, body)
      case 'removePlayer': return await removePlayer(res, principal, config, body)
      case 'editPlayer': return await editPlayer(res, principal, config, body)
      case 'getProfile': return await getPlayerProfile(res, config, body)
      case 'saveProfile': return await savePlayerProfile(res, principal, config, body)
      case 'setCoachNote': return await setCoachNote(res, principal, config, body)
      case 'restorePlayer': return await restorePlayer(res, principal, body)
      case 'markPaid': return await markPaid(res, principal, body)
      case 'setTrial': return await setTrial(res, principal, body)
      case 'sendPaymentLink': return await sendPaymentLink(req, res, principal, config, body)
      case 'invoicePdf': return await staffInvoicePdf(req, res, config, body)
      case 'familyInvoice': return await familyInvoice(req, res, principal, config, body)
      case 'nightly': { const { lastNightly, NIGHTLY_LABEL } = await import('./_jfp-nightly.js'); return res.status(200).json({ success: true, ...(await lastNightly()), labels: NIGHTLY_LABEL }) }
      case 'nightlyRun': { const { runNightly, lastNightly, NIGHTLY_LABEL } = await import('./_jfp-nightly.js'); await runNightly({ alert: false }); return res.status(200).json({ success: true, ...(await lastNightly()), labels: NIGHTLY_LABEL }) }
      case 'stripeScan': return res.status(200).json({ success: true, payments: await stripeScan({ from: clean(body.from, 10), to: clean(body.to, 10) }) })
      case 'sessionInvoice': return await sessionInvoice(req, res, principal, config, body)
      // Pro session quotes (14 Oct 2026, _jfp-quote-staff.js): staff only.
      case 'playerQuote': case 'saveQuote': case 'saveDefaultQuote': {
        const out = action === 'playerQuote' ? await playerQuote(config, body) : action === 'saveQuote' ? await saveQuote(principal, config, body) : await saveDefaultQuote(principal, config, body)
        return res.status(out.status).json(out.body)
      }
      case 'nextTerm': {
        const nt = config.nextTerm
        const [roster, groups, statuses, interest] = await Promise.all([loadRoster({ fresh: true }), listGroups(), nextStatuses(nt.name), nextInterest(nt.name)])
        const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
        const players = roster.players.filter((r) => r.holdsPlace && !isTestName(r.player)).map((r) => {
          const g = byId[r.groupId]
          const st = statuses[r.id] || null
          return { rowId: r.id, name: r.player, parent: r.parent, email: r.email, group: g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : 'Not in a group', groupId: r.groupId, coach: g ? coachLabel(coachById(config, g.coachId)) : '', status: st?.status || '', paidCents: st?.paidCents || 0, at: st?.at || '', interested: interest[r.id]?.at || '' }
        }).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
        const count = (s) => players.filter((p) => p.status === s).length
        return res.status(200).json({ success: true, nextTerm: nt, prices: nextPrices(config, null), players, totals: { players: players.length, invited: count('invited'), held: count('held'), paid: count('paid'), no: count('no'), interested: players.filter((p) => p.interested && !p.status).length, none: players.filter((p) => !p.status).length } })
      }
      case 'saveNextTerm': {
        // Statuses are kept under the term's name: no renaming once families have answered.
        const newName = clean(body.nextTerm?.name, 40)
        if (newName && newName !== config.nextTerm.name && Object.keys(await nextStatuses(config.nextTerm.name)).length) return fail(res, 409, `Families have already been invited for ${config.nextTerm.name}, so its name cannot change now.`)
        const next = await saveConfig({ nextTerm: { ...config.nextTerm, ...(body.nextTerm || {}) } })
        await audit({ by: principal.email, action: 'next.settings', target: 'config', before: config.nextTerm, after: next.nextTerm })
        return res.status(200).json({ success: true, nextTerm: next.nextTerm })
      }
      case 'nextTermInvite': {
        const nt = config.nextTerm
        const ids = new Set((Array.isArray(body.rowIds) ? body.rowIds : []).map((x) => clean(x, 30)))
        if (!ids.size) return fail(res, 400, 'Choose the players to invite.')
        const [roster, groups, statuses] = await Promise.all([loadRoster({ fresh: true }), listGroups(), nextStatuses(nt.name)])
        const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
        const rows = roster.players.filter((r) => ids.has(r.id) && r.holdsPlace)
        let invited = 0, emailed = 0
        const families = new Map()
        for (const r of rows) {
          if (!statuses[r.id]) { await setNextStatus(nt.name, r.id, { status: 'invited' }); await recordNext({ term: nt.name, row: r, group: byId[r.groupId], status: 'invited', by: principal.email }); invited += 1 }
          // Email only players invited just now, unless staff ask to send again.
          if (r.email && (!statuses[r.id] || (body.resend === true && statuses[r.id].status === 'invited'))) families.set(r.email, [...(families.get(r.email) || []), r])
        }
        const failedTo = []
        if (body.sendEmail === true) {
          for (const [email, list] of families) {
            const pr = nextPrices(config, byId[list[0].groupId])
            const sent = await trySend('next term invite', () => sendNextTermInvite({ to: email, parentName: list[0].parent, players: list.map((r) => ({ name: r.player, group: byId[r.groupId] ? `${byId[r.groupId].day} ${byId[r.groupId].time}, ${locationFor(config, byId[r.groupId].location).name}` : `${r.day} ${r.time}` })), config, url: `${siteUrl(req)}/jfp-account/#next`, holdLabel: pr.holdLabel, fullLabel: pr.fullLabel, self: list.every((r) => r.ownContact) }))
            if (sent.emailed) emailed += 1
            else failedTo.push({ email, error: sent.emailError })
          }
        }
        await audit({ by: principal.email, action: 'next.invite', target: nt.name, after: { players: rows.length, invited, emailed, failed: failedTo.length } })
        return res.status(200).json({ success: true, invited, emailed, failed: failedTo })
      }
      case 'changePayreqAmount': return await changePayreqAmount(req, res, principal, config, body)
      // Prices and quick payment links (Lee, 13 Oct 2026).
      case 'savePrice': return await savePrice(res, principal, body)
      case 'archivePrice': return await archivePrice(res, principal, body)
      case 'quickLink': return await quickLink(req, res, principal, config, body)
      case 'emailQuickLink': return await emailQuickLink(req, res, principal, body)
      case 'quickLinkChecked': return await quickLinkChecked(res, principal, body)
      case 'offerTerm': return await offerTerm(req, res, principal, config, body)
      case 'pricing': {
        const today = sydneyToday()
        // The quote editor's Rest of term / Whole term buttons (round 2): per group, and with no group.
        const runGroups = await listGroups().catch(() => [])
        const runs = { byGroup: Object.fromEntries(runGroups.map((g) => [g.id, termRun(config, {}, g)])), noGroup: termRun(config, {}) }
        return res.status(200).json({ success: true, weeks: config.weeks, today, runs, prices: config.prices, products: PRODUCTS.map((x) => ({ ...x, cents: config.prices[x.key] })), datesByDay: Object.fromEntries(DAYS.map((d) => [d, sessionDates(config, d).map((iso) => ({ iso, label: dateLabel(iso), past: iso < today }))])), ...pricesView(config), defaultQuote: config.proQuote || null })
      }
      case 'removed': {
        // Everyone removed, why, and where they were (_jfp-removed.js).
        const players = await removedPlayers(config)
        return res.status(200).json({ success: true, reasons: LEAVE_REASONS, term: config.term, counts: reasonCounts(players, config.term), players })
      }
      // Add a removed player back: everything on file for the add form.
      case 'removedPlayer': { const out = await removedPrefill(config, body); return res.status(out.status).json(out.body) }
      case 'groups': {
        const groups = await listGroups()
        return res.status(200).json({ success: true, groups: sortGroups(groups).map((g) => ({ ...g, locationName: locationFor(config, g.location).name })), coaches: coachList(config), modes: MODES, labels: LABELS, days: DAYS.slice(0, 7), locations: config.locations.map((l) => ({ id: l.id, name: l.name, match: l.match })) })
      }
      case 'saveGroup': return await saveGroupAction(res, principal, config, body)
      case 'deleteGroup': return await deleteGroupAction(res, principal, body)
      case 'draftAges': return await draftAges(res, principal, config)

      case 'trials': return res.status(200).json({ success: true, ...(await trialsData(config, { fresh: body.fresh === true })) })
      case 'trialCount': return res.status(200).json({ success: true, newCount: (await trialsData(config)).newCount })
      case 'trialDecide': return await decideTrial(res, principal, body)
      case 'requests': {
        await sweepExpiredOffers(principal)
        const [list, groups, roster, profiles] = await Promise.all([listApplications(), listGroups(), loadRoster(), allProfiles().catch((e) => { console.error('jfp profiles read failed', e); return null })])
        const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
        const session = sessionNow(config, byId, roster, profiles)
        return res.status(200).json({ success: true, requests: list.map((r) => ({ ...r, session: ['pending', 'offered'].includes(r.status) ? session(r.groupId) : null, siblings: paidSiblings(roster.players, r.email, (r.players || []).map((p) => p.name)).map((s) => ({ name: s.name, group: byId[s.groupId] ? groupSummary(byId[s.groupId], config) : '' })), group: byId[r.groupId] ? groupSummary(byId[r.groupId], config) : r.groupId === 'one-to-one' ? '1 to 1 coaching, times on request' : r.groupId, groupLabel: byId[r.groupId]?.label || (r.groupId === 'one-to-one' ? '1 to 1' : '') })) })
      }
      case 'decideRequest': return await decideRequest(req, res, principal, config, body)
      // Book extra sessions and Book game analysis, from My account (round 3).
      case 'extraRequests': return res.status(200).json({ success: true, requests: (await listExtras()).map((r) => ({ ...r, kindLabel: EXTRA_KINDS[r.kind] || r.kind })) })
      case 'extraRequestStatus': {
        const out = await setExtraStatus({ id: body.id, status: clean(body.status, 10), by: principal.email })
        if (!out.ok) return fail(res, out.status, out.error)
        return res.status(200).json({ success: true, request: out.record })
      }

      case 'payments': {
        const [bookings, stored, viewsRaw, viewedRaw, emailedRaw, checkedRaw, roster] = await Promise.all([listBookings(), listPayreqs(), kvCommand(['HGETALL', 'jfp:payreq-views']), kvCommand(['HGETALL', 'jfp:payreq-viewed-at']), kvCommand(['HGETALL', QUICK_EMAILED]), kvCommand(['HGETALL', QUICK_CHECKED]), loadRoster()])
        // Open links at what they ask for now (a fee changed since: _jfp-fee-sync.js).
        const payreqs = await syncLinks(stored, { rowsById: new Map(roster.players.map((r) => [r.id, r])), all: stored, by: 'system: fee sync (Payment links)' })
        const pairs = (raw) => { const o = {}; for (let i = 0; i + 1 < (raw || []).length; i += 2) o[raw[i]] = raw[i + 1]; return o }
        const views = pairs(viewsRaw), viewed = pairs(viewedRaw), emailed = pairs(emailedRaw), checked = pairs(checkedRaw)
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
            id: q.id, kind: q.reason, status: q.quick && q.status === 'open' && !quickOpen(q) ? 'expired' : q.status, createdAt: q.createdAt, paidAt: q.paidAt || '', group: q.groupLabel, players: q.playerNames, amountCents: q.amountCents,
            productLabel: q.productLabel || '', startDate: q.startDate || '', trialDate: q.trialDate || '', emailedAt: q.emailedAt || '', views: Number(views[q.id] || 0), lastViewedAt: viewed[q.id] || '', expiresAt: q.expiresAt || '', afterpay: q.afterpay !== false, term4Ids: q.term4Ids,
            parentName: q.parentName, email: q.email, amountLabel: formatAud(q.paidCents ?? q.amountCents), feeLabel: q.stripeFeeCents != null ? formatAud(q.stripeFeeCents) : '',
            url: payreqUrl(req, q), stripeUrl: q.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${q.stripePaymentIntentId}` : '',
            effects: q.status === 'paid' ? effectsSummary(q, payEffectsFor(q)) : null, createdBy: q.createdBy, needsAttention: q.needsAttention || '',
            ...(repricedNote(q) ? { repricedNote: repricedNote(q) } : {}), ...(q.cancelReason ? { cancelReason: q.cancelReason } : {}), unexpected: (q.unexpectedPayments || []).map((u) => ({ reason: u.reason, amountLabel: formatAud(u.amountCents), stripeUrl: u.intentId ? `https://dashboard.stripe.com/payments/${u.intentId}` : '' })),
            // Every link has a programme; only quick links can be anything but JFP.
            programme: q.programme || 'jfp',
            ...(q.charge ? { chargeId: q.charge.id, chargeKind: q.charge.kind } : {}), ...(q.invoiceId ? { invoiceId: q.invoiceId } : {}), ...(q.noPlayerReason ? { noPlayerReason: q.noPlayerReason } : {}), ...(q.paidOffline ? { paidOffline: true, paidMethod: q.paidMethod || '' } : {}),
            ...(q.quick ? quickFields(req, q, { views: Number(views[q.id] || 0), emailedAt: emailed[q.id] || '', checkedAt: checked[q.id] || '' }) : {}),
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
        const c = await cancelLink(q, principal, 'Link cancelled')
        if (c.error) return fail(res, c.status, c.error)
        return res.status(200).json({ success: true, released: c.released })
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

      case 'money': return res.status(200).json({ success: true, money: await moneyData(config, { since: ISO.test(body.since || '') ? body.since : '', fresh: body.fresh === true, quick: body.quick === true, paint: body.quick === true }) })
      // Joners Juniors (Lee, 11 Oct 2026): its own tables and Stripe payments,
      // never added into the JFP figures above.
      case 'juniorsMoney': {
        // The Juniors term in its settings, if Juniors has it; else JFP's; else the newest.
        try { return res.status(200).json({ success: true, juniors: await jjMoneyData(config, { fresh: body.fresh === true, quick: body.quick === true }) }) } catch (error) { return fail(res, 503, error.message) }
      }
      case 'venues': {
        const v = await pastVenues(config, clean(body.term, 30))
        return v ? res.status(200).json({ success: true, venues: v }) : fail(res, 404, 'No figures for that term.')
      }
      // A whole year on Money (Lee, 12 Oct 2026): every term of it, by venue.
      case 'moneyYear': {
        const year = Number(body.year)
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail(res, 400, 'Pick a year, like 2025.')
        const y = await moneyYear(config, year, { fresh: body.fresh === true })
        return y ? res.status(200).json({ success: true, year: y }) : fail(res, 404, 'No figures for that year.')
      }
      case 'playerPayments': {
        const d = await playerPayments(config, clean(body.rowId, 30))
        return d ? res.status(200).json({ success: true, player: d }) : fail(res, 404, 'Player row not found.')
      }
      case 'recordPayment': return await recordPayment(res, principal, config, body)
      case 'saveVenueCosts': return await saveVenueCosts(res, principal, body)
      case 'recordStripeAll': return await recordStripeAll(res, principal, config)
      case 'bankCheck': return res.status(200).json({ success: true, bank: await bankCheck(config) })
      case 'bankUpload': return await bankUpload(res, principal, config, body)
      // "Check payments from the bank" (15 Oct 2026): ask the Mac for a fresh Xero pull, then poll.
      case 'bankRefresh': return await bankRefresh(res, principal)
      case 'bankRefreshStatus': return res.status(200).json({ success: true, ...(await bankRefreshState()) })
      case 'bankIgnore': return await bankIgnore(res, principal, body, false)
      case 'bankUnignore': return await bankIgnore(res, principal, body, true)
      // Holiday training and last term (Lee, 13 Oct 2026).
      case 'bankHoliday': return await bankHoliday(res, principal, config, body)
      case 'bankHolidayUndo': return await bankHolidayUndo(res, principal, body)
      case 'bankPreviousTerm': return await bankPreviousTerm(res, principal, config, body)
      case 'previousTermPlayers': {
        const term = previousTerm(config.term)
        const rows = await listPreviousTerm(term, { fresh: body.fresh === true })
        return rows ? res.status(200).json({ success: true, term, players: rows }) : fail(res, 404, `${term || 'Last term'}'s player list is not set up in the portal yet.`)
      }
      case 'holidayMoney': return res.status(200).json({ success: true, holiday: await holidayMoneyData({ period: clean(body.period, 20), fresh: body.fresh === true, quick: body.quick === true, locationOf: holidayVenue(config), today: sydneyToday() }) })
      // Pro sessions and camps (Lee, 13 Oct 2026): their own Money views.
      case 'proMoney': return res.status(200).json({ success: true, pro: await proMoneyData(config, { fresh: body.fresh === true, quick: body.quick === true, month: /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : '' }) })
      case 'bankPro': return await bankPro(res, principal, config, body)
      case 'bankProUndo': return await bankProUndo(res, principal, body)
      case 'campsMoney': {
        try { return res.status(200).json({ success: true, camps: await campsMoneyData({ year: Number(body.year) || 0, fresh: body.fresh === true }) }) } catch (error) { return fail(res, 503, error.message) }
      }
      case 'campsStripe': {
        const year = Number(body.year)
        if (!Number.isInteger(year) || year < 2020 || year > 2100) return fail(res, 400, 'Pick a year, like 2026.')
        try { return res.status(200).json({ success: true, stripe: await campsStripe({ year, fresh: body.fresh === true, quick: body.quick === true }) }) } catch (error) { return fail(res, 503, `Stripe could not be read just now (${error.message.slice(0, 80)}).`) }
      }

      // New accounts from the booking page (Lee, 16 Oct 2026): the badge and the list.
      case 'accountAlerts': return res.status(200).json({ success: true, ...(await accountAlerts(principal)) })
      case 'newAccounts': {
        const [profiles, roster] = await Promise.all([allProfiles().catch(() => []), loadRoster()])
        return res.status(200).json({ success: true, ...(await newAccountsData(principal, config, { profiles, roster, show: body.show === 'all' ? 'all' : 'new' })) })
      }
      case 'audit': return res.status(200).json({ success: true, entries: await listAudit(Number(body.limit) || 300) })

      // Hermes access (Lee, 16 Oct 2026): the switch, emails held for Lee's
      // yes, and what Hermes did. Only a signed-in person flips the switch.
      case 'agentAccess': {
        const st = (await agentState()) || {}
        const recent = (await listAudit(600)).filter((e) => e.via).slice(0, 40)
        return res.status(200).json({ success: true, agent: { set: Boolean(st.hash), enabled: Boolean(st.enabled), keySetAt: st.keySetAt || '', lastUsedAt: st.lastUsedAt || '', lastAction: st.lastAction || '', switchedAt: st.switchedAt || '', switchedBy: st.switchedBy || '' }, held: (await listHeld()).map(heldView), recent })
      }
      case 'agentSwitch': {
        if (inAgent()) return fail(res, 403, 'Hermes cannot switch its own access. Lee does that in Settings.')
        if (!(await agentState())?.hash) return fail(res, 400, 'Hermes has no key yet. Ask the JFP agent to set one up on the Mac mini.')
        await setAgentEnabled(body.enabled === true, principal.email)
        return res.status(200).json({ success: true, enabled: body.enabled === true })
      }
      case 'agentRelease': case 'agentDiscard': {
        const h = await takeHeld(body.id)
        if (!h) return fail(res, 404, 'That email was already sent or discarded.')
        if (action === 'agentDiscard') { await audit({ by: principal.email, action: 'agent.held.discard', target: h.id, after: { to: (h.to || []).map((t) => t.email), subject: h.subject } }); return res.status(200).json({ success: true }) }
        try { await sendHeldEmail(h) } catch (error) { await kvCommand(['HSET', 'jfp:agent:held', h.id, JSON.stringify(h)]); return fail(res, 502, `Not sent: ${String(error.message).slice(0, 120)}. It is still held.`) }
        await audit({ by: principal.email, action: 'agent.held.send', target: h.id, after: { to: (h.to || []).map((t) => t.email), subject: h.subject } })
        return res.status(200).json({ success: true })
      }

      // Coach alerts: the switches, who can get them, and the exact words.
      case 'coachAlerts': return res.status(200).json({ success: true, ...(await alertsStatus(config)), samples: coachAlertSamples(config) })
      case 'setCoachAlerts': {
        const cur = config.coachAlerts || {}
        const next = {
          newPlayer: typeof body.newPlayer === 'boolean' ? body.newPlayer : cur.newPlayer === true,
          register: typeof body.register === 'boolean' ? body.register : cur.register === true,
          registerSince: cur.registerSince || '',
        }
        // Switching reminders on never chases sessions that already finished.
        if (next.register && !cur.register) next.registerSince = new Date().toISOString()
        const saved = await saveConfig({ coachAlerts: next })
        await audit({ by: principal.email, action: 'coachAlerts.set', target: 'config', before: { newPlayer: cur.newPlayer === true, register: cur.register === true }, after: { newPlayer: next.newPlayer, register: next.register } })
        return res.status(200).json({ success: true, ...(await alertsStatus(saved)), samples: coachAlertSamples(saved) })
      }

      case 'getSettings': {
        const all = DAYS.slice(0, 7).flatMap((d) => sessionDates({ ...config, skipDates: [] }, d))
        const lo = all.sort()[0], hi = all.at(-1)
        return res.status(200).json({ success: true, config, holidays: NSW_HOLIDAYS.map((h) => ({ ...h, inTerm: h.date >= lo && h.date <= hi, label: dateLabel(h.date) })) })
      }
      case 'saveSettings': {
        const input = body.config || {}
        const patch = {}
        for (const k of ['passwordRequired', 'moneySince', 'waiverCarryover', 'term', 'termStart', 'weeks', 'prices', 'waiverUrl', 'staffEmails', 'superAdmins', 'coachLoginsEnabled', 'locations', 'kitUrl', 'kitNote', 'kitPriceLabel', 'skipDates', 'invoice']) if (k in input) patch[k] = input[k]
        // Invoice bank details: all three or none, typed the way the bank has them.
        if (patch.invoice) {
          const i = patch.invoice
          const dig = (v) => String(v ?? '').replace(/\D/g, '')
          if (i.bsb && dig(i.bsb).length !== 6) return fail(res, 400, 'The BSB is 6 digits, like 062-000.')
          if (i.accountNumber && (dig(i.accountNumber).length < 5 || dig(i.accountNumber).length > 12)) return fail(res, 400, 'Check the account number.')
          if (i.abn && dig(i.abn).length !== 11) return fail(res, 400, 'An ABN is 11 digits.')
          if ([i.accountName, i.bsb, i.accountNumber].some(Boolean) && ![i.accountName, i.bsb, i.accountNumber].every(Boolean)) return fail(res, 400, 'Fill in the account name, BSB and account number, or leave all three empty.')
          if (i.reference && !/<n>/.test(i.reference)) return fail(res, 400, 'The reference must have <n> in it (the invoice number), like INV-<n> <player>.')
          patch.invoice = { ...config.invoice, ...i }
        }
        if (patch.prices) patch.prices = { ...config.prices, ...patch.prices }
        if (Array.isArray(input.coaches)) {
          // Photos are saved by their own action; a settings save never drops one.
          patch.coaches = input.coaches.map((c) => ({ ...c, photoV: coachById(config, clean(c.id, 30))?.photoV || 0 }))
          const badPhone = input.coaches.find((c) => clean(c.phone, 40) && !cleanPhone(c.phone))
          if (badPhone) return fail(res, 400, `Check ${clean(badPhone.fullName || badPhone.name, 80)}'s mobile number. Use digits, like 0411 222 333.`)
          const ids = patch.coaches.map((c) => clean(c.id, 30))
          if (new Set(ids).size !== ids.length) return fail(res, 400, 'Two coaches have the same id.')
          const inUse = (await listGroups()).flatMap((g) => [g.coachId, ...(g.extraCoachIds || [])]).filter(Boolean)
          const dropped = config.coaches.filter((c) => !ids.includes(c.id) && inUse.includes(c.id))
          if (dropped.length) return fail(res, 409, `${coachLabel(dropped[0])} still runs a group. Move their groups first.`)
        }
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
