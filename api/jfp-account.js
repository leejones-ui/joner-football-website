// A signed-in family's own page: their players, groups and dates, what is
// paid, waivers, and anything staff have asked them to finish.
//
// The parent's email-code session is the key. Every row returned carries that
// email in Airtable; nothing about any other family ever leaves this file.
//
//   overview    everything above
//   signWaiver  sign the waiver for players who do not have one on file
//   pay         start Stripe Checkout for an open payment request
//   payOwed     a place with something to pay and no request yet (term fee
//               owing, session by session): make the request, then pay
//               (_jfp-account-pay.js)
//   cancelOwed  close a pay-ahead link the family made, to choose again
//   fees        Fees: what they have paid and every payment record (read only)
//   cancelSession / withdrawCancel   "Can't make a session" (KV only)
//   nextTermInterest   "I want to keep my spot" before next term opens (no payment)
//   profiles / saveProfile   Player information: club, position, contacts (Airtable)
//   jjPay / jjRequestPay / jjNextChoice   Joners Juniors (stage 2, _jj-account.js):
//               the same family login shows and pays Juniors children too
//   requestExtra  Book extra sessions / Book game analysis: a request to
//               staff (_jfp-extras.js)
import { stripeFetch, siteUrl, listSlots, getConfig as holidayConfig, slotOwners, publicSlot, signAccessCookie, accessCookieHeader } from './_holiday-store.js'
import { chargeCheckoutMeta } from './_jfp-charges.js'
import { bookableSlots, privateSlot, bookExtraPlace } from './_jfp-family-extra.js'
import {
  keys, getConfig, getGroup, listGroups, listPayreqs, getPayreq, savePayreq, listApplications, listBookings, clean, dateLabel,
  formatAud, coachById, coachByAirtableName, coachLabel, locationFor, ageOn, sydneyToday, normName, emailsIn, rowEmails, audit, closeCheckout, kvPipeline, kvCommand, CHECKOUT_EXPIRES_MINUTES, formatPhone, isSessionType, isProType,
} from './_jfp-store.js'
import { telegramAlert } from './_jfp-notify.js'
import { syncLinks, syncLink, NOTHING_OWING, PAID_ELSEWHERE } from './_jfp-fee-sync.js'
import { withPayreqLease } from './_jfp-finalise.js'
import { familyProfiles, findProfile, pickProfile, profileKey, profileView, cleanProfile, saveProfile, savePhoto, waiverPrefill, DOB_MIN, dobMax, clubSuggestions, LEVELS, PLAYING_UP, POSITIONS, FEET, YEARS } from './_jfp-profiles.js'
import { markToldAway, clearToldAway } from './_jfp-away.js'
import { listCancels, submitCancel, withdrawCancel, rowSessionDates, rowTime, noticeFor, coachesFor, coverCoachFor, familyView, cancelId, REASONS, NOTE_MAX } from './_jfp-cancel.js'
import { loadRoster, familyFor, createWaiverRows, waiverFields, bustRosterCache, updateTerm4Rows } from './_jfp-airtable.js'
import { sessionFor, sameOrigin } from './_jfp-people.js'
import { nextStatuses, setNextStatus, nextPrices, recordNext, createNextPayreq, nextInterest, interestKey } from './_jfp-next.js'
import { jjAccountView, jjPay, jjRequestPay, jjNextChoice, familyJJ, jjWaiverRows, markJJWaivers } from './_jj-account.js'
import { owedItems, payOwed as makeOwedPayreq, cancelOwed as cancelOwedPayreq } from './_jfp-account-pay.js'
import { familyFees } from './_jfp-account-fees.js'
import { docForPayreq, pdfDownload } from './_jfp-fee-pdf.js'
import { docFromRecord } from './_jfp-invoice-pdf.js'
import { calendarToken, emailForToken, familyCalendar } from './_jfp-calendar.js'
import { coveredOf } from './_jfp-quote.js'
import { accountOf, openPlayers, addMyPlayer } from './_jfp-account-open.js'
import { prepaidOf } from './_jfp-store.js'
import { announcementsFor, markAnnouncementsRead } from './_jfp-announce.js'
import { attendanceFor } from './_jfp-attendance-view.js'
import { playerLoginOf, loginsForFamily, setPlayerLogin, removePlayerLogin, PLAYER_MIN_AGE } from './_jfp-player-logins.js'
import { pushView, saveSub, dropSub, setPrefs } from './_jfp-push.js'
import { roleFor } from './_jfp-people.js'
import { familyNotesFor, markFamilyNotesRead } from './_jfp-family-notes.js'
import { reportsForFamily, familyView as reportFamilyView, readSetFor, markReportsRead, getReport, REPORT_ATTRS, REPORT_SCALE } from './_jfp-reports.js'
import { submitExtra, listExtras, familyExtraView, analysisPrice, extraSlots, DAYS as EXTRA_DAYS, TIMES as EXTRA_TIMES, TYPES as EXTRA_TYPES } from './_jfp-extras.js'
// Saved card or bank account for session payments (claude/card-on-file).
import { SAVED_PAY_FAMILY, savedPayFamily } from './_jfp-saved-pay.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }
const ISO = /^\d{4}-\d{2}-\d{2}$/
const phoneOk = (v) => String(v || '').replace(/\D/g, '').length >= 8

// Dates of birth a family gave us in an application, waitlist or enquiry,
// for players whose Airtable rows do not carry one yet.
function dobsFrom(requests, email) {
  const out = new Map()
  for (const r of requests) if (r.email === email) for (const p of r.players || []) if (p.dob && !out.has(normName(p.name))) out.set(normName(p.name), p.dob)
  return out
}
function withDobs(fam, dobs, termStart) {
  for (const p of fam.players) {
    if (p.dob || !dobs.has(p.key)) continue
    p.dob = dobs.get(p.key)
    p.age = ageOn(p.dob, termStart) ?? p.age
  }
  return fam
}

// A payment request belongs to the family when it went to any of their
// addresses (both parents), written however Airtable had it at the time.
// A quick link is paid on its own page (/jfp-pay/), never from the account.
function ownsPayreq(q, fam, email) {
  const mine = new Set([email, ...(fam?.emails || [])])
  return Boolean(q) && !q.quick && emailsIn(q.email).some((e) => mine.has(e))
}

// My sessions, session by session players (round 2, 14 Oct 2026): which
// dates are paid. Paid: a committed date ([COVERED:]) or a date on a paid
// pay-ahead link; open: on a link not paid yet. Sessions prepaid with no
// dates (an older [PREPAID:n]) mark the next unpaid dates still to come.
// Anything else is billed after it happens.
export function sessionMarks(row, payreqs, upcomingIsos = []) {
  const paid = new Set(coveredOf(row.notes))
  const open = new Set()
  for (const q of payreqs) {
    if (q.prepay?.rowId !== row.id) continue
    if (q.status === 'paid') for (const d of q.prepay.dates || []) paid.add(d)
    else if (['open', 'checkout'].includes(q.status)) for (const d of q.prepay.dates || []) open.add(d)
  }
  let extra = Math.max(0, prepaidOf(row.notes) - paid.size)
  for (const d of upcomingIsos) { if (extra <= 0) break; if (!paid.has(d) && !open.has(d)) { paid.add(d); extra -= 1 } }
  return { paidDates: [...paid].sort(), openDates: [...open].sort() }
}

function paymentLine(row, openReq, owed) {
  if (openReq) return { state: 'due', label: `${formatAud(openReq.amountCents)} to pay`, payreqId: openReq.id }
  // Owing with no link yet: the Pay step on Home makes one (_jfp-account-pay.js).
  if (owed?.amountCents) return { state: 'due', label: `${owed.amountLabel} to pay` }
  if (/trial/i.test(row.paymentType)) return { state: 'trial', label: row.paymentStatus === 'Paid' ? 'Trial booked and paid' : 'Trial' }
  // Pros and casuals pay for the sessions they come to (billed from Money).
  if (isProType(row.paymentType)) return { state: 'sessions', label: 'Pro sessions, paid by the session' }
  if (isSessionType(row.paymentType)) return { state: 'sessions', label: 'Session by session' }
  if (row.paymentStatus === 'Paid') return { state: 'paid', label: 'Paid' }
  // Legacy rows can carry sibling splits and agreed plans, so no amount is
  // shown until staff raise a payment request.
  return { state: 'arranged', label: 'Payment arranged with Joner Football' }
}

