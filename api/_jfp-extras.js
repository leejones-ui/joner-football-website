// Book extra sessions and Book game analysis (Lee, 14 Oct 2026). Two new
// pages in My account. For now each is a request form: it is saved in KV
// (hash jfp:extra-requests), Lee and Ligia are emailed (and the send is in the
// email log), Telegram hears, and staff see the list in the portal under
// Requests. Nothing is booked or charged here.
//
//   extra     an extra 1 on 1 or small group session with a coach. 1 on 1
//             during term is school hours only (about 7:30am to 2pm) and the
//             school holidays; other times on request
//   analysis  a game analysis enquiry (JFP players get a discount); it
//             goes to Ligia and Dean, who does the analysis
//
// Slots (extra 1 on 1 times staff open up) can be listed on the page later:
// extraSlots() returns them, and today there are none.
import crypto from 'node:crypto'
import { kvCommand, clean, newId, formatAud, audit, dateLabel, sydneyToday } from './_jfp-store.js'
import { sendExtraRequestAlert } from './_jfp-email.js'
import { telegramAlert } from './_jfp-notify.js'

const KEY = 'jfp:extra-requests'
export const KINDS = { extra: 'Extra session', analysis: 'Game analysis' }
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const TIMES = ['School hours (about 7:30am to 2pm)', 'After school', 'Weekends', 'School holidays']
export const TYPES = ['1 on 1', 'Small group', 'Either']
export const NOTE_MAX = 1000
export const RATE_LIMIT = 10
const ISO = /^\d{4}-\d{2}-\d{2}$/
const URL_OK = /^https?:\/\/[^\s<>"']{4,500}$/

// The game analysis price, if Lee has one in Money > Prices (a live price
// named "game analysis" or "match analysis"); otherwise the page says "Ask us".
export function analysisPrice(config) {
  const p = (config.customPrices || []).find((x) => !x.archived && /game analysis|match analysis/i.test(x.name || ''))
  return p ? { cents: p.cents, label: formatAud(p.cents) } : null
}

// Extra 1 on 1 times to book straight away, when staff open some. None yet:
// the page shows the request form.
export function extraSlots() { return [] }

// What a family sent, checked. players: this family's player names.
export function cleanExtra(kind, body = {}, { players = [], today = sydneyToday() } = {}) {
  if (!KINDS[kind]) return { ok: false, status: 400, error: 'Choose what you would like to book.' }
  const player = clean(body.player, 100)
  if (player.length < 2) return { ok: false, status: 400, error: 'Choose the player.' }
  // A player on this account, or a name typed in for one not added yet.
  const known = players.find((n) => n.toLowerCase() === player.toLowerCase())
  const notes = clean(body.notes, NOTE_MAX)
  if (kind === 'extra') {
    const days = (Array.isArray(body.days) ? body.days : []).filter((d) => DAYS.includes(d))
    const times = (Array.isArray(body.times) ? body.times : []).filter((t) => TIMES.includes(t))
    const type = TYPES.includes(body.type) ? body.type : 'Either'
    if (!days.length && !times.length && notes.length < 3) return { ok: false, status: 400, error: 'Choose the days or times that suit, or add a note.' }
    return { ok: true, value: { kind, player: known || player, type, days: [...new Set(days)], times: [...new Set(times)], coach: clean(body.coach, 80), notes } }
  }
  const matchDate = clean(body.matchDate, 10)
  if (matchDate && (!ISO.test(matchDate) || matchDate > today)) return { ok: false, status: 400, error: 'Choose the date of the match (today or earlier).' }
  const video = clean(body.video, 500)
  // An enquiry since 15 Oct 2026 (Lee): the video link is optional.
  if (video && !URL_OK.test(video)) return { ok: false, status: 400, error: 'That video link does not look right. Paste the full link, or leave it empty.' }
  return { ok: true, value: { kind, player: known || player, matchDate, video, sendLater: !video, notes } }
}

function parse(v) { try { return JSON.parse(v) } catch { return null } }
export async function listExtras() {
  const raw = await kvCommand(['HGETALL', KEY])
  const out = []
  for (let i = 0; i + 1 < (raw || []).length; i += 2) { const r = parse(raw[i + 1]); if (r) out.push(r) }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}
async function saveExtra(rec) { await kvCommand(['HSET', KEY, rec.id, JSON.stringify(rec)]); return rec }

async function underRateLimit(email) {
  const key = `jfp:extra-rate:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 24)}`
  const n = Number(await kvCommand(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", '1', key, '3600']))
  return n <= RATE_LIMIT
}

// What the family sees of their own requests.
export function familyExtraView(r) {
  return { id: r.id, kind: r.kind, kindLabel: KINDS[r.kind], player: r.player, status: r.status, createdAt: r.createdAt, ...(r.matchDate ? { matchLabel: dateLabel(r.matchDate) } : {}) }
}

// A family's request: saved, staff emailed (game analysis: Ligia and Dean too), Telegram told.
export async function submitExtra({ config, parent, parentName = '', players = [], kind, body, notify = { email: sendExtraRequestAlert, telegram: telegramAlert } }) {
  const v = cleanExtra(kind, body, { players })
  if (!v.ok) return v
  if (!(await underRateLimit(parent.email))) return { ok: false, status: 429, error: 'That is a lot of requests in a short time. Please call or email us instead.' }
  const price = kind === 'analysis' ? analysisPrice(config) : null
  const rec = {
    id: newId(kind === 'analysis' ? 'GA' : 'XS'), ...v.value, status: 'new',
    email: parent.email, parentName: clean(parentName, 100), phone: clean(body.phone, 40),
    ...(price ? { priceLabel: price.label } : {}),
    createdAt: new Date().toISOString(), deliveries: {},
  }
  await saveExtra(rec)
  const [mail, tg] = await Promise.allSettled([notify.email({ rec, config }), notify.telegram(`${KINDS[kind]} request: ${rec.player}${kind === 'extra' ? ` (${rec.type}${rec.days.length ? `, ${rec.days.join(', ')}` : ''})` : rec.matchDate ? ` (match ${dateLabel(rec.matchDate)})` : ''}. See Requests in the JFP portal.`)])
  rec.deliveries = { staff: mail.status === 'fulfilled' ? 'sent' : 'failed', telegram: tg.status === 'fulfilled' ? (tg.value === 'off' ? 'off' : String(tg.value).startsWith('failed') ? 'failed' : 'sent') : 'failed' }
  if (mail.status === 'rejected') console.error('jfp extra request email failed', rec.id, mail.reason?.message)
  await saveExtra(rec)
  await audit({ by: parent.email, action: `extra.${kind}`, target: rec.id, after: { player: rec.player, emailed: rec.deliveries.staff } })
  return { ok: true, record: rec }
}

// Staff: mark a request done (or back to new).
export async function setExtraStatus({ id, status, by }) {
  const rec = parse(await kvCommand(['HGET', KEY, clean(id, 60)]))
  if (!rec) return { ok: false, status: 404, error: 'We could not find that request.' }
  const next = ['new', 'done'].includes(status) ? status : ''
  if (!next) return { ok: false, status: 400, error: 'Choose new or done.' }
  const saved = await saveExtra({ ...rec, status: next, ...(next === 'done' ? { doneAt: new Date().toISOString(), doneBy: by } : {}) })
  await audit({ by, action: 'extra.status', target: rec.id, after: { status: next } })
  return { ok: true, record: saved }
}
