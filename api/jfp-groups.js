// What parents see: groups staff have opened, with places left. An explicit
// allowlist of fields. Never player names, contacts, notes or payments.
import { requireParentAccess, getConfig, listGroups, onlineCounts, placesLeft, coachById, sessionDates, dateLabel, formatAud, to24h } from './_jfp-store.js'
import { airtableCounts } from './_jfp-airtable.js'
import { locationLine } from './_jfp-email.js'

export function publicGroup(g, config, left) {
  const coach = coachById(config, g.coachId)
  const dates = sessionDates(config, g.day)
  return {
    id: g.id,
    day: g.day,
    time: g.time,
    sortTime: to24h(g.time),
    location: g.location,
    address: locationLine(g.location),
    coachName: coach ? `Coach ${coach.name}` : '',
    programme: g.programme,
    mode: g.mode,
    durationMin: g.durationMin,
    placesLeft: g.mode === 'direct' ? left : null,
    full: g.mode === 'direct' && left <= 0,
    firstDate: dates[0] ? dateLabel(dates[0]) : '',
    lastDate: dates.at(-1) ? dateLabel(dates.at(-1)) : '',
    sessions: dates.length,
    priceCents: config.priceCents,
    priceLabel: formatAud(config.priceCents),
    publicNote: g.publicNote || '',
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  if (!requireParentAccess(req, res)) return
  try {
    const [config, groups] = await Promise.all([getConfig(), listGroups()])
    const open = groups.filter((g) => g.mode !== 'closed')
    let counts
    try { counts = (await airtableCounts()).counts } catch (error) {
      // Without the roster we cannot know what is free, so nothing is bookable.
      console.error('jfp airtable counts failed', error)
      return res.status(503).json({ success: false, error: 'Bookings are briefly unavailable. Try again in a minute.' })
    }
    const online = await onlineCounts(open.map((g) => g.id))
    return res.status(200).json({
      success: true,
      term: config.term,
      termStart: sessionDates(config, 'Monday')[0] ? dateLabel(sessionDates(config, 'Monday')[0]) : '',
      priceLabel: formatAud(config.priceCents),
      groups: open.map((g) => publicGroup(g, config, placesLeft(g, counts[g.id], online[g.id]))),
    })
  } catch (error) {
    console.error('jfp-groups failed', error)
    return res.status(500).json({ success: false, error: 'Could not load groups. Try again in a moment.' })
  }
}