async function overview(res, parent, body = {}, opts = {}) {
  // Read marks (announcements, coach notes) belong to whoever is signed in:
  // a player with their own login keeps their own (player logins).
  const readEmail = opts.readEmail || parent.email
  const config = await getConfig()
  const [roster, groups, payreqs, requests, bookings, allCancels] = await Promise.all([loadRoster(), listGroups(), listPayreqs(), listApplications(), listBookings(), listCancels()])
  const nowMs = Date.now()
  // Only this family's own cancellations are ever read out of the list.
  const myCancels = allCancels.filter((c) => c.email === parent.email && c.status === 'active')
  const fam = withDobs(familyFor(parent.email, roster, config.termStart), dobsFrom(requests, parent.email), config.termStart)
  // Each open link at what the place owes now (a fee changed since it was
  // made, _jfp-fee-sync.js); one left with nothing owing is gone.
  const famRows = new Map(fam.players.flatMap((p) => p.term4).map((r) => [r.id, r]))
  const mine = (await syncLinks(payreqs.filter((p) => ownsPayreq(p, fam, parent.email) && p.status !== 'cancelled'), { rowsById: famRows, all: payreqs, by: 'system: fee sync (My account)' })).filter((p) => p.status !== 'cancelled')
  // Opened from a payment link: staff see that the family has looked at it.
  const opened = mine.find((q) => q.id === clean(body.pay, 60) && ['open', 'checkout'].includes(q.status))
  // Counted on its own key, never by rewriting the payment record, so a
  // payment being recorded at the same moment can never be undone.
  if (opened) await kvPipeline([['HINCRBY', 'jfp:payreq-views', opened.id, '1'], ['HSET', 'jfp:payreq-viewed-at', opened.id, new Date().toISOString()]])
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, g]))
  // Joners Juniors children on the same login (null for a JFP-only family).
  const juniors = await jjAccountView({ config, parentEmail: parent.email, fam, roster, pay: body.pay })
  // A Juniors child with a family waiver would otherwise also show as a JFP
  // player with no sessions: they show once, under Joners Juniors.
  const jjNames = new Set((juniors?.children || []).map((c) => normName(c.name)))
  const jfpPlayers = fam.players.filter((p) => !(jjNames.has(p.key) && !p.term4.length))
  // Saved photos, and whether the account holder is the player (Pros, adults).
  const profs = await familyProfiles(parent.email).catch(() => [])
  const profOf = (p) => (p.term4.length ? pickProfile(profs, { key: profileKey(p.name, p.term4[0].email || parent.email), rowIds: p.term4.map((r) => r.id) }) : null)
  // Players added from the account with no session yet (round 2 item 8).
  const account = await accountOf(parent.email)
  const open = openPlayers({ fam, profs, account }).filter((o) => !jfpPlayers.some((p) => p.key === o.key))
  // Anything owing on a place with no open payment request (term fee, or
  // session by session): a Pay step, made into a request when they tap it.
  const owed = owedItems({ config, players: jfpPlayers, payreqs: mine, byGroup, cancels: myCancels, nowMs })
  const owedByRow = new Map(owed.map((x) => [x.rowId, x]))
  // Attendance (Lee, 17 Oct 2026): the coach's register for every session
  // already run, one read for the whole family. A failed read shows none.
  const attAsk = []
  for (const p of jfpPlayers) for (const r of p.term4) if (r.holdsPlace && r.groupId) {
    const g = byGroup[r.groupId] || null
    for (const d of rowSessionDates(config, r, g)) { const n = noticeFor({ date: d, time: rowTime(r, g), nowMs }); if (n && n.startMs <= nowMs) attAsk.push([r.id, r.groupId, d]) }
  }
  let attVals = []
  try { attVals = attAsk.length ? await kvPipeline(attAsk.map(([id, gid, d]) => ['HGET', keys.attendance(gid, d), id])) : [] } catch (error) { console.error('jfp attendance read failed', error) }
  const attOf = new Map(attAsk.map(([id, , d], i) => [`${id}|${d}`, attVals[i] || '']))
  const logins = opts.player ? [] : await loginsForFamily(fam.emails).catch(() => [])
  const players = jfpPlayers.map((p) => ({
    key: p.key,
    name: p.name,
    age: p.age,
    self: isSelf(p, fam, profOf(p)?.dob),
    // Which waiver they sign: the adult one (18 or over, for themselves) or
    // the parent or guardian one. The sheet changes if a date of birth typed
    // in says otherwise; the server decides again when it is signed.
    adult: adultFor(p, fam, profOf(p)?.dob),
    photo: profOf(p)?.photo || '',
    needsDob: !p.dob && !profOf(p)?.dob,
    // Player logins (12+): their own sign in, set by the parent.
    login: (logins.find((x) => x.playerKey === p.key) || {}).email || '',
    waiver: p.waiver ? { onFile: true, signedDate: p.waiver.signedDate, term: p.waiver.term, kind: p.waiver.kind || '' } : { onFile: false },
    // A place staff have confirmed but not yet given a day and time.
    placeNoSession: p.term4.some((r) => r.holdsPlace && !r.groupId),
    ownContact: p.term4.length > 0 && p.term4.every((r) => r.ownContact),
    enrolments: p.term4.filter((r) => r.holdsPlace && r.groupId).map((r) => {
      const g = byGroup[r.groupId] || { day: r.day, time: r.time, location: r.location, durationMin: 60 }
      const loc = locationFor(config, r.location)
      // Mid term joiners and trials: only their own dates.
      const dates = rowSessionDates(config, r, byGroup[r.groupId] || null)
      // Sessions still to come, each with its start (Sydney time) so the page
      // can offer "Can't make a session" and show how soon the next one is.
      const mineCancelled = new Map(myCancels.filter((c) => c.rowId === r.id).map((c) => [c.date, c]))
      const time = rowTime(r, byGroup[r.groupId] || null)
      const sessions = dates.map((d) => ({ d, n: noticeFor({ date: d, time, nowMs }) })).filter((x) => x.n && x.n.startMs > nowMs)
        .map(({ d, n }) => ({ iso: d, label: dateLabel(d), startMs: n.startMs, cancelled: mineCancelled.has(d) ? cancelId(r.id, d) : '' }))
      const openReq = mine.find((q) => ['open', 'checkout'].includes(q.status) && q.term4Ids.includes(r.id))
      const sessionPay = isSessionType(r.paymentType) && !/trial/i.test(r.paymentType || '')
      return {
        ...(sessionPay ? { sessionPay: true, isoDates: dates, ...sessionMarks(r, mine, sessions.map((x) => x.iso)) } : {}),
        rowId: r.id, day: r.day, time: r.time, location: loc.name, address: loc.address, maps: loc.maps,
        locationId: loc.id, photo: loc.photo || '', durationMin: Number(g.durationMin) || 60,
        // No coach name for families (Lee, 14 Oct 2026): time, place and money only.
        status: r.confirmation || 'Confirmed',
        dates: dates.map(dateLabel), firstDate: dates[0] ? dateLabel(dates[0]) : '',
        payment: paymentLine(r, openReq, owedByRow.get(r.id)),
        attendance: attendanceFor(dates, (d) => attOf.get(`${r.id}|${d}`)),
        sessions,
        // Coach mobiles, only where one has been entered. Never an email.
        contacts: coachesFor(config, r, byGroup[r.groupId] || null).filter((c) => c.phone).map((c) => ({ name: 'Coach', phone: formatPhone(c.phone), tel: c.phone })),
        cancelled: [...mineCancelled.values()].filter((c) => c.startMs > nowMs).sort((a, b) => a.startMs - b.startMs).map(familyView),
      }
    }),
  }))
  for (const o of open) {
    const age = ageOn(o.profile.dob || '', sydneyToday())
    players.push({ key: o.key, name: o.name, age, self: o.self, adult: age != null ? age >= 18 : o.self, photo: o.profile.photo || '', needsDob: !o.profile.dob, waiver: { onFile: false }, placeNoSession: false, ownContact: o.self, enrolments: [], noSession: true })
  }
  for (const p of players) if (!p.enrolments.length && !p.placeNoSession) p.noSession = true
  const rowsById = new Map(fam.players.flatMap((p) => p.term4).map((r) => [r.id, r]))
  const todo = mine.filter((q) => ['open', 'checkout'].includes(q.status)).map((q) => {
    const blockers = q.playerKeys.filter((k) => !fam.players.find((p) => p.key === k)?.waiver)
    return {
      needsKit: kitRequired(q), kit: kitDone(q, rowsById),
      id: q.id, amountLabel: formatAud(q.amountCents), players: q.playerNames, reason: q.reason, group: q.groupLabel || '', needsWaiver: blockers.length > 0, expiresAt: q.expiresAt || '',
      what: q.reason === 'trial' ? `Trial session${q.trialDate ? `, ${dateLabel(q.trialDate)}` : ''}` : q.product === 'halfTerm' && q.startDate ? `Half term, 5 sessions from ${dateLabel(q.startDate)}` : q.startDate ? `From ${dateLabel(q.startDate)} to the end of term${q.creditCents ? `, ${formatAud(q.creditCents)} trial taken off` : ''}` : '',
      afterpay: q.afterpay !== false,
      // Made from My account to pay ahead: the family can close it and choose again.
      ...(q.fromAccount && q.prepay ? { canChoose: true } : {}),
      // A family invoice: each place and what it costs.
      places: ['family', 'sessions'].includes(q.reason) && Array.isArray(q.places) ? q.places.map((x) => ({ name: x.name, label: x.label, amountLabel: formatAud(x.owingCents) })) : [],
    }
  })
  // Next term: this family's invited players and where each one stands.
  const nt = config.nextTerm
  const statuses = await nextStatuses(nt.name)
  const nextTerm = fam.players.flatMap((p) => p.term4.filter((r) => r.holdsPlace && (nt.open || statuses[r.id])).map((r) => {
    const g = byGroup[r.groupId]
    const st = statuses[r.id] || { status: 'invited' }
    const pr = nextPrices(config, g)
    const open = st.payreqId ? mine.find((q) => q.id === st.payreqId && ['open', 'checkout'].includes(q.status)) : null
    return { rowId: r.id, player: r.player, group: g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : `${r.day} ${r.time}`, dayTime: g ? `${g.day} ${g.time}` : [r.day, r.time].filter(Boolean).join(' '), status: st.status, holdLabel: pr.holdLabel, fullLabel: pr.fullLabel, afterHoldLabel: st.status === 'held' ? formatAud(Math.max(0, pr.fullCents - (st.paidCents || 0))) : pr.afterHoldLabel, openPayreqId: open?.id || '' }
  }))
  // "Keep my spot" (Lee, 13 Oct 2026): every family sees next term coming,
  // with their current spots, even before it opens. Before it opens they can
  // say they want to keep it; nothing is paid or promised until it opens.
  const interest = await nextInterest(nt.name)
  const keep = {
    name: nt.name, open: Boolean(nt.open), holdLabel: formatAud(nt.holdCents),
    // The deposit card (Fees and Home, only while staff have it open): held
    // for current players until this date, when staff set one.
    holdUntil: nt.holdUntil || '', holdUntilLabel: nt.holdUntil ? dateLabel(nt.holdUntil) : '',
    players: fam.players.flatMap((p) => p.term4.filter((r) => r.holdsPlace && r.groupId).map((r) => {
      const g = byGroup[r.groupId]
      return { rowId: r.id, player: r.player, group: g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : `${r.day} ${r.time}`, status: statuses[r.id]?.status || '', interested: Boolean(interest[r.id]) }
    })),
  }
  // Announcements (Lee, 17 Oct 2026): notices for everyone, this family's
  // locations or groups. Read only; a failed read shows none, never an error.
  const myRows = fam.players.flatMap((p) => p.term4)
  const announcements = await announcementsFor({ groupIds: myRows.map((r) => r.groupId), locationIds: myRows.map((r) => locationFor(config, r.location).id), email: readEmail })
  // Coach notes for this family's players (Lee, 17 Oct 2026), from "Coach".
  const notes = await familyNotesFor(myRows.map((r) => r.id), readEmail)
  // Player reports (Lee, 18 Oct 2026): a short list for the menu count; the
  // reports themselves load when the tab opens.
  const reports = opts.player ? [] : await reportsSummary(parent.email, null)
  return res.status(200).json({
    success: true,
    email: parent.email,
    announcements,
    notes,
    reports,
    playerMinAge: PLAYER_MIN_AGE,
    push: await pushView(readEmail).then((x) => ({ available: Boolean(x.available), key: x.key || '' })).catch((error) => { console.error('jfp push view failed', error); return { available: false, key: '' } }),
    parentName: fam.parentName || juniors?.parentName || '',
    // The player is their own contact (no parent): the page talks to them.
    self: !juniors?.children?.length && ((fam.players.length > 0 && fam.players.every((p) => p.term4.length > 0 && p.term4.every((r) => r.ownContact))) || (!fam.players.some((p) => p.term4.length) && open.length > 0 && open.every((o) => o.self))),
    // Anyone can have an account (round 2 item 8): where to book a first session.
    bookUrl: '/jfp-booking/',
    nextTerm: nextTerm.length ? { name: nt.name, players: nextTerm } : null,
    keep,
    termStart: config.termStart,
    weeks: Number(config.weeks) || 10,
    venues: (config.locations || []).map((l) => ({ id: l.id, name: l.name, address: l.address || '', maps: l.maps || '', photo: l.photo || '', blurb: l.blurb || '' })),
    term: config.term,
    waiverVersion: config.waiverVersion,
    kitUrl: config.kitUrl,
    kitPriceLabel: config.kitPriceLabel,
    players,
    todo,
    // Order on sign in (Lee, 13 Oct 2026): 1 waiver, 2 pay, 3 player details.
    owed,
    reasons: Object.entries(REASONS).map(([key, label]) => ({ key, label })),
    noteMax: NOTE_MAX,
    paid: mine.filter((q) => q.status === 'paid').map((q) => ({ id: q.id, amountLabel: formatAud(q.paidCents ?? q.amountCents), players: q.playerNames, paidAt: q.paidAt })),
    requests: requests.filter((r) => r.email === parent.email).map((r) => ({ id: r.id, kind: r.kind, status: r.status, offer: r.offer || '', players: r.players.map((x) => x.name), group: byGroup[r.groupId] ? `${byGroup[r.groupId].day} ${byGroup[r.groupId].time}, ${locationFor(config, byGroup[r.groupId].location).name}` : r.groupId === 'one-to-one' ? '1 to 1 coaching' : '', createdAt: r.createdAt })),
    bookings: bookings.filter((b) => b.email === parent.email && b.status === 'paid').map((b) => ({ id: b.id, players: b.players.map((x) => x.name), amountLabel: formatAud(b.amountPaidCents ?? b.priceCents), paidAt: b.paidAt })),
    juniors,
    // Book extra sessions and Book game analysis (round 3).
    extras: await extrasView(config, parent.email),
  })
}

