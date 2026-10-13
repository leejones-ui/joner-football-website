// Joners Juniors requests and waitlist (stage 2). When website
// registrations are closed or the class is full, the public form saves a
// request here instead of going to Stripe. Staff accept (the child goes into
// the term's table, and the Invites page offers the "sign in and pay"
// email), decline, or put back on the waitlist. Its own KV hash, never the
// JFP applications list, so JFP's Requests page and family account never
// show a Juniors request.
//
//   jj:requests  hash  id -> { id, kind:'waitlist', why:'full'|'closed', term,
//                player:{ name, dob, dobText, medical }, parent:{ name, email, mobile },
//                source, status:'waiting'|'accepted'|'declined', createdAt,
//                rowId?, decidedBy?, decidedAt?, declineReason?, history:[...] }
import { kvCommand, newId, clean, validEmail, cleanPhone, normName, sydneyToday, ageOn } from './_jfp-store.js'
import { dobIso, plain, readJJRows, isEnrolled } from './_jj-data.js'
import { capacityOf } from './_jj-config.js'

export const JJ_REQUESTS = 'jj:requests'
const ID = /^JJREQ-\d+-[0-9A-F]{6}$/

export async function saveJJRequest(r) { await kvCommand(['HSET', JJ_REQUESTS, r.id, JSON.stringify(r)]); return r }
export async function getJJRequest(id) {
  const c = clean(id, 60)
  if (!ID.test(c)) return null
  try { return JSON.parse((await kvCommand(['HGET', JJ_REQUESTS, c])) || 'null') } catch { return null }
}
export async function listJJRequests() {
  const flat = (await kvCommand(['HGETALL', JJ_REQUESTS])) || []
  const out = []
  for (let i = 1; i < flat.length; i += 2) { try { const r = JSON.parse(flat[i]); if (r?.id) out.push(r) } catch {} }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

// Is the class full right now? null when it cannot be read (the website then
// behaves as before and lets the family pay).
export async function classFull(config) {
  try {
    const enrolled = (await readJJRows(config)).filter(isEnrolled).length
    const cap = capacityOf(config.juniors)
    return { full: cap > 0 && enrolled >= cap, enrolled, capacity: cap }
  } catch (error) { console.error('jj class count failed', error.message); return null }
}

// From the website form (the same fields as the paid sign-up). Returns
// { ok, request, already } or { ok:false, error }.
export async function waitlistFromForm(body, { term, why }) {
  const name = plain(body.playerFullName || `${body.playerFirstName || ''} ${body.playerSurname || ''}`, 80).replace(/\s+/g, ' ')
  const parentName = plain(body.parentName, 100)
  const email = validEmail(body.email)
  const mobile = plain(body.mobile, 40)
  const dobText = plain(body.dateOfBirth || body.dob, 20)
  if (name.length < 3) return { ok: false, error: "Enter your child's full name." }
  if (parentName.length < 2) return { ok: false, error: 'Enter your name.' }
  if (!email) return { ok: false, error: 'Enter a valid email address.' }
  if (!cleanPhone(mobile)) return { ok: false, error: 'Check the mobile number. Use digits, like 0411 222 333.' }
  if (!(body.agreementAccepted === true || body.agreementAccepted === 'true' || body.agreementAccepted === 'on')) return { ok: false, error: 'Training agreement must be accepted.' }
  const dob = dobIso(dobText)
  // Same child and family already waiting: the same request, not a second one.
  const open = (await listJJRequests()).find((r) => r.status !== 'declined' && r.parent.email === email && normName(r.player.name) === normName(name))
  if (open) return { ok: true, request: open, already: true }
  const request = {
    id: newId('JJREQ'), kind: 'waitlist', why, term,
    player: { name, dob: dob && ageOn(dob, sydneyToday()) != null ? dob : '', dobText, medical: plain(body.medicalHistory || body.medical, 600) },
    parent: { name: parentName, email, mobile },
    source: plain(body.heardAboutUs || body.source, 120),
    status: 'waiting', createdAt: new Date().toISOString(), history: [],
  }
  await saveJJRequest(request)
  return { ok: true, request }
}

// The staff view of the list: waiting ones numbered in the order they asked.
export function requestsView(list, { rowsById = new Map(), invites = {}, placesLeft = 0 } = {}) {
  let n = 0
  const view = list.map((r) => {
    const row = r.rowId ? rowsById.get(r.rowId) : null
    const sent = invites[`new:${r.parent.email}`] || null
    let stage = r.status
    if (r.status === 'accepted') stage = row && /^paid$/i.test(row.status || '') ? 'paid' : sent ? 'invited' : 'accepted'
    return {
      id: r.id, why: r.why, term: r.term, createdAt: r.createdAt, status: r.status, stage,
      position: r.status === 'waiting' ? ++n : null,
      player: r.player, age: r.player.dob ? ageOn(r.player.dob, sydneyToday()) : null, parent: r.parent, source: r.source,
      rowId: r.rowId || '', inTable: Boolean(row), removed: Boolean(row?.removed), invitedAt: sent?.at || '',
      decidedBy: r.decidedBy || '', decidedAt: r.decidedAt || '', declineReason: r.declineReason || '',
    }
  })
  const waiting = view.filter((r) => r.status === 'waiting')
  return { list: view, counts: { waiting: waiting.length, accepted: view.filter((r) => r.status === 'accepted').length, declined: view.filter((r) => r.status === 'declined').length }, placesLeft, placeFree: placesLeft > 0 && waiting.length > 0 }
}
