// Joners Juniors rows in Airtable: one table per term (config.juniors.tables,
// base apphU4R0BtVIu5YqT). This reads them with a short KV cache and writes
// them back, the way _jfp-airtable.js does for Term 4 Players.
//
// The term tables do not have the same columns (Term 3 has Registration ID,
// Paid At and Internal Notes; Term 4 has Notes, Waiver Status and the payment
// link) and staff add columns by hand. So nothing here assumes a column:
//   - reads ask for every field and take whichever name is there;
//   - writes leave out a column Airtable says the table does not have
//     (remembered per table for 10 minutes in memory and 6 hours in KV, so a
//     column Lee adds later is used from then on), and anything that must not
//     be lost (a registration or Stripe id, medical notes) goes into the
//     row's notes as a tag or a line instead.
//
// Tags in the notes (always [JJ-...:value], never removed by hand-editing
// the rest of the note):
//   [JJ-REG:<registration id>]  [JJ-CS:<Stripe Checkout Session>]  [JJ-PI:<PaymentIntent>]
//   [JJ-ADD:<portal add id>]    [JJ-REMOVED:<yyyy-mm-dd>]           [JJ-PAY:<payment id>:<cents>]
//   [JJ-VOID:<payment id>]
// A child is "removed" (soft, like JFP's removed players) while the row
// carries [JJ-REMOVED:...]. The row stays in Airtable; restoring takes the
// tag off and notes who did it.
import { airtable, readTable, isoDate } from './_jfp-airtable.js'
import { kvGetJson, kvSetJson, kvCommand, kvPipeline, clean, emailsIn, normName, sydneyToday, getConfig, normaliseConfig } from './_jfp-store.js'

export const REC = /^rec[A-Za-z0-9]{14}$/
const CACHE_SECONDS = 60
const MISSING_MEMO_MS = 10 * 60 * 1000
const MISSING_KV_SECONDS = 6 * 3600
const NOTES_MAX = 20000

// Canonical name -> the Airtable column names it may have, first choice first.
export const NAMES = {
  player: ['Player Full Name'],
  dob: ['Date of Birth'],
  parent: ['Parent Name'],
  email: ['Parent Email'],
  email2: ['Parent Email 2'],
  mobile: ['Parent Mobile'],
  mobile2: ['Parent Mobile 2'],
  term: ['Term'],
  day: ['Session Day'],
  time: ['Session Time'],
  location: ['Location'],
  coach: ['Coach'],
  className: ['Class'],
  fee: ['Fee'],
  status: ['Payment Status'],
  paidVia: ['Paid Via'],
  paidAt: ['Paid At'],
  amountPaid: ['Amount Paid'],
  registrationId: ['Registration ID'],
  sessionId: ['Stripe Checkout Session ID'],
  intentId: ['Stripe PaymentIntent ID'],
  link: ['Stripe Payment Link'],
  medical: ['Medical History / Allergies', 'Medical Notes'],
  heard: ['Heard About Us'],
  confirmation: ['Confirmation Status'],
  confirmationDate: ['Confirmation Date'],
  confirmationEmail: ['Confirmation Email Status'],
  waiverStatus: ['Waiver Status'],
  notes: ['Notes', 'Internal Notes'],
}
// With no column for these, the value goes into the notes instead.
const IN_NOTES = {
  registrationId: (v) => `[JJ-REG:${v}]`,
  sessionId: (v) => `[JJ-CS:${v}]`,
  intentId: (v) => `[JJ-PI:${v}]`,
  medical: (v) => `Medical: ${v}`,
  heard: (v) => `Heard about us: ${v}`,
  email2: (v) => `Second parent email: ${v}`,
  mobile2: (v) => `Second parent mobile: ${v}`,
}
// The newest "<label>: value" line in the notes, for a table with no column.
// "none" is how a cleared one is written.
const lastLine = (notes, label) => { const v = [...String(notes || '').matchAll(new RegExp(`^(?:\\d{4}-\\d{2}-\\d{2}: )?${label}: (.+)$`, 'gm'))].at(-1)?.[1]?.trim() || ''; return v === 'none' ? '' : v }
// Cleared on a table with no column: written as "none" so the old value stops counting.
const CLEARS_IN_NOTES = new Set(['email2', 'mobile2'])

