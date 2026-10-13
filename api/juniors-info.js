// What the public Joners Juniors page shows about the term, read at runtime
// from the Joners Juniors settings (portal > Joners Juniors > Settings), so a
// change Ligia saves shows on the page within a minute, with no deploy.
//
// GET only. Public: term, dates, class, place, price, open or closed, and
// whether the class is full (one yes or no from the term's table, so the page
// offers the waitlist instead of checkout). Nothing about any family.
import { configOrDefaults } from './_jj-data.js'
import { juniorsPublic } from './_jj-config.js'
import { classFull } from './_jj-requests.js'

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'Method not allowed' }) }
  const { config, fallback } = await configOrDefaults()
  // The CDN keeps it for a minute; a settings change shows after that.
  res.setHeader('Cache-Control', fallback ? 'no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
  // Full: the class has every place taken. Unknown (Airtable down): not full,
  // so the page works as it did before (the sign-up checks again).
  const count = fallback ? null : await classFull(config)
  const pub = juniorsPublic(config.juniors)
  const full = Boolean(count?.full)
  return res.status(200).json({ success: true, juniors: { ...pub, full, waitlist: !pub.registrationOpen || full }, ...(fallback ? { fallback: true } : {}) })
}
