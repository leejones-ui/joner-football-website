// A family books a JFP group, applies for one, joins a waitlist or enquires.
//
//   reserve  -> (signed in) holds 1 place for 15 minutes; a parent can hold a few at once, not every group
//   family   -> (signed in) the players on this email, with ages and waivers
//   submit   -> (signed in) checks every player fits, resizes the hold to the
//               number of players, creates the Stripe Checkout Session
//   release  -> hands the places back (closed form, back from Stripe)
//   request  -> (signed in) application, waitlist or enquiry. No payment.
//
// Every action sits behind the shared booking password. Anything that reads
// or writes a family's details also needs the parent's email-code sign-in,
// and only ever sees players whose Airtable rows carry that email.
import crypto from 'node:crypto'
import { rateLimit, verifyRecaptcha } from './_security.js'
import { stripeFetch, siteUrl } from './_holiday-store.js'
import {
  requireParentAccess, getConfig, getGroup, getBooking, saveBooking, indexBooking, newId, clean, holdPlaces, releasePlaces,
  onlineCounts, placesLeft, tokenMatches, saveApplication, coachById, sessionDates, dateLabel, ageOn, ageFits, normName,
  locationFor, ONE_TO_ONE, closeCheckout, parentHoldCount, noteParentHold, dropParentHold, MAX_HOLDS_PER_PARENT, RESERVE_MINUTES, HOLD_MINUTES, CHECKOUT_EXPIRES_MINUTES, MAX_PLAYERS,
} from './_jfp-store.js'
import { loadRoster, countsFrom, familyFor } from './_jfp-airtable.js'
import { sessionFor, sameOrigin } from './_jfp-people.js'
import { sendRequestReceived, sendRequestAlert } from './_jfp-email.js'
import { captureWebsiteContact } from './_master-contact-capture.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }

const ISO = /^\d{4}-\d{2}-\d{2}$/
const phoneOk = (v) => String(v || '').replace(/\D/g, '').length >= 8

async function placesFor(group) {
  const roster = await loadRoster()
  const counts = countsFrom(roster)
  const online = (await onlineCounts([group.id]))[group.id] || 0
  return { roster, taken: counts[group.id] || 0, left: placesLeft(group, counts[group.id], online) }
}

// Who is this parent allowed to book for, and does each player fit?
function familyView(family, group, config, roster) {
  return family.players.map((p) => {
    const inGroup = p.term4.some((r) => r.groupId === group.id && r.holdsPlace)
    return {
      key: p.key,
      name: p.name,
      age: p.age,
      needsDob: p.age == null,
      waiverOnFile: Boolean(p.waiver),
      waiverSigned: p.waiver?.signedDate || '',
      inGroup,
      fits: p.age == null ? null : ageFits(group, p.age, config),
      groups: p.term4.filter((r) => r.holdsPlace).map((r) => `${r.day} ${r.time}, ${locationFor(config, r.location).name}`),
    }
  })
}