// What the two booking pages need: the game analysis price if Lee set one,
// whether holiday training slots are open, slots to book (none yet), and
// this family's own requests.
async function extrasView(config, email) {
  const [holiday, mine, seen] = await Promise.all([
    holidaySessions().catch((e) => { console.error('jfp account holiday sessions failed', e); return { label: '', sessions: [] } }),
    listExtras().then((l) => l.filter((r) => r.email === email).slice(0, 10).map(familyExtraView)).catch(() => []),
    sessionsSeen(email),
  ])
  const price = analysisPrice(config)
  // Extra sessions coaches opened to book now (money engineer, _jfp-family-extra.js).
  const bookable = await bookableSlots(config)
  return { analysisPriceLabel: price?.label || '', holidaySlots: holiday.sessions.filter((s) => !s.full).length, holiday, seen, slots: extraSlots(), bookable, days: EXTRA_DAYS, times: EXTRA_TIMES, types: EXTRA_TYPES, mine }
}

// Holiday training sessions still to come (Lee, 19 Oct 2026: show what is on
// at the top of the tab). The same list the holiday booking page shows, but no
// coach names and no bookings, only whether a time is taken.
const HOLIDAY_SHOW = 60
async function holidaySessions() {
  const hc = await holidayConfig()
  const cutoffMs = Date.now() + hc.bookingCutoffHours * 3_600_000
  const active = new Set(hc.coaches.filter((c) => c.active).map((c) => c.id))
  const slots = (await listSlots()).filter((x) => x.status !== 'cancelled' && active.has(x.coachId) && new Date(x.startsAt).getTime() > cutoffMs)
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))).slice(0, HOLIDAY_SHOW)
  const owners = await slotOwners(slots.map((x) => x.id))
  const sessions = slots.map((x) => {
    const v = publicSlot(x, hc, owners[x.id])
    const prices = v.options.map((o) => o.priceCents).filter((c) => c > 0)
    return {
      id: v.id, date: v.date, dateLabel: v.dateLabel, time: `${v.startLabel} to ${v.endLabel}`, durationMin: v.durationMin,
      typeLabel: v.title || v.typeLabel || 'Holiday session', full: Boolean(v.booked), ...(v.shared ? { placesLeft: v.remaining } : {}),
      fromLabel: prices.length ? formatAud(Math.min(...prices)) : '', createdAt: x.createdAt || '',
    }
  })
  return { label: hc.holidayLabel, where: hc.defaultLocation || '', sessions }
}

// New sessions to book (Lee, 19 Oct 2026): when this family last opened Book
// extra sessions and Holiday training. Anything added since shows as a red
// number and a pop up. { extra: iso, holiday: iso }, nothing yet = all new.
const SEEN_KEY = 'jfp:sessions-seen'
async function sessionsSeen(email) {
  try { return JSON.parse((await kvCommand(['HGET', SEEN_KEY, email])) || '{}') || {} } catch { return {} }
}
async function markSessionsSeen(res, parent, body) {
  const kinds = (Array.isArray(body.kinds) ? body.kinds : [body.kind]).filter((k) => ['extra', 'holiday'].includes(k))
  if (!kinds.length) return fail(res, 400, 'Nothing to mark.')
  const seen = await sessionsSeen(parent.email)
  const now = new Date().toISOString()
  for (const k of kinds) seen[k] = now
  await kvCommand(['HSET', SEEN_KEY, parent.email, JSON.stringify(seen)])
  return res.status(200).json({ success: true, seen })
}

