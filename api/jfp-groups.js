// What parents see: the whole program as a timetable. Every open group with
// its coach, place, who it is for, and places left, plus the three locations.
// An explicit allowlist of fields. Never player names, contacts, notes or
// payments, and no term price: parents see what they pay when they book.
import { requireParentAccess, getConfig, listGroups, onlineCounts, placesLeft, coachById, sessionDates, dateLabel, formatAud, to24h, locationFor, periodOf, dayOrder, QUESTIONS, REQUIREMENTS, ONE_TO_ONE, skippedDates } from './_jfp-store.js'
import { airtableCounts } from './_jfp-airtable.js'
import { sweepExpiredOffersSometimes } from './_jfp-offers.js'

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
    coachName: coach ? `Coach ${coach.name}` : '',
    label: g.label || 'Small group',
    mode: g.mode,
    durationMin: g.durationMin,
    minAge: g.minAge ?? config.minAge,
    maxAge: g.maxAge ?? config.maxAge,
    girlsOnly: g.girlsOnly === 'yes',
    capacity: g.capacity,
    placesLeft: counted ? left : null,
    full: counted && left <= 0,
    trials: g.mode === 'application' && g.trials !== false,
    questions: g.mode === 'enquire' ? [] : (g.questions || []).filter((q) => QUESTIONS[q]).map((q) => ({ key: q, label: QUESTIONS[q] })),
    requirements: (g.requirements || []).filter((q) => REQUIREMENTS[q]).map((q) => REQUIREMENTS[q]),
    photo: loc.photo || '',
    firstDate: dates[0] ? dateLabel(dates[0]) : '',
    lastDate: dates.at(-1) ? dateLabel(dates.at(-1)) : '',
    sessions: dates.length,
    publicNote: g.publicNote || '',
    noSession: skippedDates(config, g.day).map((x) => `${dateLabel(x.date)} (${x.reason})`),
  }
}

export default async function handler(req, res) {
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
    const list = open.map((g) => publicGroup(g, config, placesLeft(g, counts[g.id], online[g.id])))
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
    const coaches = [...new Map(list.filter((g) => g.coachId).map((g) => [g.coachId, { id: g.coachId, name: g.coachName }])).values()]
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
      // The Pricing tab: Lee's price list, from the Prices tab in the portal.
      pricing: [
        { title: 'Small group, full term', price: formatAud(config.prices.group), note: `${config.weeks} weekly 60 minute sessions, ${formatAud(Math.round(config.prices.group / config.weeks))} a session. Small groups by age and level.` },
        { title: 'Two a week, or two siblings', price: formatAud(config.prices.twoAWeek), note: `For two places: one player training twice a week, or two siblings. ${formatAud(Math.round(config.prices.twoAWeek / 2))} a place.` },
        { title: 'JFP Pathway, full term', price: formatAud(config.prices.pathway), note: 'Our younger players program: a 45 minute class each week.' },
        { title: 'Term of 1 to 1 coaching', price: formatAud(config.prices.oneToOneTerm), note: `One private session a week for the term, ${formatAud(Math.round(config.prices.oneToOneTerm / config.weeks))} a session.` },
        { title: 'Pathway 1 to 1, full term', price: formatAud(config.prices.pathwayOneToOne), note: 'Private 45 minute sessions for younger players, weekly for the term.' },
        { title: 'One off 1 to 1', price: formatAud(config.prices.oneToOne), note: 'A single private session to work on something specific.' },
        { title: 'Trial session', price: formatAud(config.prices.trial), note: 'One session in the group before committing. Taken off the term if the player joins.' },
      ],
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
