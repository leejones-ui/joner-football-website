// What parents see: the whole program as a timetable. Every open group with
// its coach, place, who it is for, and places left, plus the three locations.
// An explicit allowlist of fields. Never player names, contacts, notes or
// payments, and no term price: parents see what they pay when they book.
import { requireParentAccess, getConfig, coachLabel, kvGetJson, listGroups, onlineCounts, publicPlacesLeft, coachById, sessionDates, dateLabel, formatAud, to24h, locationFor, periodOf, dayOrder, QUESTIONS, REQUIREMENTS, ONE_TO_ONE, skippedDates } from './_jfp-store.js'
import { airtableCounts } from './_jfp-airtable.js'
import { listExtraSlots } from './_jfp-extra.js'
import { sessionKind } from './_jfp-family-extra.js'
import { sweepExpiredOffers } from './_jfp-offers.js'
import { coachTick } from './_jfp-coach-alerts.js'
import { pushTick } from './_jfp-push.js'
async function runReportTick() {
  const { reportTick, staffSummary } = await import('./_jfp-report-due.js')
  const { tellCoach } = await import('./_jfp-coach-alerts.js')
  const { sendStaffNotice, cancelStaffTo } = await import('./_jfp-email.js')
  const { telegramAlert } = await import('./_jfp-notify.js')
  const cfg = await getConfig()
  return reportTick({ send: {
    coach: (m) => tellCoach(m),
    staff: async (s) => {
      try { await telegramAlert(`JFP ${s.subject}\n${s.lines.join('\n')}\n\nhttps://jonerfootball.com/jfp-portal/#reports`) } catch (e) { console.error('report telegram failed', e) }
      await sendStaffNotice({ to: cancelStaffTo(cfg), subject: s.subject, heading: 'Player reports at the end of week 9', paras: ['Where each coach is with their player reports:'], list: s.lines.map((l) => { const i = l.indexOf(':'); return [l.slice(0, i), l.slice(i + 2)] }), cta: { label: 'Open Player reports', url: 'https://jonerfootball.com/jfp-portal/#reports' }, kind: 'report summary' })
    },
  } })
}
// Missing players (20 Oct 2026): the Monday email to Ligia, off until config.absenceDigest.
// Run from the evening push tick and the hourly sweep; it goes once, Monday from 7am Sydney.
async function runAbsenceTick(nowMs) {
  const { absenceDigestTick } = await import('./_jfp-absence.js')
  const { sendStaffNotice, cancelStaffTo } = await import('./_jfp-email.js')
  const cfg = await getConfig()
  return absenceDigestTick({ config: cfg, nowMs, send: (m) => sendStaffNotice({ to: cancelStaffTo(cfg), ...m, kind: 'absence digest' }) })
}
// Follow ups (30 Oct 2026, _jfp-admin-brief.js): offer reminders and the finish
// setting up email (each off until Lee switches it on), then the daily brief
// on Telegram from 7am Sydney.
async function runFollowUps(nowMs) {
  const B = await import('./_jfp-admin-brief.js')
  const { sendFamilyNotice } = await import('./_jfp-email.js')
  const { telegramAlert } = await import('./_jfp-notify.js')
  const { briefInputs } = await import('./jfp-portal-data.js')
  const cfg = await getConfig()
  try { await B.offerReminderTick({ config: cfg, nowMs, send: sendFamilyNotice }) } catch (e) { console.error('jfp offer reminders failed', e) }
  let inputs = null
  const load = async () => (inputs ||= await briefInputs(cfg))
  if (cfg.accountFollowUps === true) { try { await B.followUpTick({ config: cfg, nowMs, list: (await load()).accounts, send: sendFamilyNotice }) } catch (e) { console.error('jfp account follow ups failed', e) } }
  return B.briefTick({ config: cfg, nowMs, load, send: telegramAlert })
}
import { reconcileStripe } from './jfp-portal-data.js'
// Auto-charge after each session (claude/card-on-file).
import { cronAutoCharges } from './_jfp-saved-pay.js'

export function coachPhotoUrl(c) { return `/api/jfp-groups?coachPhoto=${encodeURIComponent(c.id)}&v=${c.photoV}` }

