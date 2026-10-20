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
//   jfp:agents   hash lower-case email -> JSON {id, name, email, mobile, company,
//                billingEmail, address, abn, rateCents, at, by}
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

// New, or the same agent again (same email): keeps the id and anything the
// form left blank (the agency, its billing details, the price).
export async function saveAgent(principal, { name, email, mobile, company }) {
  const e = String(email || '').trim().toLowerCase()
  const was = await agentFor(e)
  const rec = { ...(was || {}), id: was?.id || newId('AGT'), name: clean(name, 100) || was?.name || '', email: e, mobile: clean(mobile, 40) || was?.mobile || '', company: clean(company, 100) || was?.company || '', at: was?.at || new Date().toISOString(), by: was?.by || principal.email, ...(was ? { updatedAt: new Date().toISOString() } : {}) }
  await kvCommand(['HSET', AGENTS, e, JSON.stringify(rec)])
  return rec
}

export async function agentById(id) {
  return (await allAgents()).find((a) => a.id === id) || null
}

// The agency on its invoices (Lee, 20 Oct 2026: "invoicing needs to be for one
// agency and i should be able to update this"). Bill to the agency, for the
// attention of the agent, with the billing address and ABN when saved.
export function agencyBillTo(a) {
  if (!a) return null
  const agency = a.company || a.name
  return { name: agency, attn: a.company && a.name && a.name !== a.company ? a.name : '', email: a.billingEmail || a.email, address: a.address || '', abn: a.abn || '' }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Staff edit the agency: { ok, before, after } or { ok: false, status, error }.
// A new email moves the record to it (the rows follow in the portal action).
export async function updateAgent(principal, id, f = {}) {
  const was = await agentById(clean(id, 40))
  if (!was) return { ok: false, status: 404, error: 'That agent is not on file.' }
  const name = clean(f.name, 100), email = clean(f.email, 160).toLowerCase()
  if (name.length < 2) return { ok: false, status: 400, error: "Enter the agent's name." }
  if (!EMAIL_RE.test(email)) return { ok: false, status: 400, error: "Enter the agent's email. They sign in with it." }
  const billingEmail = clean(f.billingEmail, 160).toLowerCase()
  if (billingEmail && !EMAIL_RE.test(billingEmail)) return { ok: false, status: 400, error: 'The invoices email does not look right.' }
  const rate = f.rateCents === '' || f.rateCents == null ? 0 : Number(f.rateCents)
  if (!Number.isInteger(rate) || rate < 0 || rate > 200000) return { ok: false, status: 400, error: 'Enter the price per session in dollars, or leave it empty.' }
  if (email !== was.email && await agentFor(email)) return { ok: false, status: 409, error: `${email} is already another agent's email.` }
  const after = { ...was, name, email, mobile: clean(f.mobile, 40), company: clean(f.company, 100), billingEmail: billingEmail === email ? '' : billingEmail, address: clean(f.address, 300), abn: clean(f.abn, 20).replace(/[^\d ]/g, ''), rateCents: rate || 0, updatedAt: new Date().toISOString(), updatedBy: principal.email }
  if (email !== was.email) await kvCommand(['HDEL', AGENTS, was.email])
  await kvCommand(['HSET', AGENTS, email, JSON.stringify(after)])
  return { ok: true, before: was, after }
}

// Staff list: each agent and their players this term.
export function agentsView(agents, rosterPlayers) {
  return agents.map((a) => {
    const rows = rosterPlayers.filter((r) => r.agentId === a.id && r.holdsPlace)
    return { id: a.id, name: a.name, email: a.email, mobile: a.mobile, company: a.company, billingEmail: a.billingEmail || '', address: a.address || '', abn: a.abn || '', rateCents: a.rateCents || 0, players: rows.map((r) => r.player).sort() }
  })
}
