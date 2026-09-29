// A signed-in family's own page: their players, groups and dates, what is
// paid, waivers, and anything staff have asked them to finish.
//
// The parent's email-code session is the key. Every row returned carries that
// email in Airtable; nothing about any other family ever leaves this file.
//
//   overview    everything above
//   signWaiver  sign the waiver for players who do not have one on file
//   pay         start Stripe Checkout for an open payment request
import { stripeFetch, siteUrl } from './_holiday-store.js'
import {
  getConfig, getGroup, listGroups, listPayreqs, getPayreq, savePayreq, listApplications, listBookings, clean, sessionDates, dateLabel,
  formatAud, coachById, coachByAirtableName, locationFor, ageOn, normName, audit, closeCheckout, kvPipeline, CHECKOUT_EXPIRES_MINUTES,
} from './_jfp-store.js'
import { loadRoster, familyFor, createWaiverRows, waiverFields, bustRosterCache } from './_jfp-airtable.js'
import { sessionFor, sameOrigin } from './_jfp-people.js'

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

function paymentLine(row, openReq) {
  if (openReq) return { state: 'due', label: `${formatAud(openReq.amountCents)} to pay`, payreqId: openReq.id }
  if (row.paymentStatus === 'Paid') return { state: 'paid', label: 'Paid' }
  if (/trial/i.test(row.paymentType)) return { state: 'trial', label: 'Trial' }
  // Legacy rows can carry sibling splits and agreed plans, so no amount is
  // shown until staff raise a payment request.
  return { state: 'arranged', label: 'Payment arranged with Joner Football' }
}

async function overview(res, parent, body = {}) {
  const config = await getConfig()
  const [roster, groups, payreqs, requests, bookings] = await Promise.all([loadRoster(), listGroups(), listPayreqs(), listApplications(), listBookings()])
  const fam = withDobs(familyFor(parent.email, roster, config.termStart), dobsFrom(requests, parent.email), config.termStart)
  const mine = payreqs.filter((p) => p.email === parent.email && p.status !== 'cancelled')
  // Opened from a payment link: staff see that the family has looked at it.
  const opened = mine.find((q) => q.id === clean(body.pay, 60) && ['open', 'checkout'].includes(q.status))
  // Counted on its own key, never by rewriting the payment record, so a
  // payment being recorded at the same moment can never be undone.
  if (opened) await kvPipeline([['HINCRBY', 'jfp:payreq-views', opened.id, '1'], ['HSET', 'jfp:payreq-viewed-at', opened.id, new Date().toISOString()]])
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, g]))
  const players = fam.players.map((p) => ({
    key: p.key,
    name: p.name,
    age: p.age,
    needsDob: !p.dob,
    waiver: p.waiver ? { onFile: true, signedDate: p.waiver.signedDate, term: p.waiver.term } : { onFile: false },
    enrolments: p.term4.filter((r) => r.holdsPlace && r.groupId).map((r) => {
      const g = byGroup[r.groupId] || { day: r.day, time: r.time, location: r.location, durationMin: 60 }
      const coach = coachById(config, g.coachId) || coachByAirtableName(config, r.coach)
      const loc = locationFor(config, r.location)
      const dates = sessionDates(config, r.day)
      const openReq = mine.find((q) => ['open', 'checkout'].includes(q.status) && q.term4Ids.includes(r.id))
      return {
        rowId: r.id, day: r.day, time: r.time, location: loc.name, address: loc.address, maps: loc.maps,
        coach: coach ? `Coach ${coach.name}` : '', status: r.confirmation || 'Confirmed',
        dates: dates.map(dateLabel), firstDate: dates[0] ? dateLabel(dates[0]) : '',
        payment: paymentLine(r, openReq),
      }
    }),
  }))
  const todo = mine.filter((q) => ['open', 'checkout'].includes(q.status)).map((q) => {
    const blockers = q.playerKeys.filter((k) => !fam.players.find((p) => p.key === k)?.waiver)
    return {
      id: q.id, amountLabel: formatAud(q.amountCents), players: q.playerNames, reason: q.reason, group: q.groupLabel || '', needsWaiver: blockers.length > 0, expiresAt: q.expiresAt || '',
      what: q.reason === 'trial' ? `Trial session${q.trialDate ? `, ${dateLabel(q.trialDate)}` : ''}` : q.startDate ? `From ${dateLabel(q.startDate)} to the end of term${q.creditCents ? `, ${formatAud(q.creditCents)} trial taken off` : ''}` : '',
      afterpay: q.afterpay !== false,
    }
  })
  return res.status(200).json({
    success: true,
    email: parent.email,
    parentName: fam.parentName,
    term: config.term,
    waiverVersion: config.waiverVersion,
    players,
    todo,
    paid: mine.filter((q) => q.status === 'paid').map((q) => ({ id: q.id, amountLabel: formatAud(q.paidCents ?? q.amountCents), players: q.playerNames, paidAt: q.paidAt })),
    requests: requests.filter((r) => r.email === parent.email).map((r) => ({ id: r.id, kind: r.kind, status: r.status, offer: r.offer || '', players: r.players.map((x) => x.name), group: byGroup[r.groupId] ? `${byGroup[r.groupId].day} ${byGroup[r.groupId].time}, ${locationFor(config, byGroup[r.groupId].location).name}` : r.groupId === 'one-to-one' ? '1 to 1 coaching' : '', createdAt: r.createdAt })),
    bookings: bookings.filter((b) => b.email === parent.email && b.status === 'paid').map((b) => ({ id: b.id, players: b.players.map((x) => x.name), amountLabel: formatAud(b.amountPaidCents ?? b.priceCents), paidAt: b.paidAt })),
  })
}

