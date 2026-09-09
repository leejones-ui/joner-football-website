import { authorised, resolveWindow } from './_meta-uscreen-reconciliation.js'
import { fetchTrialCohort } from './_trial-cohort.js'

export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  if (!authorised(req)) return res.status(401).json({ success: false, error: 'Unauthorized' })
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })
  let window
  try { window = resolveWindow(req.query || {}) } catch (error) { return res.status(400).json({ success: false, error: error.message }) }
  try {
    const cohort = await fetchTrialCohort(window)
    const wantsRows = String(req.query?.rows || '') !== '0'
    return res.status(200).json({ success: true, schema_version: 1, ...cohort, rows: wantsRows ? cohort.rows : undefined })
  } catch (error) {
    return res.status(502).json({ success: false, error: String(error?.message || error) })
  }
}
