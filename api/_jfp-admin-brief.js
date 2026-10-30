// Daily brief, offer reminders and account follow ups (Lee, 30 Oct 2026).
//
// The brief: every morning from 7am Sydney, one Telegram message to the JFP
// admin chat (Lee and Ligia): requests waiting, offers not paid, new
// accounts, unpaid families, missing players. Staff only, so it is on unless
// config.dailyBrief is switched off.
//
// Offer reminders: one email to a family two days before the place we
// offered them runs out. Account follow ups: one email to a new account that
// added nobody and asked for nothing, 3 days after it was made. Both send
// nothing until Lee switches them on (config.offerReminders,
// config.accountFollowUps) after reading the words on the Follow ups page.
import { getConfig, getGroup, listApplications, listPayreqs, savePayreq, kvCommand, sydneyToday, locationFor, dateLabel, formatAud, audit } from './_jfp-store.js'
import { allAccounts } from './_jfp-account-open.js'
import { listExtras } from './_jfp-extras.js'

const SITE = 'https://jonerfootball.com'
export const PORTAL_URL = `${SITE}/jfp-portal/`
const BRIEF_SENT = 'jfp:brief:sent'
const FOLLOWED = 'jfp:acct-followup'
export const BRIEF_FROM_HOUR = 7
export const REMIND_HOURS = 48
export const FOLLOW_AFTER_DAYS = 3
// Older accounts are not chased when the switch goes on.
export const FOLLOW_MAX_DAYS = 30
const EXPIRING = new Set(['application', 'waitlist', 'trial'])
const DAY = 86400000
const ms = (iso) => Date.parse(iso || '') || 0
const staffEmail = (e) => /@jonerfootball\.com$/i.test(String(e || ''))
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || ''
const names = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] || '')