const txt = (v) => (v == null ? '' : Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? x?.name || '' : x)).join(', ') : String(v).trim())
const pick = (f, key) => { for (const n of NAMES[key]) if (f[n] != null && f[n] !== '') return f[n]; return undefined }
export function tagValue(notes, tag) { const m = String(notes || '').match(new RegExp(`\\[${tag}:([^\\]]+)\\]`)); return m ? m[1].trim() : '' }
export function tagValues(notes, tag) { return [...String(notes || '').matchAll(new RegExp(`\\[${tag}:([^\\]]+)\\]`, 'g'))].map((m) => m[1].trim()) }

// 05/03/2020 -> 2020-03-05 (Airtable keeps the date of birth as text, day first).
export function dobIso(v) { return isoDate(txt(v)) }
// 2020-03-05 -> 05/03/2020, the way the Juniors tables write it.
export function dobText(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : '' }

export function parseRemoved(notes) {
  const at = tagValue(notes, 'JJ-REMOVED')
  if (!at) return null
  const line = String(notes).split('\n').find((l) => l.includes(`[JJ-REMOVED:${at}]`)) || ''
  const m = /Removed by ([^:\n]+): ([^\n]*?)\.?\s*\[JJ-REMOVED:/.exec(line)
  return { at, by: m ? m[1].trim() : '', reason: m ? m[2].trim() : '' }
}

// One Airtable record as a Juniors child. term: the table's term when the row has none.
export function parseJJRecord(record, table = '', term = '') {
  const f = record?.fields || {}
  const notes = [txt(f.Notes), txt(f['Internal Notes'])].filter(Boolean).join('\n')
  const fee = pick(f, 'fee'), paid = pick(f, 'amountPaid')
  // A second parent's email: its column, or the newest notes line.
  const emails = [...new Set([...emailsIn(txt(pick(f, 'email'))), ...emailsIn(txt(pick(f, 'email2')) || lastLine(notes, 'Second parent email'))])]
  return {
    id: record?.id || '', table, createdTime: record?.createdTime || '',
    term: txt(pick(f, 'term')) || term,
    player: txt(pick(f, 'player')),
    dob: dobIso(pick(f, 'dob')), dobText: txt(pick(f, 'dob')),
    parent: txt(pick(f, 'parent')),
    emails, email: emails[0] || '',
    mobile: txt(pick(f, 'mobile')), mobile2: txt(pick(f, 'mobile2')) || lastLine(notes, 'Second parent mobile'),
    day: txt(pick(f, 'day')), time: txt(pick(f, 'time')), location: txt(pick(f, 'location')),
    coach: txt(pick(f, 'coach')), className: txt(pick(f, 'className')),
    feeCents: typeof fee === 'number' && Number.isFinite(fee) ? Math.round(fee * 100) : null,
    amountPaidCents: typeof paid === 'number' && Number.isFinite(paid) ? Math.round(paid * 100) : null,
    status: txt(pick(f, 'status')), paidVia: txt(pick(f, 'paidVia')), paidAt: txt(pick(f, 'paidAt')),
    registrationId: txt(pick(f, 'registrationId')) || tagValue(notes, 'JJ-REG'),
    sessionId: txt(pick(f, 'sessionId')) || tagValue(notes, 'JJ-CS'),
    intentId: txt(pick(f, 'intentId')) || tagValue(notes, 'JJ-PI'),
    linkUrl: txt(pick(f, 'link')),
    medical: txt(pick(f, 'medical')) || lastLine(notes, 'Medical'),
    heard: txt(pick(f, 'heard')),
    confirmation: txt(pick(f, 'confirmation')), confirmationDate: txt(pick(f, 'confirmationDate')),
    confirmationEmail: txt(pick(f, 'confirmationEmail')),
    waiverStatus: txt(pick(f, 'waiverStatus')),
    notes,
    addId: tagValue(notes, 'JJ-ADD'),
    removed: parseRemoved(notes),
  }
}

// The settings, or the defaults when KV cannot be read, so the public sign-up
// and the Stripe webhook keep working (they did not need KV before).
export async function configOrDefaults() {
  try { return { config: await getConfig(), fallback: false } } catch (error) {
    console.error('jj config read failed, using the defaults', error.message)
    return { config: normaliseConfig({}), fallback: true }
  }
}

// ---------- which table ----------

// The table for a term (default: the Juniors term running now). The old
// JUNIORS_AIRTABLE_TABLE setting is only a fallback for the current term.
export function tableFor(config, term = '') {
  const jj = config?.juniors || {}
  const t = term || jj.term
  return jj.tables?.[t] || (t === jj.term ? process.env.JUNIORS_AIRTABLE_TABLE || '' : '')
}
// [{ term, table }], newest term first.
export function termTables(config) {
  const order = (t) => { const m = /term\s*(\d)\s+(\d{4})/i.exec(t || ''); return m ? Number(m[2]) * 10 + Number(m[1]) : 0 }
  return Object.entries(config?.juniors?.tables || {}).map(([term, table]) => ({ term, table })).sort((a, b) => order(b.term) - order(a.term))
}

// ---------- reading ----------

const rowsKey = (table) => `jj:rows:v1:${table}`
const clearedKey = (table) => `jj:rows-cleared:${table}`

// Every child in one term table. Cached for a minute; any write clears it.
// A failed read throws: a missing table is never "no children".
export async function readJJTable(table, { term = '', fresh = false } = {}, deps = {}) {
  const read = deps.readTable || readTable
  if (!table) throw new Error(`No Airtable table is set for ${term || 'this Joners Juniors term'}.`)
  const cleared = Number(await kvCommand(['GET', clearedKey(table)])) || 0
  if (!fresh) {
    const hit = await kvGetJson(rowsKey(table))
    // Never a copy read before (or the same moment as) the last write.
    if (hit && Array.isArray(hit.records) && hit.at > cleared && Date.now() - hit.at < CACHE_SECONDS * 1000) return hit.records.map((r) => parseJJRecord(r, table, term))
  }
  const startedAt = Date.now()
  const records = await read(table)
  // A slow read that began before a write does not replace the cache.
  if (startedAt > (Number(await kvCommand(['GET', clearedKey(table)])) || 0)) await kvSetJson(rowsKey(table), { at: startedAt, records }, 3600)
  return records.map((r) => parseJJRecord(r, table, term))
}

// The current term's children, or another term's.
export async function readJJRows(config, { term = '', fresh = false } = {}, deps = {}) {
  const t = term || config.juniors.term
  return readJJTable(tableFor(config, t), { term: t, fresh }, deps)
}

// One child, read straight from Airtable. null only when the row is not there.
export async function getJJRow(table, id, term = '') {
  if (!REC.test(id || '') || !table) return null
  try { return parseJJRecord(await airtable(`${encodeURIComponent(table)}/${id}`), table, term) } catch (error) {
    if (/Airtable 404/.test(error.message)) return null
    throw error
  }
}

// After any change: this table's cache, the timetable's Juniors list, the
// venues' Juniors list, and the Juniors money figures.
export async function bustJJ(table) {
  const now = String(Date.now())
  await kvPipeline([
    ...(table ? [['SET', clearedKey(table), now, 'EX', '86400'], ['DEL', rowsKey(table)]] : []),
    ['DEL', 'jfp:juniors-roster', 'jfp:juniors-cache'],
    ['SET', 'jj:money-cleared', now, 'EX', String(30 * 86400)],
  ])
}

// ---------- writing ----------

const memo = new Map() // table -> { at, set }
const missingKey = (table) => `jj:missing-fields:${table}`
export async function missingFields(table) {
  const m = memo.get(table)
  if (m && Date.now() - m.at < MISSING_MEMO_MS) return m.set
  let list = []
  try { list = await kvGetJson(missingKey(table)) } catch {}
  const set = new Set(Array.isArray(list) ? list : [])
  memo.set(table, { at: Date.now(), set })
  return set
}
async function noteMissing(table, name) {
  const set = await missingFields(table)
  set.add(name)
  try { await kvSetJson(missingKey(table), [...set], MISSING_KV_SECONDS) } catch {}
}
export function forgetMissing() { memo.clear() }

// "<existing>\n2026-10-20: <line>", kept under Airtable's size, never losing a [JJ-...] tag.
export function appendLine(existing, line, today = sydneyToday()) {
  const out = `${existing ? `${existing}\n` : ''}${today}: ${line}`
  if (out.length <= NOTES_MAX) return out
  const tail = out.slice(-NOTES_MAX + 600)
  const lost = out.slice(0, out.length - tail.length).match(/\[JJ-[A-Z]+:[^\]]+\]/g) || []
  return `${[...new Set(lost)].join(' ')}\n${tail}`.slice(-NOTES_MAX)
}

