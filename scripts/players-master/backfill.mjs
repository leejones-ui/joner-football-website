// Players master backfill (Lee, 20 Oct 2026: "old players add as much details
// as possible, so if they come back we just send them log in info").
//   node backfill.mjs            dry run: counts only
//   node backfill.mjs --apply    writes: creates missing player rows, fills BLANK
//                                details on them, and sets the Player links.
// Never overwrites a value that is already there. Never deletes. Never prints
// a name, phone, date of birth or medical note.
import { all, at, BASE, TABLE, norm, emailsOf, phoneKey, iso } from './lib.mjs'
const APPLY = process.argv.includes('--apply')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const T = {}
for (const k of ['profiles', 'term4', 'term3', 'term2', 'oldPlayers', 'waiver', 'ledger', 'dropped3', 'dropped4', 'notReturning']) T[k] = await all(TABLE[k])
const clean = (v) => String(v ?? '').trim()
const first = (...v) => v.map(clean).find(Boolean) || ''

// ---- 1. every row that names a child becomes a node ----
const SPEC = {
  profiles: { n: 'Player Name', e: ['Family Emails', 'Second Parent Email'], p: ['Parent Mobile', 'Second Parent Mobile'], dob: 'Date of Birth', pri: 0 },
  term4: { n: 'Player Name', e: ['Email'], p: ['Phone'], pri: 1 },
  term3: { n: 'Player Name', e: ['Email', 'Parent Email 2'], p: ['Phone Number'], dob: 'Date of Birth', pri: 2 },
  term2: { n: 'Player Name', e: ['Email'], p: ['Phone number'], pri: 4 },
  oldPlayers: { n: 'Player Name', e: ['Email'], p: ['Phone Number'], dob: 'Date of Birth', pri: 5 },
  waiver: { n: 'Player Full Name', e: ['Parent Email'], p: ['Parent Mobile Number', 'Player Mobile Number'], dob: 'Date of Birth', pri: 3 },
  dropped3: { n: 'Player Name', e: ['Email'], p: ['Phone Number'], pri: 6 },
  dropped4: { n: 'Player Name', e: ['Email'], p: ['Phone Number'], pri: 6 },
  notReturning: { n: 'Player Name', e: ['Email'], p: ['Phone'], pri: 6 },
}
const nodes = []
for (const [tk, s] of Object.entries(SPEC)) for (const r of T[tk]) {
  const f = r.fields; const name = clean(f[s.n]); if (norm(name).length < 2) continue
  if (/\btest\b/i.test(name)) continue
  nodes.push({ tk, id: r.id, f, name, nn: norm(name), emails: [...new Set(s.e.flatMap((k) => emailsOf(f[k])))], phones: [...new Set(s.p.map((k) => phoneKey(f[k])).filter(Boolean))], dob: s.dob ? iso(f[s.dob]) : '', pri: s.pri, pn: norm(f['Parent Name'] || f['Parent/Guardian Name']) })
}
// ---- 2. same child = same name AND a shared email, mobile or date of birth ----
const parent = nodes.map((_, i) => i); const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
const byName = new Map(); nodes.forEach((n, i) => byName.set(n.nn, [...(byName.get(n.nn) || []), i]))
for (const idxs of byName.values()) for (let a = 0; a < idxs.length; a++) for (let b = a + 1; b < idxs.length; b++) {
  const x = nodes[idxs[a]], y = nodes[idxs[b]]
  const share = x.emails.some((e) => y.emails.includes(e)) || x.phones.some((p) => y.phones.includes(p)) || (x.dob && x.dob === y.dob) || (x.pn.length > 4 && x.pn === y.pn)
  if (share) parent[find(idxs[a])] = find(idxs[b])
}
// A row with nothing to tell it apart (no email, mobile, date of birth or parent) joins
// the one other player of the same name.
{
  const cl = new Map(); nodes.forEach((n, i) => { const r = find(i); cl.set(r, [...(cl.get(r) || []), i]) })
  const bare = (idxs) => idxs.every((i) => !nodes[i].emails.length && !nodes[i].phones.length && !nodes[i].dob && !nodes[i].pn)
  const groups = new Map(); for (const [root, idxs] of cl) { const nn = nodes[idxs[0]].nn; groups.set(nn, [...(groups.get(nn) || []), root]) }
  for (const roots of groups.values()) if (roots.length === 2) { const [a, b] = roots; if (bare(cl.get(a))) parent[find(a)] = find(b); else if (bare(cl.get(b))) parent[find(b)] = find(a) }
}
const clusters = new Map(); nodes.forEach((n, i) => { const r = find(i); clusters.set(r, [...(clusters.get(r) || []), n]) })
const list = [...clusters.values()]
console.log('rows that name a child', nodes.length, '→ distinct players', list.length)
const withProfile = list.filter((c) => c.some((n) => n.tk === 'profiles'))
const twoProfiles = list.filter((c) => c.filter((n) => n.tk === 'profiles').length > 1)
console.log('players that already have a profile', withProfile.length, '| clusters with 2+ profiles (left alone)', twoProfiles.length)
// same name, different clusters: possible split families (reported, never merged)
const nameClusters = new Map(); for (const c of list) nameClusters.set(c[0].nn, (nameClusters.get(c[0].nn) || 0) + 1)
console.log('names that appear as separate players (flagged for a human look)', [...nameClusters.values()].filter((v) => v > 1).length)
for (const c of list) if (nameClusters.get(c[0].nn) > 1) c.dup = true

