// One-off: bring the JFP groups saved before age bands existed up to the new
// shape, from the real roster. Prints what would change; writes nothing
// unless --apply is given.
//
//   node scripts/jfp-migrate-groups.mjs --groups groups.json --snapshot <dir> [--out new.json]
//   node scripts/jfp-migrate-groups.mjs --env .env.prod --snapshot <dir> --apply
//
// Rules (Lee, September 2026):
//   Belrose small groups stay bookable online.
//   Pathway groups and the early morning squads are apply only.
//   1 to 1 slots stay hidden (each belongs to one player); parents enquire.
//   Groups during school hours stay hidden.
//   Age bands are drafted one year either side of who is in the group today,
//   marked draft for Lee to confirm. Monday 5:25pm and 6:30pm look girls only:
//   flagged as suggested, not enforced.
import fs from 'node:fs'
import path from 'node:path'
import { normaliseConfig, groupId, normaliseStoredGroup, ageOn, to24h, normName } from '../api/_jfp-store.js'
import { draftAgeBand } from '../api/_jfp-airtable.js'

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : '' }
const apply = process.argv.includes('--apply')
const config = normaliseConfig({})
const HOLDS = new Set(['Confirmed', 'Awaiting Reply', 'Needs Follow-up', 'Not Contacted', ''])
const GIRLS = new Set(['mon-1725-belrose-hq', 'mon-1830-belrose-hq'])

function env(file) {
  const out = {}
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, '') }
  return out
}
async function kv(e, cmd) {
  const r = await fetch(e.KV_REST_API_URL, { method: 'POST', headers: { Authorization: `Bearer ${e.KV_REST_API_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) })
  const d = await r.json()
  if (d.error) throw new Error(d.error)
  return d.result
}

const snap = arg('--snapshot')
const read = (n) => JSON.parse(fs.readFileSync(path.join(snap, `${n}.json`), 'utf8'))
const t4 = read('term4'), t3 = read('term3'), wv = read('waiver')
const dobById = new Map(t3.map((r) => [r.id, r.fields['Date of Birth']]))
const dobByName = new Map([...t3.map((r) => [normName(r.fields['Player Name']), r.fields['Date of Birth']]), ...wv.map((r) => [normName(r.fields['Player Full Name']), r.fields['Date of Birth']])].filter(([, v]) => v))
const ages = new Map()
for (const r of t4) {
  const f = r.fields
  if (!HOLDS.has(f['Term 4 Confirmation'] || '') || !f['Term 3 Day'] || !f['Term 3 Time'] || !f['Term 3 Location']) continue
  const gid = groupId(f['Term 3 Day'], f['Term 3 Time'], f['Term 3 Location'])
  const dob = dobById.get(f['Source Term 3 Record ID']) || dobByName.get(normName(f['Player Name']))
  const note = /\bage (\d{1,2})\b/i.exec(f['Term 4 Notes'] || '')
  const age = ageOn(dob, config.termStart) ?? (note ? Number(note[1]) : null)
  ages.set(gid, [...(ages.get(gid) || []), age])
}

let e = null
let groups
if (arg('--groups')) groups = JSON.parse(fs.readFileSync(arg('--groups'), 'utf8'))
else {
  e = env(arg('--env'))
  const raw = await kv(e, ['HGETALL', 'jfp:groups'])
  groups = []
  for (let i = 0; i < raw.length; i += 2) groups.push(JSON.parse(raw[i + 1]))
}

const out = []
for (const old of groups) {
  const g = normaliseStoredGroup(old)
  const belrose = /belrose/i.test(g.location)
  const oneToOne = /1 on 1/i.test(g.programme) || (g.capacity === 1)
  const pathway = /pathway/i.test(g.programme)
  const hour = Number(to24h(g.time).slice(0, 2))
  const schoolHours = hour >= 8 && hour < 15 && !['Saturday', 'Sunday'].includes(g.day)
  let mode = g.mode, label = g.label
  // Each 1 to 1 slot belongs to one player, so it stays off the parent page;
  // parents see a single 1 to 1 enquiry card instead.
  if (oneToOne) { mode = 'closed'; label = '1 to 1' }
  else if (pathway) { mode = 'application'; label = 'Pathway' }
  else if (!belrose) { mode = 'application'; label = 'Squad' }
  else if (schoolHours) { mode = 'closed'; label = 'Small group' }
  else { label = 'Small group' }
  const band = oneToOne ? { minAge: null, maxAge: null } : (g.minAge != null ? { minAge: g.minAge, maxAge: g.maxAge } : draftAgeBand(ages.get(g.id) || [], config))
  const next = { ...g, mode, label, ...band, ageStatus: g.ageStatus === 'confirmed' ? 'confirmed' : 'draft', girlsOnly: g.girlsOnly !== 'no' ? g.girlsOnly : (GIRLS.has(g.id) ? 'suggested' : 'no'), migratedAt: new Date().toISOString() }
  const changes = ['mode', 'label', 'minAge', 'maxAge', 'girlsOnly'].filter((k) => old[k] !== next[k]).map((k) => `${k}: ${old[k] ?? '-'} -> ${next[k] ?? '-'}`)
  console.log(`${g.id.padEnd(24)} ${String((ages.get(g.id) || []).filter((a) => a != null).sort((a, b) => a - b).join(',')).padEnd(40)} ${changes.join('; ')}`)
  out.push(next)
}
if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(out, null, 1))
if (apply) {
  if (!e) throw new Error('--apply needs --env')
  for (const g of out) await kv(e, ['HSET', 'jfp:groups', g.id, JSON.stringify(g)])
  await kv(e, ['LPUSH', 'jfp:audit', JSON.stringify({ at: new Date().toISOString(), by: 'system (build 2026-09-28)', action: 'group.migrate', target: 'all', after: { groups: out.length } })])
  console.log(`\napplied to ${out.length} groups`)
} else console.log(`\ndry run: ${out.length} groups, nothing written`)
