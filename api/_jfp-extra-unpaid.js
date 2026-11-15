// Extra sessions are paid before they run (Lee, 16 Nov 2026: "no player should
// be able to train without paying"). Dean put Reyansh on a Sunday 1 on 1 on
// 1 Nov, the A$120 was never paid, and the session ran anyway. So for every
// booking on an extra session that is still unpaid:
//
//   about 48 hours before   the coach is told (email and text), and the family
//   and again at 24 hours   gets a reminder with the pay link (email and text)
//   at the start            Lee hears on Telegram (Barry bot) that it is unpaid
//
// The family email and text are OFF until Lee says yes to the exact words
// (config.extraUnpaidFamily === true). While off, what would have gone is kept
// in jfp:extra-unpaid-held so Lee and Ligia can read it. The coach and Lee
// notices are on now.
//
// A family whose saved card is charged after the session (auto charge) is
// covered: nothing is sent about them.
import { kvCommand, coachById, coachLabel, dateLabel, formatAud, audit, getPayreq, sydneyToday } from './_jfp-store.js'
import { allSlots, liveBookings, startMs, leadPayreq } from './_jfp-extra.js'
import { getTerm4Row } from './_jfp-airtable.js'
import { getCharge, listCharges } from './_jfp-charges.js'
import { tellCoach } from './_jfp-coach-alerts.js'
import { barryAlert } from './_jfp-notify.js'
import { newMsg, saveMsg, event, normalisePhone, maskPhone, sha, routeStatus, getPrefs, doNotContact } from './_jfp-messages.js'
import { sendFamilyNotice } from './_jfp-email.js'

export const UNPAID_DONE = 'jfp:extra-unpaid' // hash slotId|bookingId|stage -> when
export const UNPAID_HELD = 'jfp:extra-unpaid-held' // list of family reminders held while the switch is off
const H = 3600000
// A booking made in the last hour has only just had its payment email.
const FRESH_MS = H
const SITE = 'https://jonerfootball.com'
const first = (s) => String(s || '').trim().split(/\s+/)[0] || ''
const shortWhen = (s) => `${dateLabel(s.date)} at ${s.time}`

export const familyOn = (config) => config?.extraUnpaidFamily === true

// The exact family text Lee is asked to say yes to (16 Nov 2026).
export function familyText({ parentFirst, playerFirst, coach, when, url }) {
  return `Hi ${parentFirst || 'there'}, ${playerFirst}'s extra session with Coach ${coach} on ${when} hasn't been paid yet. It needs to be paid before the session starts: ${url}. Thanks, Joner Football`
}
export function familyEmail({ parentFirst, playerFirst, player, coach, when, url, amountCents }) {
  return {
    subject: `Extra session not paid yet: ${playerFirst}, ${when}`,
    heading: 'Your extra session is not paid yet',
    paras: [`Hi ${parentFirst || 'there'}, ${playerFirst}'s extra session with Coach ${coach} on ${when} hasn't been paid yet.`, 'It needs to be paid before the session starts. Card or Apple Pay, with the button below.'],
    list: [['Player', player], ['Session', when], ['Amount', formatAud(amountCents)]],
    cta: { label: `Pay ${formatAud(amountCents)}`, url },
  }
}

// What stage a booking is at now, or ''. Later stages win (a booking made 20
// hours before only gets the 24 hour one).
export function stageFor(startAt, now) {
  const left = startAt - now
  if (left <= 0) return now - startAt < 3 * H ? 'start' : ''
  if (left <= 24 * H) return '24h'
  if (left <= 48 * H) return '48h'
  return ''
}