// Validate the players a parent picked or added. Returns { players } or { error }.
function checkPlayers(input, { family, group, config, requireWaiver, waiver, roster }) {
  const list = Array.isArray(input) ? input.slice(0, MAX_PLAYERS) : []
  if (!list.length) return { error: 'Choose at least one player.' }
  const seen = new Set()
  const players = []
  for (const x of list) {
    const existing = x.key ? family.players.find((p) => p.key === clean(x.key, 80)) : null
    if (x.key && !existing) return { error: 'We could not find that player on your account. Sign in with the email we have on file.' }
    const name = existing ? existing.name : clean(x.name, 80)
    if (!existing && (name.length < 3 || !/\s/.test(name))) return { error: 'Enter each new player\'s first and last name.' }
    const k = normName(name)
    if (seen.has(k)) return { error: `${name} is listed twice.` }
    seen.add(k)
    if (!existing && family.players.some((p) => p.key === k)) return { error: `${name} is already on your account. Pick them from your players instead.` }
    const dob = clean(x.dob, 10)
    if ((!existing || existing.age == null) && !ISO.test(dob)) return { error: `Enter ${name}'s date of birth.` }
    const age = existing?.age ?? ageOn(dob, config.termStart)
    if (age == null) return { error: `Check ${name}'s date of birth.` }
    if (!ageFits(group, age, config)) {
      return { error: `${name} is ${age} on the first day of term. This group is for ages ${group.minAge ?? config.minAge} to ${group.maxAge ?? config.maxAge}. Filter by age to see the groups that fit.`, code: 'age' }
    }
    if (existing?.term4.some((r) => r.groupId === group.id && r.holdsPlace)) return { error: `${name} is already in this group.` }
    const needsWaiver = !existing?.waiver
    const details = {
      club: clean(x.club, 120), medical: clean(x.medical, 500),
      emergencyName: clean(x.emergencyName, 100), emergencyPhone: clean(x.emergencyPhone, 40), mobile: clean(x.playerMobile, 40),
    }
    if (needsWaiver && requireWaiver) {
      if (details.emergencyName.length < 2 || !phoneOk(details.emergencyPhone)) return { error: `Add an emergency contact name and phone for ${name}.` }
      if (!waiver) return { error: 'Sign the waiver to continue.', code: 'waiver' }
    }
    const sourceTerm3 = existing ? (roster.term3.find((r) => normName(r.player) === k && r.emails.some((e) => family.emails.includes(e)))?.id || '') : ''
    players.push({
      name, age, dob: existing?.dob || dob || '', isNew: !existing, sourceTerm3, ...details,
      waiver: needsWaiver && waiver ? waiver : null,
    })
  }
  return { players }
}

// The waiver the parent signed on the page, the same clauses as the Airtable form.
function checkWaiver(input, parentName) {
  if (!input) return { waiver: null }
  const a = input.accepted || {}
  if (!(a.terms && a.makeups && a.payment && a.emergency)) return { error: 'Tick each part of the waiver to continue.' }
  const signature = clean(input.signature, 100)
  if (signature.length < 3) return { error: 'Type your full name to sign the waiver.' }
  return { waiver: { signature, acceptedAt: new Date().toISOString(), media: input.media === true, signedBy: parentName } }
}

async function reserve(req, res, body, parent) {
  if (!rateLimit(req, { key: 'jfp-reserve', limit: 12, windowMs: 60_000 }).allowed) return fail(res, 429, 'Too many tries. Wait a minute and try again.')
  const rc = await verifyRecaptcha(req, body.recaptchaToken)
  if (!rc.ok) return fail(res, 400, rc.error)
  if ((await parentHoldCount(parent.email)) >= MAX_HOLDS_PER_PARENT) return fail(res, 429, 'You are holding places in other groups. Finish or close those bookings first.', { code: 'too_many_holds' })
  const group = await getGroup(body.groupId)
  if (!group || group.mode !== 'direct') return fail(res, 404, 'That group is not taking online bookings.', { code: 'not_bookable' })
  let snap
  try { snap = await placesFor(group) } catch { return fail(res, 503, 'Bookings are briefly unavailable. Try again in a minute.') }
  const nowMs = Date.now()
  const id = newId('JFP')
  const expiresMs = nowMs + RESERVE_MINUTES * 60_000
  const ok = await holdPlaces({ gid: group.id, bookingId: id, want: 1, available: Math.max(0, group.capacity - snap.taken), expiresMs, nowMs })
  if (!ok) return fail(res, 409, 'That group has just filled. You can join the waitlist instead.', { code: 'full' })
  const releaseToken = crypto.randomBytes(16).toString('hex')
  await saveBooking({ id, groupId: group.id, seats: 1, status: 'reserving', email: parent.email, releaseToken, holdExpiresAt: new Date(expiresMs).toISOString(), createdAt: new Date(nowMs).toISOString() })
  await noteParentHold(parent.email, id, expiresMs)
  return res.status(200).json({ success: true, bookingId: id, releaseToken, expiresAt: new Date(expiresMs).toISOString() })
}