// Book holiday training from My account: a JFP family goes straight in, no
// shared password (Lee, 19 Oct 2026). Families with no JFP player still use
// the password from their message.
async function holidayAccess(res, parent) {
  const config = await getConfig()
  const fam = familyFor(parent.email, await loadRoster(), config.termStart)
  if (!fam.players.some((p) => p.term4.length)) return fail(res, 403, 'Holiday booking from here is for JFP families. Use the password from your Joner Football message on the holiday booking page.', { code: 'password' })
  if (!process.env.HOLIDAY_BOOKING_PASSWORD || !process.env.HOLIDAY_SIGNING_SECRET) return fail(res, 503, 'Holiday bookings are not open yet.')
  res.setHeader('Set-Cookie', accessCookieHeader(signAccessCookie()))
  return res.status(200).json({ success: true, url: '/holiday-bookings/' })
}

async function requestExtra(res, parent, body) {
  const config = await getConfig()
  const fam = familyFor(parent.email, await loadRoster(), config.termStart)
  const profs = await familyProfiles(parent.email).catch(() => [])
  const open = openPlayers({ fam, profs, account: await accountOf(parent.email) })
  const players = [...fam.players.map((p) => p.name), ...open.map((o) => o.name)]
  const out = await submitExtra({ config, parent, parentName: fam.parentName, players, kind: clean(body.kind, 20), body })
  if (!out.ok) return fail(res, out.status, out.error)
  return res.status(200).json({ success: true, request: familyExtraView(out.record), emailed: out.record.deliveries.staff === 'sent' })
}

// "Can't make a session": saved in KV only, the coach(es) and the team told.
// The row must carry this family's email in Airtable, the date must be a real
// upcoming session for that row, and the same session is only ever cancelled
// once (see _jfp-cancel.js).
// Families are never told a coach's name (Lee, 14 Oct 2026: morning groups
// rotate coaches): "your coach", with the mobile where there is one.
function toldCoaches(config, rec) {
  return (rec.coachIds || []).map((id) => coachById(config, id)).filter(Boolean).map((c) => ({ name: 'Your coach', ...(c.phone ? { phone: formatPhone(c.phone), tel: c.phone } : {}) }))
}

async function cancelSession(res, parent, body) {
  const config = await getConfig()
  const roster = await loadRoster({ fresh: true })
  const fam = familyFor(parent.email, roster, config.termStart)
  const row = fam.players.flatMap((p) => p.term4).find((r) => r.id === clean(body.rowId, 30) && r.holdsPlace && r.groupId)
  const group = row ? await getGroup(row.groupId) : null
  const date = clean(body.date, 10)
  const out = await submitCancel({
    config, parentEmail: parent.email, parentName: fam.parentName, row, group, date,
    reason: clean(body.reason, 20), note: typeof body.note === 'string' ? body.note : '',
    coverCoachId: group ? await coverCoachFor(group.id, date) : '',
  })
  if (!out.ok) return fail(res, out.status, out.error, out.code ? { code: out.code } : {})
  // The register shows them Away (told us) for that date.
  if (out.record.status === 'active') await markToldAway({ config, group, rec: out.record }).catch((e) => console.error('jfp told-away failed', e))
  // Who heard (round 3): the coach taking the session and Ligia (staff).
  // A coach who is also on the staff email counts as told by that one.
  const d = out.record.deliveries || {}
  const coachTold = (out.record.coachIds || []).some((id) => d[`coach:${id}`] === 'sent' || (d[`coach:${id}`] === 'skipped' && Boolean(coachById(config, id)?.email) && d.staff === 'sent'))
  return res.status(200).json({ success: true, already: out.already, cancellation: familyView(out.record), told: toldCoaches(config, out.record), toldWho: { coach: coachTold, staff: d.staff === 'sent' } })
}

async function withdrawSession(res, parent, body) {
  const config = await getConfig()
  const out = await withdrawCancel({ config, parentEmail: parent.email, id: clean(body.id, 40) })
  if (!out.ok) return fail(res, out.status, out.error, out.code ? { code: out.code } : {})
  if (out.record?.status === 'withdrawn') await clearToldAway({ config, group: await getGroup(out.record.groupId), rec: out.record }).catch((e) => console.error('jfp told-away clear failed', e))
  return res.status(200).json({ success: true, already: out.already })
}

async function signWaiver(res, parent, body) {
  const config = await getConfig()
  const roster = await loadRoster({ fresh: true })
  const fam = withDobs(familyFor(parent.email, roster, config.termStart), dobsFrom(await listApplications(), parent.email), config.termStart)
  const a = body.waiver?.accepted || {}
  if (!(a.terms && a.makeups && a.payment && a.emergency)) return fail(res, 400, 'Tick each part of the waiver to continue.')
  const profs = await familyProfiles(parent.email).catch(() => [])
  const signature = clean(body.waiver?.signature, 100)
  if (signature.length < 3) return fail(res, 400, 'Type your full name to sign the waiver.')
  const parentName = clean(body.parentName, 100) || fam.parentName
  const mobile = clean(body.mobile, 40) || fam.mobile
  if (parentName.length < 2 || !phoneOk(mobile)) return fail(res, 400, 'Enter your name and mobile.')
  const all = Array.isArray(body.players) ? body.players.slice(0, 6) : []
  if (!all.length) return fail(res, 400, 'Choose the players to sign for.')
  const acceptedAt = new Date().toISOString()
  const rows = []
  // Joners Juniors children ("jj:<row id>"): the same family waiver.
  const jjList = all.filter((x) => String(x?.key || '').startsWith('jj:'))
  const list = all.filter((x) => !String(x?.key || '').startsWith('jj:'))
  let jjRowIds = []
  if (jjList.length) {
    const f = await familyJJ(config, parent.email, fam)
    if (!f) return fail(res, 404, 'We could not find that child on your account.')
    const j = jjWaiverRows({ config, list: jjList, f, roster, parent, parentName, mobile, signature, acceptedAt, media: body.waiver?.media === true, waiverFields, phoneOk })
    if (j.error) return fail(res, j.status, j.error)
    rows.push(...j.rows); jjRowIds = j.rowIds
  }
  // Players added from the account with no session can sign too (round 2 item 8).
  const open = list.some((x) => !fam.players.some((f) => f.key === clean(x.key, 80))) ? openPlayers({ fam, profs, account: await accountOf(parent.email) }) : []
  for (const x of list) {
    const o = open.find((f) => f.key === clean(x.key, 80))
    const p = fam.players.find((f) => f.key === clean(x.key, 80)) || (o ? { key: o.key, name: o.name, dob: o.profile.dob || '', waiver: null, term4: [] } : null)
    if (!p) return fail(res, 404, 'We could not find that player on your account.')
    if (p.waiver) continue
    // The date of birth staff saved on the player information counts too.
    const prof = p.term4.length ? pickProfile(profs, { key: profileKey(p.name, p.term4[0].email || parent.email), rowIds: p.term4.map((r) => r.id) }) : null
    const dob = p.dob || (ISO.test(prof?.dob || '') ? prof.dob : '') || clean(x.dob, 10)
    if (!ISO.test(dob) || ageOn(dob, config.termStart) == null) return fail(res, 400, `Enter ${p.name}'s date of birth.`)
    const emergencyName = clean(x.emergencyName, 100), emergencyPhone = clean(x.emergencyPhone, 40)
    if (emergencyName.length < 2 || !phoneOk(emergencyPhone)) return fail(res, 400, `Add an emergency contact for ${p.name}.`)
    // 18 or over by date of birth: the adult waiver, signed by the player.
    // Under 18: always the parent or guardian waiver.
    const kind = adultFor(p, fam, prof?.dob, dob) ? 'adult' : 'guardian'
    if (kind === 'adult' && a.adult !== true) return fail(res, 400, `Tick "I am 18 or over and I'm signing for myself" to sign ${p.name}'s waiver.`, { code: 'adult' })
    if (kind === 'guardian' && body.waiver?.kind === 'adult') return fail(res, 400, `${p.name} is under 18, so a parent or guardian signs. Close this and sign again.`, { code: 'guardian' })
    rows.push(waiverFields({
      player: { name: p.name, dob, club: clean(x.club, 120), medical: clean(x.medical, 500), emergencyName, emergencyPhone, ...(kind === 'adult' ? { mobile } : {}) },
      parent: { name: parentName, email: parent.email, mobile }, config, signature, acceptedAt, media: body.waiver?.media === true, kind,
    }))
  }
  if (!rows.length) return res.status(200).json({ success: true, created: 0 })
  const ids = await createWaiverRows(rows)
  await bustRosterCache()
  if (jjRowIds.length) await markJJWaivers(config, jjRowIds, parentName)
  await audit({ by: parent.email, action: 'waiver.signed', target: ids.join(','), after: { players: rows.map((r) => r['Player Full Name']), kinds: rows.map((r) => (/\[WAIVER:adult\]/.test(r['Internal Notes'] || '') ? 'adult' : 'guardian')) } })
  return res.status(200).json({ success: true, created: ids.length })
}

