// Hermes (Barry) working the JFP portal for Lee, under the hood (Lee, 16 Oct
// 2026: "i want it to have full access to do anything ! just easier for me
// when i am on the run").
//
// How it works:
// - The Mac mini holds a secret key (~/.jfp-agent/hermes.key). Only its
//   SHA-256 is stored here, in KV jfp:agent:hermes { hash, enabled, ... }.
// - A request carrying the key in x-jfp-agent-key acts as Lee (admin, owner)
//   on /api/jfp-portal-data, /api/jfp-messages and /api/holiday-admin.
// - Every call is audited as "Hermes for Lee".
// - Lee's two hard rules still hold, enforced here rather than trusted:
//   1. Nothing reaches a family or coach without Lee's yes on that exact
//      message. A text needs x-jfp-confirmed: lee-said-yes. An email that an
//      action would send to anyone outside @jonerfootball.com is held, not
//      sent, and listed in Settings > Hermes access (and to Hermes) until it
//      is released with the confirm header or from the portal.
//   2. Money changes only on Lee's or Ligia's word: Hermes is told to act on
//      money only when Lee asked in that chat (docs), and every one is audited.
// - Settings > Hermes access switches it off at once. Only a signed-in person
//   can switch it, never Hermes itself.
import crypto from 'node:crypto'
import { kvCommand, kvGetJson, kvSetJson, newId, tokenMatches, audit, ownerEmail } from './_jfp-store.js'
import { agentContext, agentNow, AGENT_HEADER, CONFIRM_HEADER, CONFIRM_VALUE, AGENT_NAME } from './_jfp-agent-context.js'

export const AGENT_KEY = 'jfp:agent:hermes'
export const HELD = 'jfp:agent:held'

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

export async function agentState() { return (await kvGetJson(AGENT_KEY)) || null }

// Runs a handler with the Hermes context when the request carries the key.
// Any email it held is added to the reply as heldForLee, so Hermes can say
// "ready to send, want me to?" instead of "sent".
export function withAgent(req, endpoint, fn, res) {
  const key = req?.headers?.[AGENT_HEADER]
  if (!key) return fn()
  const ctx = { agent: true, valid: false, endpoint, confirmed: req.headers?.[CONFIRM_HEADER] === CONFIRM_VALUE, held: [] }
  if (res?.json) {
    const json = res.json.bind(res)
    res.json = (payload) => json(ctx.held.length && payload && typeof payload === 'object' ? { ...payload, heldForLee: ctx.held, note: 'Emails in heldForLee were NOT sent. Show Lee each one; on his yes run jfp release <id> --yes.' } : payload)
  }
  return agentContext.run(ctx, async () => {
    const out = await fn()
    if (ctx.valid) {
      let action = ''
      try { action = String((typeof req.body === 'string' ? JSON.parse(req.body) : req.body)?.action || '').slice(0, 40) } catch {}
      await audit({ by: ownerEmail(), action: 'agent.call', target: `${endpoint}:${action}`, after: { confirmed: ctx.confirmed, held: ctx.held.length } }).catch(() => {})
      await kvSetJson(AGENT_KEY, { ...(await agentState()), lastUsedAt: new Date().toISOString(), lastAction: `${endpoint}:${action}` }).catch(() => {})
    }
    return out
  })
}

// Lee, as Hermes, when the key matches and access is switched on.
export async function agentPrincipal(req) {
  const ctx = agentNow()
  const key = String(req?.headers?.[AGENT_HEADER] || '')
  if (!ctx || key.length < 32) return null
  const st = await agentState()
  if (!st?.enabled || !st.hash || !tokenMatches(sha(key), st.hash)) return null
  ctx.valid = true
  return { role: 'admin', email: ownerEmail(), name: AGENT_NAME, via: 'hermes' }
}

export const agentConfirmed = () => Boolean(agentNow()?.confirmed)
export const inAgent = () => Boolean(agentNow()?.valid)

// The email sender asks this first. True means "hold it, do not send".
const internal = (email) => /@jonerfootball\.com$/i.test(String(email || ''))
export async function holdIfAgent(msg) {
  const ctx = agentNow()
  if (!ctx?.valid || ctx.confirmed) return null
  const to = msg.to || []
  if (to.length && to.every((t) => internal(t.email))) return null
  const held = { id: newId('AH'), at: new Date().toISOString(), endpoint: ctx.endpoint, ...msg }
  await kvCommand(['HSET', HELD, held.id, JSON.stringify(held)])
  ctx.held.push({ id: held.id, to: to.map((t) => t.email), subject: msg.subject })
  return held
}

export async function listHeld() {
  const flat = (await kvCommand(['HGETALL', HELD])) || []
  const out = []
  for (let i = 0; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i + 1])) } catch {} }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)))
}
export async function takeHeld(id) {
  const raw = await kvCommand(['HGET', HELD, String(id || '')])
  if (!raw) return null
  await kvCommand(['HDEL', HELD, String(id)])
  try { return JSON.parse(raw) } catch { return null }
}
export const heldView = (h) => ({ id: h.id, at: h.at, to: (h.to || []).map((t) => t.email), subject: h.subject, kind: h.kind || '', html: h.html })

// The new key: only the hash is kept. Used by scripts/jfp-agent-key.mjs.
export async function setAgentKey(key) {
  const prev = (await agentState()) || {}
  await kvSetJson(AGENT_KEY, { ...prev, hash: sha(key), enabled: true, keySetAt: new Date().toISOString() })
}
export async function setAgentEnabled(enabled, by) {
  const prev = (await agentState()) || {}
  await kvSetJson(AGENT_KEY, { ...prev, enabled: Boolean(enabled), switchedAt: new Date().toISOString(), switchedBy: by })
  await audit({ by, action: enabled ? 'agent.on' : 'agent.off', target: 'hermes' })
}
