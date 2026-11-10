// Camps in the Joner Football Portal (Lee, 10 Nov 2026): "build in all the
// signups inside the portal instead" of the Google Sheet the Sydney and USA
// camps used. A camp lives in KV, families book a place per day on the
// website, pay with Stripe Checkout on the Sydney account, and Lee and Ligia
// see and manage every sign-up in the portal Camps tab.
//
// Places are counted per day with the same atomic hold as holiday training:
// a ZSET per camp day, one member per player ("<bookingId>#<n>"), scored by
// hold expiry (or a far-future score once paid). One Lua step checks every
// chosen day and takes them all, or none.
//
// Stripe sessions carry metadata campBookingId (never registrationId, which
// the old camp webhook would try to confirm). The Sydney webhook
// (holiday-payment-webhook.js) sends them here.
import crypto from 'node:crypto'
import { kvCommand, kvPipeline, kvGetJson, kvSetJson, claimOnce, clean, stripeFetch, CONFIRMED_SCORE } from './_holiday-store.js'

export const CAMP_HOLD_MINUTES = 31
export const CAMP_CHECKOUT_MINUTES = 30
export const MAX_PLAYERS = 6

export const ckeys = {
  camps: () => 'camp:camps',
  seats: (campId, dayId) => `camp:seats:${campId}:${dayId}`,
  booking: (id) => `camp:booking:${id}`,
  bookings: (campId) => `camp:bookings:${campId}`,
  session: (sid) => `camp:session:${sid}`,
  lease: (id) => `camp:lease:${id}`,
  effect: (id, what) => `camp:done:${id}:${what}`,
  waitlist: (campId) => `camp:waitlist:${campId}`,
}

export const JERSEY_SIZES = ['Youth XS (4 to 6)', 'Youth S (6 to 8)', 'Youth M (8 to 10)', 'Youth L (10 to 12)', 'Youth XL (12 to 14)', 'Adult S', 'Adult M', 'Adult L', 'Adult XL']
export const HEARD_ABOUT = ['Instagram', 'Facebook', 'Google', 'YouTube', 'Email', 'Friend / word of mouth', 'Previous Joner player', 'JFP family', 'Coach / club', 'Other']

// The first camp of the new system. Everything here can be changed in the
// portal (Camps > Settings); this is only what a fresh KV starts with.
export const XMAS_2026 = {
  id: 'xmas-2026',
  slug: 'christmas-drop-and-shop',
  title: 'Christmas Drop and Shop Camp',
  short: 'Christmas Drop and Shop',
  status: 'open',
  // Venue not given yet (10 Nov 2026): set it in the portal (Camps > Settings)
  // and the page and emails show it. Until then they say it comes by email.
  location: '',
  address: '',
  startTime: '09:00',
  endTime: '12:00',
  timesLabel: '9am to 12pm',
  arriveLabel: 'Drop off from 8:45am',
  ages: 'Ages 5 to 14',
  capacityPerDay: 72,
  days: [
    { id: 'mon', date: '2026-12-21', label: 'Monday 21 December', short: 'Mon 21 Dec' },
    { id: 'tue', date: '2026-12-22', label: 'Tuesday 22 December', short: 'Tue 22 Dec' },
  ],
  // Per player. One day, or both days for less per day (Lee, 10 Nov 2026:
  // "if they book 2 days it's cheaper"). Same as the July Sydney camp.
  prices: { oneDay: 15000, allDays: 25000 },
  // Shown as "N places left" once a day has this many or fewer.
  lowAt: 20,
  staffEmails: ['leejones@jonerfootball.com', 'ligia@jonerfootball.com'],
  bring: ['Football boots and runners', 'Shin pads', 'A full water bottle', 'Hat and sunscreen on before drop off', 'A small snack for the break', 'A rain jacket if the forecast says so'],
  updatedAt: '',
}

const parse = (v) => { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return null } }
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d)

export function newCampId(prefix = 'CAMP') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
}

export function audLabel(cents) {
  const d = Number(cents || 0) / 100
  return `A$${d % 1 === 0 ? d.toFixed(0) : d.toFixed(2)}`
}

// ---------- camps ----------