// A coach's profile photo. Public on purpose: parents see it on the
// timetable, and the portal shows it before anyone signs in.
async function sendCoachPhoto(req, res) {
  const id = String(req.query?.coachPhoto || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30)
  const photo = id ? await kvGetJson(`jfp:coach-photo:${id}`) : null
  if (!photo?.b64 || !/^image\/(jpeg|png|webp)$/.test(photo.type || '')) return res.status(404).end()
  res.setHeader('Content-Type', photo.type)
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  return res.status(200).end(Buffer.from(photo.b64, 'base64'))
}

// A coaching photo from a coach's profile. Public like the profile photo.
async function sendGalleryPhoto(req, res) {
  const id = String(req.query?.coachGallery || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30)
  const v = String(req.query?.g || '').replace(/\D/g, '').slice(0, 16)
  const photo = id && v ? await kvGetJson(`jfp:coach-gallery:${id}:${v}`) : null
  if (!photo?.b64 || !/^image\/(jpeg|png|webp)$/.test(photo.type || '')) return res.status(404).end()
  res.setHeader('Content-Type', photo.type)
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  return res.status(200).end(Buffer.from(photo.b64, 'base64'))
}

// Public extras show for the next 3 weeks (Lee, 27 Oct 2026; was 7 days).
const WEEK_MS = 21 * 86400000
export async function weekExtras(config, nowMs = Date.now()) {
  const until = new Date(nowMs + WEEK_MS).toISOString().slice(0, 10)
  try {
    return (await listExtraSlots({ config, publicOnly: true })).filter((s) => s.date <= until).sort((a, b) => `${a.date}${to24h(a.time)}`.localeCompare(`${b.date}${to24h(b.time)}`)).slice(0, 12)
      .map((s) => ({ id: s.id, date: s.date, dateLabel: s.dateLabel, time: s.time, durationMin: s.durationMin, location: s.location, kind: s.whole ? s.options.map((o) => (o.type === 'one' ? '1 on 1' : 'Group')).join(' or ') : sessionKind(s.capacity), ...(s.whole ? { whole: true } : {}), coach: s.coachName ? `Coach ${s.coachName}` : '', placesLeft: s.placesLeft, full: s.placesLeft <= 0, ...(s.weekly ? { weekly: `Every ${s.dayName}` } : {}) }))
  } catch (error) { console.error('jfp week extras failed', error.message); return [] }
}

