// Bank transfers to check (Lee, 12 Oct 2026): money in from the bank (the
// Xero feed a Mac job writes, or a bank statement CSV Lee uploads) matched
// to the players who probably sent it. Lee confirms each one with one tap;
// nothing here records anything. Pure functions, no network.
import crypto from 'node:crypto'
import { nearHoliday, suggestPeriod } from './_holiday-periods.js'

export const EXTERNAL_ID = /^(XERO|CSV)-[A-Za-z0-9-]{6,80}$/
// csvDays: the uploaded CSV is kept this long after the last upload;
// csvKeepDays: its lines this far back are kept (older holiday and last
// term transfers, Lee 13 Oct 2026).
export const BANK_LIMITS = { lines: 2000, cents: 5000000, description: 200, csvDays: 45, csvKeepDays: 130, earlyDays: 14, sameDays: 7 }
// n: the 2nd, 3rd... line in one file with the same date, amount and
// description (two real transfers that look alike). The first keeps the
// plain id, so an export that overlaps an earlier one gives the same ids.
export const csvId = (date, cents, description, n = 1) => `CSV-${crypto.createHash('sha1').update(`${date}|${cents}|${description}${n > 1 ? `|${n}` : ''}`).digest('hex')}`
export function csvIds(lines) {
  const seen = new Map()
  return lines.map((l) => {
    const k = `${l.date}|${l.cents}|${l.description}`
    seen.set(k, (seen.get(k) || 0) + 1)
    return csvId(l.date, l.cents, l.description, seen.get(k))
  })
}

// Words the bank puts in front of a payer's name, and titles.
const NOISE = [/\bfast transfer from\b/gi, /\btransfer from\b/gi, /\bnetbank\b/gi, /\bcommbank app\b/gi, /\bosko payment from\b/gi, /\bdirect credit\b/gi, /\bpayment from\b/gi]
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'mstr', 'master'])

// "Fast Transfer From MR J SMITH-JONES" -> ['j', 'smith', 'jones'];
// "JaneSmith" -> ['jane', 'smith'].
export function nameTokens(text) {
  let t = String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  for (const re of NOISE) t = t.replace(re, ' ')
  t = t.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return t.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !TITLES.has(w))
}

// The people on a row: "Jane & Tom Smith" -> Jane Smith, Tom Smith. A one
// word part borrows the surname of a full name in the same field.
export function peopleIn(field) {
  const parts = String(field || '').split(/\s*(?:\/|&|,|\band\b|\+)\s*/i).map(nameTokens).filter((x) => x.length)
  const surname = parts.find((p) => p.length > 1)?.at(-1) || ''
  return parts.map((p) => ({ first: p[0], last: p.length > 1 ? p.at(-1) : surname })).filter((p) => p.first)
}

// 1 = the same word, down to 0 for nothing alike.
export function similarity(a, b) {
  if (a === b) return 1
  if (!a || !b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length)
}

// How well what the bank shows names one person.
//   3 surname and first name (or initial), 2 surname only,
//   1 weak: a near spelling of the surname, or the first name only.
// The bank cuts payer names at about 16 letters, so a last word of five or
// more letters that starts the surname counts as the surname.
export function personScore(tokens, person) {
  if (!person.first) return 0
  const { first, last } = person
  const lastAt = tokens.findIndex((w, i) => last && (w === last || (i === tokens.length - 1 && w.length >= 5 && last.startsWith(w))))
  const others = tokens.filter((_, i) => i !== lastAt)
  const firstHit = others.some((w) => w === first || (w.length === 1 && w === first[0]))
  if (lastAt >= 0) return firstHit ? 3 : 2
  const near = last && last.length >= 5 && tokens.some((w) => w.length >= 5 && similarity(w, last) >= 0.86)
  if (near) return 1
  return first.length >= 3 && tokens.includes(first) ? 1 : 0
}

