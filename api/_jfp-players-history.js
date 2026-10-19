// Past and present players (Lee, 19 Oct 2026): the Players tab can look back
// across terms, and Lee and Ligia can search the JF Master Players list.
// Read only. Names, parent, email, session and coach: never a phone, date of
// birth or medical note, which stay in Airtable.
// The older tables have finished and barely change, so each is read at most
// every 10 minutes.
import { kvGetJson, kvSetJson } from './_jfp-store.js'
import { readTable, airtable } from './_jfp-airtable.js'

// Oldest first. "First players table" is the base's original Players table;
// it carries no term of its own, so it is not given one.
export const HISTORY_TABLES = [
  { id: 'first', label: 'First players table', table: process.env.JFP_PLAYERS1_TABLE || 'tblY4W1OmMzNTAirt', location: 'Location' },
  { id: 'term2', label: 'Term 2 2026', table: process.env.JFP_TERM2_TABLE || 'tblFXWwF7l7iKMm2j', location: 'Session Location' },
  { id: 'term3', label: 'Term 3 2026', table: process.env.JFP_TERM3_TABLE || 'tblF25gfo0fZcqdPT', location: 'Session Location', status: 'Term 3 Enrolment Status' },
]
export const MASTER_TABLE = process.env.JFP_MASTER_PLAYERS_TABLE || 'tblGMVuC2QaoOxdsN'
const TTL = 600
const text = (f, name) => { const v = f?.[name]; return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v).trim() }
const isTest = (n) => /\btest\b/i.test(n || '')

export async function termRows(spec, { fresh = false } = {}) {
  const key = `jfp:history:v1:${spec.id}`
  if (!fresh) { const hit = await kvGetJson(key); if (Array.isArray(hit)) return hit }
  const status = spec.status || 'Status'
  const rows = (await readTable(spec.table, ['Player Name', 'Parent Name', 'Email', 'Session Day', 'Session Time', spec.location, 'Coach', status]))
    .map(({ id, fields: f }) => ({ rowId: id, term: spec.id, termLabel: spec.label, player: text(f, 'Player Name'), parent: text(f, 'Parent Name'), email: text(f, 'Email').toLowerCase(), session: [text(f, 'Session Day'), text(f, 'Session Time'), text(f, spec.location)].filter(Boolean).join(' '), coach: text(f, 'Coach'), status: text(f, status) }))
    .filter((r) => r.player && !isTest(r.player))
  await kvSetJson(key, rows, TTL)
  return rows
}

export async function masterRows({ fresh = false } = {}) {
  const key = 'jfp:history:v1:master'
  if (!fresh) { const hit = await kvGetJson(key); if (Array.isArray(hit)) return hit }
  const rows = (await readTable(MASTER_TABLE, ['Player Name', 'Parent Names from Sources', 'Source Tables', 'Review Status']))
    .map(({ id, fields: f }) => ({ rowId: id, player: text(f, 'Player Name'), parents: text(f, 'Parent Names from Sources'), sources: text(f, 'Source Tables'), review: text(f, 'Review Status') }))
    .filter((r) => r.player && !isTest(r.player))
    .sort((a, b) => a.player.localeCompare(b.player))
  await kvSetJson(key, rows, TTL)
  return rows
}

// Every term a player was in: one row per player (name + email), newest term first.
// current: this term's roster rows ({ player, parent, email, session, coach, status }).
export function mergePeople(current, past) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()
  const by = new Map()
  for (const r of [...current, ...[...past].reverse()]) {
    const k = `${norm(r.player)}|${r.email || ''}`
    const p = by.get(k) || { player: r.player, parent: r.parent, email: r.email, terms: [], refs: [], latest: r }
    if (!p.terms.includes(r.termLabel)) p.terms.push(r.termLabel)
    if (r.rowId) p.refs.push({ term: r.term, rowId: r.rowId })
    by.set(k, p)
  }
  return [...by.values()].map((p) => ({ player: p.player, parent: p.parent, email: p.email, terms: p.terms, current: p.latest.term === 'current', session: p.latest.session, coach: p.latest.coach, status: p.latest.status, lastTerm: p.latest.termLabel, refs: p.refs.slice(0, 6) })).sort((a, b) => a.player.localeCompare(b.player))
}

