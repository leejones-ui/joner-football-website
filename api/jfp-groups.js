// What parents see: the groups staff have opened, with places left, who each
// group is for, and the three locations. An explicit allowlist of fields.
// Never player names, contacts, notes or payments.
import { requireParentAccess, getConfig, listGroups, onlineCounts, placesLeft, coachById, sessionDates, dateLabel, formatAud, to24h, locationFor, ONE_TO_ONE } from './_jfp-store.js'
import { airtableCounts } from './_jfp-airtable.js'
import { sweepExpiredOffersSometimes } from './_jfp-offers.js'

export function publicGroup(g, config, left) {
  const coach = coachById(config, g.coachId)
  const dates = sessionDates(config, g.day)
  const loc = locationFor(config, g.location)
  const bookable = g.mode === 'direct'
  return {
    id: g.id,
    day: g.day,
    time: g.time,
    sortTime: to24h(g.time),
    locationId: loc.id,
    location: loc.name,
    coachName: coach ? `Coach ${coach.name}` : '',
    label: g.label || 'Small group',
    mode: g.mode,
    durationMin: g.durationMin,
    minAge: g.minAge ?? config.minAge,
    maxAge: g.maxAge ?? config.maxAge,
    girlsOnly: g.girlsOnly === 'yes',
    capacity: g.capacity,
    placesLeft: bookable ? left : null,
    full: bookable && left <= 0,
    firstDate: dates[0] ? dateLabel(dates[0]) : '',
    lastDate: dates.at(-1) ? dateLabel(dates.at(-1)) : '',
    sessions: dates.length,
    priceLabel: g.mode === 'enquire' ? '' : formatAud(config.priceCents),
    publicNote: g.publicNote || '',
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
        id: l.id, name: l.name, address: l.address, maps: l.maps, photo: l.photo, blurb: l.blurb,
        groups: mine.length,
        bookable: mine.filter((g) => g.mode === 'direct').length,
        spots: mine.filter((g) => g.mode === 'direct').reduce((t, g) => t + (g.placesLeft || 0), 0),
        applyOnly: mine.length > 0 && mine.every((g) => g.mode !== 'direct'),
      }
    }).filter((l) => l.groups > 0)
    const monday = sessionDates(config, 'Monday')
    return res.status(200).json({
      success: true,
      term: config.term,
      termStart: monday[0] ? dateLabel(monday[0]) : '',
      termEnd: monday.at(-1) ? dateLabel(monday.at(-1)) : '',
      termStartIso: config.termStart,
      weeks: config.weeks,
      priceLabel: formatAud(config.priceCents),
      minAge: config.minAge,
      maxAge: config.maxAge,
      locations,
      groups: list,
      // One enquiry card for private coaching, whenever the programme runs any.
      privateCoaching: groups.some((g) => g.label === '1 to 1') ? { ...publicGroup(ONE_TO_ONE, config, null), sortTime: '99:99', firstDate: '', lastDate: '', sessions: 0 } : null,
    })
  } catch (error) {
    console.error('jfp-groups failed', error)
    return res.status(500).json({ success: false, error: 'Could not load groups. Try again in a moment.' })
  }
}
