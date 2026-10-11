// Joners Juniors money for the portal (Lee, 11 Oct 2026): a programme filter
// on Money and a card on the dashboard. Read only: nothing here changes
// Airtable or Stripe.
//
// The contract (term cohort):
// - "Collected" is money received in Stripe (the Sydney account only)
//   against a term's Juniors enrolments, net of refunds, whenever it was paid.
// - A Paid status is not an amount, and a fee is not a payment. A row only
//   has a paid amount when a real Stripe payment is matched to it: by its
//   Checkout Session or PaymentIntent ID first, then by the parent's email on
//   the same payment link (or, for the online sign-up, the "Joners Juniors"
//   tag). Anything else is "Paid, amount not recorded" or unmatched.
// - A place paid with last term's credit is not new money: shown apart.
// - One payment covering two children is split by fee, never counted twice.
// - Cash and bank transfers are not recorded for Juniors anywhere today (the
//   payment ledger has no Juniors rows), so they are not in the total.
// - Totals never include a failed read: a failed source is an error or a
//   stale last-known result, labelled as such, never a zero.
// - All amounts are whole cents (AUD). Another currency is flagged, not added.
import { stripeFetch } from './_holiday-store.js'
import { kvGetJson, kvSetJson } from './_jfp-store.js'
import { readTable } from './_jfp-airtable.js'

export const JUNIORS_TABLES = (process.env.JFP_JUNIORS_TABLES || 'tblMLhYQ126P5uKLB,tblVzW8E9qumQEtXx').split(',').map((x) => x.trim()).filter(Boolean)
export const SYDNEY_ACCOUNT = 'acct_1QyPm0EwxK4ojTS1'
const FIELDS = ['Player Full Name', 'Parent Name', 'Parent Email', 'Parent Email 2', 'Term', 'Location', 'Session Day', 'Session Time', 'Fee', 'Payment Status', 'Paid Via', 'Paid At', 'Stripe Checkout Session ID', 'Stripe PaymentIntent ID', 'Stripe Payment Link']
const CACHE = 'jfp:juniors-money'
const FRESH_SECONDS = 600
const MAX_PAGES = 30

const lower = (v) => String(v ?? '').trim().toLowerCase()
const cents = (aud) => (typeof aud === 'number' && Number.isFinite(aud) ? Math.round(aud * 100) : null)
const termOrder = (t) => { const m = /term\s*(\d)\s+(\d{4})/i.exec(t || ''); return m ? Number(m[2]) * 10 + Number(m[1]) : 0 }

// ---------- reading ----------

// Every Juniors row in every term table. Any failed table or page throws:
// a missing table is never read as "no revenue".
export async function readJuniorsRows(tables = JUNIORS_TABLES, read = readTable) {
  const rows = []
  for (const table of tables) {
    // readTable pages until Airtable says there is no more, or throws.
    for (const { id, fields: f } of await read(table, FIELDS)) {
      const s = (k) => (f[k] == null ? '' : String(Array.isArray(f[k]) ? f[k].join(', ') : f[k]).trim())
      rows.push({
        id, table, term: s('Term'), player: s('Player Full Name'), parent: s('Parent Name'),
        emails: [lower(f['Parent Email']), lower(f['Parent Email 2'])].filter(Boolean),
        location: s('Location'), session: [s('Session Day'), s('Session Time')].filter(Boolean).join(' '),
        feeCents: cents(f.Fee), status: s('Payment Status'), paidVia: s('Paid Via'), paidAt: s('Paid At'),
        sessionId: s('Stripe Checkout Session ID'), intentId: s('Stripe PaymentIntent ID'), linkUrl: s('Stripe Payment Link'),
      })
    }
  }
  return rows
}

function sessionOf(s, how, extra = {}) {
  const pi = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent : null
  const charge = pi?.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  return {
    id: s.id, intentId: pi?.id || (typeof s.payment_intent === 'string' ? s.payment_intent : ''),
    paid: s.status === 'complete' && s.payment_status === 'paid',
    email: lower(s.customer_details?.email || s.customer_email),
    amountCents: s.amount_total || 0, refundedCents: charge?.amount_refunded || 0, currency: lower(s.currency || 'aud'),
    at: new Date((s.created || 0) * 1000).toISOString(),
    link: typeof s.payment_link === 'string' ? s.payment_link : s.payment_link?.id || '',
    tagged: lower(s.metadata?.programme || s.metadata?.program) === 'joners juniors',
    found: [how], ...extra,
  }
}

