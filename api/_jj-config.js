// Joners Juniors settings (config.juniors), kept in the same KV config as JFP
// (getConfig / saveConfig in _jfp-store.js) and edited in the portal under
// Joners Juniors > Settings. The public page, Stripe Checkout, the emails and
// the portal all read them from here, so a change Ligia saves shows without
// a deploy.
//
// No imports on purpose: the public Astro page imports JJ_DEFAULTS and
// juniorsPublic for its first paint, and the server modules import it too.
//
// The defaults are Term 4 2026. Lee to confirm the dates: Airtable has no
// Juniors dates, so the term is ten Saturdays from 17 October 2026 (the
// first Saturday of school Term 4) to 19 December 2026.

export const JJ_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const JJ_DEFAULTS = Object.freeze({
  term: 'Term 4 2026',
  // The first class of the term. Later classes are weekly from here.
  termStart: '2026-10-17',
  weeks: 10,
  // [{ date, reason }]: Saturdays with no class (taken out of the dates).
  skipDates: [],
  // What the page and emails say for the term's dates. '' = worked out from
  // the class dates ("17 October 2026 to 19 December 2026"). Term 4 2026 says
  // the school term's dates, as the live page does (main, 13 Oct 2026); only
  // used until Settings are first saved, and only for Term 4 2026.
  datesLabel: '12 October 2026 to 19 December 2026',
  // One class for now (Lee, 13 Oct 2026). A list, so a second class later
  // is a second entry, not a rewrite.
  classes: [{ id: 'sat-0915-belrose', day: 'Saturday', time: '9:15am', endTime: '10:00am', location: 'Belrose HQ', capacity: 12, coachId: 'sam' }],
  // '' = from the first class ("Saturday 9:15am to 10:00am").
  classLabel: '',
  // Where parents go, as the page and the emails say it.
  location: 'Joner Football HQ, Unit 2, 20 Narabang Way, Belrose',
  priceCents: 22000,
  // Optional second child price. null = same price for every child.
  siblingPriceCents: null,
  registrationOpen: true,
  waiverVersion: 'Joners Juniors Term 4 2026 online waiver v1',
  ageLabel: 'Ages 3 to early primary',
  // The Airtable table for each term's children (base apphU4R0BtVIu5YqT).
  tables: { 'Term 3 2026': 'tblMLhYQ126P5uKLB', 'Term 4 2026': 'tblVzW8E9qumQEtXx' },
  // Next term, for re-enrolment (Invites). priceCents null = this term's
  // price. holdCents null = no hold: families pay in full or say not
  // returning. The next term's children go into tables[nextTerm.name].
  nextTerm: { name: 'Term 1 2027', termStart: '', open: false, priceCents: null, holdCents: null },
})

