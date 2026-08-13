import { getTrackingDestination, getTrackingLink } from './_tracking-link-bank.js'

const safe = (value, max = 240) => String(value || '').trim().slice(0, max)

export default function handler(req, res) {
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
  destination.searchParams.set('destination_token', safe(req.query?.to) || 'join')

  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  return res.redirect(302, destination.toString())
}