async function nextTermInterest(res, parent, body) {
  const config = await getConfig()
  const nt = config.nextTerm
  const roster = await loadRoster()
  const row = roster.players.find((r) => r.id === clean(body.rowId, 30) && rowEmails(r).includes(parent.email) && r.holdsPlace)
  if (!row) return fail(res, 404, 'We could not find that player on your account.')
  const first = await kvCommand(['HSETNX', interestKey(nt.name), row.id, JSON.stringify({ email: parent.email, at: new Date().toISOString() })])
  // Staff hear once per player. Test rows stay quiet.
  if (Number(first) === 1 && !/test/i.test(row.player)) {
    const group = row.groupId ? await getGroup(row.groupId) : null
    const where = group ? `${group.day} ${group.time}, ${locationFor(config, group.location).name}` : 'no group yet'
    await recordNext({ term: nt.name, row, group, status: 'interested', by: parent.email }).catch((e) => console.error('jfp next interest airtable failed', e))
    await telegramAlert(`Keep my spot, ${nt.name}: ${row.player} (${where}) wants to keep their place.`)
  }
  await audit({ by: parent.email, action: 'next.interest', target: row.id, after: { term: nt.name, first: Number(first) === 1 } })
  return res.status(200).json({ success: true })
}

// ---------- player information ----------

// Is the person signed in the player themselves? A Pro or an adult player has
// their own account: their name is the contact name, they are 18 or over, or
// the row has no parent at all. Then the page says "My profile", not "Your players".
const bareName = (n) => normName(String(n || '').replace(/\([^)]*\)/g, ' '))
function isSelf(p, fam, profileDob = '') {
  // Staff ticked "Player is their own contact" when adding them: that decides.
  if (p.term4.length && p.term4.every((r) => r.ownContact)) return true
  const age = ageOn(profileDob || p.dob || '', sydneyToday())
  if (age != null && age >= 18) return true
  if (!fam.parentName) return fam.players.filter((x) => x.term4.length).length === 1
  return bareName(p.name) === bareName(fam.parentName)
}

// The adult waiver or the parent or guardian one. A date of birth decides
// (18 or over on the day they sign); with none on file yet, isSelf() does
// (their own contact, or the account is theirs), and the date of birth they
// type on the waiver settles it when they sign.
function adultFor(p, fam, profileDob = '', typedDob = '') {
  const age = ageOn(typedDob || profileDob || p.dob || '', sydneyToday())
  if (age != null) return age >= 18
  return isSelf(p, fam, profileDob)
}

// This family's current players, each with their saved profile or, the first
// time, what their waiver already told us (club, emergency contact).
async function profiles(res, parent) {
  const config = await getConfig()
  const roster = await loadRoster()
  const fam = familyFor(parent.email, roster, config.termStart)
  const mine = await familyProfiles(parent.email)
  const players = []
  // Players added from the account with no session: their profile as it is.
  const open = openPlayers({ fam, profs: mine, account: await accountOf(parent.email) })
  for (const o of open) players.push({ key: o.key, name: o.name, age: ageOn(o.profile.dob || '', sydneyToday()), self: o.self, noSession: true, profile: profileView(o.profile), prefill: { dob: o.profile.dob || '', parentName: o.profile.parentName || '', parentMobile: o.profile.parentMobile || '' } })
  for (const p of fam.players.filter((x) => x.term4.length)) {
    const rowIds = p.term4.map((r) => r.id)
    const key = profileKey(p.name, p.term4[0].email || parent.email)
    const prof = pickProfile(mine, { key, rowIds }) || await findProfile({ key, rowIds })
    const prefill = prof ? {} : await waiverPrefill(p.waiver?.id)
    players.push({ key: p.key, name: p.name, age: p.age, self: isSelf(p, fam, prof?.dob), profile: profileView(prof), prefill: { ...prefill, dob: prefill.dob || p.dob || '', parentName: prefill.parentName || fam.parentName || '', parentMobile: prefill.parentMobile || fam.mobile || '' } })
  }
  players.sort((a, b) => a.name.localeCompare(b.name))
  return res.status(200).json({ success: true, players, dob: { min: DOB_MIN, max: dobMax() }, options: { levels: LEVELS, playingUp: PLAYING_UP, positions: POSITIONS, feet: FEET, years: YEARS, clubs: clubSuggestions(roster.waivers) } })
}

async function saveMyProfile(res, parent, body) {
  const config = await getConfig()
  const roster = await loadRoster({ fresh: true })
  const fam = familyFor(parent.email, roster, config.termStart)
  const p = fam.players.find((x) => x.key === clean(body.playerKey, 80) && x.term4.length)
  if (!p) return saveOpenProfile(res, parent, fam, body)
  const { values, errors } = cleanProfile(body.values || {})
  if (errors.length) return fail(res, 400, errors.join(' '))
  const rowIds = p.term4.map((r) => r.id)
  const key = profileKey(p.name, p.term4[0].email || parent.email)
  const existing = pickProfile(await familyProfiles(parent.email), { key, rowIds }) || await findProfile({ key, rowIds })
  const saved = await saveProfile({ existing, name: p.name, key, emails: [...new Set([parent.email, ...p.term4.flatMap(rowEmails)])], rowIds, values, by: parent.email, from: 'Family account' })
  return res.status(200).json({ success: true, profile: profileView(saved) })
}

// Player information for a player added from the account with no session
// (round 2 item 8): the same checks, their own profile row, never Term 4.
async function saveOpenProfile(res, parent, fam, body) {
  const o = openPlayers({ fam, profs: await familyProfiles(parent.email), account: await accountOf(parent.email) }).find((x) => x.key === clean(body.playerKey, 80))
  if (!o) return fail(res, 404, 'We could not find that player on your account.')
  const { values, errors } = cleanProfile(body.values || {})
  if (errors.length) return fail(res, 400, errors.join(' '))
  const saved = await saveProfile({ existing: o.profile, name: o.name, key: o.profile.key, emails: [parent.email], rowIds: [], values, by: parent.email, from: 'Family account' })
  return res.status(200).json({ success: true, profile: profileView(saved) })
}

// "Add a player" in My account: a profile, no session and no place.
async function addPlayerAction(res, parent, body) {
  const config = await getConfig()
  const fam = familyFor(parent.email, await loadRoster({ fresh: true }), config.termStart)
  const out = await addMyPlayer({ email: parent.email, fam, body })
  if (!out.ok) return fail(res, out.status, out.error, out.code ? { code: out.code } : {})
  return res.status(200).json({ success: true, key: out.key, profile: profileView(out.profile) })
}

// A profile photo, from My account. Saved on the player's Airtable profile.
async function saveMyPhoto(res, parent, body) {
  const config = await getConfig()
  const roster = await loadRoster()
  const fam = familyFor(parent.email, roster, config.termStart)
  const p = fam.players.find((x) => x.key === clean(body.playerKey, 80) && x.term4.length)
  if (!p) {
    // A player added from the account with no session: their own profile.
    const o = openPlayers({ fam, profs: await familyProfiles(parent.email), account: await accountOf(parent.email) }).find((x) => x.key === clean(body.playerKey, 80))
    if (!o) return fail(res, 404, 'We could not find that player on your account.')
    const out = await savePhoto({ existing: o.profile, name: o.name, key: o.profile.key, emails: [parent.email], rowIds: [], dataUrl: body.image, remove: body.remove === true, by: parent.email, from: 'Family account' })
    if (out.error) return fail(res, 400, out.error)
    return res.status(200).json({ success: true, profile: profileView(out.profile) })
  }
  const rowIds = p.term4.map((r) => r.id)
  const key = profileKey(p.name, p.term4[0].email || parent.email)
  const existing = pickProfile(await familyProfiles(parent.email), { key, rowIds }) || await findProfile({ key, rowIds })
  const out = await savePhoto({ existing, name: p.name, key, emails: [...new Set([parent.email, ...p.term4.flatMap(rowEmails)])], rowIds, dataUrl: body.image, remove: body.remove === true, by: parent.email, from: 'Family account' })
  if (out.error) return fail(res, 400, out.error)
  return res.status(200).json({ success: true, profile: profileView(out.profile) })
}