const ISO = /^\d{4}-\d{2}-\d{2}$/
const TABLE = /^tbl[A-Za-z0-9]{14}$/
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function jjClean(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

// "9:15am" -> "09:15"; '' if it cannot be read.
export function jjTime24(label) {
  const m = String(label || '').trim().toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)$/)
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return ''
  let h = Number(m[1]) % 12
  if (m[3] === 'pm') h += 12
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`
}
const timeLabel = (v) => jjClean(v, 10).toLowerCase().replace(/\s+/g, '')

// 2026-10-17 -> "17 October 2026".
export function longDate(iso) {
  if (!ISO.test(iso || '')) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const dayOf = (iso) => JJ_DAYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7]

function cleanClass(c, fallback) {
  const day = JJ_DAYS.includes(c?.day) ? c.day : ''
  const time = jjTime24(c?.time) ? timeLabel(c.time) : ''
  if (!day || !time) return null
  const capacity = Number(c.capacity)
  return {
    id: jjClean(c.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, '') || `${day.slice(0, 3).toLowerCase()}-${jjTime24(time).replace(':', '')}`,
    day, time,
    endTime: jjTime24(c.endTime) ? timeLabel(c.endTime) : '',
    location: jjClean(c.location, 80) || fallback?.location || 'Belrose HQ',
    capacity: Number.isInteger(capacity) && capacity >= 0 && capacity <= 60 ? capacity : (fallback?.capacity ?? 12),
    coachId: jjClean(c.coachId, 30).toLowerCase().replace(/[^a-z0-9-]/g, ''),
  }
}

function cleanTables(input, base) {
  const out = { ...base }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [term, id] of Object.entries(input)) {
      const t = jjClean(term, 40)
      if (t && TABLE.test(String(id || '').trim())) out[t] = String(id).trim()
    }
  }
  return out
}

const centsOr = (v, fallback, { min = 100, max = 200000, allowNull = false } = {}) => {
  if (allowNull && (v === null || v === '' || v === undefined)) return null
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

// Lenient: whatever is stored reads cleanly, falling back field by field.
export function normaliseJuniors(input = {}) {
  const b = JJ_DEFAULTS
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const classes = Array.isArray(src.classes) ? src.classes.slice(0, 6).map((c, i) => cleanClass(c, b.classes[i] || b.classes[0])).filter(Boolean) : []
  const weeks = Number(src.weeks)
  return {
    term: jjClean(src.term, 40) || b.term,
    termStart: ISO.test(src.termStart || '') ? src.termStart : b.termStart,
    weeks: Number.isInteger(weeks) && weeks >= 1 && weeks <= 20 ? weeks : b.weeks,
    skipDates: Array.isArray(src.skipDates) ? [...new Map(src.skipDates.filter((x) => ISO.test(x?.date || '')).map((x) => [x.date, { date: x.date, reason: jjClean(x.reason, 60) || 'No class' }])).values()].sort((x, y) => x.date.localeCompare(y.date)) : [],
    datesLabel: src.datesLabel === undefined ? ((jjClean(src.term, 40) || b.term) === b.term ? b.datesLabel : '') : jjClean(src.datesLabel, 80),
    classes: classes.length ? classes : b.classes.map((c) => ({ ...c })),
    classLabel: jjClean(src.classLabel, 80),
    location: jjClean(src.location, 160) || b.location,
    priceCents: centsOr(src.priceCents, b.priceCents),
    siblingPriceCents: centsOr(src.siblingPriceCents, null, { allowNull: true }),
    registrationOpen: typeof src.registrationOpen === 'boolean' ? src.registrationOpen : b.registrationOpen,
    waiverVersion: jjClean(src.waiverVersion, 80) || b.waiverVersion,
    ageLabel: jjClean(src.ageLabel, 60) || b.ageLabel,
    tables: cleanTables(src.tables, b.tables),
    nextTerm: {
      name: jjClean(src.nextTerm?.name, 40) || b.nextTerm.name,
      termStart: ISO.test(src.nextTerm?.termStart || '') ? src.nextTerm.termStart : '',
      open: src.nextTerm?.open === true,
      priceCents: centsOr(src.nextTerm?.priceCents, null, { allowNull: true }),
      holdCents: centsOr(src.nextTerm?.holdCents, null, { allowNull: true }),
    },
  }
}

// Strict, for a save from Settings: says what is wrong rather than quietly
// keeping the old value. Returns { ok, juniors, errors, warnings }.
export function validateJuniors(input = {}, current = JJ_DEFAULTS) {
  const errors = [], warnings = []
  const merged = { ...normaliseJuniors(current), ...(input && typeof input === 'object' ? input : {}) }
  if (!jjClean(merged.term, 40)) errors.push('Give the term a name, like Term 1 2027.')
  if (!ISO.test(merged.termStart || '')) errors.push('Choose the date of the first class.')
  const weeks = Number(merged.weeks)
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 20) errors.push('Weeks must be a whole number from 1 to 20.')
  const price = Number(merged.priceCents)
  if (!Number.isInteger(price) || price < 100 || price > 200000) errors.push('The term price must be between A$1 and A$2,000.')
  if (merged.siblingPriceCents != null && merged.siblingPriceCents !== '') {
    const s = Number(merged.siblingPriceCents)
    if (!Number.isInteger(s) || s < 100 || s > 200000) errors.push('The sibling price must be between A$1 and A$2,000, or left blank.')
  }
  if (!Array.isArray(merged.classes) || !merged.classes.length) errors.push('Add the class.')
  else merged.classes.forEach((c, i) => {
    const n = merged.classes.length > 1 ? ` (class ${i + 1})` : ''
    if (!JJ_DAYS.includes(c?.day)) errors.push(`Choose the day${n}.`)
    if (!jjTime24(c?.time)) errors.push(`The start time must look like 9:15am${n}.`)
    if (c?.endTime && !jjTime24(c.endTime)) errors.push(`The finish time must look like 10:00am${n}.`)
    if (c?.endTime && jjTime24(c?.time) && jjTime24(c.endTime) && jjTime24(c.endTime) <= jjTime24(c.time)) errors.push(`The class must finish after it starts${n}.`)
    const cap = Number(c?.capacity)
    if (!Number.isInteger(cap) || cap < 0 || cap > 60) errors.push(`Places must be a whole number from 0 to 60${n}.`)
  })
  const nt = merged.nextTerm && typeof merged.nextTerm === 'object' ? merged.nextTerm : {}
  for (const [k, label] of [['priceCents', 'next term\'s price'], ['holdCents', 'hold']]) {
    if (nt[k] == null || nt[k] === '') continue
    const v = Number(nt[k])
    if (!Number.isInteger(v) || v < 100 || v > 200000) errors.push(`The ${label} must be between A$1 and A$2,000, or left blank.`)
  }
  if (nt.holdCents != null && nt.holdCents !== '') {
    const full = nt.priceCents != null && nt.priceCents !== '' ? Number(nt.priceCents) : Number(merged.priceCents)
    if (Number(nt.holdCents) >= full) errors.push('The hold must be less than next term\'s price.')
  }
  if (merged.tables && typeof merged.tables === 'object') {
    for (const [t, id] of Object.entries(merged.tables)) if (!TABLE.test(String(id || '').trim())) errors.push(`The Airtable table for ${jjClean(t, 40) || 'a term'} should look like tbl followed by 14 letters and numbers.`)
  }
  const out = normaliseJuniors(merged)
  if (!errors.length && !out.tables[out.term]) errors.push(`Add the Airtable table for ${out.term} first (under Airtable tables).`)
  if (!errors.length && out.classes[0] && dayOf(out.termStart) !== out.classes[0].day) warnings.push(`${longDate(out.termStart)} is a ${dayOf(out.termStart)}. Classes run from the first ${out.classes[0].day} on or after it.`)
  return errors.length ? { ok: false, errors } : { ok: true, juniors: out, warnings }
}

// The class dates for the term: weekly from the first class day on or after
// termStart, less any skipped dates.
export function juniorsDates(jj, cls = jj.classes?.[0]) {
  const idx = JJ_DAYS.indexOf(cls?.day || 'Saturday')
  if (!ISO.test(jj.termStart || '') || idx < 0) return []
  const start = new Date(`${jj.termStart}T00:00:00Z`)
  const first = new Date(start.getTime() + ((idx - ((start.getUTCDay() + 6) % 7) + 7) % 7) * 86400000)
  const off = new Set((jj.skipDates || []).map((x) => x.date))
  return Array.from({ length: jj.weeks }, (_, k) => new Date(first.getTime() + k * 7 * 86400000).toISOString().slice(0, 10)).filter((d) => !off.has(d))
}

export function classLabelOf(jj, cls = jj.classes?.[0]) {
  if (jj.classLabel) return jj.classLabel
  if (!cls) return ''
  return `${cls.day} ${cls.time}${cls.endTime ? ` to ${cls.endTime}` : ''}`
}
export const timeLineOf = (cls) => (cls ? `${cls.time}${cls.endTime ? ` to ${cls.endTime}` : ''}` : '')
export function datesLabelOf(jj) {
  if (jj.datesLabel) return jj.datesLabel
  const d = juniorsDates(jj)
  return d.length ? `${longDate(d[0])} to ${longDate(d.at(-1))}` : ''
}
// "Term 4 2026" -> "Term 4".
export const termShort = (term) => String(term || '').replace(/\s+\d{4}$/, '')
export const dollars = (cents) => `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
export const capacityOf = (jj) => (jj.classes || []).reduce((t, c) => t + (c.capacity || 0), 0)