// ---- 3. the details each cluster can offer a profile ----
const PREF = (c, tk) => c.filter((n) => n.tk === tk)
const pick = (c, getters) => { for (const [tk, fn] of getters) for (const n of PREF(c, tk)) { const v = clean(fn(n.f)); if (v) return v } return '' }
const emailsAll = (c) => [...new Set(c.flatMap((n) => n.emails))]
function details(c) {
  const t4 = PREF(c, 'term4')[0]
  const name = first(t4?.name, ...c.sort((a, b) => a.pri - b.pri).map((n) => n.name))
  const primary = first(t4?.emails[0], PREF(c, 'term3')[0]?.emails[0], PREF(c, 'waiver')[0]?.emails[0], c.find((n) => n.emails.length)?.emails[0])
  const med = [...new Set([pick(c, [['waiver', (f) => f['Medical Notes']]]), pick(c, [['oldPlayers', (f) => f['Medical Notes']]]), pick(c, [['term2', (f) => f['Medical Notes']]])].filter(Boolean))].join('\n')
  const par2 = (PREF(c, 'term3')[0]?.f['Parent Email 2']) || ''
  const out = {
    name, key: `${norm(name)}|${primary}`, emails: emailsAll(c),
    'Date of Birth': first(...c.map((n) => n.dob).filter(Boolean)),
    'Parent Name': pick(c, [['term4', (f) => f['Parent Name']], ['waiver', (f) => f['Parent/Guardian Name']], ['term3', (f) => f['Parent Name']], ['oldPlayers', (f) => f['Parent Name']], ['term2', (f) => f['Parent Name']], ['dropped4', (f) => f['Parent Name']], ['dropped3', (f) => f['Parent Name']]]),
    'Parent Mobile': pick(c, [['term4', (f) => f['Phone']], ['waiver', (f) => f['Parent Mobile Number']], ['term3', (f) => f['Phone Number']], ['oldPlayers', (f) => f['Phone Number']], ['term2', (f) => f['Phone number']], ['dropped4', (f) => f['Phone Number']]]),
    'Second Parent Email': emailsOf(par2)[0] || '',
    'Club': pick(c, [['waiver', (f) => f['Current Club']]]),
    'Emergency Contact Name': pick(c, [['waiver', (f) => f['Emergency Contact Name']]]),
    'Emergency Contact Phone': pick(c, [['waiver', (f) => f['Emergency Contact Phone']]]),
    'Medical Notes': med,
    t4ids: PREF(c, 'term4').map((n) => n.id),
  }
  return out
}
const status = (c) => PREF(c, 'term4').some((n) => !/^(Not Returning|Dropped)$/.test(clean(n.f['Term 4 Confirmation']))) ? 'Current' : PREF(c, 'dropped4').length ? 'Removed this term' : PREF(c, 'term4').length || PREF(c, 'notReturning').length ? 'Not returning' : 'Past player'
const lastTerm = (c) => PREF(c, 'term4').length ? 'Term 4 2026' : PREF(c, 'term3').length || PREF(c, 'dropped3').length ? 'Term 3 2026' : PREF(c, 'term2').length ? 'Term 2 2026' : PREF(c, 'waiver').length ? first(...PREF(c, 'waiver').map((n) => n.f.Term)) : 'Earlier'
const FILLABLE = ['Date of Birth', 'Parent Name', 'Parent Mobile', 'Second Parent Email', 'Club', 'Emergency Contact Name', 'Emergency Contact Phone', 'Medical Notes']
const plan = { create: [], fill: [], links: {} }
const profileById = new Map(T.profiles.map((r) => [r.id, r]))
const profOf = new Map() // cluster root -> profile id (existing or to-create index)
for (const c of list) {
  const d = details(c); const existing = PREF(c, 'profiles').sort((a, b) => a.id < b.id ? -1 : 1)[0]
  if (existing) {
    const have = existing.f; const patch = {}
    for (const k of FILLABLE) if (!clean(have[k]) && d[k]) patch[k] = d[k]
    if (!clean(have['Player Key']) && d.key) patch['Player Key'] = d.key
    if (Object.keys(patch).length) plan.fill.push({ id: existing.id, patch, keys: Object.keys(patch) })
    c.profileId = existing.id
  } else {
    plan.create.push({ c, d, fields: { 'Player Name': d.name, 'Player Key': d.key, 'Family Emails': d.emails.join(', '), 'Term 4 Record IDs': d.t4ids.join(', '), ...Object.fromEntries(FILLABLE.filter((k) => d[k]).map((k) => [k, d[k]])), ...(c.dup ? { 'Review Note': 'Another player has this name. Check if they are the same child, then merge in Airtable.' } : {}), 'Updated At': new Date().toISOString(), 'Updated By': 'Players master backfill, 20 Oct 2026', 'Updated From': 'Staff portal' } })
  }
}
console.log('profiles to create', plan.create.length, '| existing profiles to fill blanks', plan.fill.length)
const filled = {}; for (const p of plan.fill) for (const k of p.keys) filled[k] = (filled[k] || 0) + 1
console.log('blank fields to fill on existing', JSON.stringify(filled))
const createdFill = {}; for (const p of plan.create) for (const k of FILLABLE) if (p.d[k]) createdFill[k] = (createdFill[k] || 0) + 1
console.log('details on new profiles', JSON.stringify(createdFill))