async function signWaiver(res, parent, body) {
  const config = await getConfig()
  const roster = await loadRoster({ fresh: true })
  const fam = withDobs(familyFor(parent.email, roster, config.termStart), dobsFrom(await listApplications(), parent.email), config.termStart)
  const a = body.waiver?.accepted || {}
  if (!(a.terms && a.makeups && a.payment && a.emergency)) return fail(res, 400, 'Tick each part of the waiver to continue.')
  const signature = clean(body.waiver?.signature, 100)
  if (signature.length < 3) return fail(res, 400, 'Type your full name to sign the waiver.')
  const parentName = clean(body.parentName, 100) || fam.parentName
  const mobile = clean(body.mobile, 40) || fam.mobile
  if (parentName.length < 2 || !phoneOk(mobile)) return fail(res, 400, 'Enter your name and mobile.')
  const list = Array.isArray(body.players) ? body.players.slice(0, 6) : []
  if (!list.length) return fail(res, 400, 'Choose the players to sign for.')
  const acceptedAt = new Date().toISOString()
  const rows = []
  for (const x of list) {
    const p = fam.players.find((f) => f.key === clean(x.key, 80))
    if (!p) return fail(res, 404, 'We could not find that player on your account.')
    if (p.waiver) continue
    const dob = p.dob || clean(x.dob, 10)
    if (!ISO.test(dob) || ageOn(dob, config.termStart) == null) return fail(res, 400, `Enter ${p.name}'s date of birth.`)
    const emergencyName = clean(x.emergencyName, 100), emergencyPhone = clean(x.emergencyPhone, 40)
    if (emergencyName.length < 2 || !phoneOk(emergencyPhone)) return fail(res, 400, `Add an emergency contact for ${p.name}.`)
    rows.push(waiverFields({
      player: { name: p.name, dob, club: clean(x.club, 120), medical: clean(x.medical, 500), emergencyName, emergencyPhone },
      parent: { name: parentName, email: parent.email, mobile }, config, signature, acceptedAt, media: body.waiver?.media === true,
    }))
  }
  if (!rows.length) return res.status(200).json({ success: true, created: 0 })
  const ids = await createWaiverRows(rows)
  await bustRosterCache()
  await audit({ by: parent.email, action: 'waiver.signed', target: ids.join(','), after: { players: rows.map((r) => r['Player Full Name']) } })
  return res.status(200).json({ success: true, created: ids.length })
}