function sydneyHour(nowMs) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', hour12: false }).format(new Date(nowMs))) % 24
}
const longDate = (iso) => new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long', day: 'numeric', month: 'long' })
const ago = (iso, nowMs) => { const d = Math.floor((nowMs - ms(iso)) / DAY); return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago` }
async function groupLine(config, id) {
  if (id === 'one-to-one') return '1 to 1 coaching'
  const g = id ? await getGroup(id) : null
  return g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : id || 'no group'
}
// Away: by their answer, or by the connection's country while they have not answered (as New accounts does).
const awayOf = (a) => (a.where ? a.where.place !== 'sydney' : Boolean(a.from?.country && a.from.country !== 'AU'))

// ---------- offer reminders ----------

export function offerReminderWords({ parentName, players, group, expiresAt, url }) {
  return {
    subject: `Your place in ${group.split(',')[0]} is held until ${longDate(expiresAt)}`,
    heading: 'Your place is still held',
    paras: [
      `Hi ${firstName(parentName) || 'there'}. Just a reminder that the place we offered ${names(players)} in ${group} is held for you until ${longDate(expiresAt)}.`,
      'After that it goes to the next family waiting. Sign in with this email address to pay and lock it in. Card, Apple Pay or Afterpay.',
      'Any questions, just reply to this email.',
    ],
    cta: { label: 'Sign in and pay', url },
  }
}

const payUrl = (q) => `${SITE}/jfp-account/?pay=${encodeURIComponent(q.id)}`
const offerOpen = (q) => ['open', 'checkout'].includes(q.status) && EXPIRING.has(q.reason) && q.expiresAt && q.email

// Offers not paid yet, soonest to run out first, with whether they were reminded.
export async function openOffers(config, nowMs = Date.now()) {
  const list = (await listPayreqs()).filter((q) => offerOpen(q) && ms(q.expiresAt) > nowMs).sort((a, b) => ms(a.expiresAt) - ms(b.expiresAt))
  return Promise.all(list.map(async (q) => ({
    id: q.id, parentName: q.parentName || '', email: q.email, players: q.playerNames || [], kind: q.reason,
    group: q.groupLabel || (await groupLine(config, q.groupId)), amountLabel: formatAud(q.amountCents), expiresAt: q.expiresAt, remindedAt: q.remindedAt || '',
    due: ms(q.expiresAt) - nowMs <= REMIND_HOURS * 3600000,
  })))
}

// Sends one reminder for one offer. by: who pressed it, or 'the daily check'.
export async function remindOffer(id, { by, send }) {
  const q = (await listPayreqs()).find((x) => x.id === id)
  if (!q || !offerOpen(q)) return { error: 'That offer is paid, closed or gone.' }
  if (q.remindedAt) return { error: `Already reminded on ${dateLabel(q.remindedAt.slice(0, 10))}.` }
  const config = await getConfig()
  const w = offerReminderWords({ parentName: q.parentName, players: q.playerNames || [], group: q.groupLabel || (await groupLine(config, q.groupId)), expiresAt: q.expiresAt, url: payUrl(q) })
  const r = await send({ to: q.email, name: q.parentName || '', ...w, kind: 'offer reminder', replyTo: 'ligia@jonerfootball.com' })
  if (r?.held) return { held: true }
  await savePayreq({ ...q, remindedAt: new Date().toISOString(), remindedBy: by })
  await audit({ by, action: 'offer.remind', target: q.id, after: { to: q.email } })
  return { sent: true, to: q.email }
}

export async function offerReminderTick({ config, nowMs = Date.now(), send }) {
  if (config.offerReminders !== true) return { off: true }
  const sent = []
  for (const o of await openOffers(config, nowMs)) {
    if (!o.due || o.remindedAt) continue
    // Once per offer, even if two sweeps overlap.
    if ((await kvCommand(['SET', `jfp:offer-remind-lock:${o.id}`, '1', 'NX', 'EX', '3600'])) !== 'OK') continue
    const r = await remindOffer(o.id, { by: 'the daily check', send }).catch((e) => { console.error('jfp offer reminder failed', o.id, e); return { error: e.message } })
    if (r.sent) sent.push(o)
  }
  return { sent }
}

// ---------- account follow ups ----------

export function followUpWords({ away, country = '', coach = false, name = '' }) {
  if (away) {
    return {
      subject: 'Train with Joner Football from anywhere',
      heading: 'Joner Football, wherever you are',
      paras: [
        `Hi ${firstName(name) || 'there'}. Thanks for making a Joner Football account.`,
        `Our in-person sessions are in Sydney, so the best way to train with us${country ? ` from ${country}` : ''} is the Joner Football app.`,
        coach ? 'It has full sessions and drills you can run with your team, with videos of every one.' : 'It has full sessions and drills you can do anywhere, with videos of every one.',
        'Any questions, just reply to this email.',
      ],
      cta: { label: 'See the Joner Football app', url: `${SITE}/app/` },
    }
  }
  return {
    subject: 'Finish setting up your JFP account',
    heading: 'You are nearly there',
    paras: [
      `Hi ${firstName(name) || 'there'}. Thanks for making a Joner Football Performance account.`,
      'The next step is adding your player (or yourself, if you are the one playing) and picking a group. You can see every session, coach and place left, and book a trial session first if you want to try it.',
      'Any questions, just reply to this email and Ligia will help.',
    ],
    cta: { label: 'Finish setting up', url: `${SITE}/jfp-account/` },
  }
}

const countryOf = (a) => (a.where?.label || '').split('·')[1]?.trim() || ''

// Accounts the follow up would go to now (or went to), newest first.
// list: the New accounts rows (newAccountsData), so empty means what it means there.
export async function followUpList(list, nowMs = Date.now()) {
  const [accounts, apps, done] = await Promise.all([allAccounts(), listApplications(), kvCommand(['HGETALL', FOLLOWED])])
  const asked = new Set(apps.map((r) => String(r.email || '').toLowerCase()))
  const sent = {}
  for (let i = 0; i + 1 < (done || []).length; i += 2) sent[done[i]] = done[i + 1]
  return list.filter((a) => a.kind === 'new' && a.accountState === 'active' && a.status === 'empty' && !staffEmail(a.email) && !asked.has(a.email) && nowMs - ms(a.createdAt) <= FOLLOW_MAX_DAYS * DAY).map((a) => {
    const rec = accounts[a.email] || {}
    const away = awayOf(rec)
    return { email: a.email, createdAt: a.createdAt, away, country: away ? countryOf(rec) : '', coach: rec.where?.forWho === 'I coach', sentAt: sent[a.email] || '', due: !sent[a.email] && nowMs - ms(a.createdAt) >= FOLLOW_AFTER_DAYS * DAY }
  })
}

export async function followUpTick({ config, nowMs = Date.now(), list, send }) {
  if (config.accountFollowUps !== true) return { off: true }
  const sent = []
  for (const a of await followUpList(list, nowMs)) {
    if (!a.due) continue
    if (Number(await kvCommand(['HSETNX', FOLLOWED, a.email, new Date(nowMs).toISOString()])) !== 1) continue
    try {
      const r = await send({ to: a.email, ...followUpWords(a), kind: 'account follow up', replyTo: 'ligia@jonerfootball.com' })
      if (r?.held) { await kvCommand(['HDEL', FOLLOWED, a.email]); continue }
      sent.push(a)
    } catch (e) { console.error('jfp account follow up failed', e); await kvCommand(['HDEL', FOLLOWED, a.email]) }
  }
  return { sent }
}

// ---------- the daily brief ----------

export async function briefText({ config, nowMs = Date.now(), accounts, money, absences }) {
  const [apps, extras, offers, payreqs, done] = await Promise.all([listApplications(), listExtras(), openOffers(config, nowMs), listPayreqs(), kvCommand(['HGETALL', FOLLOWED])])
  const reminded = payreqs.filter((q) => q.remindedAt && nowMs - ms(q.remindedAt) <= DAY).map((q) => ({ players: q.playerNames || [], email: q.email }))
  const followed = []
  for (let i = 0; i + 1 < (done || []).length; i += 2) if (nowMs - ms(done[i + 1]) <= DAY) followed.push(done[i])
  const pending = apps.filter((r) => r.status === 'pending').sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
  const extraOpen = extras.filter((r) => r.status !== 'done')
  const fresh = accounts.filter((a) => a.kind === 'new' && nowMs - ms(a.createdAt) <= DAY)
  const freshAway = fresh.filter((a) => (a.where ? a.where.away === true : Boolean(a.from?.country && a.from.country !== 'AU'))).length
  const notBooked = accounts.filter((a) => a.kind === 'new' && !a.booked && a.accountState === 'active').length
  const owing = money.players.filter((p) => p.owingCents > 0).sort((a, b) => b.owingCents - a.owingCents)
  const owingCents = owing.reduce((t, p) => t + p.owingCents, 0)
  const L = [`JFP daily brief, ${dateLabel(sydneyToday(nowMs))}`, '']
  L.push(`Requests waiting: ${pending.length}`)
  for (const r of pending.slice(0, 8)) L.push(`- ${r.parentName || r.email}: ${(r.players || []).map((p) => `${p.name}${p.age != null ? ` (${p.age})` : ''}`).join(', ')}, ${await groupLine(config, r.groupId)}, ${ago(r.createdAt, nowMs)}`)
  if (extraOpen.length) L.push(`Extra session and game analysis requests open: ${extraOpen.length}`)
  L.push('', `Offers not paid yet: ${offers.length}`)
  for (const o of offers.slice(0, 8)) L.push(`- ${names(o.players)}, ${o.group}, ${o.amountLabel}, runs out ${dateLabel(sydneyToday(ms(o.expiresAt)))}${o.remindedAt ? ' (reminded)' : ''}`)
  L.push('', `New accounts in the last day: ${fresh.length}${fresh.length ? ` (${fresh.length - freshAway} Sydney, ${freshAway} outside Sydney)` : ''}`)
  for (const a of fresh.slice(0, 8)) L.push(`- ${a.parent || a.email}${a.players.length ? `: ${a.players.map((p) => p.name).join(', ')}` : ', nobody added yet'}${a.booked ? ', booked' : ''}`)
  L.push(`New accounts not booked yet: ${notBooked}`)
  L.push('', `Unpaid this term: ${owing.length} player${owing.length === 1 ? '' : 's'}, ${formatAud(owingCents)} owing`)
  for (const p of owing.slice(0, 6)) L.push(`- ${p.player}, ${formatAud(p.owingCents)}${p.openLink ? ', link sent' : ', no link yet'}`)
  if (owing.length > 6) L.push(`- and ${owing.length - 6} more`)
  L.push('', `Missing players to follow up: ${absences}`)
  if (reminded.length || followed.length) {
    L.push('', 'Sent by the portal since yesterday:')
    for (const o of reminded) L.push(`- Offer reminder: ${names(o.players)}`)
    if (followed.length) L.push(`- Finish setting up emails: ${followed.length}`)
  }
  L.push('', PORTAL_URL)
  return L.join('\n')
}

// Once a day from 7am Sydney.
export async function briefTick({ config, nowMs = Date.now(), load, send }) {
  if (config.dailyBrief === false) return { off: true }
  if (sydneyHour(nowMs) < BRIEF_FROM_HOUR) return { notNow: true }
  const today = sydneyToday(nowMs)
  if (Number(await kvCommand(['HSETNX', BRIEF_SENT, today, new Date(nowMs).toISOString()])) !== 1) return { already: true }
  try {
    const text = await briefText({ config, nowMs, ...(await load()) })
    const r = await send(text)
    if (r !== 'sent') throw new Error(`telegram ${r}`)
    return { sent: true }
  } catch (error) { await kvCommand(['HDEL', BRIEF_SENT, today]); throw error }
}