async function release(req, res, body) {
  const b = await getBooking(body.bookingId)
  if (!b) return res.status(200).json({ success: true })
  if (!tokenMatches(clean(body.releaseToken, 64), b.releaseToken)) return fail(res, 403, 'Not allowed.')
  if (b.status === 'held' || b.status === 'reserving') {
    // Only release once Stripe confirms the payment page is closed. If it
    // was paid, or we cannot tell, leave the hold: it lapses on its own.
    const closed = b.status === 'held' ? await closeCheckout(b.stripeSessionId) : 'expired'
    if (closed !== 'expired') return res.status(200).json({ success: true, released: false })
    await releasePlaces(b.groupId, b.id)
    await dropParentHold(b.email, b.id)
    await saveBooking({ ...b, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'parent' })
  }
  return res.status(200).json({ success: true, released: true })
}

async function family(req, res, body, parent) {
  const config = await getConfig()
  const group = body.groupId ? await getGroup(body.groupId) : null
  const roster = await loadRoster()
  const fam = familyFor(parent.email, roster, config.termStart)
  return res.status(200).json({
    success: true,
    email: parent.email,
    parentName: fam.parentName,
    mobile: fam.mobile,
    players: group ? familyView(fam, group, config, roster) : fam.players.map((p) => ({ key: p.key, name: p.name, age: p.age, waiverOnFile: Boolean(p.waiver) })),
  })
}

function parentDetails(body, fam) {
  const parentName = clean(body.parentName, 100) || fam.parentName
  const mobile = clean(body.mobile, 40) || fam.mobile
  if (parentName.length < 2) return { error: 'Enter the parent or guardian name.' }
  if (!phoneOk(mobile)) return { error: 'Enter a mobile number we can reach you on.' }
  return { parentName, mobile }
}