async function pay(req, res, parent, body) {
  const q = await getPayreq(body.payreqId)
  if (!q || q.email !== parent.email) return fail(res, 404, 'We could not find that payment.')
  if (q.status === 'paid') return fail(res, 409, 'This is already paid.', { code: 'paid' })
  if (!['open', 'checkout'].includes(q.status)) return fail(res, 410, 'This payment is no longer open. Contact Joner Football.')
  if (q.expiresAt && Date.parse(q.expiresAt) < Date.now()) return fail(res, 410, 'This payment link has expired. Contact Joner Football and we will send a new one.')
  const config = await getConfig()
  const roster = await loadRoster({ fresh: true })
  const fam = familyFor(parent.email, roster, config.termStart)
  const missing = q.playerKeys.filter((k) => !fam.players.find((p) => p.key === k)?.waiver)
  if (missing.length) return fail(res, 400, 'Sign the waiver for each player first.', { code: 'waiver' })
  // Paying again after going back from Stripe: close the first page before
  // opening a second, so one request can never be paid twice.
  if (q.status === 'checkout' && q.stripeSessionId) {
    const closed = await closeCheckout(q.stripeSessionId)
    if (closed === 'complete') return fail(res, 409, 'This payment has gone through and is being processed. Refresh in a minute.', { code: 'processing' })
    if (closed === 'error') return fail(res, 503, 'Could not check your earlier payment. Try again in a minute.')
  }
  const group = q.groupId ? await getGroup(q.groupId) : null
  const base = siteUrl(req)
  const name = `${q.reason === 'trial' ? 'JFP trial' : config.term}: ${q.playerNames.join(', ')}${group ? `, ${group.day} ${group.time}` : ''}${q.reason === 'trial' && q.trialDate ? `, ${dateLabel(q.trialDate)}` : ''}`
  const session = await stripeFetch('/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment',
      customer_email: q.email,
      expires_at: String(Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRES_MINUTES * 60),
      // Paid: the thank you page, which points them to the training kit.
      success_url: `${base}/jfp-booking/success/?pay=${encodeURIComponent(q.id)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/jfp-account/`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'aud',
      'line_items[0][price_data][unit_amount]': String(q.amountCents),
      'line_items[0][price_data][product_data][name]': name.slice(0, 250),
      // Card only when staff turned Afterpay off for this link.
      ...(q.afterpay === false ? { 'payment_method_types[0]': 'card' } : {}),
      'metadata[jfpBookingId]': q.id,
      'metadata[source]': q.reason || 'payreq',
      'payment_intent_data[metadata][jfpBookingId]': q.id,
      'payment_intent_data[description]': name.slice(0, 400),
    },
  })
  // Staff may have changed the amount while this page was opening.
  const now = await getPayreq(q.id)
  if (!now || now.amountCents !== q.amountCents || !['open', 'checkout'].includes(now.status)) {
    await closeCheckout(session.id)
    return fail(res, 409, 'This payment was just updated. Refresh the page and try again.', { code: 'changed' })
  }
  await savePayreq({ ...now, status: 'checkout', stripeSessionId: session.id, siteUrl: base })
  return res.status(200).json({ success: true, url: session.url })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  if (!sameOrigin(req)) return fail(res, 403, 'Invalid request origin')
  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }
  try {
    const parent = await sessionFor(req, 'parent')
    if (!parent) return fail(res, 401, 'Sign in with your email to continue.', { code: 'signin' })
    if (body.action === 'signWaiver') return await signWaiver(res, parent, body)
    if (body.action === 'pay') return await pay(req, res, parent, body)
    return await overview(res, parent, body)
  } catch (error) {
    console.error('jfp-account failed', error)
    return fail(res, 500, 'Something went wrong. Try again in a moment.')
  }
}

export { normName }