export function normaliseCamp(input = {}, base = XMAS_2026) {
  const c = { ...base, ...input }
  const days = (Array.isArray(c.days) && c.days.length ? c.days : base.days).slice(0, 7).map((d, i) => ({
    id: clean(d.id, 20).replace(/[^a-z0-9-]/gi, '') || `d${i + 1}`,
    date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : '',
    label: clean(d.label, 60), short: clean(d.short, 30),
  }))
  const prices = { oneDay: Math.max(0, int(c.prices?.oneDay, base.prices.oneDay)), allDays: Math.max(0, int(c.prices?.allDays, base.prices.allDays)) }
  return {
    id: clean(c.id, 40) || base.id, slug: clean(c.slug, 80) || base.slug,
    title: clean(c.title, 90) || base.title, short: clean(c.short, 60) || clean(c.title, 60),
    status: ['open', 'closed', 'hidden'].includes(c.status) ? c.status : 'open',
    location: clean(c.location, 120), address: clean(c.address, 160),
    startTime: /^\d{2}:\d{2}$/.test(c.startTime || '') ? c.startTime : base.startTime,
    endTime: /^\d{2}:\d{2}$/.test(c.endTime || '') ? c.endTime : base.endTime,
    timesLabel: clean(c.timesLabel, 40), arriveLabel: clean(c.arriveLabel, 60), ages: clean(c.ages, 40),
    capacityPerDay: Math.min(500, Math.max(1, int(c.capacityPerDay, base.capacityPerDay))),
    days, prices, lowAt: Math.max(0, int(c.lowAt, base.lowAt)),
    staffEmails: (Array.isArray(c.staffEmails) ? c.staffEmails : String(c.staffEmails || '').split(/[\s,;]+/)).map((e) => clean(e, 120).toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 6),
    bring: (Array.isArray(c.bring) ? c.bring : String(c.bring || '').split('\n')).map((b) => clean(b, 120)).filter(Boolean).slice(0, 12),
    updatedAt: clean(c.updatedAt, 40),
  }
}

export async function getCamp(id = XMAS_2026.id) {
  const raw = parse(await kvCommand(['HGET', ckeys.camps(), id]))
  if (raw) return normaliseCamp(raw, id === XMAS_2026.id ? XMAS_2026 : { ...XMAS_2026, ...raw })
  return id === XMAS_2026.id ? normaliseCamp(XMAS_2026) : null
}
export async function getCampBySlug(slug) {
  const all = await listCamps()
  return all.find((c) => c.slug === slug) || null
}
export async function listCamps() {
  const raw = (await kvCommand(['HGETALL', ckeys.camps()])) || []
  const out = new Map()
  for (let i = 0; i < raw.length; i += 2) { const c = parse(raw[i + 1]); if (c?.id) out.set(c.id, normaliseCamp(c, c.id === XMAS_2026.id ? XMAS_2026 : { ...XMAS_2026, ...c })) }
  if (!out.has(XMAS_2026.id)) out.set(XMAS_2026.id, normaliseCamp(XMAS_2026))
  return [...out.values()]
}
export async function saveCamp(camp) {
  const c = normaliseCamp({ ...camp, updatedAt: new Date().toISOString() }, camp.id === XMAS_2026.id ? XMAS_2026 : { ...XMAS_2026, ...camp })
  await kvCommand(['HSET', ckeys.camps(), c.id, JSON.stringify(c)])
  return c
}

// Price per player for a set of days. Every day of the camp = the all-days
// price; anything less is the one-day price per day.
export function pricePerPlayer(camp, dayIds) {
  const n = dayIds.length
  if (!n) return 0
  if (n >= camp.days.length && camp.days.length > 1) return camp.prices.allDays
  return camp.prices.oneDay * n
}
export function priceSummary(camp) {
  const full = camp.prices.oneDay * camp.days.length
  return { oneDay: camp.prices.oneDay, allDays: camp.prices.allDays, save: Math.max(0, full - camp.prices.allDays) }
}

// The last day still to come (Sydney): a camp whose days have all passed
// takes no more bookings.
export function sydneyToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function bookableDays(camp, today = sydneyToday()) {
  return camp.days.filter((d) => d.date && d.date >= today)
}

// ---------- places ----------

// KEYS: one seats ZSET per chosen day. ARGV: now, score, bookingId, want,
// capacity, force. Returns 0 when every day was taken, else 1 + the index of
// the first day that is full.
export const CAMP_HOLD_SCRIPT = `
local want = tonumber(ARGV[4])
local cap = tonumber(ARGV[5])
for k = 1, #KEYS do
  redis.call('ZREMRANGEBYSCORE', KEYS[k], '-inf', ARGV[1])
  if ARGV[6] ~= '1' then
    local own = 0
    for i = 1, 12 do
      if redis.call('ZSCORE', KEYS[k], ARGV[3] .. '#' .. i) then own = own + 1 end
    end
    if redis.call('ZCARD', KEYS[k]) - own + want > cap then return k end
  end
end
for k = 1, #KEYS do
  for i = 1, 12 do redis.call('ZREM', KEYS[k], ARGV[3] .. '#' .. i) end
  for i = 1, want do redis.call('ZADD', KEYS[k], ARGV[2], ARGV[3] .. '#' .. i) end
end
return 0`

