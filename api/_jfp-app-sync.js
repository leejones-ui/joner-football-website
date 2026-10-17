// Requests in Airtable (Lee, 18 Oct 2026: "go"). Every application, waitlist
// request and enquiry is copied to the Airtable table "JFP Applications", one
// row per request, updated in place when staff answer it. KV stays the
// working copy (the portal reads KV); Airtable is the record Lee and Ligia
// can see and filter. A failed copy never stops the request: it is listed in
// jfp:app-at-failed and the nightly check copies it again.
//
//   jfp:app-at          hash requestId -> Airtable record id
//   jfp:app-at-failed   hash requestId -> ISO time of the failed copy
import { kvCommand, getConfig, getGroup, coachById, locationFor, listApplications, QUESTIONS } from './_jfp-store.js'
import { airtable } from './_jfp-airtable.js'

export const APPS_TABLE = process.env.JFP_APPLICATIONS_TABLE || 'tblAnkpS9vF4PI8nD'
const MAP = 'jfp:app-at'
const FAILED = 'jfp:app-at-failed'

const TYPE = { application: 'Application', waitlist: 'Waitlist', enquiry: 'Enquiry' }
function statusOf(a) {
  if (a.status === 'offered') return a.offer === 'trial' ? 'Trial offered' : 'Place offered'
  return { pending: 'Pending', declined: 'Declined', done: 'Done', expired: 'Offer expired' }[a.status] || 'Pending'
}
const QUESTION_LABEL = { ...QUESTIONS, videos: 'Videos' }

export async function applicationFields(a, { config, group } = {}) {
  const cfg = config || (await getConfig())
  const g = group === undefined ? await getGroup(a.groupId).catch(() => null) : group
  const where = g ? locationFor(cfg, g.location)?.name || g.location || '' : ''
  const coach = g ? coachById(cfg, g.coachId)?.name || '' : ''
  const players = a.players || []
  const answers = Object.entries(a.answers || {}).map(([k, v]) => `${QUESTION_LABEL[k] || k}: ${v}`).join('\n')
  return {
    'Request ID': a.id,
    Type: TYPE[a.kind] || 'Application',
    Status: statusOf(a),
    Players: players.map((p) => p.name).join(', '),
    Ages: players.map((p) => (p.age == null ? '' : String(p.age))).join(', '),
    Group: g ? [g.day, g.time, where].filter(Boolean).join(' ') : a.groupId === 'one-to-one' ? '1 to 1 coaching' : a.groupId || '',
    Coach: coach,
    'Parent Name': a.parentName || '',
    Email: a.email || null,
    Mobile: a.mobile || null,
    Club: a.club || a.answers?.club || '',
    Answers: answers,
    Message: a.message || '',
    'New to JFP': players.some((p) => p.isNew),
    'Waiver Signed': players.some((p) => p.waiver) || Boolean(a.waiver),
    'Submitted At': a.createdAt || null,
    'Decided By': a.decidedBy || '',
    'Decision Notes': a.note || '',
  }
}

// Copy one request to Airtable (create or update). Never throws.
export async function mirrorApplication(a, opts = {}) {
  if (!a?.id) return { skipped: true }
  try {
    const fields = await applicationFields(a, opts)
    const known = await kvCommand(['HGET', MAP, a.id])
    if (known) {
      try {
        await airtable(encodeURIComponent(APPS_TABLE), { method: 'PATCH', body: { typecast: true, records: [{ id: known, fields }] } })
        await kvCommand(['HDEL', FAILED, a.id])
        return { updated: known }
      } catch (error) {
        // Someone deleted the row by hand: make it again.
        if (!/Airtable (404|422)/.test(error.message)) throw error
      }
    }
    const d = await airtable(encodeURIComponent(APPS_TABLE), { method: 'POST', body: { typecast: true, records: [{ fields }] } })
    const id = d.records?.[0]?.id
    if (id) await kvCommand(['HSET', MAP, a.id, id])
    await kvCommand(['HDEL', FAILED, a.id])
    return { created: id }
  } catch (error) {
    console.error('jfp application airtable copy failed', a.id, error)
    try { await kvCommand(['HSET', FAILED, a.id, new Date().toISOString()]) } catch {}
    return { error: error.message }
  }
}

// Copy every request Airtable does not have yet, plus any that failed.
// Used by the nightly check and the one-off backfill.
export async function syncApplications({ all = false, dryRun = false } = {}) {
  const config = await getConfig()
  const list = await listApplications()
  const mapRaw = (await kvCommand(['HGETALL', MAP])) || []
  const failedRaw = (await kvCommand(['HGETALL', FAILED])) || []
  const toSet = (raw) => new Set(Array.isArray(raw) ? raw.filter((_, i) => i % 2 === 0) : Object.keys(raw))
  const have = toSet(mapRaw), failed = toSet(failedRaw)
  const todo = list.filter((a) => all || !have.has(a.id) || failed.has(a.id))
  if (dryRun) return { total: list.length, todo: todo.length, ids: todo.map((a) => a.id) }
  const out = { total: list.length, created: 0, updated: 0, failed: 0 }
  for (const a of todo) {
    const r = await mirrorApplication(a, { config })
    if (r.created) out.created++
    else if (r.updated) out.updated++
    else if (r.error) out.failed++
  }
  return out
}