// The unpaid bookings on open extra sessions starting in the next 48 hours
// (or started in the last 3). deps for tests.
export async function unpaidBookings(now = Date.now(), { slots } = {}) {
  const list = (slots || (await allSlots())).filter((s) => s.status === 'open' && startMs(s) && startMs(s) - now <= 48 * H && now - startMs(s) < 3 * H)
  const out = []
  for (const s of list) {
    for (const b of liveBookings(s)) {
      // A whole session's friends are paid for on the first booking: only the lead is chased.
      if (b.groupId && b.groupId !== b.id) continue
      const pid = leadPayreq(s, b)
      const q = pid ? await getPayreq(pid) : null
      if (q?.status === 'paid') continue
      if (q && q.status === 'cancelled') continue
      const players = b.groupId ? liveBookings(s).filter((x) => x.groupId === b.groupId).map((x) => x.name) : [b.name]
      out.push({ s, b, q, players })
    }
  }
  return out
}

// The saved card pays it after the session (auto charge).
async function autoPays(b, q) {
  try {
    const { chargeAutoPays } = await import('./_jfp-saved-pay.js')
    const c = b.chargeId ? await getCharge(b.chargeId) : q?.charge?.id ? await getCharge(q.charge.id) : (await listCharges()).find((x) => x.payreqId === q?.id)
    return c ? await chargeAutoPays(c) : false
  } catch (e) { console.error('jfp extra unpaid autopay check failed', e.message); return false }
}

async function familyTarget(b, q) {
  const row = b.rowId ? await getTerm4Row(b.rowId).catch(() => null) : null
  const email = (b.email || q?.email || row?.email || '').toLowerCase()
  const phone = normalisePhone(b.mobile || row?.phone || '')
  const self = Boolean(row?.ownContact)
  const parent = self ? '' : (q?.parentName || row?.parent || '')
  return { email, phone, parentFirst: self ? first(b.name) : first(parent), parentName: parent, row }
}

// The five minute check (from coachTick). Each stage goes once per booking.
export async function extraUnpaidSweep({ config, now = Date.now(), send = {} } = {}) {
  const tell = send.tellCoach || tellCoach
  const barry = send.barry || barryAlert
  const emailFamily = send.emailFamily || sendFamilyNotice
  const out = { coach: 0, family: 0, held: 0, lee: 0 }
  for (const { s, b, q, players } of await unpaidBookings(now)) {
    const stage = stageFor(startMs(s), now)
    if (!stage) continue
    if (stage !== 'start' && Date.parse(b.at || 0) > now - FRESH_MS) continue
    const key = `${s.id}|${b.id}|${stage}`
    if (Number(await kvCommand(['HEXISTS', UNPAID_DONE, key])) === 1) continue
    if (await autoPays(b, q)) { await kvCommand(['HSETNX', UNPAID_DONE, key, `auto ${new Date(now).toISOString()}`]); continue }
    if (Number(await kvCommand(['HSETNX', UNPAID_DONE, key, new Date(now).toISOString()])) !== 1) continue
    const coach = coachById(config, s.coachId)
    const coachName = coachLabel(coach) || 'your coach'
    const who = players.join(', ')
    const when = shortWhen(s)
    const amount = q ? formatAud(q.amountCents || 0) : 'no payment made yet'
    if (stage === 'start') {
      await barry(`Extra session starting NOT PAID\n${who}\n${when}, ${s.location}\nCoach ${coachName} · ${amount}\nPortal: Extra sessions`).catch(() => {})
      out.lee += 1
      await audit({ by: 'extra unpaid', action: 'extra.unpaid.start', target: s.id, after: { booking: b.id, player: who } })
      continue
    }
    // The coach hears at 48 and 24 hours (Lee owns the business: never chased).
    const owner = coach?.email && (config.superAdmins || []).includes(coach.email)
    if (coach && !owner) {
      const r = await tell({
        coach, kind: 'coach extra unpaid',
        text: `Hi ${coach.name}, ${who} has not paid for your extra session on ${when} yet. It must be paid before the session starts. We have reminded the family. Details in your coach portal: jonerfootball.com/jfp-portal`,
        subject: `Not paid yet: ${who}, ${when}`, heading: 'An extra session is not paid yet',
        paras: [`Hi Coach ${coach.name}, ${who} has not paid for your extra session on ${when} yet.`, 'Extra sessions must be paid before they start. Only paid players go on your invoice. We are reminding the family.'],
        list: [['Session', `${when}, ${s.location}`], ['Player', who]],
      }).catch((e) => ({ error: e.message }))
      out.coach += 1
      await audit({ by: 'extra unpaid', action: 'extra.unpaid.coach', target: s.id, after: { booking: b.id, stage, player: who, emailed: r?.emailed, texted: r?.texted } })
    }
    // The family, 48 and 24 hours before: held until Lee's yes on the words.
    if (!q) continue
    const fam = await familyTarget(b, q)
    const url = `${SITE}/jfp-account/?pay=${encodeURIComponent(q.id)}`
    const words = { parentFirst: fam.parentFirst, playerFirst: first(b.name), player: who, coach: coachName, when, url, amountCents: q.amountCents || 0 }
    const text = familyText(words)
    if (!familyOn(config)) {
      await kvCommand(['LPUSH', UNPAID_HELD, JSON.stringify({ at: new Date(now).toISOString(), stage, slotId: s.id, bookingId: b.id, player: who, when, coach: coachName, text, email: Boolean(fam.email), mobile: Boolean(fam.phone) })])
      await kvCommand(['LTRIM', UNPAID_HELD, '0', '99'])
      out.held += 1
      continue
    }
    let emailed = false, texted = false, why = ''
    if (fam.email) {
      try { emailed = Boolean(await emailFamily({ to: fam.email, name: fam.parentName || b.name, ...familyEmail(words), kind: 'extra unpaid' })) } catch (e) { why = e.message }
    }
    try { const t = await queueFamilyText({ email: fam.email, phone: fam.phone, parent: fam.parentName, players: [{ name: b.name, rowId: b.rowId || '' }], text, expiresAt: startMs(s) }); texted = t.texted; why = why || t.why || '' } catch (e) { why = e.message }
    out.family += 1
    await audit({ by: 'extra unpaid', action: 'extra.unpaid.family', target: s.id, after: { booking: b.id, player: who, emailed, texted, why } })
  }
  return out
}