// A row's best score against the payer, and against the description or
// reference, which families often fill with the player's name.
export function rowScore(item, row) {
  const payer = nameTokens(item.payer || item.description)
  const said = nameTokens([item.description, item.reference].filter(Boolean).join(' '))
  let best = { score: 0, why: '' }
  const take = (score, why) => { if (score > best.score) best = { score, why } }
  for (const [field, who] of [[row.parent, 'the parent'], [row.player, 'the player']]) {
    for (const p of peopleIn(field)) {
      const s = personScore(payer, p)
      take(s, s === 3 ? `name matches ${who}` : s === 2 ? `surname matches ${who}` : `name is close to ${who}'s`)
    }
  }
  for (const p of peopleIn(row.player)) {
    if (!p.last || p.last === p.first) continue
    const i = said.indexOf(p.first)
    if (i >= 0 && said.includes(p.last)) take(3, 'the reference names the player')
  }
  return best
}

// Payments in that are clearly not a family paying for training.
const NOT_FAMILY = /\b(stripe|paypal|apple|google|ato|tax office|own account|joner football|jonerfootball|interest|transfer to)\b/i
export const notFamily = (item) => NOT_FAMILY.test(`${item.payer || ''} ${item.description || ''}`)

// Does the amount fit a row exactly?
export function amountFit(cents, row, familyOwing) {
  if (row.owingCents > 0 && cents === row.owingCents) return "amount = what's owing"
  if (familyOwing > row.owingCents && cents === familyOwing) return "amount = the family's total owing"
  if (row.feeCents > 0 && cents === row.feeCents) return 'amount = the fee'
  if (row.feeCents > 0 && cents === row.feeCents * 2) return 'amount = 2 x the fee'
  if (row.feeCents > 0 && cents === row.feeCents * 3) return 'amount = 3 x the fee'
  return ''
}