const EXPAND = 'expand[]=payment_intent.latest_charge'
const EXPAND_LIST = 'expand[]=data.payment_intent.latest_charge'

async function listAll(path, fetcher) {
  const out = []
  let after = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const d = await fetcher(`${path}${path.includes('?') ? '&' : '?'}limit=100${after ? `&starting_after=${after}` : ''}`)
    out.push(...(d.data || []))
    if (!d.has_more || !(d.data || []).length) return out
    after = d.data.at(-1).id
  }
  throw new Error(`Stripe list did not finish within ${MAX_PAGES} pages: ${path.split('?')[0]}`)
}

// Every Stripe payment that can belong to Juniors, from three places:
// IDs on the rows, the "Joners Juniors" tag on online sign-ups, and the
// payment links on the rows (plus any other link whose product says Juniors).
export async function readJuniorsStripe(rows, fetcher = stripeFetch) {
  const account = await fetcher('/account')
  if (account?.id !== SYDNEY_ACCOUNT) throw new Error('The Stripe key is not the Sydney JFP account, so Juniors payments were not read.')
  const byId = new Map()
  const add = (x) => { const old = byId.get(x.id); if (old) old.found = [...new Set([...old.found, ...x.found])]; else byId.set(x.id, x) }
  // 1. Sessions named on the rows.
  for (const id of [...new Set(rows.map((r) => r.sessionId).filter((v) => /^cs_/.test(v)))]) add(sessionOf(await fetcher(`/checkout/sessions/${encodeURIComponent(id)}?${EXPAND}`), 'row id'))
  for (const pi of [...new Set(rows.filter((r) => !r.sessionId && /^pi_/.test(r.intentId)).map((r) => r.intentId))]) {
    for (const s of await listAll(`/checkout/sessions?payment_intent=${encodeURIComponent(pi)}&${EXPAND_LIST}`, fetcher)) add(sessionOf(s, 'row id'))
  }
  // 2. Online sign-ups tagged Joners Juniors.
  let next = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const d = await fetcher(`/payment_intents/search?query=${encodeURIComponent("metadata['programme']:'Joners Juniors'")}&limit=100${next ? `&page=${encodeURIComponent(next)}` : ''}`)
    for (const pi of d.data || []) {
      if (pi.status !== 'succeeded' || [...byId.values()].some((s) => s.intentId === pi.id)) continue
      for (const s of await listAll(`/checkout/sessions?payment_intent=${encodeURIComponent(pi.id)}&${EXPAND_LIST}`, fetcher)) add(sessionOf(s, 'juniors tag'))
    }
    if (!d.has_more || !d.next_page) { next = ''; break }
    next = d.next_page
    if (page === MAX_PAGES - 1) throw new Error('Stripe search did not finish.')
  }
  // 3. Payment links: the ones on the rows, and any whose product says Juniors.
  const links = await listAll('/payment_links', fetcher)
  const rowUrls = new Set(rows.map((r) => r.linkUrl).filter(Boolean))
  const linkInfo = {}
  for (const l of links) {
    const onRow = rowUrls.has(l.url)
    let product = ''
    if (!onRow) {
      const items = await fetcher(`/payment_links/${encodeURIComponent(l.id)}/line_items?limit=5`)
      product = (items.data || []).map((x) => x.description || '').join(', ')
      if (!/junior/i.test(product)) continue
    }
    linkInfo[l.id] = { url: l.url, onRow, product }
    for (const s of await listAll(`/checkout/sessions?payment_link=${encodeURIComponent(l.id)}&status=complete&${EXPAND_LIST}`, fetcher)) add(sessionOf(s, 'payment link'))
  }
  const missingLinks = [...rowUrls].filter((u) => !Object.values(linkInfo).some((l) => l.url === u))
  return { sessions: [...byId.values()], links: linkInfo, missingLinks }
}

// ---------- the sums (pure, tested) ----------

