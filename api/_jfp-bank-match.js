// Bank transfers to check (Lee, 12 Oct 2026): money in from the bank (the
// Xero feed a Mac job writes, or a bank statement CSV Lee uploads) matched
// to the players who probably sent it. Lee confirms each one with one tap;
// nothing here records anything. Pure functions, no network.
import crypto from 'node:crypto'

export const EXTERNAL_ID = /^(XERO|CSV)-[A-Za-z0-9-]{6,80}$/
export const BANK_LIMITS = { lines: 2000, cents: 5000000, description: 200, csvDays: 45, earlyDays: 14, sameDays: 7 }
export const csvId = (date, cents, description) => `CSV-${crypto.createHash('sha1').update(`${date}|${cents}|${description}`).digest('hex')}`

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

// Already in the ledger: by its own id, or as a bank transfer, cash or other
// payment of the same amount within a week from someone with the same name.
export function recordedIn(item, ledgerPays) {
  return ledgerPays.some((l) => {
    if (l.id === item.id) return true
    if (l.method === 'Stripe' || l.cents !== item.cents || !l.date || dayGap(l.date, item.date) > BANK_LIMITS.sameDays) return false
    return l.rows.some((r) => rowScore({ payer: item.payer, description: item.payer }, r).score >= 1)
  })
}

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

// The same transfer in Xero and in the CSV: keep the Xero line.
function dropTwins(items) {
  const xero = items.filter((x) => x.source === 'xero')
  return items.filter((x) => x.source !== 'csv' || !xero.some((y) => y.cents === x.cents && dayGap(y.date, x.date) <= 1 && (rowScore(y, { parent: x.payer, player: '' }).score >= 1 || nameTokens(y.payer).join(' ') === nameTokens(x.payer).join(' '))))
}

// Every bank line still to check, with up to three players it is probably for.
//   players: moneyData players (this term's rows only)
//   ledger:  this term's ledger rows (Airtable fields)
export function matchBank({ items, players, ledger = [], ignored = [], since = '' }) {
  const skip = new Set(ignored)
  const from = since ? addDays(since, -BANK_LIMITS.earlyDays) : ''
  const rowsById = new Map(players.map((p) => [p.rowId, p]))
  const pays = ledgerPayments(ledger, rowsById)
  // A family: rows that share an email or a parent name.
  const famKey = (p) => [p.email ? `e:${String(p.email).toLowerCase()}` : '', nameTokens(p.parent).length ? `n:${nameTokens(p.parent).join(' ')}` : ''].filter(Boolean)
  const famOf = new Map()
  for (const p of players) for (const k of famKey(p)) famOf.set(k, [...(famOf.get(k) || []), p])
  const family = (p) => [...new Map(famKey(p).flatMap((k) => famOf.get(k) || []).map((x) => [x.rowId, x])).values()]
  const counts = { checked: 0, high: 0, possible: 0, none: 0, recorded: 0, ignored: 0, notFamily: 0, early: 0 }
  const out = []
  for (const item of dropTwins(items)) {
    counts.checked += 1
    if (skip.has(item.id)) { counts.ignored += 1; continue }
    if (from && item.date < from) { counts.early += 1; continue }
    if (notFamily(item)) { counts.notFamily += 1; continue }
    if (recordedIn(item, pays)) { counts.recorded += 1; continue }
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
    cands.sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact) || Number(b.owingCents > 0) - Number(a.owingCents > 0) || a.player.localeCompare(b.player))
    const top = cands.slice(0, 3)
    const grade = top.length ? gradeOf(top[0].score, top[0].exact) : 'none'
    counts[grade] += 1
    out.push({ ...item, grade, candidates: top })
  }
  const rank = { high: 0, possible: 1, none: 2 }
  out.sort((a, b) => rank[a.grade] - rank[b.grade] || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  return { items: out, counts }
}
