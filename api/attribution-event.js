import crypto from 'node:crypto'
import { createJourneyId, extractTracking, getJourney, mergeTouch, normalizeJourneyId, sanitizeEvent, sanitizeIdentity, upsertJourney, claimEvent } from './_attribution-ledger.js'

function json(res, status, body) { return res.status(status).json(body) }
function cors(req, res) { const origin = req.headers?.origin; if (origin === 'https://app.jonerfootball.com') res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'content-type') }
function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function cookie(req, name) {
  const header = req.headers?.cookie || ''
  return header.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1)
}
function setCookie(res, id) { res.setHeader('Set-Cookie', `jfa_journey=${id}; Max-Age=7776000; Path=/; SameSite=Lax; Secure; HttpOnly`) }

export default async function handler(req, res) {
  cors(req, res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return json(res, 405, { success: false, error: 'Method not allowed' })
  try {
    const body = parse(req)
    const journeyId = normalizeJourneyId(body.journey_id) || normalizeJourneyId(cookie(req, 'jfa_journey')) || createJourneyId()
    const event = sanitizeEvent({ ...body, journey_id: journeyId })
    if (!(await claimEvent(journeyId, event.event_id))) return json(res, 200, { success: true, duplicate: true, journey_id: journeyId })
    const now = event.occurred_at
    let journey = await getJourney(journeyId)
    journey = mergeTouch(journey, { ...extractTracking(body, req.headers?.referer), journey_id: journeyId, path: body.path, url: body.url, cta: body.cta }, now)
    journey.journey_id = journeyId
    journey.events = [...(journey.events || []).slice(-99), event]
    await upsertJourney(journey)
    setCookie(res, journeyId)
    return json(res, 200, { success: true, journey_id: journeyId, event_id: event.event_id })
  } catch (error) {
    return json(res, 400, { success: false, error: error.message === 'Unsupported attribution event' || error.message.includes('journey_id') ? error.message : 'Could not record attribution' })
  }
}
