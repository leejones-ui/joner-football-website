// What the public Joners Juniors page shows about the term, read at runtime
// from the Joners Juniors settings (portal > Joners Juniors > Settings), so a
// change Ligia saves shows on the page within a minute, with no deploy.
//
// GET only. Public: term, dates, class, place, price, open or closed. Nothing
// about any family, and nothing read from Airtable or Stripe.
import { configOrDefaults } from './_jj-data.js'
import { juniorsPublic } from './_jj-config.js'

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'Method not allowed' }) }
  const { config, fallback } = await configOrDefaults()
  // The CDN keeps it for a minute; a settings change shows after that.
  res.setHeader('Cache-Control', fallback ? 'no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
  return res.status(200).json({ success: true, juniors: juniorsPublic(config.juniors), ...(fallback ? { fallback: true } : {}) })
}
