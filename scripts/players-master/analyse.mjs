import { all, TABLE, norm, emailsOf, phoneKey, iso } from './lib.mjs'
const names = Object.keys(TABLE)
const T = {}
for (const k of names) { try { T[k] = await all(TABLE[k]) } catch (e) { console.log('skip', k, e.message.slice(0, 80)); T[k] = [] } }
for (const k of names) console.log(k.padEnd(14), T[k].length)
// who is who: name + any email
const pf = T.profiles
const keyOf = (name, email) => `${norm(name)}|${email}`
const profByKey = new Map(pf.map((r) => [r.fields['Player Key'], r.id]))
let rows4 = 0, hit4 = 0
const people = new Map() // norm(name) -> set of emails
const add = (name, emails) => { const n = norm(name); if (!n) return; const s = people.get(n) || new Set(); emails.forEach((e) => s.add(e)); people.set(n, s) }
for (const r of T.term4) { rows4++; const f = r.fields; const es = emailsOf(f.Email); add(f['Player Name'], es); if (es.some((e) => profByKey.has(keyOf(f['Player Name'], e)))) hit4++ }
console.log('term4 rows', rows4, 'with profile by key', hit4)
for (const [t, nf, ef] of [['term3', 'Player Name', 'Email'], ['term2', 'Player Name', 'Email'], ['oldPlayers', 'Player Name', 'Email'], ['waiver', 'Player Full Name', 'Parent Email'], ['dropped3', 'Player Name', 'Email'], ['dropped4', 'Player Name', 'Email'], ['notReturning', 'Player Name', 'Email'], ['nextHolds', 'Player Name', 'Email']]) for (const r of T[t]) add(r.fields[nf], emailsOf(r.fields[ef]))
console.log('distinct names across all tables', people.size)
let multi = 0; for (const s of people.values()) if (s.size > 1) multi++
console.log('names with more than one email', multi)
// ledger linkage
const t4ids = new Set(T.term4.map((r) => r.id)); const t3ids = new Set(T.term3.map((r) => r.id))
const bySrc = {}; let ledNoSrc = 0
for (const r of T.ledger) { const s = r.fields['Source Table'] || '(none)'; bySrc[s] = (bySrc[s] || 0) + 1; const id = r.fields['Source Record ID']; if (!id) ledNoSrc++ }
console.log('ledger by source table', JSON.stringify(bySrc), 'no source id', ledNoSrc)
let ledLinked = 0; const t2ids = new Set(T.term2.map((r) => r.id))
for (const r of T.ledger) { const id = r.fields['Source Record ID']; if (t4ids.has(id) || t3ids.has(id) || t2ids.has(id)) ledLinked++ }
console.log('ledger rows whose source row exists', ledLinked, 'of', T.ledger.length)
// waiver coverage: matching a term4 player by name AND email/phone
const wByName = new Map(); for (const w of T.waiver) { const n = norm(w.fields['Player Full Name']); wByName.set(n, [...(wByName.get(n) || []), w]) }
let wHit = 0
for (const r of T.term4) { const n = norm(r.fields['Player Name']); const es = new Set(emailsOf(r.fields.Email)); const ws = wByName.get(n) || []; if (ws.some((w) => emailsOf(w.fields['Parent Email']).some((e) => es.has(e)) || (phoneKey(w.fields['Parent Mobile Number']) && phoneKey(w.fields['Parent Mobile Number']) === phoneKey(r.fields.Phone)))) wHit++ }
console.log('term4 players with a waiver by name+family', wHit, 'of', rows4)
// field fill rate in profiles
const fill = {}; for (const r of pf) for (const [k, v] of Object.entries(r.fields)) if (v !== '' && v != null) fill[k] = (fill[k] || 0) + 1
console.log('profiles', pf.length, 'fill', JSON.stringify(fill))
