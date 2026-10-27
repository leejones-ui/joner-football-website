// Past and present players (Lee, 19 Oct 2026): the Players tab can look back
// across terms, and Lee and Ligia can search the JF Master Players list.
// Read only. Names, parent, email, session and coach: never a phone, date of
// birth or medical note, which stay in Airtable.
// The older tables have finished and barely change, so each is read at most
// every 10 minutes.
import { kvGetJson, kvSetJson } from './_jfp-store.js'
import { readTable, airtable, TABLES } from './_jfp-airtable.js'
import { PROFILES_TABLE } from './_jfp-profiles.js'

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
const ROW_ID = /^rec[0-9A-Za-z]{14}$/
// The JFP Player Profiles record a row links to (its Player field), if any.
const profileOf = (f) => { const v = Array.isArray(f?.Player) ? f.Player[0] : ''; return ROW_ID.test(v || '') ? v : '' }

export async function termRows(spec, { fresh = false } = {}) {
  const key = `jfp:history:v2:${spec.id}`
  if (!fresh) { const hit = await kvGetJson(key); if (Array.isArray(hit)) return hit }
  const status = spec.status || 'Status'
  const rows = (await readTable(spec.table, ['Player Name', 'Parent Name', 'Email', 'Session Day', 'Session Time', spec.location, 'Coach', status, 'Player']))
    .map(({ id, fields: f }) => ({ rowId: id, term: spec.id, termLabel: spec.label, player: text(f, 'Player Name'), parent: text(f, 'Parent Name'), email: text(f, 'Email').toLowerCase(), session: [text(f, 'Session Day'), text(f, 'Session Time'), text(f, spec.location)].filter(Boolean).join(' '), coach: text(f, 'Coach'), status: text(f, status), profile: profileOf(f) }))
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

// Term 4 rows' Player links (the roster does not read them), cached briefly.
export async function currentProfiles({ fresh = false } = {}) {
  const key = 'jfp:history:v2:current-profiles'
  if (!fresh) { const hit = await kvGetJson(key); if (hit && typeof hit === 'object') return hit }
  const out = {}
  for (const { id, fields } of await readTable(TABLES.term4, ['Player'])) { const p = profileOf(fields); if (p) out[id] = p }
  await kvSetJson(key, out, 120)
  return out
}

// Every term a player was in, newest term first (Lee, 27 Oct 2026): one row per
// JFP Player Profile when the rows link to one, so a player whose email changed
// between terms is one entry; rows with no profile fall back to name + email.
// current: this term's roster rows ({ player, parent, email, session, coach, status, profile }).
export function mergePeople(current, past) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()
  const rows = [...current, ...[...past].reverse()]
  const plain = (r) => `${norm(r.player)}|${r.email || ''}`
  // A row with no profile joins the profile another row with its name + email has.
  const viaPlain = new Map()
  for (const r of rows) if (r.profile && !viaPlain.has(plain(r))) viaPlain.set(plain(r), r.profile)
  const by = new Map()
  for (const r of rows) {
    const profile = r.profile || viaPlain.get(plain(r)) || ''
    const k = profile ? `p:${profile}` : plain(r)
    const p = by.get(k) || { player: r.player, parent: r.parent, email: r.email, terms: [], refs: [], latest: r, profile }
    if (!p.parent && r.parent) p.parent = r.parent
    if (!p.email && r.email) p.email = r.email
    if (!p.terms.includes(r.termLabel)) p.terms.push(r.termLabel)
    if (r.rowId) p.refs.push({ term: r.term, rowId: r.rowId })
    by.set(k, p)
  }
  return [...by.values()].map((p) => ({ player: p.player, parent: p.parent, email: p.email, terms: p.terms, current: p.latest.term === 'current', session: p.latest.session, coach: p.latest.coach, status: p.latest.status, lastTerm: p.latest.termLabel, profile: p.profile || '', refs: [...p.refs.slice(0, 6), ...(p.profile ? [{ term: 'profile', rowId: p.profile }] : [])] })).sort((a, b) => a.player.localeCompare(b.player))
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
  const links = await currentProfiles({ fresh }).catch((e) => { console.error('jfp history profile links failed', e.message); return {} })
  const current = roster.players.filter((r) => r.holdsPlace && !isTest(r.player)).map((r) => ({ term: 'current', rowId: r.id, profile: links[r.id] || '', termLabel, player: r.player, parent: r.parent || '', email: String(r.email || '').toLowerCase(), session: [r.day, r.time, r.location].filter(Boolean).join(' '), coach: r.coach || '', status: r.confirmation || '' }))
  return { term: 'all', people: mergePeople(current, past), failed }
}
export const HISTORY_TERMS = HISTORY_TABLES.map((t) => ({ id: t.id, label: t.label }))