async function submit(req, res, body, parent) {
  if (!rateLimit(req, { key: 'jfp-submit', limit: 8, windowMs: 60_000 }).allowed) return fail(res, 429, 'Too many tries. Wait a minute and try again.')
  const config = await getConfig()
  const group = await getGroup(body.groupId)
  if (!group || group.mode !== 'direct') return fail(res, 404, 'That group is not taking online bookings.')
  const roster = await loadRoster({ fresh: true })
  const fam = familyFor(parent.email, roster, config.termStart)
  const who = parentDetails(body, fam)
  if (who.error) return fail(res, 400, who.error)
  const w = checkWaiver(body.waiver, who.parentName)
  if (w.error) return fail(res, 400, w.error, { code: 'waiver' })
  const pl = checkPlayers(body.players, { family: fam, group, config, requireWaiver: true, waiver: w.waiver, roster })
  if (pl.error) return fail(res, 400, pl.error, { code: pl.code })
  if (group.girlsOnly === 'yes' && body.girlsConfirmed !== true) return fail(res, 400, 'This is a girls group. Confirm each player is a girl to continue.', { code: 'girls' })
  if (body.agreementAccepted !== true) return fail(res, 400, 'Please accept the terms to continue.')
  const n = pl.players.length

  // Keep the reservation id if it is still ours, then resize the hold to n
  // places in one atomic step. Nothing is charged if this fails.
  const reservation = await getBooking(body.bookingId)
  const ours = reservation && reservation.groupId === group.id && ['reserving', 'held'].includes(reservation.status) && (!reservation.email || reservation.email === parent.email) && tokenMatches(clean(body.releaseToken, 64), reservation.releaseToken)
  // Back from Stripe and paying again: close the first payment page before
  // opening a second, so the same children can never be charged twice.
  if (ours && reservation.status === 'held') {
    // Record the old session first, so its "expired" event cannot release
    // the places this booking is about to re-hold.
    reservation.replacedSessionIds = [...new Set([...(reservation.replacedSessionIds || []), reservation.stripeSessionId].filter(Boolean))]
    await saveBooking(reservation)
    const closed = await closeCheckout(reservation.stripeSessionId)
    if (closed === 'complete') return fail(res, 409, 'This booking is already paid. Check your email for the confirmation.', { code: 'paid' })
    if (closed === 'error') return fail(res, 503, 'Could not check your earlier payment. Try again in a minute.')
  }
  const id = ours ? reservation.id : newId('JFP')
  const releaseToken = ours ? reservation.releaseToken : crypto.randomBytes(16).toString('hex')
  const nowMs = Date.now()
  const holdExpiresMs = nowMs + HOLD_MINUTES * 60_000
  const taken = countsFrom(roster)[group.id] || 0
  if (!(await holdPlaces({ gid: group.id, bookingId: id, want: n, available: Math.max(0, group.capacity - taken), expiresMs: holdExpiresMs, nowMs }))) {
    const online = (await onlineCounts([group.id]))[group.id] || 0
    const left = placesLeft(group, taken, online)
    return fail(res, 409, left > 0 ? `Only ${left} place${left === 1 ? '' : 's'} left in this group now.` : 'This group has just filled. You can join the waitlist instead.', { code: 'full', placesLeft: left })
  }

  const booking = {
    ...(ours ? reservation : { createdAt: new Date(nowMs).toISOString() }),
    id, groupId: group.id, seats: n, releaseToken,
    email: parent.email, parentName: who.parentName, mobile: who.mobile, notes: clean(body.notes, 500),
    players: pl.players,
    unitCents: config.priceCents,
    priceCents: config.priceCents * n,
    groupSnapshot: group,
    source: 'direct',
    status: 'held',
    holdExpiresAt: new Date(holdExpiresMs).toISOString(),
    siteUrl: siteUrl(req),
  }
  const coach = coachById(config, group.coachId)
  const dates = sessionDates(config, group.day)
  const loc = locationFor(config, group.location)
  const name = `${config.term}: ${group.day} ${group.time}, ${loc.name}${coach ? ` with Coach ${coach.name}` : ''}`
  let session
  try {
    session = await stripeFetch('/checkout/sessions', {
      method: 'POST',
      body: {
        mode: 'payment',
        customer_email: booking.email,
        expires_at: String(Math.floor(nowMs / 1000) + CHECKOUT_EXPIRES_MINUTES * 60),
        success_url: `${booking.siteUrl}/jfp-booking/success/?booking_id=${encodeURIComponent(id)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${booking.siteUrl}/jfp-booking/?payment=cancelled&booking_id=${encodeURIComponent(id)}&release=${releaseToken}`,
        'line_items[0][quantity]': String(n),
        'line_items[0][price_data][currency]': 'aud',
        'line_items[0][price_data][unit_amount]': String(booking.unitCents),
        'line_items[0][price_data][product_data][name]': name.slice(0, 250),
        'line_items[0][price_data][product_data][description]': `${dates.length} weeks, ${dateLabel(dates[0])} to ${dateLabel(dates.at(-1))}. ${pl.players.map((x) => x.name).join(', ')}.`.slice(0, 500),
        'metadata[jfpBookingId]': id,
        'metadata[groupId]': group.id,
        'metadata[source]': 'direct',
        'metadata[players]': pl.players.map((x) => x.name).join(', ').slice(0, 480),
        'payment_intent_data[metadata][jfpBookingId]': id,
        'payment_intent_data[metadata][groupId]': group.id,
        'payment_intent_data[description]': name.slice(0, 400),
      },
    })
  } catch (error) {
    console.error('jfp checkout failed', error)
    await releasePlaces(group.id, id).catch(() => {})
    await saveBooking({ ...booking, status: 'cancelled', cancelledBy: 'checkout-failed' })
    return fail(res, 502, 'Could not start the payment. Nothing has been charged. Please try again.')
  }
  booking.stripeSessionId = session.id
  await saveBooking(booking)
  await indexBooking(booking)
  await noteParentHold(parent.email, id, holdExpiresMs)
  const masterCapture = await captureWebsiteContact({ endpoint: 'jfp-book', form: 'jfp-direct-booking', country: 'AU', players: booking.players.map((x) => ({ name: x.name, age: x.age })), phone: booking.mobile, email: booking.email, parentName: booking.parentName, contactType: 'Parent/Guardian', source: 'jfp-direct-booking', sourceLabel: 'JFP term booking', submittedAt: booking.createdAt })
  if (masterCapture.status === 'failed') console.error('Master contact capture failed:', masterCapture.reason)
  return res.status(200).json({ success: true, bookingId: id, url: session.url })
}