export function publicGroup(g, config, left) {
  const coach = coachById(config, g.coachId)
  const dates = sessionDates(config, g.day)
  const loc = locationFor(config, g.location)
  const counted = g.mode === 'direct' || g.mode === 'application'
  return {
    id: g.id,
    day: g.day,
    time: g.time,
    sortTime: to24h(g.time),
    period: periodOf(g),
    locationId: loc.id,
    location: loc.name,
    coachId: coach?.id || '',
    coachName: coach ? `Coach ${coachLabel(coach)}` : '',
    coachPhoto: coach?.photoV ? coachPhotoUrl(coach) : '',
    label: g.label || 'Small group',
    mode: g.mode,
    durationMin: g.durationMin,
    // No age range on a session (Lee, 12 Oct 2026: every session except his
    // own): parents see "All ages and levels can apply", never a default range.
    minAge: g.minAge ?? null,
    maxAge: g.maxAge ?? null,
    girlsOnly: g.girlsOnly === 'yes',
    // Popular groups keep taking applications when full (Lee, 5 Oct 2026).
    applyWhenFull: g.mode === 'application' && g.applyWhenFull === true,
    allowOneToOne: g.mode === 'direct' && g.allowOneToOne === true,
    capacity: g.capacity,
    placesLeft: counted ? left : null,
    full: counted && left <= 0,
    trials: g.mode === 'application' && g.trials !== false,
    questions: g.mode === 'enquire' ? [] : (g.questions || []).filter((q) => QUESTIONS[q]).map((q) => ({ key: q, label: QUESTIONS[q] })),
    requirements: (g.requirements || []).filter((q) => REQUIREMENTS[q]).map((q) => REQUIREMENTS[q]),
    requirementsText: g.requirementsText || '',
    // Each card carries its location as a banner (Lee: no photo per card).
    locationBanner: loc.banner || loc.name,
    firstDate: dates[0] ? dateLabel(dates[0]) : '',
    lastDate: dates.at(-1) ? dateLabel(dates.at(-1)) : '',
    sessions: dates.length,
    publicNote: g.publicNote || '',
    noSession: skippedDates(config, g.day).map((x) => `${dateLabel(x.date)} (${x.reason})`),
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query?.coachPhoto) return sendCoachPhoto(req, res)
  if (req.method === 'GET' && req.query?.coachGallery) return sendGalleryPhoto(req, res)
  // The hourly Vercel cron gives back places from offers not paid within 7
  // days. A family loading the timetable never changes anything (review, 5 Oct).
  // Every 5 minutes: coach alerts (new player in your group, register not done).
  if (req.method === 'GET' && req.query?.coachTick) {
    const secret = process.env.CRON_SECRET
    if (!secret || String(req.headers?.authorization || '') !== `Bearer ${secret}`) return res.status(401).json({ success: false })
    try { const now = process.env.JFP_TEST_CLOCK === '1' && Number(req.query.now) ? Number(req.query.now) : Date.now(); return res.status(200).json({ success: true, ...(await coachTick(await getConfig(), now)) }) } catch (error) { console.error('jfp coach tick failed', error); return res.status(500).json({ success: false }) }
  }
  // Nightly (about 6pm Sydney): push reminders for tomorrow, session changes,
  // new payments and announcements that start today (_jfp-push.js).
  if (req.method === 'GET' && req.query?.pushTick) {
    const secret = process.env.CRON_SECRET
    if (!secret || String(req.headers?.authorization || '') !== `Bearer ${secret}`) return res.status(401).json({ success: false })
    try { const now = process.env.JFP_TEST_CLOCK === '1' && Number(req.query.now) ? Number(req.query.now) : Date.now(); const push = await pushTick(now)
      // Player reports due in week 9 (20 Oct 2026): off until config.reportReminders.
      let reports = null
      try { reports = await runReportTick() } catch (error) { console.error('jfp report tick failed', error); reports = { error: true } }
      let absence = null
      try { absence = await runAbsenceTick(now) } catch (error) { console.error('jfp absence digest failed', error); absence = { error: true } }
      return res.status(200).json({ success: true, ...push, reports, absence }) } catch (error) { console.error('jfp push tick failed', error); return res.status(500).json({ success: false }) }
  }
  // Check the JF App link: the Uscreen group JFP (seats left) and the app video
  // list for Session ideas. Read only; ?refresh=1 reloads the video list.
  if (req.method === 'GET' && req.query?.uscreenCheck) {
    const secret = process.env.CRON_SECRET
    if (!secret || String(req.headers?.authorization || '') !== `Bearer ${secret}`) return res.status(401).json({ success: false })
    try {
      const { findJfpGroup, appCatalog } = await import('./_jfp-uscreen.js')
      const [group, cat] = await Promise.all([findJfpGroup().catch((e) => ({ error: e.message })), appCatalog({ refresh: req.query.refresh === '1' })])
      return res.status(200).json({ success: true, group, videos: cat.videos.length, catalogAt: cat.at, sample: cat.videos.slice(0, 2).map((v) => ({ title: v.title, cats: v.cats, url: v.url, img: Boolean(v.img) })) })
    } catch (error) { console.error('jfp uscreen check failed', error); return res.status(500).json({ success: false, error: error.message }) }
  }
  // Nightly money check (about 9pm Sydney): Stripe against Airtable, read only (_jfp-nightly.js).
  if (req.method === 'GET' && req.query?.nightly) {
    const secret = process.env.CRON_SECRET
    if (!secret || String(req.headers?.authorization || '') !== `Bearer ${secret}`) return res.status(401).json({ success: false })
    try { const { runNightly } = await import('./_jfp-nightly.js'); const r = await runNightly(); return res.status(200).json({ success: true, ok: r.ok, counts: r.counts, newCount: r.newCount }) } catch (error) { console.error('jfp nightly check failed', error); return res.status(500).json({ success: false }) }
  }
  // Daily (10:00 Sydney time): charge saved cards and accounts for yesterday's sessions (claude/card-on-file).
  if (req.method === 'GET' && req.query?.autoCharge) {
    const secret = process.env.CRON_SECRET
    if (!secret || String(req.headers?.authorization || '') !== `Bearer ${secret}`) return res.status(401).json({ success: false })
    try { const now = process.env.JFP_TEST_CLOCK === '1' && Number(req.query.now) ? Number(req.query.now) : Date.now(); return res.status(200).json({ success: true, ...(await cronAutoCharges({ nowMs: now })) }) } catch (error) { console.error('jfp auto-charge cron failed', error); return res.status(500).json({ success: false }) }
  }
  if (req.method === 'GET' && req.query?.sweep) {
    const secret = process.env.CRON_SECRET
    if (!secret || String(req.headers?.authorization || '') !== `Bearer ${secret}`) return res.status(401).json({ success: false })
    // Backstop for the Stripe webhook: any JFP payment Airtable does not show yet.
    let stripe = null
    try { stripe = await reconcileStripe(await getConfig(), undefined, { alert: true }) } catch (error) { console.error('jfp stripe sync failed', error) }
    // A place opened in a group with a waitlist: email those waiting (_jfp-waitlist-open.js).
    try { const { waitlistTick } = await import('./_jfp-waitlist-open.js'); await waitlistTick(await getConfig()) } catch (error) { console.error('jfp waitlist place check failed', error) }
    // Coach invoices due Monday 9am: a Sunday 6pm reminder, a Monday 9am list for Lee and Ligia.
    try {
      const [{ invoiceReminders }, { sendCoachNotice }, { claimOnce }] = await Promise.all([import('./_jfp-coach-invoices.js'), import('./_jfp-email.js'), import('./_holiday-store.js')])
      const now = process.env.JFP_TEST_CLOCK === '1' && Number(req.query.now) ? Number(req.query.now) : Date.now()
      await invoiceReminders(await getConfig(), { nowMs: now, sendCoach: sendCoachNotice, claimOnce })
    } catch (error) { console.error('jfp coach invoice reminders failed', error) }
    try { await runAbsenceTick(process.env.JFP_TEST_CLOCK === '1' && Number(req.query.now) ? Number(req.query.now) : Date.now()) } catch (error) { console.error('jfp absence digest failed', error) }
    try { await runFollowUps(process.env.JFP_TEST_CLOCK === '1' && Number(req.query.now) ? Number(req.query.now) : Date.now()) } catch (error) { console.error('jfp follow ups and brief failed', error) }
    try { await sweepExpiredOffers({ email: 'hourly check' }); return res.status(200).json({ success: true, stripe: stripe ? { recorded: stripe.recorded, failed: stripe.failed?.length || 0, busy: Boolean(stripe.busy) } : null }) } catch (error) { console.error('jfp offer sweep failed', error); return res.status(500).json({ success: false }) }
  }
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  if (!requireParentAccess(req, res, await getConfig())) return
  try {
    const [config, groups] = await Promise.all([getConfig(), listGroups()])
    // Joners Juniors is closed to JFP bookings but shown to families as a
    // card whose Book now goes to the Joners Juniors sign-up page (Lee, 12 Oct).
    const isJuniors = (g) => g.label === 'Joners Juniors'
    const open = groups.filter((g) => g.mode !== 'closed' || isJuniors(g))
    let counts
    try { counts = (await airtableCounts({ groups, config })).counts } catch (error) {
      // Without the roster we cannot know what is free, so nothing is bookable.
      console.error('jfp airtable counts failed', error)
      return res.status(503).json({ success: false, error: 'Bookings are briefly unavailable. Try again in a minute.' })
    }
    const online = await onlineCounts(open.map((g) => g.id))
    const list = open.map((g) => isJuniors(g)
      ? { ...publicGroup(g, config, null), mode: 'signup', signupUrl: '/jonersjuniors', placesLeft: null, full: false, trials: false, questions: [], oneToOneOpen: false }
      : { ...publicGroup(g, config, publicPlacesLeft(g, counts[g.id], online[g.id])), oneToOneOpen: g.mode === 'direct' && g.allowOneToOne === true && !g.showFull && !(counts[g.id] > 0) && !(online[g.id] > 0) })
    const locations = config.locations.map((l) => {
      const mine = list.filter((g) => g.locationId === l.id)
      return {
        id: l.id, name: l.name, banner: l.banner || l.name, address: l.address, maps: l.maps, photo: l.photo, blurb: l.blurb,
        groups: mine.length,
        spots: mine.reduce((t, g) => t + Math.max(0, g.placesLeft || 0), 0),
        bookable: mine.filter((g) => g.mode === 'direct' && !g.full).length,
        full: mine.length > 0 && mine.every((g) => g.full),
      }
    }).filter((l) => l.groups > 0)
    const coaches = [...new Map(list.filter((g) => g.coachId).map((g) => [g.coachId, { id: g.coachId, name: g.coachName, photo: g.coachPhoto }])).values()]
    const firstDay = open.map((g) => g.day).sort((a, b) => dayOrder(a) - dayOrder(b))[0] || 'Monday'
    const lastDay = open.map((g) => g.day).sort((a, b) => dayOrder(b) - dayOrder(a))[0] || 'Monday'
    const startIso = sessionDates(config, firstDay)[0] || config.termStart
    const endIso = sessionDates(config, lastDay).at(-1) || config.termStart
    const long = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T00:00:00Z`)).replace(',', '')
    return res.status(200).json({
      success: true,
      term: config.term,
      termLabel: config.term.replace(/\s*\d{4}$/, ''),
      termStart: dateLabel(startIso),
      termEnd: dateLabel(endIso),
      termRange: `${long(startIso)} to ${long(endIso)} ${endIso.slice(0, 4)}`,
      termStartIso: config.termStart,
      weeks: config.weeks,
      trialPriceLabel: formatAud(config.prices.trial),
      kitUrl: config.kitUrl,
      kitPriceLabel: config.kitPriceLabel,
      // The Pricing tab: Lee's price list, from the Prices tab in the portal.
      // Short on purpose (Lee: easy to read): a name, a price, a few words.
      pricing: [
        { section: 'Term', title: 'Small group', price: formatAud(config.prices.group), note: `${config.weeks} sessions` },
        { section: 'Term', title: 'Two a week, or two siblings', price: formatAud(config.prices.twoAWeek), note: 'Two places' },
        { section: 'Term', title: 'Second child, any group', price: formatAud(config.prices.sibling), note: 'When a brother or sister has a paid place' },
        { section: 'Term', title: 'JFP Pathway', price: formatAud(config.prices.pathway), note: 'Younger players' },
        { section: 'Term', title: 'Trial session', price: formatAud(config.prices.trial), note: 'Comes off the term' },
        { section: '1 to 1', title: 'Term of 1 to 1s', price: formatAud(config.prices.oneToOneTerm), note: 'One a week. Book on the timetable where it says Group or 1 to 1' },
        { section: '1 to 1', title: 'Pathway 1 to 1s', price: formatAud(config.prices.pathwayOneToOne), note: 'One a week' },
        { section: '1 to 1', title: 'One off 1 to 1', price: formatAud(config.prices.oneToOne), note: 'Single session' },
      ],
      kit: { url: config.kitUrl, price: config.kitPriceLabel, note: config.kitNote },
      minAge: config.minAge,
      maxAge: config.maxAge,
      locations,
      coaches,
      groups: list,
      // Public extra sessions in the next 3 weeks, on their own tab (Lee, 19 Oct
      // 2026). A session drops off by itself once it has started. The coach and
      // the kind of session, no price: families book in My account.
      extras: await weekExtras(config),
      // One enquiry card for private coaching, whenever the program runs any.
      privateCoaching: groups.some((g) => g.label === '1 to 1') ? { ...publicGroup(ONE_TO_ONE, config, null), sortTime: '99:99', firstDate: '', lastDate: '', sessions: 0 } : null,
    })
  } catch (error) {
    console.error('jfp-groups failed', error)
    return res.status(500).json({ success: false, error: 'Could not load groups. Try again in a moment.' })
  }
}
