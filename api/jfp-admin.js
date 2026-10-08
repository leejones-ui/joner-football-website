// Token-scoped criteria administration. No player, payment or Airtable access.
import crypto from 'node:crypto'
import { listGroups, validateGroup, getConfig, REQUIREMENTS, clean, kvCommand, keys, normaliseStoredGroup } from './_jfp-store.js'

// Compare every original row before writing anything. Criteria and audit records
// commit together; preserve every other stored field, including unknown fields.
export const CRITERIA_SCRIPT = `
local gt = redis.call('TYPE', KEYS[1]).ok
local at = redis.call('TYPE', KEYS[2]).ok
if gt ~= 'hash' or (at ~= 'none' and at ~= 'list') then return {'storage-type'} end
local items = cjson.decode(ARGV[1])
for _, item in ipairs(items) do
  if redis.call('HGET', KEYS[1], item.id) ~= item.before then return {'conflict', item.id} end
end
for _, item in ipairs(items) do
  redis.call('HSET', KEYS[1], item.id, item.after)
  redis.call('LPUSH', KEYS[2], item.audit)
end
redis.call('LTRIM', KEYS[2], 0, 4999)
return {'ok'}
`

function fail(res, status, error) { return res.status(status).json({ success: false, error }) }
function authorised(req) {
  const token = process.env.JFP_ADMIN_TOKEN || ''
  const header = req.headers?.authorization
  if (token.length < 32 || typeof header !== 'string' || !/^Bearer\s+\S+$/i.test(header)) return false
  const supplied = header.replace(/^Bearer\s+/i, '')
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(token).digest(), crypto.createHash('sha256').update(supplied).digest())
}

export function criteriaPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Each group must be an object.' }
  if (Object.keys(input).some(k => !['id', 'requirements', 'requirementsText'].includes(k))) return { error: 'Only id, requirements and requirementsText are accepted.' }
  const patch = {}
  if (Object.hasOwn(input, 'requirements')) {
    if (!Array.isArray(input.requirements) || input.requirements.length > 100 || input.requirements.some(k => typeof k !== 'string' || !Object.hasOwn(REQUIREMENTS, k))) return { error: `Requirements must be an array containing only: ${Object.keys(REQUIREMENTS).join(', ')}.` }
    patch.requirements = [...new Set(input.requirements)]
  }
  if (Object.hasOwn(input, 'requirementsText')) {
    if (typeof input.requirementsText !== 'string' || input.requirementsText.length > 1200) return { error: 'requirementsText must be text of at most 1200 characters.' }
    patch.requirementsText = input.requirementsText
  }
  if (!Object.keys(patch).length) return { error: 'Send requirements and/or requirementsText.' }
  return { patch }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!process.env.JFP_ADMIN_TOKEN || process.env.JFP_ADMIN_TOKEN.length < 32) return fail(res, 503, 'The admin route is not switched on.')
  if (!authorised(req)) return fail(res, 401, 'Not authorised.')
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return fail(res, 405, 'Use GET or POST.') }
  let commitAttempted = false
  try {
    if (req.method === 'GET') {
      const groups = await listGroups()
      return res.status(200).json({ success: true, allowed: REQUIREMENTS, groups: groups.map(g => Object.fromEntries(['id', 'day', 'time', 'location', 'coachId', 'label', 'minAge', 'maxAge', 'mode', 'requirements', 'requirementsText'].map(k => [k, g[k]]))) })
    }
    let body
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch { return fail(res, 400, 'Invalid JSON.') }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.action !== 'setCriteria' || Object.keys(body).some(k => !['action', 'groups'].includes(k))) return fail(res, 400, 'Use POST with action setCriteria and groups.')
    if (!Array.isArray(body.groups) || !body.groups.length || body.groups.length > 100) return fail(res, 400, 'Send between 1 and 100 groups.')
    const seen = new Set()
    const patches = []
    for (const item of body.groups) {
      const { patch, error } = criteriaPatch(item)
      if (error) return fail(res, 400, error)
      if (typeof item.id !== 'string' || !item.id || item.id !== clean(item.id, 80) || seen.has(item.id)) return fail(res, 400, 'Group ids must be unique, non-empty and at most 80 clean characters.')
      seen.add(item.id)
      patches.push({ id: item.id, patch })
    }
    const config = await getConfig()
    const staged = [], changed = []
    for (const { id, patch } of patches) {
      const raw = await kvCommand(['HGET', keys.groups(), id])
      if (!raw) return fail(res, 404, `No group with id ${id}.`)
      const stored = typeof raw === 'string' ? JSON.parse(raw) : raw
      const existing = normaliseStoredGroup(stored)
      const checked = validateGroup({ ...existing, ...patch }, config, existing)
      if (checked.ok !== true || !checked.group) return fail(res, 400, `${id}: ${(checked.errors || ['Invalid group.']).join(' ')}`)
      const before = { requirements: existing.requirements, requirementsText: existing.requirementsText }
      const after = { requirements: checked.group.requirements, requirementsText: checked.group.requirementsText }
      if (JSON.stringify(before) === JSON.stringify(after)) continue
      const at = new Date().toISOString()
      staged.push({ id, before: typeof raw === 'string' ? raw : JSON.stringify(raw), after: JSON.stringify({ ...stored, ...after }), audit: JSON.stringify({ at, by: 'jfp-admin (shared admin token)', action: 'group.criteria', target: id, before, after }) })
      changed.push({ id, ...after })
    }
    if (staged.length) {
      commitAttempted = true
      const result = await kvCommand(['EVAL', CRITERIA_SCRIPT, '2', keys.groups(), keys.audit(), JSON.stringify(staged)])
      if (result?.[0] === 'conflict') return fail(res, 409, 'A group changed during this request. Re-read groups before retrying.')
      if (result?.[0] !== 'ok') return fail(res, 503, 'Storage rejected the update. Re-read groups before retrying.')
    }
    return res.status(200).json({ success: true, changed: changed.length, groups: changed })
  } catch {
    return fail(res, 503, commitAttempted ? 'Update result unconfirmed. Re-read groups and audit before retrying.' : 'Storage unavailable. Nothing has been written by this request.')
  }
}