// A family text in the portal queue (the office Mac sends it), the same
// checks as a text Lee writes: Texts no, Do Not Contact, the route verified.
async function queueFamilyText({ email, phone, parent, players, text, expiresAt }) {
  if (!phone) return { texted: false, why: 'no mobile' }
  const prefs = await getPrefs()
  if (email && prefs[email]?.text === 'no') return { texted: false, why: 'asked for no texts' }
  const dnc = await doNotContact()
  if (dnc.has(email || '', phone)) return { texted: false, why: 'Do Not Contact' }
  const route = await routeStatus()
  if (!route.verified) return { texted: false, why: 'portal texts are not switched on' }
  const m = newMsg({ channel: 'text', family: { email: email || '', parent: parent || '', players, kind: 'extra unpaid' }, content: { text }, target: { ref: maskPhone(phone), hash: sha(phone) }, by: 'extra unpaid', route: { id: 'mac', label: 'Messages on the office Mac' } })
  m.quick = true
  m.rowIds = (m.rowIds || []).filter(Boolean)
  m.status = 'queued'
  m.approvedBy = 'extra unpaid reminder (words approved by Lee)'
  m.approvedAt = m.createdAt
  m.expiresAt = new Date(expiresAt).toISOString()
  event(m, 'extra unpaid', 'reminder to pay before the extra session')
  await saveMsg(m)
  return { texted: true, id: m.id }
}

// For Lee and Ligia: the switch, and the family reminders held while it is off.
export async function unpaidSettings({ config }) {
  const raw = (await kvCommand(['LRANGE', UNPAID_HELD, '0', '29'])) || []
  return { on: familyOn(config), held: raw.map((x) => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean), sample: familyText({ parentFirst: 'Sarah', playerFirst: 'Sam', coach: 'Dean', when: 'Sun 22 Nov at 10:00am', url: `${SITE}/jfp-account/?pay=PAY-…` }), today: sydneyToday() }
}
