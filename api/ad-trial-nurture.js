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
  // Safety switch: nothing sends unless AD_TRIAL_NURTURE_LIVE=1 is set in the
  // environment (Lee's go-live decision). The cron and manual calls both obey it;
  // a manual call can additionally force a dry run with ?dry_run=1.
  const live = process.env.AD_TRIAL_NURTURE_LIVE === '1'
  const forcedDry = String(req.query?.dry_run ?? '') === '1'
  const dryRun = !live || forcedDry
  try {
    const summary = await runAdTrialNurture({ dryRun })
    return res.status(200).json({ success: true, live_switch: live, ...summary })
  } catch (error) {
    return res.status(502).json({ success: false, error: String(error?.message || error) })
  }
}
