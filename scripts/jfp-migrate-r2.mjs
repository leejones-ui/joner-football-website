// One-off, round 2 (Lee, 29 September 2026). Prints what would change;
// writes nothing unless --apply is given.
//
//   node scripts/jfp-migrate-r2.mjs --groups groups.json --snapshot <dir> [--out new.json]
//   node scripts/jfp-migrate-r2.mjs --env .env.prod --snapshot <dir> --backup <file> --apply
//
// Rules:
//   Every weekday afternoon group: 4 places, Apply only. Groups already on 4
//   or more show Fully booked with a waitlist. Lee can open one back to 6.
//   Early morning squads at North Turramurra and Rydalmere become one group per
//   coach, so parents see which coach has places. Lee's and Dean's take up to
//   8 and are Apply; every other coach's take 6 and are Book now for players
//   inside the age band.
//   Monday 6:15am at Belrose: Apply, ages 8 to 11 (Lee: 3 players there already).
//   1 to 1 slots, school hours and Saturday Pathway stay as they are.
//   Every group gets the default application questions and allows trials.
import fs from 'node:fs'
import path from 'node:path'
import { normaliseConfig, groupId, normaliseStoredGroup, ageOn, normName, periodOf, coachByAirtableName, DEFAULT_QUESTIONS } from '../api/_jfp-store.js'
import { draftAgeBand } from '../api/_jfp-airtable.js'

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : '' }
const apply = process.argv.includes('--apply')
const config = normaliseConfig({})
const HOLDS = new Set(['Confirmed', 'Awaiting Reply', 'Needs Follow-up', 'Not Contacted', ''])
const SPLIT = new Set(['wed-0630-ntra', 'thu-0630-ntra', 'fri-0630-rydalmere'])
const BIG_COACHES = new Set(['lee', 'dean'])

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