// Canonical values -> Airtable fields for this table. Returns { fields, notesExtra }.
function mapFields(set, missing, notesName) {
  const fields = {}, extra = []
  for (const [key, value] of Object.entries(set)) {
    if (key === 'notes' || value === undefined) continue
    const name = (NAMES[key] || [key]).find((n) => !missing.has(n))
    if (name) fields[name] = value
    else if (IN_NOTES[key] && value != null && value !== '') extra.push(IN_NOTES[key](value))
    else if (CLEARS_IN_NOTES.has(key)) extra.push(IN_NOTES[key]('none'))
  }
  return { fields, extra, notesName }
}

// Text typed by staff or a family never makes a tag of its own.
export const plain = (v, max = 500) => clean(String(v ?? '').replace(/[[\]]/g, ''), max)

// A notes line already says this: a tag anywhere, or the newest line of the
// same kind ("Medical: ...") with the same value.
function alreadySays(notes, line) {
  if (line.startsWith('[')) return notes.includes(line)
  const prefix = line.slice(0, line.indexOf(':') + 1)
  const last = notes.split('\n').filter((l) => l.replace(/^\d{4}-\d{2}-\d{2}: /, '').startsWith(prefix)).at(-1)
  return Boolean(last) && last.replace(/^\d{4}-\d{2}-\d{2}: /, '') === line
}

