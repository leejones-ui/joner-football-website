// An agent adds their own players (Lee, 20 Oct 2026): "i want him to add all
// his agency players, once he does that will it be added to the system ?"
//
// A family's Add a player only makes a profile (_jfp-account-open.js). An
// agent's goes straight on to Term 4 Players as one of the agency's players:
// the agent is the contact, session by session at the agency's price when Lee
// saved one, no group, Awaiting Reply, nothing to pay until Lee bills the
// agency. Tagged [AGENT:<id>] and [AGENTADD], so the Players tab and the
// agency card show who added it. Nothing is emailed, texted or charged.
import { kvCommand, normName, clean, ageOn, sydneyToday, audit, formatAud, SESSION_TYPE, withPerSession } from './_jfp-store.js'
import { createTerm4Rows, bustRosterCache } from './_jfp-airtable.js'
import { cleanProfile, profileKey, saveProfile, findProfile } from './_jfp-profiles.js'
import { withAgentTag } from './_jfp-agents.js'

export const AGENT_ADD_TAG = '[AGENTADD]'
export const AGENT_ADDS_PER_DAY = 40

async function underLimit(email) {
  const key = `jfp:rl:agent-add:${email}`
  const n = Number(await kvCommand(['INCR', key]))
  if (n === 1) await kvCommand(['EXPIRE', key, '86400'])
  return n <= AGENT_ADDS_PER_DAY
}

// agent: the jfp:agents record; roster: loadRoster({ fresh: true }).
export async function addAgentPlayer({ agent, roster, body }) {
  const name = clean(body.name, 80).replace(/\s+/g, ' ')
  if (name.length < 3 || !/^[\p{L}][\p{L}'’ .-]*$/u.test(name) || name.split(' ').length < 2) return { ok: false, status: 400, error: "Enter the player's first and last name." }
  const { values, errors } = cleanProfile({ ...(body.values && typeof body.values === 'object' ? body.values : {}), ...(body.dob != null ? { dob: body.dob } : {}) })
  if (errors.length) return { ok: false, status: 400, error: errors.join(' ') }
  for (const k of ['parentName', 'parentMobile', 'parent2Name', 'parent2Email', 'parent2Mobile']) delete values[k]
  const mine = roster.players.filter((r) => r.agentId === agent.id && r.holdsPlace)
  if (mine.some((r) => normName(r.player) === normName(name))) return { ok: false, status: 409, error: `${name} is already one of your players.`, code: 'duplicate' }
  if (!(await underLimit(agent.email))) return { ok: false, status: 429, error: 'That is a lot of players for one day. Try again tomorrow, or contact us.' }
  const age = values.dob ? ageOn(values.dob, sydneyToday()) : null
  const agency = agent.company || agent.name
  const rate = agent.rateCents || 0
  let notes = `Added by ${agent.name} (agent, ${agency}) from their account${age != null ? `, age ${age}` : ''}, with no session yet. Session by session${rate ? ` at ${formatAud(rate)} a session` : ''}. ${AGENT_ADD_TAG}`
  if (rate) notes = withPerSession(notes, rate)
  notes = withAgentTag(notes, agent.id)
  const [rowId] = await createTerm4Rows([{
    'Player Name': name,
    'Parent Name': agent.name,
    Email: agent.email,
    ...(agent.mobile ? { Phone: agent.mobile } : {}),
    'Term 4 Confirmation': 'Awaiting Reply',
    'Term 4 Fee': 0,
    'Term 4 Amount Paid': 0,
    'Term 4 Payment Status': 'Unpaid',
    'Term 4 Payment Type': SESSION_TYPE,
    'Term 4 Notes': notes,
  }])
  await bustRosterCache()
  // Date of birth, club and the rest go on the player's profile, never Term 4.
  const key = profileKey(name, agent.email)
  const existing = await findProfile({ key }).catch(() => null)
  const profile = await saveProfile({ existing, name, key: existing?.key || key, emails: [agent.email], rowIds: [rowId], values, by: agent.email, from: 'Agent account' }).catch((e) => { console.error('jfp agent add profile failed', e); return null })
  await audit({ by: agent.email, action: 'agent.addPlayer', target: rowId, after: { agentId: agent.id, name, rateCents: rate, fields: Object.keys(values) } })
  return { ok: true, rowId, key: normName(name), profile }
}

export const agentAdded = (r) => String(r?.notes || '').includes(AGENT_ADD_TAG)
