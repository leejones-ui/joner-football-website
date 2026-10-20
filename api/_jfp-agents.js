// Agents (Lee, 20 Oct 2026): "I have an agent that works at Joner Football,
// and loads of pro players work under that agent. So I actually invoice the
// agent who pays for the players' sessions ... I don't want to add him as a
// parent because it just doesn't sound right."
//
// An agent is the contact on each of their players' Term 4 rows (the row's
// Parent Name and Email are the agent's), so the agent signs in with that
// email and sees every player, their dates and every payment, as a family
// does. What is different:
//   - the wording everywhere: agent and players, never parent and children;
//   - the players are not brothers and sisters: no sibling rate, ever;
//   - the agent never signs a waiver for them. Each player signs their own
//     (a parent signs for one under 18) from the player's own login, and the
//     agent can pay before the waivers are in.
//
//   jfp:agents   hash lower-case email -> JSON {id, name, email, mobile, company, at, by}
//   [AGENT:<id>] on each player's Term 4 notes, so every path that already has
//                the row knows it without another read (no new Airtable column).
import { kvCommand, clean, newId } from './_jfp-store.js'

export const AGENTS = 'jfp:agents'
export const AGENT_TAG = 'AGENT'
const TAG_RE = /\s*\[AGENT:[A-Za-z0-9-]+\]/g

export function withAgentTag(notes, id) {
  const base = String(notes || '').replace(TAG_RE, '')
  return id ? `${base}${base ? ' ' : ''}[${AGENT_TAG}:${id}]` : base
}

export async function allAgents() {
  const raw = (await kvCommand(['HGETALL', AGENTS])) || []
  const out = []
  for (let i = 0; i + 1 < raw.length; i += 2) { try { out.push(JSON.parse(raw[i + 1])) } catch {} }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function agentFor(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!e) return null
  try { return JSON.parse(await kvCommand(['HGET', AGENTS, e]) || 'null') } catch { return null }
}

// New, or the same agent again (same email): keeps the id, updates the details.
export async function saveAgent(principal, { name, email, mobile, company }) {
  const e = String(email || '').trim().toLowerCase()
  const was = await agentFor(e)
  const rec = { id: was?.id || newId('AGT'), name: clean(name, 100), email: e, mobile: clean(mobile, 40), company: clean(company, 100), at: was?.at || new Date().toISOString(), by: was?.by || principal.email, ...(was ? { updatedAt: new Date().toISOString() } : {}) }
  await kvCommand(['HSET', AGENTS, e, JSON.stringify(rec)])
  return rec
}

// Staff list: each agent and how many players they have this term.
export function agentsView(agents, rosterPlayers) {
  return agents.map((a) => {
    const rows = rosterPlayers.filter((r) => r.agentId === a.id && r.holdsPlace)
    return { id: a.id, name: a.name, email: a.email, mobile: a.mobile, company: a.company, players: rows.map((r) => r.player).sort() }
  })
}