// The playersHistory action: term = 'all' | a HISTORY_TABLES id | 'master'.
export async function playersHistory({ body, roster, termLabel }) {
  const fresh = body.fresh === true
  if (body.term === 'master') return { term: 'master', master: await masterRows({ fresh }) }
  const specs = body.term === 'all' ? HISTORY_TABLES : HISTORY_TABLES.filter((t) => t.id === body.term)
  if (!specs.length) return { error: 'Choose a term.' }
  const failed = []
  const past = []
  for (const s of specs) { try { past.push(...(await termRows(s, { fresh }))) } catch (e) { failed.push(s.label); console.error('jfp history read failed', s.id, e.message) } }
  if (body.term !== 'all') return { term: body.term, rows: past, failed }
  const current = roster.players.filter((r) => r.holdsPlace && !isTest(r.player)).map((r) => ({ term: 'current', rowId: r.id, termLabel, player: r.player, parent: r.parent || '', email: String(r.email || '').toLowerCase(), session: [r.day, r.time, r.location].filter(Boolean).join(' '), coach: r.coach || '', status: r.confirmation || '' }))
  return { term: 'all', people: mergePeople(current, past), failed }
}
export const HISTORY_TERMS = HISTORY_TABLES.map((t) => ({ id: t.id, label: t.label }))

// One player's Airtable records, for the Players tab when Lee or Ligia click a
// past player (Lee, 19 Oct 2026). Every filled field of each record, except
// medical notes, which stay in Airtable. refs: [{ term, rowId }], at most 6.
const ROW = /^rec[0-9A-Za-z]{14}$/
const MEDICAL = /medical|allerg|injur|health|condition|medication|asthma/i
const FIRST = ['Player Name', 'Parent Name', 'Email', 'Phone', 'Mobile', 'Session Day', 'Session Time', 'Session Location', 'Location', 'Coach', 'Status', 'Term 3 Enrolment Status', 'Payment Status', 'Payment Type', 'Fee', 'Amount Paid']
function showValue(v) {
  if (v == null || v === '') return ''
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && v[0]?.url) return `${v.length} file${v.length === 1 ? '' : 's'} in Airtable`
    if (v.length && /^rec[0-9A-Za-z]{14}$/.test(String(v[0]))) return `${v.length} linked record${v.length === 1 ? '' : 's'}`
    return v.map((x) => (typeof x === 'object' ? x?.name || x?.email || '' : String(x))).filter(Boolean).join(', ')
  }
  if (typeof v === 'object') return v.name || v.email || v.label || ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v).slice(0, 600)
}
export async function playerRecords({ refs, termLabel, currentTable }) {
  const tables = { ...Object.fromEntries(HISTORY_TABLES.map((t) => [t.id, [t.table, t.label]])), master: [MASTER_TABLE, 'JF Master Players'], current: [currentTable, termLabel] }
  const out = []
  for (const r of (Array.isArray(refs) ? refs : []).slice(0, 6)) {
    const t = tables[r?.term]
    if (!t || !t[0] || !ROW.test(r?.rowId || '')) continue
    try {
      const rec = await airtable(`${encodeURIComponent(t[0])}/${r.rowId}`)
      const f = rec.fields || {}
      const keys = Object.keys(f).filter((k) => !MEDICAL.test(k)).sort((a, b) => ((FIRST.indexOf(a) + 1 || 99) - (FIRST.indexOf(b) + 1 || 99)) || a.localeCompare(b))
      out.push({ term: r.term, label: t[1], rowId: r.rowId, created: rec.createdTime || '', fields: keys.map((k) => [k, showValue(f[k])]).filter(([, v]) => v) })
    } catch (e) { out.push({ term: r.term, label: t[1], rowId: r.rowId, error: 'Could not read this record just now.' }); console.error('jfp player record read failed', r.term, e.message) }
  }
  return out
}