// Hold the place, pay next term in full, or say not returning.
async function nextTermChoice(req, res, parent, body) {
  const config = await getConfig()
  const nt = config.nextTerm
  const choice = ['hold', 'full', 'no'].includes(body.choice) ? body.choice : ''
  if (!choice) return fail(res, 400, 'Choose hold, pay in full or not returning.')
  const roster = await loadRoster({ fresh: true })
  const row = roster.players.find((r) => r.id === clean(body.rowId, 30) && rowEmails(r).includes(parent.email) && r.holdsPlace)
  if (!row) return fail(res, 404, 'We could not find that player on your account.')
  // One choice at a time per player (two tabs, a double tap).
  const lock = `jfp:next-lock:${row.id}`
  if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '20'])) !== 'OK') return fail(res, 409, 'Just a moment, that is still being saved.')
  try {
  const statuses = await nextStatuses(nt.name)
  const st = statuses[row.id]
  if (!nt.open && !st) return fail(res, 403, `${nt.name} places are not open yet.`)
  if (st && ['held', 'paid'].includes(st.status) && choice !== 'full') return fail(res, 409, `${row.player}'s place is already ${st.status === 'held' ? 'held' : 'paid'}.`)
  if (st?.status === 'paid') return fail(res, 409, `${row.player} is already paid for ${nt.name}.`)
  const group = row.groupId ? await getGroup(row.groupId) : null
  // Any open next-term link for this player closes before a new choice.
  const existing = st?.payreqId ? await getPayreq(st.payreqId) : null
  if (existing && ['open', 'checkout'].includes(existing.status) && !(choice !== 'no' && existing.next?.choice === choice)) {
    const closed = existing.status === 'checkout' ? await closeCheckout(existing.stripeSessionId) : 'expired'
    if (closed !== 'expired') return fail(res, 409, 'A payment is already on its way. Refresh in a minute.')
    await savePayreq({ ...existing, status: 'cancelled', cancelledBy: parent.email, cancelledAt: new Date().toISOString() })
  }
  if (choice === 'no') {
    if (st && ['held', 'paid'].includes(st.status)) return fail(res, 409, 'This place is already paid for. Contact Joner Football to cancel it.')
    await setNextStatus(nt.name, row.id, { status: 'no' })
    await recordNext({ term: nt.name, row, group, status: 'no', note: clean(body.note, 300), by: parent.email })
    return res.status(200).json({ success: true, status: 'no' })
  }
  // Reuse an open link for the same choice rather than making a second one.
  if (existing && ['open', 'checkout'].includes(existing.status) && existing.next?.choice === choice) return res.status(200).json({ success: true, payreqId: existing.id })
  const q = await createNextPayreq({ config, row, group, choice, siteUrl: siteUrl(req) })
  // A held place paying the rest: charge the full price less the hold paid,
  // and keep that hold on the link so the total is always recorded right.
  if (choice === 'full' && st?.status === 'held') await savePayreq({ ...q, amountCents: Math.max(100, q.next.fullCents - (st.paidCents || 0)), next: { ...q.next, holdPaidCents: st.paidCents || 0 }, productLabel: `${nt.name}, the rest of the term` })
  await setNextStatus(nt.name, row.id, { ...(st || {}), status: st?.status === 'held' ? 'held' : 'invited', payreqId: q.id, paidCents: st?.paidCents || 0 })
  await audit({ by: parent.email, action: `next.choose.${choice}`, target: row.id, after: { payreq: q.id } })
  return res.status(200).json({ success: true, payreqId: q.id })
  } finally { await kvCommand(['DEL', lock]) }
}

// The JF playing kit is required for a place in the program (Lee, 30 Sept).
// A trial is one session, and next term's players already have it.
// Session by session players already train with us: no kit step.
// Player charges and invoices (money engineer, 14 Oct 2026) need no kit step either.
function kitRequired(q) { return q.reason !== 'trial' && q.reason !== 'sessions' && q.reason !== 'charge' && q.reason !== 'invoice' && !q.next }
function kitDone(q, rowsById) {
  if (q.kit) return q.kit
  const rows = (q.term4Ids || []).map((id) => rowsById?.get(id)).filter(Boolean)
  return rows.length && rows.every((r) => r.kit) ? rows[0].kit : ''
}
const KIT = { ordered: 'Ordered', has: 'Already has one' }

async function confirmKit(res, parent, body) {
  const q = await getPayreq(body.payreqId)
  if (!q || !ownsPayreq(q, familyFor(parent.email, await loadRoster(), (await getConfig()).termStart), parent.email)) return fail(res, 404, 'We could not find that payment.')
  const choice = KIT[body.kit] ? body.kit : ''
  if (!choice) return fail(res, 400, 'Choose one: ordered, or already has one.')
  q.kit = KIT[choice]
  q.kitAt = new Date().toISOString()
  await savePayreq(q)
  // On the player's Term 4 row, so Lee sees it in Airtable and the portal.
  // The payment still goes ahead if Airtable is slow: the link keeps it too.
  const ids = (q.term4Ids || []).filter(Boolean)
  if (ids.length) {
    try { await updateTerm4Rows(ids.map((id) => ({ id, fields: { 'Training Kit': q.kit } }))) } catch (error) { console.error('jfp kit airtable failed', q.id, error) }
  }
  await audit({ by: parent.email, action: 'kit.confirm', target: q.id, after: { kit: q.kit, players: q.playerNames } })
  return res.status(200).json({ success: true, kit: q.kit })
}

// A family invoice shows each place on Stripe's page; anything else (or an
// invoice whose amount staff changed) is one line.
function lineItems(q, name) {
  const places = ['family', 'sessions'].includes(q.reason) && Array.isArray(q.places) ? q.places : []
  const list = places.length >= (q.reason === 'sessions' ? 1 : 2) && places.reduce((t, x) => t + x.owingCents, 0) === q.amountCents
    ? places.map((x) => ({ cents: x.owingCents, name: `JFP: ${x.name}, ${x.label}` }))
    : [{ cents: q.amountCents, name }]
  const out = {}
  list.forEach((x, i) => {
    out[`line_items[${i}][quantity]`] = '1'
    out[`line_items[${i}][price_data][currency]`] = 'aud'
    out[`line_items[${i}][price_data][unit_amount]`] = String(x.cents)
    out[`line_items[${i}][price_data][product_data][name]`] = x.name.slice(0, 250)
  })
  return out
}

// Pay for a place with no payment request yet (term fee owing, session by
// session). Makes the request (or hands back the open one), then the same
// checkout as pay().
async function payOwed(req, res, parent, body) {
  const config = await getConfig()
  const [roster, groups, allCancels] = await Promise.all([loadRoster({ fresh: true }), listGroups(), listCancels()])
  const fam = familyFor(parent.email, roster, config.termStart)
  const out = await makeOwedPayreq({
    config, parent, fam, byGroup: Object.fromEntries(groups.map((g) => [g.id, g])),
    cancels: allCancels.filter((c) => c.email === parent.email && c.status === 'active'),
    site: siteUrl(req), body,
  })
  if (!out.ok) return fail(res, out.status, out.error, out.code ? { code: out.code } : {})
  return pay(req, res, parent, { payreqId: out.payreqId })
}

async function pay(req, res, parent, body) {
  const found = await getPayreq(body.payreqId)
  if (!found || !ownsPayreq(found, familyFor(parent.email, await loadRoster(), (await getConfig()).termStart), parent.email)) return fail(res, 404, 'We could not find that payment.')
  // What the place owes now, from fresh Airtable rows, before Stripe is asked
  // for anything: a fee changed since the link was made moves it first.
  const q = await syncLink(found, { by: 'system: fee sync (Pay)' })
  if (q.status === 'cancelled' && [NOTHING_OWING, PAID_ELSEWHERE].includes(q.cancelReason)) return fail(res, 409, q.cancelReason === NOTHING_OWING ? 'There is nothing to pay on this any more: the fee was changed. Your account is up to date.' : 'There is nothing to pay on this any more: it is already paid. Your account is up to date.', { code: 'nothing' })
  if (q.status === 'paid') return fail(res, 409, 'This is already paid.', { code: 'paid' })
  if (!['open', 'checkout'].includes(q.status)) return fail(res, 410, 'This payment is no longer open. Contact Joner Football.')
  if (q.expiresAt && Date.parse(q.expiresAt) < Date.now()) return fail(res, 410, 'This payment link has expired. Contact Joner Football and we will send a new one.')
  const config = await getConfig()
  const roster = await loadRoster({ fresh: true })
  const fam = familyFor(parent.email, roster, config.termStart)
  const missing = q.playerKeys.filter((k) => !fam.players.find((p) => p.key === k)?.waiver)
  if (missing.length) return fail(res, 400, 'Sign the waiver for each player first.', { code: 'waiver' })
  if (kitRequired(q) && !kitDone(q, new Map(fam.players.flatMap((p) => p.term4).map((r) => [r.id, r])))) return fail(res, 400, 'Confirm the JF playing kit first. It is required for every player.', { code: 'kit' })
  // Paying again after going back from Stripe: close the first page before
  // opening a second, so one request can never be paid twice.
  if (q.status === 'checkout' && q.stripeSessionId) {
    const closed = await closeCheckout(q.stripeSessionId)
    if (closed === 'complete') return fail(res, 409, 'This payment has gone through and is being processed. Refresh in a minute.', { code: 'processing' })
    if (closed === 'error') return fail(res, 503, 'Could not check your earlier payment. Try again in a minute.')
  }
  const group = q.groupId ? await getGroup(q.groupId) : null
  const base = siteUrl(req)
  const name = `${q.reason === 'trial' ? 'JFP trial' : q.next ? `${q.productLabel || q.next.term}` : config.term}: ${q.playerNames.join(', ')}${group ? `, ${group.day} ${group.time}` : ''}${q.reason === 'trial' && q.trialDate ? `, ${dateLabel(q.trialDate)}` : ''}`
  const session = await stripeFetch('/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment',
      customer_email: q.email,
      expires_at: String(Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRES_MINUTES * 60),
      // Paid: the thank you page, which points them to the training kit.
      success_url: `${base}/jfp-booking/success/?pay=${encodeURIComponent(q.id)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/jfp-account/`,
      ...lineItems(q, name),
      // Card only when staff turned Afterpay off for this link.
      ...(q.afterpay === false ? { 'payment_method_types[0]': 'card' } : {}),
      'metadata[jfpBookingId]': q.id,
      'metadata[source]': q.reason || 'payreq',
      // Next term paid early names its term, so Money keeps it out of this term.
      ...(q.next?.term ? { 'metadata[jfpTerm]': q.next.term } : {}),
      // A Pro sessions player's link: recognisable as Pro money. Not
      // jfpProgramme, so it stays where JFP links go until Money splits it.
      ...(q.programme === 'pro' ? { 'metadata[jfpProduct]': 'pro', 'payment_intent_data[metadata][jfpProduct]': 'pro' } : {}),
      'payment_intent_data[metadata][jfpBookingId]': q.id,
      // The player, and a charge's or invoice's own program (money engineer, 14 Oct 2026).
      ...chargeCheckoutMeta(q),
      'payment_intent_data[description]': name.slice(0, 400),
    },
  })
  // Staff may have changed the amount (or a fee) while this page was opening.
  // Saved under the payment lease, so a reprice never lands in between.
  const saved = await withPayreqLease(q.id, async () => {
    const now = await getPayreq(q.id)
    if (!now || now.amountCents !== q.amountCents || !['open', 'checkout'].includes(now.status)) return false
    await savePayreq({ ...now, status: 'checkout', stripeSessionId: session.id, siteUrl: base })
    return true
  })
  if (saved !== true) {
    await closeCheckout(session.id)
    return fail(res, 409, 'This payment was just updated. Refresh the page and try again.', { code: 'changed' })
  }
  return res.status(200).json({ success: true, url: session.url })
}

