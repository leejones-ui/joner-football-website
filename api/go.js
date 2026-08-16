import { getTrackingDestination, getTrackingDestinationToken, getTrackingLink } from './_tracking-link-bank.js'
import { createOrTouchJourney, journeyStoreConfigured } from './_journey-ledger.js'

const safe = (value, max = 240) => String(value || '').trim().slice(0, max)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const link = getTrackingLink(req.query?.token)
  if (!link.source) return res.status(404).json({ success: false, error: 'Unknown tracking link' })

  const destination = new URL(getTrackingDestination(req.query?.to, link.destination), 'https://jonerfootball.com')
  destination.searchParams.set('utm_source', link.source)
  destination.searchParams.set('utm_medium', link.channel)
  destination.searchParams.set('utm_campaign', safe(req.query?.campaign) || link.campaign)
  destination.searchParams.set('utm_content', safe(req.query?.content) || link.content)
  destination.searchParams.set('link_token', link.token)
  destination.searchParams.set('source_detail', link.source)
  destination.searchParams.set('source_taxonomy', link.source)
  destination.searchParams.set('destination_token', getTrackingDestinationToken(req.query?.to))

  if (journeyStoreConfigured()) {
    try {
      const result = await createOrTouchJourney({
        attribution: Object.fromEntries(destination.searchParams.entries()),
        page_path: destination.pathname,
        referrer: safe(req.headers?.referer || req.headers?.referrer, 800),
      })
      res.setHeader('Set-Cookie', `jf_journey_id=${encodeURIComponent(result.token)}; Max-Age=15552000; Path=/; Domain=.jonerfootball.com; Secure; SameSite=Lax`)
    } catch (error) {
      console.error('Tracking gateway journey creation failed', error?.message || String(error))
    }
  }

  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  return res.redirect(302, destination.toString())
}