export function gradeOf(score, exact) {
  if (score >= 2 && exact) return 'high'
  if (score >= 2 || (score >= 1 && exact)) return 'possible'
  return 'none'
}
const dayGap = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const ledgerBase = (id) => String(id || '').replace(/#\d+$/, '')

// The ledger as payments: lines "<id>", "<id>#2"... added back together,
// with the rows they paid for (for the names).
export function ledgerPayments(ledger, rowsById) {
  const by = new Map()
  for (const l of ledger) {
    const id = ledgerBase(l['Payment ID'])
    if (!id) continue
    const x = by.get(id) || { id, method: l['Payment Method'] || '', date: String(l['Payment Date'] || '').slice(0, 10), cents: 0, rows: [] }
    x.cents += Math.round(Number(l['Amount Paid'] || 0) * 100)
    const ids = String(l['Source Record ID'] || '').split(',').map((s) => s.trim()).filter(Boolean)
    const found = ids.map((rid) => rowsById.get(rid)).filter(Boolean)
    x.rows.push(...(found.length ? found : [{ player: l['Player Name'] || '', parent: '' }]))
    by.set(id, x)
  }
  return [...by.values()]
}

// One bank line from either source, tidied. Anything that does not look
// like money in is dropped.
export function cleanItem(x, source) {
  const id = String(x?.id || '')
  const cents = Number(x?.cents)
  const date = String(x?.date || '').slice(0, 10)
  if (!EXTERNAL_ID.test(id) || !Number.isInteger(cents) || cents <= 0 || cents > BANK_LIMITS.cents || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const description = String(x.description || '').replace(/\s+/g, ' ').trim().slice(0, BANK_LIMITS.description)
  const payer = String(x.payer || '').replace(/\s+/g, ' ').trim().slice(0, 120) || description
  return { id, date, cents, payer, description, reference: String(x.reference || '').replace(/\s+/g, ' ').trim().slice(0, 120), source }
}

// The same transfer seen twice: in Xero and in the CSV, the same amount, at
// most a day apart, from the same payer.
const payerKey = (x) => nameTokens(x.payer || x.description).join(' ')
export function sameTransfer(a, b) {
  if (a.source === b.source || a.cents !== b.cents || !a.date || !b.date || dayGap(a.date, b.date) > 1) return false
  if (!payerKey(a) || !payerKey(b)) return false
  return payerKey(a) === payerKey(b) || rowScore(a, { parent: b.payer || b.description, player: '' }).score >= 1
}

// One to one: each left takes at most one right and each right is taken at
// most once, closest date first, a Xero line before a CSV one.
function pairUp(lefts, rights, fits) {
  const pairs = []
  for (const l of lefts) for (const r of rights) if (fits(l, r)) pairs.push([l, r, dayGap(l.date, r.date)])
  pairs.sort((a, b) => a[2] - b[2] || Number(a[1].source !== 'xero') - Number(b[1].source !== 'xero') || String(a[1].id).localeCompare(String(b[1].id)))
  const usedL = new Set(), out = new Map()
  for (const [l, r] of pairs) {
    if (usedL.has(l) || out.has(r)) continue
    usedL.add(l)
    out.set(r, l)
  }
  return out
}

// Bank lines recorded so far (KV jfp:bank-recorded): { id, source, cents,
// date, payer, distinct }. Two recorded lines that are the same transfer
// (both copies recorded) pair off; each one left can stand for one more copy.
// distinct: Lee said it was a different transfer, so it pairs with nothing.
export function unpairedRecorded(recorded) {
  const xero = recorded.filter((r) => r.source === 'xero' && !r.distinct)
  const csv = recorded.filter((r) => r.source === 'csv' && !r.distinct)
  const paired = pairUp(xero, csv, sameTransfer)
  const used = new Set([...paired.keys(), ...paired.values()])
  return recorded.filter((r) => !used.has(r))
}
// The recorded line this bank line is probably the other copy of, or null.
export function twinOf(item, recorded) {
  return unpairedRecorded(recorded.filter((r) => r.id !== item.id))
    .filter((r) => !r.distinct && sameTransfer(r, item))
    .sort((a, b) => dayGap(a.date, item.date) - dayGap(b.date, item.date))[0] || null
}

const isBankId = (id) => /^(XERO|CSV)-/.test(id)
const sourceOfId = (id) => (String(id).startsWith('XERO-') ? 'xero' : 'csv')
const namesRow = (x) => (r) => rowScore({ payer: x.payer, description: x.payer }, r).score >= 1

// Which lines are already recorded. Every ledger payment and recorded line
// stands for one bank line only:
//   1. its own id, in the ledger or the recorded store
//   2. the other copy (Xero or CSV) of a recorded line
//   3. a payment typed in by hand (bank transfer, cash, other), the same
//      amount within a week, from someone with the same name
// The same transfer in Xero and the CSV, neither recorded, shows once as the
// Xero line: its CSV copy is in twins.
export function settle(items, pays, recorded = []) {
  const done = new Set()
  const store = new Set(recorded.map((r) => r.id))
  const own = new Set(pays.map((p) => p.id))
  for (const x of items) if (own.has(x.id) || store.has(x.id)) done.add(x.id)
  // Recorded lines: the store, or the ledger alone (names from its rows).
  const lines = [...recorded]
  for (const p of pays) if (isBankId(p.id) && !store.has(p.id)) lines.push({ id: p.id, source: sourceOfId(p.id), cents: p.cents, date: p.date, payer: '', rows: p.rows })
  const fitsCopy = (r, x) => !r.distinct && (r.payer ? sameTransfer(r, x) : r.source !== x.source && r.cents === x.cents && Boolean(r.date) && dayGap(r.date, x.date) <= 1 && (r.rows || []).some(namesRow(x)))
  const open = items.filter((x) => !done.has(x.id))
  for (const x of pairUp(unpairedRecorded(lines), open, fitsCopy).keys()) done.add(x.id)
  const xero = items.filter((x) => x.source === 'xero' && !done.has(x.id))
  const csv = items.filter((x) => x.source === 'csv' && !done.has(x.id))
  const twins = new Set([...pairUp(xero, csv, sameTransfer).keys()].map((x) => x.id))
  // A XERO-/CSV- payment only ever stands for its own line or its copy, never this.
  const hand = pays.filter((p) => !isBankId(p.id) && p.method !== 'Stripe' && p.date && p.cents > 0)
  const left = items.filter((x) => !done.has(x.id) && !twins.has(x.id))
  const fitsHand = (p, x) => p.cents === x.cents && dayGap(p.date, x.date) <= BANK_LIMITS.sameDays && p.rows.some(namesRow(x))
  for (const x of pairUp(hand, left, fitsHand).keys()) done.add(x.id)
  return { recorded: done, twins }
}

// Amounts a place could cost: what anyone owes, a fee, two or three fees.
export function feeSizes(players) {
  const s = new Set()
  for (const p of players) for (const c of [p.owingCents, p.feeCents, p.feeCents * 2, p.feeCents * 3]) if (c > 0) s.add(c)
  return s
}
// A line nobody on the term could have sent, for no amount a place costs, is
// most likely not JFP money: it is never kept or shown.
export const looksJfp = (item, players, sizes = feeSizes(players)) => !notFamily(item) && (sizes.has(item.cents) || players.some((p) => rowScore(item, p).score >= 1))

// The best match for a bank line on last term's list (Lee, 13 Oct 2026):
// { rowId, player, parent, location, feeCents, paidCents, owingCents, status, score, reason } or null.
export function previousMatch(item, previous = []) {
  let best = null
  for (const r of previous) {
    const { score, why } = rowScore(item, r)
    if (!score) continue
    const exact = (r.owingCents > 0 && item.cents === r.owingCents) || (r.feeCents > 0 && item.cents === r.feeCents)
    if (!best || score > best.score || (score === best.score && exact && !best.exact)) best = { rowId: r.rowId, player: r.player, parent: r.parent || '', location: r.location || '', feeCents: r.feeCents, paidCents: r.paidCents, owingCents: r.owingCents, status: r.status || '', score, exact, reason: `${why}${exact ? (r.owingCents > 0 && item.cents === r.owingCents ? ", amount = what's owing" : ', amount = the fee') : ''}` }
  }
  return best
}

// Hints on a bank line (Lee, 13 Oct 2026):
//   holiday   inside a school holiday or up to 10 days before one, and the
//             amount is what a holiday session costs
//   lastTerm  before this term started, with nobody on this term's list by
//             that name (and not a holiday payment), or the best name match
//             is only on last term's list, or last term's row owes exactly
//             that amount and this term's does not. A Term 4 fee paid before
//             the term from a family on this term's list is not flagged.
export function hintsFor(item, { termStart = '', holidaySizes = null, grade = 'none', best = 0, previous = null } = {}) {
  const holiday = Boolean(holidaySizes?.has(item.cents) && nearHoliday(item.date))
  const early = Boolean(termStart && item.date < termStart && grade === 'none' && !holiday)
  const lastTerm = early || Boolean(previous && (previous.score > best || (previous.exact && grade !== 'high')))
  return { holiday, lastTerm }
}

// Every bank line still to check, with up to three players it is probably for.
//   players:  moneyData players (this term's rows only)
//   ledger:   this term's ledger rows (Airtable fields)
//   recorded: bank lines recorded so far (see unpairedRecorded)
// hidden: the lines Lee hid that look like JFP money, so he can show them again.
// before: lines from before this term's window (since less earlyDays), with
// the same matches, for older holiday and last term transfers.
//   previous:     last term's rows (listPreviousTerm), for its matches and hints
//   holidaySizes: every amount a holiday booking costs; termStart: this term's first day
export function matchBank({ items, players, ledger = [], ignored = [], since = '', recorded = [], previous = [], holidaySizes = null, termStart = '' }) {
  const skip = new Set(ignored)
  const from = since ? addDays(since, -BANK_LIMITS.earlyDays) : ''
  const rowsById = new Map(players.map((p) => [p.rowId, p]))
  const pays = ledgerPayments(ledger, rowsById)
  // A family: rows that share an email or a parent name.
  const famKey = (p) => [p.email ? `e:${String(p.email).toLowerCase()}` : '', nameTokens(p.parent).length ? `n:${nameTokens(p.parent).join(' ')}` : ''].filter(Boolean)
  const famOf = new Map()
  for (const p of players) for (const k of famKey(p)) famOf.set(k, [...(famOf.get(k) || []), p])
  const family = (p) => [...new Map(famKey(p).flatMap((k) => famOf.get(k) || []).map((x) => [x.rowId, x])).values()]
  const counts = { checked: 0, high: 0, possible: 0, none: 0, recorded: 0, ignored: 0, notFamily: 0, early: 0, twins: 0, notJfp: 0, before: 0 }
  const sizes = feeSizes(players)
  // Last term's families and holiday prices count as JFP money too.
  const kept = (item) => looksJfp(item, players, sizes) || Boolean(holidaySizes?.has(item.cents)) || previous.some((r) => rowScore(item, r).score >= 1)
  // Not a family or hidden: left out before anything is matched. Too early
  // (before this term's window) is counted, then sorted into before.
  const live = [], hidden = []
  const early = new Set()
  for (const item of items) {
    counts.checked += 1
    const isEarly = Boolean(from && item.date < from)
    if (isEarly) { counts.early += 1; early.add(item.id) }
    if (notFamily(item)) { if (!isEarly) counts.notFamily += 1 }
    else if (skip.has(item.id)) { if (!isEarly) counts.ignored += 1; if (kept(item)) hidden.push(item) }
    else live.push(item)
  }
  const { recorded: done, twins } = settle(live, pays, recorded)
  const out = [], before = []
  for (const item of live) {
    const isEarly = early.has(item.id)
    if (twins.has(item.id)) { if (!isEarly) counts.twins += 1; continue }
    if (done.has(item.id)) { if (!isEarly) counts.recorded += 1; continue }
    const cands = []
    for (const p of players) {
      const { score, why } = rowScore(item, p)
      if (!score) continue
      const fam = family(p)
      const famOwing = fam.reduce((t, x) => t + (x.owingCents || 0), 0)
      const fit = amountFit(item.cents, p, famOwing)
      cands.push({
        rowId: p.rowId, player: p.player, parent: p.parent || '', locationId: p.locationId || '', group: p.group || '', status: p.status,
        owingCents: p.owingCents || 0, feeCents: p.feeCents || 0, score, exact: Boolean(fit),
        reason: `${why}, ${fit || (p.owingCents > 0 ? "amount doesn't match what's owing" : 'nothing owing')}`,
        familyRowIds: fam.map((x) => x.rowId), familyOwingCents: famOwing,
      })
    }
    const prev = previous.length ? previousMatch(item, previous) : null
    // Nobody who could have sent it, and not an amount a place or a holiday
    // session costs: not shown, only counted.
    if (!cands.length && !sizes.has(item.cents) && !prev && !holidaySizes?.has(item.cents)) { if (!isEarly) counts.notJfp += 1; continue }
    cands.sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact) || Number(b.owingCents > 0) - Number(a.owingCents > 0) || a.player.localeCompare(b.player))
    const top = cands.slice(0, 3)
    const grade = top.length ? gradeOf(top[0].score, top[0].exact) : 'none'
    const hints = hintsFor(item, { termStart, holidaySizes, grade, best: top[0]?.score || 0, previous: prev })
    const line = { ...item, grade, candidates: top, previous: prev, hints, holidayPeriod: suggestPeriod(item.date) }
    if (isEarly) { counts.before += 1; before.push({ ...line, early: true }); continue }
    counts[grade] += 1
    out.push(line)
  }
  const rank = { high: 0, possible: 1, none: 2 }
  out.sort((a, b) => rank[a.grade] - rank[b.grade] || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  before.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  hidden.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  return { items: out, counts, hidden: hidden.map(({ id, date, cents, payer, source }) => ({ id, date, cents, payer, source })), before }
}