// What the public page shows. Nothing private, nothing from Airtable.
export function juniorsPublic(jjInput) {
  const jj = normaliseJuniors(jjInput)
  const cls = jj.classes[0]
  const dates = juniorsDates(jj)
  const datesLabel = datesLabelOf(jj)
  return {
    term: jj.term,
    termShort: termShort(jj.term),
    datesLabel,
    termDatesLine: datesLabel ? `${termShort(jj.term)}: ${datesLabel}` : jj.term,
    firstDate: dates[0] || '', lastDate: dates.at(-1) || '',
    weeks: dates.length,
    classLabel: classLabelOf(jj),
    day: cls?.day || '',
    timeLabel: timeLineOf(cls),
    classes: jj.classes.map((c) => ({ id: c.id, label: classLabelOf({ ...jj, classLabel: '' }, c), day: c.day, time: c.time, endTime: c.endTime, location: c.location })),
    location: jj.location,
    priceCents: jj.priceCents,
    priceLabel: dollars(jj.priceCents),
    feeLine: `${dollars(jj.priceCents)} for ${dates.length} week${dates.length === 1 ? '' : 's'}`,
    siblingPriceCents: jj.siblingPriceCents,
    registrationOpen: jj.registrationOpen,
    ageLabel: jj.ageLabel,
    nextTerm: { name: jj.nextTerm.name, open: jj.nextTerm.open },
  }
}

// Next term's price and hold: { name, fullCents, holdCents (0 = no hold), table }.
export function nextTermOf(jjInput) {
  const jj = normaliseJuniors(jjInput)
  const nt = jj.nextTerm
  const fullCents = nt.priceCents ?? jj.priceCents
  return { name: nt.name, termStart: nt.termStart, open: nt.open, fullCents, holdCents: nt.holdCents && nt.holdCents < fullCents ? nt.holdCents : 0, table: jj.tables[nt.name] || '' }
}
