// Adds the link fields that tie every term row, waiver and payment to the one
// player row in JFP Player Profiles (the Players master). Additive only:
// nothing existing is changed or deleted. Safe to run again.
import { BASE, TABLE } from './lib.mjs'
import fs from 'node:fs'
const env = {}; for (const l of fs.readFileSync(process.env.HOME + '/.hermes/secrets/jf-website-production.env', 'utf8').split('\n')) { const m = l.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
const TOKEN = env.JFP_AIRTABLE_TOKEN || env.AIRTABLE_API_TOKEN || env.AIRTABLE_TOKEN
const meta = async (path, method = 'GET', body) => { const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let d = {}; try { d = JSON.parse(t) } catch {} return { status: r.status, d } }
const DESC = 'The one player row in JFP Player Profiles. Filled in by the portal; do not type here.'
// [table, field name, linked table, inverse name on Players]
const WANT = [
  ['term4', 'Player', 'profiles', 'Term 4 Place'],
  ['term3', 'Player', 'profiles', 'Term 3 Place'],
  ['term2', 'Player', 'profiles', 'Term 2 Place'],
  ['oldPlayers', 'Player', 'profiles', 'Earlier Players Row'],
  ['waiver', 'Player', 'profiles', 'Waivers'],
  ['ledger', 'Player', 'profiles', 'Payments'],
  ['dropped3', 'Player', 'profiles', 'Removed Term 3'],
  ['dropped4', 'Player', 'profiles', 'Removed Term 4'],
  ['notReturning', 'Player', 'profiles', 'Not Returning Term 4'],
  ['ledger', 'Term 4 Row', 'term4', 'Payments (Ledger)'],
]
let schema = (await meta('/tables')).d.tables
for (const [tk, name, linked, inverse] of WANT) {
  const t = schema.find((x) => x.id === TABLE[tk])
  if (t.fields.some((f) => f.name === name)) { console.log('exists ', tk, name); continue }
  const r = await meta(`/tables/${t.id}/fields`, 'POST', { name, type: 'multipleRecordLinks', options: { linkedTableId: TABLE[linked] }, description: DESC })
  console.log(r.status === 200 ? 'created' : 'FAILED ', tk, name, r.status === 200 ? '' : JSON.stringify(r.d).slice(0, 300))
}
// Name the other end of each link.
schema = (await meta('/tables')).d.tables
for (const [tk, name, linked, inverse] of WANT) {
  const t = schema.find((x) => x.id === TABLE[tk]); const f = t.fields.find((x) => x.name === name); if (!f) continue
  const invId = f.options?.inverseLinkFieldId; if (!invId) continue
  const target = schema.find((x) => x.id === TABLE[linked]); const inv = target.fields.find((x) => x.id === invId)
  if (inv && inv.name !== inverse) { const r = await meta(`/tables/${target.id}/fields/${invId}`, 'PATCH', { name: inverse }); console.log('renamed', `${linked}.${inv.name} ->`, inverse, r.status) }
}

// Plain fields on the Players master itself.
schema = (await meta('/tables')).d.tables
const pf = schema.find((x) => x.id === TABLE.profiles)
const OWN = [
  { name: 'Player Status', type: 'singleSelect', options: { choices: [{ name: 'Current' }, { name: 'Not returning' }, { name: 'Removed this term' }, { name: 'Past player' }] }, description: 'Kept up to date by the portal from the term rows linked to this player.' },
  { name: 'Last Term', type: 'singleLineText', description: 'The latest term this player was on a roster.' },
  { name: 'Review Note', type: 'multilineText', description: 'Set when something needs a person to look, for example another player row with the same name.' },
]
for (const f of OWN) {
  if (pf.fields.some((x) => x.name === f.name)) { console.log('exists ', f.name); continue }
  const r = await meta(`/tables/${pf.id}/fields`, 'POST', f)
  console.log(r.status === 200 ? 'created' : 'FAILED ', f.name, r.status === 200 ? '' : JSON.stringify(r.d).slice(0, 300))
}