export async function holdPlaces({ camp, dayIds, bookingId, players, scoreMs, nowMs = Date.now(), force = false }) {
  const r = Number(await kvCommand(['EVAL', CAMP_HOLD_SCRIPT, String(dayIds.length), ...dayIds.map((d) => ckeys.seats(camp.id, d)), String(nowMs), String(scoreMs), bookingId, String(players), String(camp.capacityPerDay), force ? '1' : '0']))
  return r === 0 ? { ok: true } : { ok: false, fullDay: dayIds[r - 1] }
}
const members = (bookingId) => Array.from({ length: 12 }, (_, i) => `${bookingId}#${i + 1}`)
export async function releasePlaces(campId, dayIds, bookingId) {
  if (!dayIds.length) return
  await kvPipeline(dayIds.map((d) => ['ZREM', ckeys.seats(campId, d), ...members(bookingId)]))
}

// { dayId: { taken, left, capacity } }, holds included (a family paying now
// is counted, so the last places cannot be sold twice).
export async function dayCounts(camp, nowMs = Date.now()) {
  const cmds = camp.days.flatMap((d) => [['ZREMRANGEBYSCORE', ckeys.seats(camp.id, d.id), '-inf', String(nowMs)], ['ZCARD', ckeys.seats(camp.id, d.id)]])
  const res = await kvPipeline(cmds)
  const out = {}
  camp.days.forEach((d, i) => {
    const taken = Number(res[i * 2 + 1]) || 0
    out[d.id] = { taken, left: Math.max(0, camp.capacityPerDay - taken), capacity: camp.capacityPerDay }
  })
  return out
}

// What the public page shows: never names, emails or money taken.
export async function publicCamp(camp, today = sydneyToday()) {
  const counts = await dayCounts(camp)
  const open = new Set(bookableDays(camp, today).map((d) => d.id))
  return {
    id: camp.id, slug: camp.slug, title: camp.title, status: camp.status, location: camp.location, address: camp.address,
    timesLabel: camp.timesLabel, arriveLabel: camp.arriveLabel, ages: camp.ages, capacityPerDay: camp.capacityPerDay, lowAt: camp.lowAt,
    prices: priceSummary(camp), bring: camp.bring,
    days: camp.days.map((d) => ({ ...d, ...counts[d.id], bookable: camp.status === 'open' && open.has(d.id) && counts[d.id].left > 0, past: !open.has(d.id) })),
  }
}

// ---------- bookings ----------

export async function getBooking(id) { return parse(await kvCommand(['GET', ckeys.booking(id)])) }
export async function saveBooking(b) {
  b.updatedAt = new Date().toISOString()
  await kvCommand(['SET', ckeys.booking(b.id), JSON.stringify(b), 'EX', String(400 * 86400)])
  return b
}
export async function indexBooking(b) {
  await kvCommand(['ZADD', ckeys.bookings(b.campId), String(Date.parse(b.createdAt) || Date.now()), b.id])
}
export async function listBookings(campId) {
  const ids = (await kvCommand(['ZREVRANGE', ckeys.bookings(campId), '0', '1999'])) || []
  if (!ids.length) return []
  const rows = await kvPipeline(ids.map((id) => ['GET', ckeys.booking(id)]))
  return rows.map(parse).filter(Boolean)
}
export async function bookingForSession(sid) { return kvCommand(['GET', ckeys.session(sid)]) }

const yesNo = (v) => (/^y/i.test(String(v || '')) ? 'Yes' : /^n/i.test(String(v || '')) ? 'No' : '')
const phoneOk = (v) => String(v || '').replace(/\D/g, '').length >= 8