const REQUEST_MODES = { application: ['application'], waitlist: ['direct', 'application'], enquiry: ['enquire', 'application', 'direct'] }

async function request(req, res, body, parent) {
  if (!rateLimit(req, { key: 'jfp-request', limit: 6, windowMs: 60_000 }).allowed) return fail(res, 429, 'Too many tries. Wait a minute and try again.')
  const kind = ['application', 'waitlist', 'enquiry'].includes(body.kind) ? body.kind : ''
  if (!kind) return fail(res, 400, 'Invalid request.')
  const config = await getConfig()
  const group = body.groupId === ONE_TO_ONE.id && kind === 'enquiry' ? ONE_TO_ONE : await getGroup(body.groupId)
  if (!group || !REQUEST_MODES[kind].includes(group.mode)) return fail(res, 404, 'That group is not taking requests.')
  const roster = await loadRoster({ fresh: true })
  const fam = familyFor(parent.email, roster, config.termStart)
  const who = parentDetails(body, fam)
  if (who.error) return fail(res, 400, who.error)
  const w = checkWaiver(body.waiver, who.parentName)
  if (w.error) return fail(res, 400, w.error, { code: 'waiver' })
  const pl = checkPlayers(body.players, { family: fam, group, config, requireWaiver: false, waiver: w.waiver, roster })
  if (pl.error) return fail(res, 400, pl.error, { code: pl.code })
  const record = {
    id: newId(kind === 'waitlist' ? 'WAIT' : kind === 'enquiry' ? 'ENQ' : 'APP'),
    kind, groupId: group.id, players: pl.players,
    email: parent.email, parentName: who.parentName, mobile: who.mobile,
    club: clean(body.club, 120), message: clean(body.message, 800),
    status: 'pending', createdAt: new Date().toISOString(),
  }
  await saveApplication(record)
  await Promise.all([
    sendRequestReceived({ request: record, group, config }).catch((e) => console.error('jfp request ack failed', e)),
    sendRequestAlert({ request: record, group, config }).catch((e) => console.error('jfp request alert failed', e)),
  ])
  const masterCapture = await captureWebsiteContact({ endpoint: 'jfp-book', form: `jfp-${kind}`, country: 'AU', players: record.players.map((x) => ({ name: x.name, age: x.age })), phone: record.mobile, email: record.email, parentName: record.parentName, contactType: 'Parent/Guardian', source: `jfp-${kind}`, sourceLabel: `JFP ${kind}`, submittedAt: record.createdAt })
  if (masterCapture.status === 'failed') console.error('Master contact capture failed:', masterCapture.reason)
  return res.status(200).json({ success: true, id: record.id, kind })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }
  try {
    if (!requireParentAccess(req, res)) return
    if (!sameOrigin(req)) return fail(res, 403, 'Invalid request origin')
    if (body.action === 'release') return await release(req, res, body)
    const parent = await sessionFor(req, 'parent')
    if (!parent) return fail(res, 401, 'Sign in with your email to continue.', { code: 'signin' })
    if (body.action === 'reserve') return await reserve(req, res, body, parent)
    if (body.action === 'family') return await family(req, res, body, parent)
    if (body.action === 'request') return await request(req, res, body, parent)
    return await submit(req, res, body, parent)
  } catch (error) {
    console.error('jfp-book failed', error)
    return fail(res, 500, 'Something went wrong. Nothing has been charged. Please try again.')
  }
}