// Fees (14 Oct 2026): what this family has paid and every payment record
// (_jfp-account-fees.js). Read only.
async function fees(res, parent) {
  const config = await getConfig()
  const [roster, groups, payreqs] = await Promise.all([loadRoster(), listGroups(), listPayreqs()])
  const fam = familyFor(parent.email, roster, config.termStart)
  const { intentIds, ...view } = await familyFees({ config, parent, fam, payreqs: payreqs.filter((q) => ownsPayreq(q, fam, parent.email)), groups })
  return res.status(200).json({ success: true, fees: view })
}

// The PDF tax invoice for one of this family's own payment requests (Fees,
// Lee 16 Oct 2026). Anyone else's, a quick link or a cancelled one: not found.
// A receipt PDF for one of this family's own payment records (Lee, 17 Oct 2026).
async function receiptPdf(res, parent, body) {
  const config = await getConfig()
  const [roster, groups, payreqs] = await Promise.all([loadRoster(), listGroups(), listPayreqs()])
  const fam = familyFor(parent.email, roster, config.termStart)
  const view = await familyFees({ config, parent, fam, payreqs: payreqs.filter((q) => ownsPayreq(q, fam, parent.email)), groups })
  const r = (view.records || []).find((x) => x.id && x.id === clean(body.id, 120))
  if (!r) return fail(res, 404, 'Receipt not found.')
  const name = fam.parentName || fam.players?.[0]?.name || ''
  return res.status(200).json({ success: true, ...(await pdfDownload(docFromRecord(r, config, { name, email: parent.email }))) })
}

async function invoicePdf(req, res, parent, body) {
  const config = await getConfig()
  const q = await getPayreq(clean(body.payreqId, 60))
  const fam = familyFor(parent.email, await loadRoster(), config.termStart)
  if (!q || q.status === 'cancelled' || !ownsPayreq(q, fam, parent.email)) return fail(res, 404, 'Invoice not found.')
  return res.status(200).json({ success: true, ...(await pdfDownload(await docForPayreq(q, config, siteUrl(req)))) })
}

// Close a pay-ahead link the family made, so they can choose another option.
async function cancelOwed(res, parent, body) {
  const config = await getConfig()
  const fam = familyFor(parent.email, await loadRoster({ fresh: true }), config.termStart)
  const out = await cancelOwedPayreq({ parent, fam, body })
  if (!out.ok) return fail(res, out.status, out.error, out.code ? { code: out.code } : {})
  return res.status(200).json({ success: true })
}

// Joners Juniors: pay, ask to pay, next term (_jj-account.js).
async function juniorsAction(req, res, parent, body) {
  const config = await getConfig()
  const roster = await loadRoster({ fresh: body.action === 'jjPay' })
  const fam = familyFor(parent.email, roster, config.termStart)
  const ctx = { config, parent, fam, roster, body }
  const r = body.action === 'jjPay' ? await jjPay(req, ctx) : body.action === 'jjRequestPay' ? await jjRequestPay(req, ctx) : await jjNextChoice(req, ctx)
  if (!r.ok) return fail(res, r.status, r.error, r.code ? { code: r.code } : {})
  const { ok, ...rest } = r
  return res.status(200).json({ success: true, ...rest })
}


// ---------- player logins (Lee, 17 Oct 2026: 12+, sessions, attendance, coach notes) ----------

async function playerLoginAction(res, parent, body) {
  const config = await getConfig()
  const roster = await loadRoster()
  const fam = familyFor(parent.email, roster, config.termStart)
  const player = fam.players.find((p) => p.key === clean(body.playerKey, 80) && p.term4.some((r) => r.holdsPlace))
  if (!player) return fail(res, 404, 'That player is not on your account.')
  if (body.action === 'playerLoginRemove') { await removePlayerLogin({ parent, fam, playerKey: player.key }); return res.status(200).json({ success: true }) }
  const profs = await familyProfiles(parent.email).catch(() => [])
  const prof = pickProfile(profs, { key: profileKey(player.name, player.term4[0].email || parent.email), rowIds: player.term4.map((r) => r.id) })
  const dob = prof?.dob || player.dob || ''
  const age = dob ? ageOn(dob, sydneyToday()) : null
  const e = String(body.email || '').trim().toLowerCase()
  const r = await setPlayerLogin({ parent, fam, player, age, email: e, isStaffEmail: Boolean(roleFor(e, config)), isFamilyEmail: familyFor(e, roster, config.termStart).players.length > 0 })
  if (r.error) return fail(res, 400, r.error)
  return res.status(200).json({ success: true, login: r.login.email })
}

// Player reports (Lee, 18 Oct 2026): the reports sent to this family, newest
// first. A player login sees only their own. Read only, plus "opened".
async function reportsScope(email, login) {
  const config = await getConfig()
  if (login) {
    const fam = familyFor(login.parentEmail, await loadRoster(), config.termStart)
    const rows = fam.players.find((p) => p.key === login.playerKey)?.term4 || []
    return { email: login.email, rowIds: rows.map((r) => r.id), playerKey: login.playerKey, parentEmail: login.parentEmail }
  }
  const fam = familyFor(email, await loadRoster(), config.termStart)
  return { email, rowIds: fam.players.flatMap((p) => p.term4).map((r) => r.id) }
}
async function myReports(email, login) {
  const scope = await reportsScope(email, login)
  const list = await reportsForFamily(scope)
  const read = await readSetFor(scope.email, list.map((r) => r.id))
  return { list, read, scope }
}
async function reportsSummary(email, login) {
  try {
    const { list, read } = await myReports(email, login)
    return list.slice(0, 60).map((r) => ({ id: r.id, player: r.player, termNo: r.termNo, year: r.year, sentAt: r.sentAt, unread: !read.has(r.id) }))
  } catch (error) { console.error('jfp reports summary failed', error); return [] }
}
async function reportsAction(res, email, login, body) {
  const { list, read, scope } = await myReports(email, login)
  if (body.action === 'reports') return res.status(200).json({ success: true, reports: list.map((r) => reportFamilyView(r, read)), form: { attrs: REPORT_ATTRS, scale: REPORT_SCALE } })
  if (body.action === 'reportRead') return res.status(200).json({ success: true, read: await markReportsRead(scope.email, body.ids, new Set(list.map((r) => r.id))) })
  // reportPdf: only a report this family can see.
  const id = clean(body.id, 40)
  if (!list.some((r) => r.id === id)) return fail(res, 404, 'That report is not in your account.')
  const rec = await getReport(id)
  try {
    const { renderReportPdf, reportFilename } = await import('./_jfp-report-pdf.js')
    const bytes = await renderReportPdf(rec)
    await markReportsRead(scope.email, [id], new Set([id]))
    return res.status(200).json({ success: true, filename: reportFilename(rec), pdf: Buffer.from(bytes).toString('base64') })
  } catch (error) {
    console.error('jfp report pdf failed', error)
    return fail(res, 500, 'The PDF could not be made just now. Try again in a moment.')
  }
}
const REPORT_FAMILY = new Set(['reports', 'reportRead', 'reportPdf'])

