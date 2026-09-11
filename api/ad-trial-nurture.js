import { runAdTrialNurture } from './_ad-trial-nurture.js'

export const config = { maxDuration: 300 }

function authorised(req) {
  const header = String(req.headers?.authorization || '')
  const secrets = [process.env.CRON_SECRET, process.env.META_USCREEN_RECONCILIATION_TOKEN].filter(Boolean)
  return secrets.some((secret) => header === `Bearer ${secret}`)
}

export default async function handler(req, res) {
  if (!authorised(req)) return res.status(401).json({ success: false, error: 'Unauthorized' })
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, error: 'Method not allowed' })
  // The cron (GET) always sends. A manual call sends only with ?dry_run=0.
  const isCron = req.method === 'GET' && !('dry_run' in (req.query || {}))
  const dryRun = isCron ? false : String(req.query?.dry_run ?? '1') !== '0'
  try {
    const summary = await runAdTrialNurture({ dryRun })
    return res.status(200).json({ success: true, ...summary })
  } catch (error) {
    return res.status(502).json({ success: false, error: String(error?.message || error) })
  }
}