// Split an amount over rows, each up to what it still needs, in row order.
function split(amount, rows, room) {
  const parts = new Map()
  let left = amount
  for (const r of rows) {
    if (left <= 0) break
    const take = room(r) == null ? left : Math.min(left, Math.max(0, room(r)))
    if (take > 0) { parts.set(r.id, take); left -= take }
  }
  return { parts, left }
}

export function juniorsMoney(rows, stripe, { now = new Date().toISOString(), jfpSessionIds = [] } = {}) {
  // One payment found twice (row ID, tag, link) is still one payment.
  const sessions = [...new Map((stripe?.sessions || []).filter((s) => s.paid).map((s) => [s.id, s])).values()]
  const linkOfUrl = Object.fromEntries(Object.entries(stripe?.links || {}).map(([id, l]) => [l.url, id]))
  const rowLink = (r) => (r.linkUrl ? linkOfUrl[r.linkUrl] || '' : '')
  const paid = new Map(rows.map((r) => [r.id, { gross: 0, refunded: 0, sessions: [] }]))
  const room = (r) => (r.feeCents == null ? null : r.feeCents - paid.get(r.id).gross)
  const unlinked = []
  const otherCurrency = []
  const allocate = (s, targets) => {
    const { parts, left } = split(s.amountCents, targets, room)
    // Refunds follow the money: each row gives back its share.
    let refundLeft = s.refundedCents
    const entries = [...parts.entries()]
    entries.forEach(([id, part], i) => {
      const share = i === entries.length - 1 ? refundLeft : Math.floor((s.refundedCents * part) / s.amountCents)
      refundLeft -= share
      const p = paid.get(id)
      p.gross += part; p.refunded += share; p.sessions.push({ id: s.id, cents: part, at: s.at })
    })
    return left
  }
  const used = new Set()
  // 1. By ID on the row (siblings may share one session: split by fee).
  for (const s of sessions) {
    if (s.currency !== 'aud') { otherCurrency.push({ id: s.id, currency: s.currency, cents: s.amountCents }); used.add(s.id); continue }
    const targets = rows.filter((r) => (r.sessionId && r.sessionId === s.id) || (r.intentId && r.intentId === s.intentId))
    if (!targets.length) continue
    used.add(s.id)
    const left = allocate(s, targets)
    if (left > 0) unlinked.push({ id: s.id, cents: left, at: s.at, term: targets[0].term, why: 'More than the fee on the rows it names' })
  }
  // 2. By the parent's email, on the same payment link (or the online tag).
  for (const s of sessions) {
    if (used.has(s.id)) continue
    used.add(s.id)
    // A link on the rows: only those rows. An online sign-up, or a Juniors
    // link no row carries (an older term's link): rows that have no link.
    const onRows = s.link && rows.some((r) => rowLink(r) === s.link)
    const pool = rows.filter((r) => (onRows ? rowLink(r) === s.link : !r.linkUrl))
    const fam = s.email ? pool.filter((r) => r.emails.includes(s.email)) : []
    const terms = [...new Set(fam.map((r) => r.term))]
    const linkTerm = s.link ? [...new Set(rows.filter((r) => rowLink(r) === s.link).map((r) => r.term))] : []
    if (!fam.length || terms.length > 1) {
      unlinked.push({ id: s.id, cents: s.amountCents - s.refundedCents, at: s.at, term: linkTerm.length === 1 ? linkTerm[0] : '', why: terms.length > 1 ? 'The email matches children in more than one term' : 'No Juniors row with this email' })
      continue
    }
    const open = fam.filter((r) => room(r) == null || room(r) > 0)
    const left = allocate(s, open.length ? open : fam)
    if (left > 0) unlinked.push({ id: s.id, cents: left, at: s.at, term: terms[0], why: 'More than the fees for this family' })
  }

  const out = rows.map((r) => {
    const p = paid.get(r.id)
    const net = p.gross - p.refunded
    const airtablePaid = /^paid$/i.test(r.status)
    let status
    if (/credit/i.test(r.paidVia)) status = 'credit'
    else if (/^n\/?a$/i.test(r.status)) status = 'na'
    else if (p.gross > 0 && net <= 0) status = 'refunded'
    else if (r.feeCents != null && net >= r.feeCents) status = airtablePaid ? 'paid' : 'stripe'
    else if (net > 0) status = 'part'
    else if (airtablePaid) status = 'unverified'
    else if (r.feeCents == null) status = 'nofee'
    else status = 'unpaid'
    // What is still owed, only where it can be known.
    const owingCents = ['unpaid', 'part'].includes(status) && r.feeCents != null ? Math.max(0, r.feeCents - net) : ['paid', 'stripe', 'credit', 'na'].includes(status) ? 0 : null
    return {
      rowId: r.id, term: r.term, player: r.player, parent: r.parent, location: r.location, session: r.session,
      feeCents: r.feeCents, paidCents: net, refundedCents: p.refunded, owingCents, status, airtableStatus: r.status || 'Not set',
      paidVia: r.paidVia || '', paidAt: p.sessions[0]?.at || r.paidAt || '', payments: p.sessions.map((x) => ({ ref: `…${x.id.slice(-6)}`, cents: x.cents, at: x.at })),
      match: p.sessions.length ? 'stripe' : '',
    }
  })

  const terms = [...new Set(rows.map((r) => r.term).filter(Boolean))].sort((a, b) => termOrder(b) - termOrder(a))
  const byTerm = Object.fromEntries(terms.map((term) => {
    const list = out.filter((r) => r.term === term)
    const extra = unlinked.filter((u) => u.term === term)
    const sum = (k, l = list) => l.reduce((t, r) => t + (r[k] || 0), 0)
    const unknownOwing = list.filter((r) => r.owingCents == null)
    return [term, {
      term, players: list.length,
      collectedCents: sum('paidCents') + extra.reduce((t, u) => t + u.cents, 0),
      refundedCents: sum('refundedCents'),
      linkedCents: sum('paidCents'), unlinkedCents: extra.reduce((t, u) => t + u.cents, 0), unlinkedCount: extra.length,
      owingCents: sum('owingCents'), owingComplete: unknownOwing.length === 0,
      creditPlaces: list.filter((r) => r.status === 'credit').length,
      creditValueCents: list.filter((r) => r.status === 'credit').reduce((t, r) => t + (r.feeCents || 0), 0),
      counts: list.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {}),
      unresolved: unknownOwing.length,
    }]
  }))
  return {
    at: now, terms, byTerm, players: out,
    unlinked: unlinked.map(({ id, ...u }) => ({ ref: `…${id.slice(-6)}`, ...u })),
    unassigned: unlinked.filter((u) => !u.term).length,
    otherCurrency,
    coverage: {
      tables: [...new Set(rows.map((r) => r.table))].length,
      rows: rows.length,
      stripePayments: sessions.length,
      byIdOrLink: sessions.filter((s) => used.has(s.id)).length,
      linksChecked: Object.keys(stripe?.links || {}).length,
      missingLinks: (stripe?.missingLinks || []).length,
      cashAndBank: 'not recorded for Juniors (no Juniors rows in the payment ledger)',
      // Juniors payments the JFP Money view also counts (should be 0).
      alsoInJfp: sessions.filter((s) => jfpSessionIds.includes(s.id)).length,
    },
  }
}

// ---------- cached, with last-known-good ----------

// { ...juniorsMoney, stale, error }. A failed refresh keeps the last good
// result, marked stale with its time; with no last good result it throws.
export async function juniorsMoneyData({ fresh = false } = {}, deps = {}) {
  const get = deps.kvGetJson || kvGetJson, set = deps.kvSetJson || kvSetJson
  const hit = await get(CACHE)
  if (!fresh && hit?.at && Date.now() - Date.parse(hit.at) < FRESH_SECONDS * 1000) return { ...hit, stale: false }
  try {
    const rows = await (deps.readRows || readJuniorsRows)()
    const stripe = await (deps.readStripe || readJuniorsStripe)(rows)
    const jfpSessionIds = deps.jfpSessionIds ? await deps.jfpSessionIds() : []
    const data = juniorsMoney(rows, stripe, { jfpSessionIds })
    await set(CACHE, data, 60 * 60 * 24 * 30)
    return { ...data, stale: false }
  } catch (error) {
    console.error('jfp juniors money failed', error.message)
    if (hit?.at) return { ...hit, stale: true, error: 'Could not refresh Juniors from Airtable or Stripe. These are the last good figures.' }
    throw new Error(`Juniors money could not be read: ${error.message}`)
  }
}