// One player's Airtable records, for the Players tab when Lee or Ligia click a
// past player (Lee, 19 Oct 2026). Every filled field of each term record, except
// medical notes, which stay in Airtable. refs: [{ term, rowId }], at most 6 term
// rows plus their JFP Player Profile (term 'profile', Lee 27 Oct 2026). The
// profile shows its non-medical fields but never a date of birth, and each
// waiver linked to it shows only its contact fields.
const ROW = ROW_ID
const MEDICAL = /medical|allerg|injur|health|condition|medication|asthma/i
const NO_DOB = /date of birth|\bdob\b|birth/i
const WAIVER_CONTACT = ['Player Full Name', 'Parent/Guardian Name', 'Parent Email', 'Parent Mobile Number', 'Emergency Contact Name', 'Emergency Contact Phone', 'Term', 'Signed Date']
const FIRST = ['Player Name', 'Parent Name', 'Email', 'Phone', 'Phone Number', 'Phone number', 'Mobile', 'Session Day', 'Session Time', 'Session Location', 'Location', 'Coach', 'Status', 'Term 3 Enrolment Status', 'Payment Status', 'Payment Type', 'Fee', 'Amount Paid']
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
  const list = Array.isArray(refs) ? refs : []
  const out = []
  // The profile, then its waivers (contact fields only), go first: they hold the
  // contact details the older term rows often lack.
  const prof = list.find((r) => r?.term === 'profile' && ROW.test(r?.rowId || ''))
  if (prof) {
    try {
      const rec = await airtable(`${encodeURIComponent(PROFILES_TABLE)}/${prof.rowId}`)
      const f = rec.fields || {}
      const keys = Object.keys(f).filter((k) => !MEDICAL.test(k) && !NO_DOB.test(k)).sort((a, b) => ((FIRST.indexOf(a) + 1 || 99) - (FIRST.indexOf(b) + 1 || 99)) || a.localeCompare(b))
      out.push({ term: 'profile', label: 'JFP Player Profile', rowId: prof.rowId, created: rec.createdTime || '', fields: keys.map((k) => [k, showValue(f[k])]).filter(([, v]) => v) })
      for (const w of (Array.isArray(f.Waivers) ? f.Waivers : []).filter((x) => ROW.test(x || '')).slice(0, 3)) {
        try {
          const wr = await airtable(`${encodeURIComponent(TABLES.waiver)}/${w}`)
          const wf = wr.fields || {}
          out.push({ term: 'waiver', label: `Waiver${wf.Term ? ` (${showValue(wf.Term)})` : ''}`, rowId: w, created: wr.createdTime || '', fields: WAIVER_CONTACT.map((k) => [k, showValue(wf[k])]).filter(([, v]) => v) })
        } catch (e) { out.push({ term: 'waiver', label: 'Waiver', rowId: w, error: 'Could not read this record just now.' }); console.error('jfp waiver read failed', e.message) }
      }
    } catch (e) { out.push({ term: 'profile', label: 'JFP Player Profile', rowId: prof.rowId, error: 'Could not read this record just now.' }); console.error('jfp profile read failed', e.message) }
  }
  for (const r of list.filter((x) => x?.term !== 'profile').slice(0, 6)) {
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