// The roster, joined the way loadRoster joins it: coach from Term 4, else
// Term 3, else the only coach at that session.
const snap = arg('--snapshot')
const read = (n) => JSON.parse(fs.readFileSync(path.join(snap, `${n}.json`), 'utf8'))
const t4 = read('term4'), t3 = read('term3'), wv = read('waiver')
const t3ById = new Map(t3.map((r) => [r.id, r.fields]))
const t3ByName = new Map(t3.map((r) => [normName(r.fields['Player Name']), r.fields]))
const dobByName = new Map(wv.map((r) => [normName(r.fields['Player Full Name']), r.fields['Date of Birth']]).filter(([, v]) => v))
const players = []
const DEBUG = process.argv.includes("--debug")
for (const r of t4) {
  const f = r.fields
  if (!HOLDS.has(f['Term 4 Confirmation'] || '') || !f['Term 3 Day'] || !f['Term 3 Time'] || !f['Term 3 Location'] || /test/i.test(f['Player Name'] || '')) continue
  const src = t3ById.get(f['Source Term 3 Record ID']) || t3ByName.get(normName(f['Player Name'])) || {}
  const coach = coachByAirtableName(config, f['Coach'] || src['Coach'] || '')?.id || ''
  const note = /\bage (\d{1,2})\b/i.exec(f['Term 4 Notes'] || '')
  const age = ageOn(src['Date of Birth'] || dobByName.get(normName(f['Player Name'])), config.termStart) ?? (note ? Number(note[1]) : null)
  players.push({ name: f['Player Name'], session: groupId(f['Term 3 Day'], f['Term 3 Time'], f['Term 3 Location']), coach, age, raw: [f['Term 3 Day'], f['Term 3 Time'], f['Term 3 Location'], f['Coach'] || '', src['Coach'] || ''] })
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
if (apply && !arg('--backup')) throw new Error('--apply needs --backup <file>, so the old groups can be put back')
if (apply) fs.writeFileSync(arg('--backup'), JSON.stringify(groups, null, 1), { mode: 0o600 })

const out = []
const removed = []
const now = new Date().toISOString()
const line = (id, what) => console.log(`${id.padEnd(30)} ${what}`)
for (const old of groups) {
  const g = { ...normaliseStoredGroup(old), trials: old.trials ?? true, questions: old.questions ?? DEFAULT_QUESTIONS, product: old.product ?? (old.label === 'Pathway' ? 'pathway' : old.label === '1 to 1' ? 'oneToOneTerm' : 'group'), migratedAt: now }
  if (SPLIT.has(g.id)) {
    const here = players.filter((p) => p.session === g.id)
    // A coach gets a group where they ran this session in Term 3. A row whose
    // coach did not (a typed-in row matched to another session's coach) is
    // left for Lee under "Not in a group" rather than inventing a group.
    const ran = new Set(t3.filter((r) => groupId(r.fields['Session Day'] || '', r.fields['Session Time'] || '', r.fields['Session Location'] || '') === g.id).map((r) => coachByAirtableName(config, r.fields['Coach'] || '')?.id).filter(Boolean))
    const coaches = [...new Set(here.map((p) => p.coach).filter((c) => c && ran.has(c)))].sort()
    const noCoach = here.filter((p) => !coaches.includes(p.coach))
    if (DEBUG) for (const p of here) console.log('   ', p.name.slice(0, 2), p.coach, JSON.stringify(p.raw))
    for (const c of coaches) {
      const mine = here.filter((p) => p.coach === c)
      const big = BIG_COACHES.has(c)
      const next = { ...g, id: groupId(g.day, g.time, g.location, c), byCoach: true, coachId: c, extraCoachIds: [], capacity: big ? 8 : 6, mode: big ? 'application' : 'direct', label: 'Squad', ...draftAgeBand(mine.map((p) => p.age), config), ageStatus: 'draft' }
      line(next.id, `NEW coach group: ${mine.length} players, ${next.capacity} places, ${next.mode}, ages ${next.minAge} to ${next.maxAge}`)
      out.push(next)
    }
    line(g.id, `REMOVED (split by coach: ${coaches.join(', ')})${noCoach.length ? `; ${noCoach.length} row(s) with no coach group go to "Not in a group": ${noCoach.map((p) => `${p.name}${p.coach ? ` (Term 3 coach ${p.coach})` : ''}`).join(', ')}` : ''}`)
    removed.push(g.id)
    continue
  }
  const changes = []
  const weekdayPm = periodOf(g) === 'pm' && !['Saturday', 'Sunday'].includes(g.day)
  if (weekdayPm && !['closed', 'enquire'].includes(g.mode)) {
    if (g.capacity !== 4) { changes.push(`places ${g.capacity} -> 4`); g.capacity = 4 }
    if (g.mode !== 'application') { changes.push(`${g.mode} -> application`); g.mode = 'application' }
  }
  // Lee: Monday 6:15am at Belrose is ages 8 to 11, apply only.
  if (g.id === 'mon-0615-belrose-hq') {
    if (g.mode !== 'application') { changes.push(`${g.mode} -> application`); g.mode = 'application' }
    if (g.minAge !== 8 || g.maxAge !== 11 || g.ageStatus !== 'confirmed') { changes.push(`ages ${g.minAge} to ${g.maxAge} -> 8 to 11 (confirmed)`); Object.assign(g, { minAge: 8, maxAge: 11, ageStatus: 'confirmed' }) }
  }
  const n = players.filter((p) => p.session === g.id).length
  line(g.id, `${changes.join('; ') || 'no change'}${weekdayPm && !['closed', 'enquire'].includes(g.mode) ? ` (${n} players${n >= g.capacity ? ', FULLY BOOKED' : `, ${g.capacity - n} left`})` : ''}`)
  out.push(g)
}
if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(out, null, 1))
if (apply) {
  if (!e) throw new Error('--apply needs --env')
  for (const g of out) await kv(e, ['HSET', 'jfp:groups', g.id, JSON.stringify(g)])
  for (const id of removed) await kv(e, ['HDEL', 'jfp:groups', id])
  await kv(e, ['DEL', 'jfp:roster-cache', 'jfp:airtable-counts'])
  await kv(e, ['LPUSH', 'jfp:audit', JSON.stringify({ at: now, by: 'system (round 2, 2026-09-29)', action: 'group.migrate', target: 'all', after: { groups: out.length, removed } })])
  console.log(`\napplied: ${out.length} groups written, ${removed.length} split`)
} else console.log(`\ndry run: ${out.length} groups, ${removed.length} split, nothing written`)