// One family's form, checked. Returns { error } or { value }.
export function validateBookingInput(body, camp, { staff = false } = {}) {
  const dayIds = [...new Set((Array.isArray(body.days) ? body.days : [body.days]).map((d) => clean(d, 20)))].filter((d) => camp.days.some((x) => x.id === d))
  if (!dayIds.length) return { error: 'Choose which day or days.' }
  const players = (Array.isArray(body.players) ? body.players : []).slice(0, MAX_PLAYERS).map((p) => ({
    firstName: clean(p?.firstName, 60), surname: clean(p?.surname, 60), age: clean(p?.age, 3).replace(/\D/g, ''),
    jerseySize: clean(p?.jerseySize, 40), previousCamp: yesNo(p?.previousCamp), clubLevel: clean(p?.clubLevel, 120), medical: clean(p?.medical, 600),
  }))
  if (!players.length) return { error: 'Add at least one player.' }
  for (const [i, p] of players.entries()) {
    const who = players.length > 1 ? `Player ${i + 1}: ` : ''
    if (!p.firstName || !p.surname) return { error: `${who}enter the player's first name and surname.` }
    const age = Number(p.age)
    if (!staff && (!age || age < 3 || age > 18)) return { error: `${who}enter the player's age (3 to 18).` }
    if (!staff && !p.jerseySize) return { error: `${who}choose a jersey size.` }
    if (!staff && !p.previousCamp) return { error: `${who}tell us if they have done a Joner camp before.` }
  }
  const v = {
    dayIds: camp.days.filter((d) => dayIds.includes(d.id)).map((d) => d.id), players,
    parentName: clean(body.parentName, 100), email: clean(body.email, 160).toLowerCase(), mobile: clean(body.mobile, 30),
    emergencyName: clean(body.emergencyName, 100), emergencyMobile: clean(body.emergencyMobile, 30), pickup: clean(body.pickup, 200),
    heardAbout: clean(body.heardAbout, 60), extraInfo: clean(body.extraInfo, 800),
    agreement: body.agreement === true || body.agreement === 'true' || body.agreement === 'on',
  }
  if (!v.parentName) return { error: 'Enter the parent or guardian name.' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return { error: 'Enter a valid email address.' }
  if (!phoneOk(v.mobile) && !staff) return { error: 'Enter a mobile number we can call on the day.' }
  if (!staff) {
    if (!v.emergencyName || !phoneOk(v.emergencyMobile)) return { error: 'Add an emergency contact (name and mobile), someone other than you if you can.' }
    if (!v.heardAbout) return { error: 'Tell us where you heard about the camp.' }
    if (!v.agreement) return { error: 'Please accept the camp terms.' }
  }
  return { value: v }
}

export function dayLabels(camp, dayIds) {
  return camp.days.filter((d) => dayIds.includes(d.id)).map((d) => d.label)
}
export function daysText(camp, dayIds) {
  const l = dayLabels(camp, dayIds)
  return l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : l[0] || ''
}

// ---------- Stripe ----------

export async function createCheckout({ camp, booking, baseUrl }) {
  const each = pricePerPlayer(camp, booking.dayIds)
  const both = booking.dayIds.length === camp.days.length && camp.days.length > 1
  const pageUrl = `${baseUrl}/camps/${camp.slug}/`
  const body = {
    mode: 'payment',
    customer_email: booking.email,
    expires_at: String(Math.floor(Date.now() / 1000) + CAMP_CHECKOUT_MINUTES * 60),
    success_url: `${pageUrl}?booked=${encodeURIComponent(booking.id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${pageUrl}?cancelled=${encodeURIComponent(booking.id)}&t=${encodeURIComponent(booking.releaseToken)}#book`,
    'line_items[0][quantity]': String(booking.players.length),
    'line_items[0][price_data][currency]': 'aud',
    'line_items[0][price_data][unit_amount]': String(each),
    'line_items[0][price_data][product_data][name]': `${camp.title}: ${both ? 'both days' : daysText(camp, booking.dayIds)}`,
    'line_items[0][price_data][product_data][description]': `${booking.players.map((p) => `${p.firstName} ${p.surname}`).join(', ')} · ${camp.timesLabel}${camp.location ? ` · ${camp.location}` : ' · Sydney'}`.slice(0, 300),
    'metadata[campBookingId]': booking.id,
    'metadata[campId]': camp.id,
    'metadata[camp]': camp.title,
    'metadata[days]': booking.dayIds.join(','),
    'metadata[players]': String(booking.players.length),
    'payment_intent_data[metadata][campBookingId]': booking.id,
    'payment_intent_data[metadata][camp]': camp.title,
    'payment_intent_data[description]': `${camp.title} (${booking.id})`,
  }
  return stripeFetch('/checkout/sessions', { method: 'POST', body, idempotencyKey: `camp-checkout-${booking.id}` })
}

export function campBookingIdFromSession(session) {
  const id = session?.metadata?.campBookingId
  return typeof id === 'string' && /^CB-\d+-[0-9A-F]{6}$/.test(id) ? id : ''
}

// ---------- finishing a paid booking ----------

// Paid: keep the places (or take them again if the hold lapsed), mark it paid,
// then each side effect once. Returns { status, booking, busy?, already? }.
export async function finaliseCampBooking(id, session, deps = {}) {
  const lease = await kvCommand(['SET', ckeys.lease(id), '1', 'NX', 'EX', '60'])
  if (lease !== 'OK') return { busy: true }
  try {
    let b = await getBooking(id)
    if (!b) return { missing: true }
    const camp = await getCamp(b.campId)
    // Paid once and then cancelled in the portal (a refund): never revive it.
    if (b.paidAt && b.status !== 'paid') return { already: true, booking: b }
    if (b.status !== 'paid') {
      // The hold may have lapsed: take the places with no capacity check, and
      // flag it when that put a day over the limit (Lee decides).
      await holdPlaces({ camp, dayIds: b.dayIds, bookingId: b.id, players: b.players.length, scoreMs: CONFIRMED_SCORE, force: true })
      const counts = await dayCounts(camp)
      const over = b.dayIds.filter((d) => counts[d].taken > camp.capacityPerDay)
      b = {
        ...b, status: 'paid', paidAt: new Date().toISOString(), method: 'Stripe',
        amountPaidCents: Number(session?.amount_total ?? b.priceCents) || 0,
        stripeSessionId: session?.id || b.stripeSessionId, paymentIntent: typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id || b.paymentIntent || '',
        attention: over.length ? `Paid after the hold ran out and ${dayLabels(camp, over).join(' and ')} went over ${camp.capacityPerDay}.` : b.attention || '',
      }
      await saveBooking(b)
    } else if (deps.onlyIfNew) return { already: true, booking: b }
    await runEffects(b, camp, deps)
    return { status: 'paid', booking: await getBooking(id), already: false }
  } finally {
    await kvCommand(['DEL', ckeys.lease(id)]).catch(() => {})
  }
}

// Each once: parent email, staff alert, Telegram, Brevo. A failure is kept on
// the booking (effects) and retried on the next finalise; never blocks paid.
export async function runEffects(b, camp, deps = {}) {
  const email = deps.email || (await import('./_camp-email.js'))
  const effects = { ...(b.effects || {}) }
  const step = async (what, fn) => {
    if (effects[what] === 'done') return
    if (!(await claimOnce(ckeys.effect(b.id, what), 600))) return
    try { await fn(); effects[what] = 'done' } catch (error) {
      console.error(`camp ${what} failed`, b.id, error?.message || error)
      effects[what] = 'failed'
      await kvCommand(['DEL', ckeys.effect(b.id, what)]).catch(() => {})
    }
  }
  await step('parentEmail', () => email.sendCampConfirmation(b, camp))
  await step('staffEmail', () => email.sendCampStaffAlert(b, camp))
  await step('telegram', async () => {
    const { telegramAlert } = await import('./_jfp-notify.js')
    const counts = await dayCounts(camp)
    await telegramAlert(`Camp sign-up: ${b.players.map((p) => p.firstName).join(', ')} (${b.parentName}) for ${camp.short}, ${daysText(camp, b.dayIds)}. ${audLabel(b.amountPaidCents)}. Places left: ${camp.days.map((d) => `${d.short} ${counts[d.id].left}`).join(', ')}.`)
  })
  await step('brevo', () => email.addCampContact(b, camp))
  const fresh = await getBooking(b.id)
  if (fresh) { fresh.effects = { ...(fresh.effects || {}), ...effects }; await saveBooking(fresh) }
}

export async function expireCampBooking(id) {
  const b = await getBooking(id)
  if (!b || b.status !== 'held') return { changed: false }
  const camp = await getCamp(b.campId)
  await releasePlaces(camp.id, b.dayIds, b.id)
  b.status = 'expired'
  await saveBooking(b)
  return { changed: true }
}

// ---------- waitlist ----------

export async function addWaitlist(campId, entry) {
  const id = newCampId('CW')
  const row = { id, at: new Date().toISOString(), ...entry }
  await kvCommand(['HSET', ckeys.waitlist(campId), id, JSON.stringify(row)])
  return row
}
export async function listWaitlist(campId) {
  const raw = (await kvCommand(['HGETALL', ckeys.waitlist(campId)])) || []
  const out = []
  for (let i = 0; i < raw.length; i += 2) { const r = parse(raw[i + 1]); if (r) out.push(r) }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}
export async function removeWaitlist(campId, id) { await kvCommand(['HDEL', ckeys.waitlist(campId), id]) }

export { kvGetJson, kvSetJson }
