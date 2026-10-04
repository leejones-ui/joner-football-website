// What parents see: the whole program as a timetable. Every open group with
// its coach, place, who it is for, and places left, plus the three locations.
// An explicit allowlist of fields. Never player names, contacts, notes or
// payments, and no term price: parents see what they pay when they book.
import { requireParentAccess, getConfig, coachLabel, kvGetJson, listGroups, onlineCounts, publicPlacesLeft, coachById, sessionDates, dateLabel, formatAud, to24h, locationFor, periodOf, dayOrder, QUESTIONS, REQUIREMENTS, ONE_TO_ONE, skippedDates } from './_jfp-store.js'
import { airtableCounts } from './_jfp-airtable.js'
import { sweepExpiredOffersSometimes } from './_jfp-offers.js'

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
    minAge: g.minAge ?? config.minAge,
    maxAge: g.maxAge ?? config.maxAge,
    girlsOnly: g.girlsOnly === 'yes',
    // Popular groups keep taking applications when full (Lee, 5 Oct 2026).
    applyWhenFull: g.mode === 'application' && g.applyWhenFull === true,
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
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  if (!requireParentAccess(req, res)) return
  try {
    await sweepExpiredOffersSometimes()
    const [config, groups] = await Promise.all([getConfig(), listGroups()])
    const open = groups.filter((g) => g.mode !== 'closed')
    let counts
    try { counts = (await airtableCounts()).counts } catch (error) {
      // Without the roster we cannot know what is free, so nothing is bookable.
      console.error('jfp airtable counts failed', error)
      return res.status(503).json({ success: false, error: 'Bookings are briefly unavailable. Try again in a minute.' })
    }
    const online = await onlineCounts(open.map((g) => g.id))
    const list = open.map((g) => publicGroup(g, config, publicPlacesLeft(g, counts[g.id], online[g.id])))
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
        { section: 'Term', title: 'JFP Pathway', price: formatAud(config.prices.pathway), note: 'Younger players, 45 minutes' },
        { section: 'Term', title: 'Trial session', price: formatAud(config.prices.trial), note: 'Comes off the term' },
        { section: '1 to 1', title: 'Term of 1 to 1s', price: formatAud(config.prices.oneToOneTerm), note: 'One a week' },
        { section: '1 to 1', title: 'Pathway 1 to 1s', price: formatAud(config.prices.pathwayOneToOne), note: 'One a week, 45 minutes' },
        { section: '1 to 1', title: 'One off 1 to 1', price: formatAud(config.prices.oneToOne), note: 'Single session' },
      ],
      kit: { url: config.kitUrl, price: config.kitPriceLabel, note: config.kitNote },
      minAge: config.minAge,
      maxAge: config.maxAge,
      locations,
      coaches,
      groups: list,
      // One enquiry card for private coaching, whenever the program runs any.
      privateCoaching: groups.some((g) => g.label === '1 to 1') ? { ...publicGroup(ONE_TO_ONE, config, null), sortTime: '99:99', firstDate: '', lastDate: '', sessions: 0 } : null,
    })
  } catch (error) {
    console.error('jfp-groups failed', error)
    return res.status(500).json({ success: false, error: 'Could not load groups. Try again in a moment.' })
  }
}