if (process.argv.includes('--explain')) {
  let i = 0
  for (const [nn, cnt] of nameClusters) if (cnt > 1) {
    i++; const cs = list.filter((c) => c[0].nn === nn)
    console.log(`#${i}`, cs.map((c) => `[${[...new Set(c.map((n) => n.tk))].join('+')}${c.some((n) => n.dob) ? ' dob' : ''}${c.some((n) => n.phones.length) ? ' ph' : ''}${c.some((n) => n.emails.length) ? ' em' : ''}]`).join(' vs '))
  }
}
if (!APPLY) {
  // link plan counts
  const per = {}; for (const c of list) for (const n of c) if (n.tk !== 'profiles') { const had = n.f.Player?.length; per[n.tk] = per[n.tk] || { total: 0, already: 0 }; per[n.tk].total++; if (had) per[n.tk].already++ }
  console.log('rows to link, by table (total / already linked)', JSON.stringify(per))
  process.exit(0)
}

// ---- 4. write ----
const batches = (arr, n = 10) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
for (const b of batches(plan.fill)) { await at(`${BASE}/${TABLE.profiles}`, { method: 'PATCH', body: { typecast: true, records: b.map((x) => ({ id: x.id, fields: x.patch })) } }); await sleep(250) }
console.log('filled', plan.fill.length)
let made = 0
for (const b of batches(plan.create)) {
  const d = await at(`${BASE}/${TABLE.profiles}`, { method: 'POST', body: { typecast: true, records: b.map((x) => ({ fields: x.fields })) } })
  d.records.forEach((rec, i) => { b[i].c.profileId = rec.id }); made += d.records.length; await sleep(250)
}
console.log('created', made)
// Player status and last term on every player row (new and old).
const stat = []
for (const c of list) if (c.profileId) stat.push({ id: c.profileId, fields: { 'Player Status': status(c), 'Last Term': lastTerm(c), ...(c.dup && !PREF(c, 'profiles')[0]?.f['Review Note'] ? { 'Review Note': 'Another player has this name. Check if they are the same child, then merge in Airtable.' } : {}) } })
for (const b of batches(stat)) { await at(`${BASE}/${TABLE.profiles}`, { method: 'PATCH', body: { typecast: true, records: b } }); await sleep(250) }
// Links: every source row points at its player.
const linkTables = ['term4', 'term3', 'term2', 'oldPlayers', 'waiver', 'dropped3', 'dropped4', 'notReturning']
for (const tk of linkTables) {
  const todo = []; for (const c of list) for (const n of c) if (n.tk === tk && c.profileId && !(n.f.Player || []).length) todo.push({ id: n.id, fields: { Player: [c.profileId] } })
  for (const b of batches(todo)) { await at(`${BASE}/${TABLE[tk]}`, { method: 'PATCH', body: { records: b } }); await sleep(250) }
  console.log('linked', tk, todo.length)
}
// Ledger: through the row each payment names.
const profByRow = new Map(); for (const c of list) for (const n of c) if (c.profileId) profByRow.set(n.id, c.profileId)
const t4set = new Set(T.term4.map((r) => r.id))
const led = []; let unmatched = 0
for (const r of T.ledger) {
  if ((r.fields.Player || []).length) continue
  const p = profByRow.get(r.fields['Source Record ID']); if (!p) { unmatched++; continue }
  led.push({ id: r.id, fields: { Player: [p], ...(t4set.has(r.fields['Source Record ID']) && !(r.fields['Term 4 Row'] || []).length ? { 'Term 4 Row': [r.fields['Source Record ID']] } : {}) } })
}
for (const b of batches(led)) { await at(`${BASE}/${TABLE.ledger}`, { method: 'PATCH', body: { records: b } }); await sleep(250) }
console.log('linked ledger', led.length, 'left alone (source row gone)', unmatched)