// The player's own view: the family overview cut down to them. No money,
// no brothers or sisters, no parent name or contacts.
async function playerView(login) {
  let out = null
  const cap = { c: 200, status(c) { this.c = c; return this }, json(d) { out = { c: this.c, d } }, setHeader() { return this } }
  await overview(cap, { email: login.parentEmail }, {}, { readEmail: login.email, player: true })
  if (!out?.d?.success) return out || { c: 500, d: { success: false, error: 'Could not load your account.' } }
  const d = out.d
  const config = await getConfig()
  const fam = familyFor(login.parentEmail, await loadRoster(), config.termStart)
  const rows = (fam.players.find((p) => p.key === login.playerKey)?.term4 || []).filter((r) => r.holdsPlace)
  const rowIds = new Set(rows.map((r) => r.id))
  const players = d.players.filter((p) => p.key === login.playerKey).map((p) => ({
    key: p.key, name: p.name, age: p.age, self: true, photo: p.photo, adult: p.adult, needsDob: false, waiver: { onFile: true }, placeNoSession: p.placeNoSession, noSession: p.noSession, ownContact: true, login: '',
    enrolments: p.enrolments.map(({ payment, sessionPay, paidDates, openDates, ...e }) => e),
  }))
  return { c: 200, d: {
    success: true, playerLogin: true, email: login.email, parentName: '', self: true, players,
    announcements: await announcementsFor({ groupIds: rows.map((r) => r.groupId), locationIds: rows.map((r) => locationFor(config, r.location).id), email: login.email }),
    notes: (d.notes || []).filter((n) => rowIds.has(n.rowId)),
    reports: await reportsSummary(login.email, login),
    push: d.push, term: d.term, termStart: d.termStart, weeks: d.weeks, venues: d.venues, reasons: d.reasons, noteMax: d.noteMax,
    todo: [], owed: [], paid: [], requests: [], bookings: [], juniors: null, nextTerm: null, keep: { name: d.keep?.name || '', open: false, players: [] }, extras: null,
  }, rowIds }
}

async function playerAction(req, res, login, body) {
  const a = body.action
  if (!a || a === 'overview') { const v = await playerView(login); return res.status(v.c).json(v.d) }
  if (a === 'announceRead') return res.status(200).json({ success: true, read: await markAnnouncementsRead(login.email, body.ids) })
  if (REPORT_FAMILY.has(a)) return await reportsAction(res, login.email, login, body)
  if (a === 'calendarLink') { const t = await calendarToken(login.email); return res.status(200).json({ success: true, url: `${siteUrl(req)}/api/jfp-account?cal=${t}` }) }
  const v = await playerView(login)
  if (a === 'noteRead') return res.status(200).json({ success: true, read: await markFamilyNotesRead(login.email, body.ids, v.rowIds || new Set()) })
  // Can't make it: only their own sessions; saved under the family, so the parent sees it too.
  if (a === 'cancelSession') {
    if (!v.rowIds?.has(clean(body.rowId, 30))) return fail(res, 404, 'That session is not yours.')
    return await cancelSession(res, { email: login.parentEmail }, body)
  }
  if (a === 'withdrawCancel') {
    const c = (await listCancels()).find((x) => x.id === clean(body.id, 40))
    if (!c || !v.rowIds?.has(c.rowId)) return fail(res, 404, 'That session is not yours.')
    return await withdrawSession(res, { email: login.parentEmail }, body)
  }
  return fail(res, 403, 'Ask your parent to do this from their account.', { code: 'parent-only' })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // The calendar feed (GET ?cal=<token>): a phone calendar reads it, no sign in.
  if (req.method === 'GET' && req.query?.cal) {
    try {
      const email = await emailForToken(req.query.cal)
      if (!email) return res.status(404).end('Not found')
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
      res.setHeader('Content-Disposition', 'inline; filename="jfp-sessions.ics"')
      return res.status(200).end(await familyCalendar(email))
    } catch (error) { console.error('jfp calendar failed', error); return res.status(500).end('Try again soon') }
  }
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  if (!sameOrigin(req)) return fail(res, 403, 'Invalid request origin')
  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }
  try {
    const parent = await sessionFor(req, 'parent')
    if (!parent) return fail(res, 401, 'Sign in with your email to continue.', { code: 'signin' })
    // Push notifications (Lee, 17 Oct 2026): this device on or off, and the switches.
    if (body.action === 'pushState') return res.status(200).json({ success: true, push: await pushView(parent.email, String(body.endpoint || '')) })
    if (body.action === 'pushSubscribe') { const r = await saveSub(parent.email, body.sub, req.headers?.['user-agent']); if (r.error) return fail(res, 400, r.error); return res.status(200).json({ success: true, push: await pushView(parent.email, body.sub.endpoint) }) }
    if (body.action === 'pushUnsubscribe') { await dropSub(parent.email, String(body.endpoint || '')); return res.status(200).json({ success: true, push: await pushView(parent.email, '') }) }
    if (body.action === 'pushPrefs') { await setPrefs(parent.email, body.prefs || {}); return res.status(200).json({ success: true, push: await pushView(parent.email, String(body.endpoint || '')) }) }
    // A player's own login (12+): only their own things, never money.
    const login = await playerLoginOf(parent.email)
    if (login) return await playerAction(req, res, login, body)
    if (body.action === 'playerLoginSet' || body.action === 'playerLoginRemove') return await playerLoginAction(res, parent, body)
    if (body.action === 'announceRead') return res.status(200).json({ success: true, read: await markAnnouncementsRead(parent.email, body.ids) })
    if (REPORT_FAMILY.has(body.action)) return await reportsAction(res, parent.email, null, body)
    if (body.action === 'noteRead') { const config = await getConfig(); const rows = familyFor(parent.email, await loadRoster(), config.termStart).players.flatMap((p) => p.term4); return res.status(200).json({ success: true, read: await markFamilyNotesRead(parent.email, body.ids, new Set(rows.map((r) => r.id))) }) }
    if (body.action === 'signWaiver') return await signWaiver(res, parent, body)
    if (body.action === 'confirmKit') return await confirmKit(res, parent, body)
    if (body.action === 'pay') return await pay(req, res, parent, body)
    if (body.action === 'payOwed') return await payOwed(req, res, parent, body)
    if (body.action === 'cancelOwed') return await cancelOwed(res, parent, body)
    if (body.action === 'fees') return await fees(res, parent)
    if (body.action === 'calendarLink') { const t = await calendarToken(parent.email); return res.status(200).json({ success: true, url: `${siteUrl(req)}/api/jfp-account?cal=${t}` }) }
    if (body.action === 'receiptPdf') return await receiptPdf(res, parent, body)
    if (body.action === 'invoicePdf') return await invoicePdf(req, res, parent, body)
    if (body.action === 'nextTermChoice') return await nextTermChoice(req, res, parent, body)
    if (body.action === 'nextTermInterest') return await nextTermInterest(res, parent, body)
    if (body.action === 'profiles') return await profiles(res, parent)
    if (body.action === 'saveProfile') return await saveMyProfile(res, parent, body)
    if (body.action === 'savePhoto') return await saveMyPhoto(res, parent, body)
    if (body.action === 'addPlayer') return await addPlayerAction(res, parent, body)
    if (['jjPay', 'jjRequestPay', 'jjNextChoice'].includes(body.action)) return await juniorsAction(req, res, parent, body)
    if (body.action === 'cancelSession') return await cancelSession(res, parent, body)
    if (body.action === 'withdrawCancel') return await withdrawSession(res, parent, body)
    if (body.action === 'requestExtra') return await requestExtra(res, parent, body)
    if (body.action === 'holidayAccess') return await holidayAccess(res, parent)
    if (body.action === 'sessionsSeen') return await markSessionsSeen(res, parent, body)
    // Book an extra session: hold the place, make the charge, then pay (money engineer).
    if (body.action === 'extraSlot') { const s = await privateSlot(await getConfig(), { slotId: body.slotId, token: body.k }); return s ? res.status(200).json({ success: true, slot: s }) : fail(res, 404, 'That session is not open to book, or the link is not right.') }
    if (body.action === 'bookExtra') {
      const config = await getConfig()
      const fam = familyFor(parent.email, await loadRoster({ fresh: true }), config.termStart)
      const r = await bookExtraPlace({ config, parent, fam, body, siteUrl: siteUrl(req) })
      if (!r.ok) return fail(res, r.status, r.error, r.code ? { code: r.code } : {})
      if (r.paid) return res.status(200).json({ success: true, paid: true, payreqId: r.payreqId })
      return await pay(req, res, parent, { payreqId: r.payreqId })
    }
    // Saved card or bank account (claude/card-on-file): Fees > save, replace, remove.
    if (SAVED_PAY_FAMILY.has(body.action)) { const config = await getConfig(); return await savedPayFamily(req, res, parent, body, { config, fam: familyFor(parent.email, await loadRoster(), config.termStart) }) }
    return await overview(res, parent, body)
  } catch (error) {
    console.error('jfp-account failed', error)
    return fail(res, 500, 'Something went wrong. Try again in a moment.')
  }
}

export { normName }