// Create (no id) or change one row. set: canonical values (null clears a
// column). note: a line added to the row's notes. editNotes(text): change
// the notes first (for taking a tag off). Returns the record id.
export async function writeJJRow(table, { id = '', set = {}, note = '', editNotes = null } = {}, deps = {}) {
  const call = deps.airtable || airtable
  if (!table) throw new Error('No Airtable table is set for this Joners Juniors term.')
  if (id && !REC.test(id)) throw new Error('That Juniors row id is not valid.')
  // The notes already on the row, so a line is added, never written over.
  let base = '', notesName = ''
  const mayNote = Boolean(note) || Boolean(editNotes) || Object.keys(set).some((k) => IN_NOTES[k] && ((set[k] != null && set[k] !== '') || CLEARS_IN_NOTES.has(k)))
  if (id && mayNote) {
    const rec = await call(`${encodeURIComponent(table)}/${id}`)
    const f = rec?.fields || {}
    notesName = NAMES.notes.find((n) => f[n] != null) || ''
    base = notesName ? txt(f[notesName]) : ''
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const missing = deps.missing || await missingFields(table)
    const name = (notesName && !missing.has(notesName) ? notesName : '') || NAMES.notes.find((n) => !missing.has(n)) || ''
    const { fields, extra } = mapFields(set, missing, name)
    let notesText = editNotes ? editNotes(base) : base
    let changed = Boolean(editNotes)
    // The note first, then any value with no column of its own, then the ids on one line.
    if (note) { notesText = appendLine(notesText, note); changed = true }
    for (const line of extra.filter((l) => !l.startsWith('['))) if (!alreadySays(notesText, line)) { notesText = appendLine(notesText, line); changed = true }
    const tags = extra.filter((l) => l.startsWith('[') && !notesText.includes(l))
    if (tags.length) { notesText = appendLine(notesText, tags.join(' ')); changed = true }
    if (name && changed) fields[name] = notesText
    if (id && !Object.keys(fields).length) return id
    try {
      const d = id
        ? await call(encodeURIComponent(table), { method: 'PATCH', body: { typecast: true, records: [{ id, fields }] } })
        : await call(encodeURIComponent(table), { method: 'POST', body: { typecast: true, records: [{ fields }] } })
      // The write has happened: a cache that could not be cleared only means
      // up to a minute of old figures, never a second write.
      try { await (deps.bust || bustJJ)(table) } catch (error) { console.error('jj cache clear failed', error.message) }
      return d.records?.[0]?.id || id
    } catch (error) {
      const m = /Unknown field name: "([^"]+)"/.exec(error.message || '')
      if (!m || !Object.hasOwn(fields, m[1])) throw error
      if (deps.missing) deps.missing.add(m[1]); else await noteMissing(table, m[1])
    }
  }
  throw new Error('Airtable kept refusing the Joners Juniors columns.')
}

// The row this registration made, if any: by its Registration ID column or
// its [JJ-REG] tag. Read fresh, so a retry never makes a second row.
export async function findByRegistration(table, registrationId, deps = {}) {
  if (!registrationId) return null
  const rows = await readJJTable(table, { fresh: true }, deps)
  return rows.find((r) => r.registrationId === registrationId) || null
}

// ---------- small helpers for the portal ----------

export const isEnrolled = (r) => !r.removed && !/^(dropped|not returning|removed)$/i.test(r.confirmation || '')
export const familyKey = (r) => r.emails?.[0] || `row:${r.id}`
export function sameChild(a, b) {
  return normName(a.player) === normName(b.player) && (a.emails || []).some((e) => (b.emails || []).includes(e))
}
export { clean }
