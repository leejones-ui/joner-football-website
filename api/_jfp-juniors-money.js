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
// - Cash and bank transfers are recorded in the portal (Joners Juniors >
//   Players > Record payment) into the Juniors payment ledger in KV
//   (jj:ledger, one entry per payment, a voided one is kept and marked), never
//   the JFP Payment Ledger, so they count here and never in JFP income.
// - Stripe's fee on each payment comes from its balance transaction, the
//   same way as JFP (_jfp-stripe.js): never an estimate; a fee not known yet
//   is shown as pending.
// - Totals never include a failed read: a failed source is an error or a
//   stale last-known result, labelled as such, never a zero.
// - All amounts are whole cents (AUD). Another currency is flagged, not added.
import { stripeFetch } from './_holiday-store.js'
import { kvGetJson, kvSetJson, kvCommand } from './_jfp-store.js'
import { readTable, listVenueHistory } from './_jfp-airtable.js'
import { readSheetRange } from './_camp-automation.js'
import { feeFrom, fillFees } from './_jfp-stripe.js'
import { parseJJRecord } from './_jj-data.js'

export const JUNIORS_TABLES = (process.env.JFP_JUNIORS_TABLES || 'tblMLhYQ126P5uKLB,tblVzW8E9qumQEtXx').split(',').map((x) => x.trim()).filter(Boolean)
export const SYDNEY_ACCOUNT = 'acct_1QyPm0EwxK4ojTS1'
const FIELDS = ['Player Full Name', 'Date of Birth', 'Session Day', 'Session Time', 'Parent Name', 'Parent Email', 'Parent Email 2', 'Term', 'Location', 'Fee', 'Payment Status', 'Paid Via', 'Paid At', 'Stripe Checkout Session ID', 'Stripe PaymentIntent ID', 'Stripe Payment Link', 'Registration ID', 'Amount Paid', 'Notes', 'Internal Notes']
const CACHE = 'jfp:juniors-money'
const FRESH_SECONDS = 600
const MAX_PAGES = 30

const lower = (v) => String(v ?? '').trim().toLowerCase()
const nameKey = (v) => lower(v).normalize('NFKD').replace(/[^a-z]+/g, ' ').trim()
const cents = (aud) => (typeof aud === 'number' && Number.isFinite(aud) ? Math.round(aud * 100) : null)
const termOrder = (t) => { const m = /term\s*(\d)\s+(\d{4})/i.exec(t || ''); return m ? Number(m[2]) * 10 + Number(m[1]) : 0 }

// ---------- reading ----------

// Every Juniors row in every term table. Any failed table or page throws:
// a missing table is never read as "no revenue". tables: table ids, or
// { table, term } (config.juniors.tables), the term used when a row has none.
export async function readJuniorsRows(tables = JUNIORS_TABLES, read = readTable) {
  const rows = []
  const seen = new Set()
  for (const entry of tables) {
    const table = typeof entry === 'string' ? entry : entry.table
    if (!table || seen.has(table)) continue
    seen.add(table)
    // The term tables do not all have the same columns (Term 3 has Paid At,
    // Term 4 has the payment link): ask again without any column Airtable
    // says this table does not have. Any other failure throws.
    let fields = [...FIELDS], list
    for (;;) {
      try { list = await read(table, fields); break } catch (error) {
        const m = /Unknown field name: "([^"]+)"/.exec(error.message || '')
        if (!m || !fields.includes(m[1])) throw error
        fields = fields.filter((x) => x !== m[1])
      }
    }
    // readTable pages until Airtable says there is no more, or throws.
    // The same reading as the Juniors portal pages (_jj-data.js): ids kept
    // in the notes when the table has no column for them, removed children.
    for (const rec of list) {
      const r = parseJJRecord(rec, table, typeof entry === 'string' ? '' : entry.term || '')
      rows.push({
        id: r.id, table, term: r.term, player: r.player, parent: r.parent,
        emails: r.emails,
        location: r.location, session: [r.day, r.time].filter(Boolean).join(' '), day: r.day, time: r.time, dob: r.dobText,
        feeCents: r.feeCents, status: r.status, paidVia: r.paidVia, paidAt: r.paidAt,
        sessionId: r.sessionId, intentId: r.intentId, sessionIds: r.sessionIds, intentIds: r.intentIds, linkUrl: r.linkUrl,
        registrationId: r.registrationId, removed: r.removed,
      })
    }
  }
  return rows
}

// What Stripe kept, from the charge's balance transaction (as JFP).
const feeFields = (f) => (f ? { feeCents: f.fee, feeGstCents: f.gst, stripeNetCents: f.net, feeKnown: true } : { feeCents: null, feeGstCents: null, stripeNetCents: null, feeKnown: false })
function sessionOf(s, how, extra = {}) {
  const pi = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent : null
  const charge = pi?.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  return {
    // Nothing charged (a full discount): no fee.
    ...feeFields(!s.amount_total ? { fee: 0, gst: 0, net: 0 } : feeFrom(charge)), payMethod: charge?.payment_method_details?.type || '',
    id: s.id, intentId: pi?.id || (typeof s.payment_intent === 'string' ? s.payment_intent : ''),
    paid: s.status === 'complete' && s.payment_status === 'paid',
    email: lower(s.customer_details?.email || s.customer_email),
    amountCents: s.amount_total || 0, refundedCents: charge?.amount_refunded || 0, currency: lower(s.currency || 'aud'),
    at: new Date((s.created || 0) * 1000).toISOString(),
    link: typeof s.payment_link === 'string' ? s.payment_link : s.payment_link?.id || '',
    tagged: lower(s.metadata?.programme || s.metadata?.program) === 'joners juniors',
    player: String(s.metadata?.player || '').trim(), registrationId: String(s.metadata?.registrationId || '').trim(),
    found: [how], ...extra,
  }
}

// Every Stripe id a row names: its column and each tag (stage 2: a hold then
// the rest, a part payment then the family's online payment).
const sessionsOf = (r) => (r.sessionIds?.length ? r.sessionIds : r.sessionId ? [r.sessionId] : [])
const intentsOf = (r) => (r.intentIds?.length ? r.intentIds : r.intentId ? [r.intentId] : [])

// The balance transaction carries Stripe's fee (four levels: Stripe's most).
const EXPAND = 'expand[]=payment_intent.latest_charge.balance_transaction'
const EXPAND_LIST = 'expand[]=data.payment_intent.latest_charge.balance_transaction'

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
export async function readJuniorsStripe(rows, fetcher = stripeFetch, deps = {}) {
  const account = await fetcher('/account')
  if (account?.id !== SYDNEY_ACCOUNT) throw new Error('The Stripe key is not the Sydney JFP account, so Juniors payments were not read.')
  const byId = new Map()
  const add = (x) => { const old = byId.get(x.id); if (old) old.found = [...new Set([...old.found, ...x.found])]; else byId.set(x.id, x) }
  // 1. Sessions named on the rows.
  for (const id of [...new Set(rows.flatMap(sessionsOf).filter((v) => /^cs_/.test(v)))]) add(sessionOf(await fetcher(`/checkout/sessions/${encodeURIComponent(id)}?${EXPAND}`), 'row id'))
  for (const pi of [...new Set(rows.filter((r) => !sessionsOf(r).length).flatMap(intentsOf).filter((v) => /^pi_/.test(v)))]) {
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
  const sessions = [...byId.values()]
  // A fee Stripe had not worked out in the list: asked for on its own, a few
  // per read (the JFP fee cache). A fee still not known shows as pending.
  const fill = deps.fillFees ?? (fetcher === stripeFetch ? fillFees : null)
  if (fill) { try { await fill(sessions) } catch (error) { console.error('jfp juniors stripe fees failed', error.message) } }
  return { sessions, links: linkInfo, missingLinks }
}

// The website's Joners Juniors sign-up sheet (a tab in the camps sheet).
// Read only, and only what helps match a payment to a child: no mobiles,
// dates of birth or medical notes. It never adds money of its own.
export async function readJuniorsSheet(read = readSheetRange, env = process.env) {
  const sheetId = env.JUNIORS_SHEET_ID || env.CAMP_REGISTRATION_SHEET_ID || ''
  const tab = env.JUNIORS_SHEET_TAB || 'Joners Juniors'
  if (!sheetId) return { read: false, why: 'No sheet id is configured', rows: [] }
  const values = await read(sheetId, tab, 'A:O')
  const [head = [], ...body] = values
  const col = (name) => head.findIndex((h) => lower(h).startsWith(lower(name)))
  const at = { paidAt: col('Paid At'), reg: col('Registration ID'), status: col('Payment Status'), player: col('Player Full Name'), email: col('Parent Email'), amount: col('Amount Paid'), cs: col('Stripe Checkout Session'), pi: col('Stripe PaymentIntent') }
  if (at.reg < 0 || at.player < 0) throw new Error(`The "${tab}" tab does not have the expected columns`)
  const v = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '')
  return { read: true, tab, rows: body.filter((r) => v(r, at.reg) || v(r, at.player)).map((r) => ({
    registrationId: v(r, at.reg), status: lower(v(r, at.status)), player: v(r, at.player), email: lower(v(r, at.email)),
    amount: v(r, at.amount), sessionId: v(r, at.cs).match(/cs_[A-Za-z0-9_]+/)?.[0] || '', intentId: v(r, at.pi).match(/pi_[A-Za-z0-9_]+/)?.[0] || '', paidAt: v(r, at.paidAt),
  })) }
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

// A payment Lee has said is for a child, when nothing else can tell (Benji,
// 12 Oct 2026: his Term 3 payment, carried to Term 4 as credit). Matched by
// the end of the Stripe id, the amount and the day, so it can only ever be
// that one payment. term: which term the money counts in.
export const JUNIORS_LINKS_KEY = 'jfp:juniors-links'
const handLink = (links, s) => links.find((l) => l.suffix && s.id.endsWith(l.suffix) && Number(l.cents) === s.amountCents && String(s.at).slice(0, 10) === l.day)

// ledger: the Juniors payment ledger (cash, bank transfer, other), from
// readJJLedger. A voided entry is kept for the record and never counted.
export function juniorsMoney(rows, stripe, { now = new Date().toISOString(), jfpSessionIds = [], sheet = null, links = [], ledger = [] } = {}) {
  // One payment found twice (row ID, tag, link) is still one payment.
  const sessions = [...new Map((stripe?.sessions || []).filter((s) => s.paid).map((s) => [s.id, s])).values()]
  const linkOfUrl = Object.fromEntries(Object.entries(stripe?.links || {}).map(([id, l]) => [l.url, id]))
  const rowLink = (r) => (r.linkUrl ? linkOfUrl[r.linkUrl] || '' : '')
  const paid = new Map(rows.map((r) => [r.id, { gross: 0, refunded: 0, sessions: [], fee: 0, feePending: 0, recorded: [] }]))
  const room = (r) => (r.feeCents == null ? null : r.feeCents - paid.get(r.id).gross)
  const unlinked = []
  const otherCurrency = []
  // Where each payment's money landed, by term: { net, refunded, rows: Set }.
  const landed = new Map()
  const land = (s, term, net, refunded, rowName = '') => {
    if (!landed.has(s.id)) landed.set(s.id, new Map())
    const m = landed.get(s.id)
    const x = m.get(term) || { net: 0, refunded: 0, who: new Set() }
    x.net += net; x.refunded += refunded
    if (rowName) x.who.add(rowName)
    m.set(term, x)
  }
  const feeShare = (s, part) => (s.feeKnown && s.amountCents ? Math.round(((s.feeCents || 0) * part) / s.amountCents) : 0)
  const allocate = (s, targets) => {
    const { parts, left } = split(s.amountCents, targets, room)
    // Refunds follow the money: each row gives back its share.
    let refundLeft = s.refundedCents
    const entries = [...parts.entries()]
    entries.forEach(([id, part], i) => {
      const share = i === entries.length - 1 ? refundLeft : Math.floor((s.refundedCents * part) / s.amountCents)
      refundLeft -= share
      const p = paid.get(id)
      const r = rows.find((x) => x.id === id)
      p.gross += part; p.refunded += share; p.sessions.push({ id: s.id, cents: part, at: s.at })
      p.fee += feeShare(s, part); if (!s.feeKnown) p.feePending += 1
      land(s, r.term, part - share, share, r.player)
    })
    return left
  }
  const unlink = (s, u) => { unlinked.push(u); land(s, u.term || '', u.cents, u.refunded || 0, u.forPlayer || '') }
  // Who a payment was for, from Stripe's own note or the sign-up sheet.
  const sheetRows = sheet?.rows || []
  const whoFor = (s) => {
    const hit = sheetRows.find((x) => (x.sessionId && x.sessionId === s.id) || (x.intentId && x.intentId === s.intentId) || (x.registrationId && x.registrationId === s.registrationId))
    return { player: s.player || hit?.player || '', email: s.email || hit?.email || '', viaSheet: Boolean(hit) }
  }
  const used = new Set()
  const byHand = []
  // 0. Linked by hand: counted in the term Lee chose, against that child.
  for (const s of sessions) {
    const l = handLink(links, s)
    if (!l) continue
    const r = rows.find((x) => x.id === l.rowId)
    used.add(s.id)
    if (r && r.term === l.term) { allocate(s, [r]); continue }
    byHand.push({ id: s.id, cents: s.amountCents - s.refundedCents, at: s.at, term: l.term, forPlayer: r?.player || l.player || '', rowTerm: r?.term || '', note: l.note || '' })
    land(s, l.term, s.amountCents - s.refundedCents, s.refundedCents, r?.player || l.player || '')
  }
  // 1. By ID on the row (siblings may share one session: split by fee). The
  // registration id counts too: the website sign-up writes it on the row.
  for (const s of sessions) {
    if (used.has(s.id)) continue
    if (s.currency !== 'aud') { otherCurrency.push({ id: s.id, currency: s.currency, cents: s.amountCents }); used.add(s.id); continue }
    const targets = rows.filter((r) => sessionsOf(r).includes(s.id) || (s.intentId && intentsOf(r).includes(s.intentId)) || (r.registrationId && s.registrationId && r.registrationId === s.registrationId))
    if (!targets.length) continue
    used.add(s.id)
    const left = allocate(s, targets)
    if (left > 0) unlink(s, { id: s.id, cents: left, at: s.at, term: targets[0].term, why: 'More than the fee on the rows it names' })
  }
  // 2. By the parent's email, on the same payment link (or the online tag).
  for (const s of sessions) {
    if (used.has(s.id)) continue
    used.add(s.id)
    // A link on the rows: only those rows. An online sign-up, or a Juniors
    // link no row carries (an older term's link): rows that have no link.
    const onRows = s.link && rows.some((r) => rowLink(r) === s.link)
    const pool = rows.filter((r) => (onRows ? rowLink(r) === s.link : !r.linkUrl))
    const who = whoFor(s)
    // The child's name (Stripe note or sign-up sheet) settles it when the
    // email alone does not, for example a parent who paid from another email.
    let byName = who.player ? pool.filter((r) => nameKey(r.player) === nameKey(who.player)) : []
    if (byName.length > 1 && who.email) byName = byName.filter((r) => r.emails.includes(who.email))
    const byEmail = s.email ? pool.filter((r) => r.emails.includes(s.email)) : []
    const fam = byName.length && new Set(byName.map((r) => r.term)).size === 1 ? byName : byEmail
    const terms = [...new Set(fam.map((r) => r.term))]
    const linkTerm = s.link ? [...new Set(rows.filter((r) => rowLink(r) === s.link).map((r) => r.term))] : []
    if (!fam.length || terms.length > 1) {
      unlink(s, { id: s.id, cents: s.amountCents - s.refundedCents, refunded: s.refundedCents, at: s.at, term: linkTerm.length === 1 ? linkTerm[0] : '', forPlayer: who.player, fromSheet: who.viaSheet, why: terms.length > 1 ? 'The email matches children in more than one term' : who.player ? 'No Juniors row with this child\'s name or email' : 'No Juniors row with this email' })
      continue
    }
    const open = fam.filter((r) => room(r) == null || room(r) > 0)
    const left = allocate(s, open.length ? open : fam)
    if (left > 0) unlink(s, { id: s.id, cents: left, at: s.at, term: terms[0], why: 'More than the fees for this family' })
  }
  // 3. Cash, bank transfers and other payments recorded in the portal.
  const recordedLines = []
  for (const e of ledger || []) {
    if (!e || e.void || !Array.isArray(e.shares)) continue
    const who = new Set()
    let term = e.term || ''
    for (const sh of e.shares) {
      const p = paid.get(sh.rowId)
      const r = rows.find((x) => x.id === sh.rowId)
      if (!p || !r) { unlinked.push({ id: e.id, cents: sh.cents, at: e.date, term: e.term || '', forPlayer: sh.name || '', why: 'Recorded in the portal for a child no longer in Airtable', recorded: true }); continue }
      p.gross += sh.cents
      p.recorded.push({ id: e.id, cents: sh.cents, method: e.method, date: e.date })
      who.add(r.player); term = r.term
    }
    recordedLines.push({ term, ref: e.id, at: e.date, kind: methodKind(e.method), method: e.method, who: [...who].join(', '), takenCents: e.cents, refundedCents: 0, feeCents: 0, feeGstCents: 0, keptCents: e.cents })
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
    // What is still owed, only where it can be known. A child who has left
    // owes nothing more here.
    let owingCents = ['unpaid', 'part'].includes(status) && r.feeCents != null ? Math.max(0, r.feeCents - net) : ['paid', 'stripe', 'credit', 'na'].includes(status) ? 0 : null
    if (r.removed) owingCents = 0
    const recordedCents = p.recorded.reduce((t, x) => t + x.cents, 0)
    return {
      rowId: r.id, term: r.term, player: r.player, parent: r.parent, location: r.location, session: r.session,
      feeCents: r.feeCents, paidCents: net, refundedCents: p.refunded, owingCents, status, airtableStatus: r.status || 'Not set',
      paidVia: r.paidVia || [...new Set(p.recorded.map((x) => x.method))].join(', '), paidAt: p.sessions[0]?.at || p.recorded[0]?.date || r.paidAt || '', payments: p.sessions.map((x) => ({ ref: `…${x.id.slice(-6)}`, cents: x.cents, at: x.at })),
      recorded: p.recorded, stripeCents: net - recordedCents, recordedCents, stripeFeeCents: p.fee, stripeFeePending: p.feePending,
      match: p.sessions.length ? 'stripe' : p.recorded.length ? 'recorded' : '',
      removed: r.removed ? { at: r.removed.at, reason: r.removed.reason } : null,
    }
  })

  // One line per Stripe payment per term it counts in, with its fee (spread
  // over the terms by the money each got), then the recorded ones.
  const lines = []
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  for (const [id, byT] of landed) {
    const s = sessionById.get(id)
    const parts = [...byT.entries()]
    const totalNet = parts.reduce((t, [, x]) => t + Math.max(0, x.net), 0)
    let feeLeft = s.feeKnown ? s.feeCents || 0 : null, gstLeft = s.feeKnown ? s.feeGstCents || 0 : null
    parts.forEach(([term, x], i) => {
      let fee = null, gst = null
      const last = i === parts.length - 1
      if (s.feeKnown) {
        fee = last ? feeLeft : totalNet ? Math.round(((s.feeCents || 0) * Math.max(0, x.net)) / totalNet) : 0; feeLeft -= fee
        gst = last ? gstLeft : totalNet ? Math.round(((s.feeGstCents || 0) * Math.max(0, x.net)) / totalNet) : 0; gstLeft -= gst
      }
      lines.push({ term, ref: `…${id.slice(-6)}`, at: s.at, kind: 'stripe', method: 'Stripe', payMethod: s.payMethod || '', who: [...x.who].join(', '), takenCents: x.net + x.refunded, refundedCents: x.refunded, feeCents: fee, feeGstCents: gst, keptCents: fee == null ? null : x.net - fee })
    })
  }
  lines.push(...recordedLines)
  lines.sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.ref).localeCompare(String(b.ref)))

  const terms = [...new Set(rows.map((r) => r.term).filter(Boolean))].sort((a, b) => termOrder(b) - termOrder(a))
  const byTerm = Object.fromEntries(terms.map((term) => {
    const all = out.filter((r) => r.term === term)
    const list = all.filter((r) => !r.removed)
    const extra = unlinked.filter((u) => u.term === term)
    const hand = byHand.filter((u) => u.term === term)
    const handCents = hand.reduce((t, u) => t + u.cents, 0)
    const sum = (k, l = all) => l.reduce((t, r) => t + (r[k] || 0), 0)
    const unknownOwing = list.filter((r) => r.owingCents == null)
    const termLines = lines.filter((l) => l.term === term)
    const stripeLines = termLines.filter((l) => l.kind === 'stripe')
    const collectedCents = sum('paidCents') + handCents + extra.reduce((t, u) => t + u.cents, 0)
    const feesCents = stripeLines.reduce((t, l) => t + (l.feeCents || 0), 0)
    const byKind = (k) => termLines.filter((l) => l.kind === k).reduce((t, l) => t + l.takenCents, 0)
    return [term, {
      term, players: list.length, removed: all.length - list.length,
      collectedCents,
      refundedCents: sum('refundedCents'),
      linkedCents: sum('paidCents') + handCents, byHandCents: handCents, unlinkedCents: extra.reduce((t, u) => t + u.cents, 0), unlinkedCount: extra.length,
      owingCents: sum('owingCents', list), owingComplete: unknownOwing.length === 0,
      creditPlaces: list.filter((r) => r.status === 'credit').length,
      creditValueCents: list.filter((r) => r.status === 'credit').reduce((t, r) => t + (r.feeCents || 0), 0),
      counts: list.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {}),
      unresolved: unknownOwing.length,
      // Money by how it came in, and what Stripe kept.
      stripeCents: collectedCents - byKind('cash') - byKind('bank') - byKind('other'), cashCents: byKind('cash'), bankCents: byKind('bank'), otherCents: byKind('other'),
      feesCents, feeGstCents: stripeLines.reduce((t, l) => t + (l.feeGstCents || 0), 0), feesPending: stripeLines.filter((l) => l.feeCents == null).length, keptCents: collectedCents - feesCents,
      lines: termLines,
    }]
  }))
  return {
    at: now, terms, byTerm, players: out,
    unlinked: unlinked.map(({ id, ...u }) => ({ ref: u.recorded ? id : `…${id.slice(-6)}`, ...u })),
    byHand: byHand.map(({ id, ...u }) => ({ ref: `…${id.slice(-6)}`, ...u })),
    unassigned: unlinked.filter((u) => !u.term).length,
    otherCurrency,
    coverage: {
      tables: [...new Set(rows.map((r) => r.table))].length,
      rows: rows.length,
      stripePayments: sessions.length,
      byIdOrLink: sessions.filter((s) => used.has(s.id)).length,
      linksChecked: Object.keys(stripe?.links || {}).length,
      missingLinks: (stripe?.missingLinks || []).length,
      cashAndBank: `${(ledger || []).filter((e) => e && !e.void).length} recorded in the portal (Joners Juniors payment ledger, never the JFP one)`,
      recordedPayments: (ledger || []).filter((e) => e && !e.void).length,
      sheet: sheet ? (sheet.read ? { tab: sheet.tab, rows: sheetRows.length, paid: sheetRows.filter((x) => x.status === 'paid').length, paidFoundInStripe: sheetRows.filter((x) => x.status === 'paid' && sessions.some((s) => s.id === x.sessionId || (x.intentId && s.intentId === x.intentId))).length } : { error: sheet.why || 'not read' }) : null,
      // Juniors payments the JFP Money view also counts (should be 0).
      alsoInJfp: sessions.filter((s) => jfpSessionIds.includes(s.id)).length,
      feesKnown: sessions.filter((s) => s.feeKnown).length,
    },
  }
}

export const METHODS = ['Cash', 'Bank transfer', 'Other']
export function methodKind(m) { return /cash/i.test(m || '') ? 'cash' : /bank/i.test(m || '') ? 'bank' : 'other' }

// Earlier Joners Juniors terms, from the copy of Lee's Money Register (JFP
// Venue History rows whose session is Joners Juniors). Totals only, no names.
export function juniorsHistory(history = [], liveTerms = []) {
  const by = new Map()
  for (const h of history || []) {
    if (!/junior/i.test(h.session || '') || !h.term || liveTerms.includes(h.term)) continue
    if (h.kind && !/payments/i.test(h.kind)) continue
    const x = by.get(h.term) || { term: h.term, year: Number(/(\d{4})/.exec(h.term)?.[1]) || null, takenCents: 0, stripeCents: 0, bankCents: 0, cashCents: 0, otherCents: 0, payments: 0, source: 'register' }
    const c = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : 0)
    x.takenCents += c(h.revenue); x.stripeCents += c(h.stripe); x.bankCents += c(h.bank); x.cashCents += c(h.cash); x.otherCents += c(h.other); x.payments += Number(h.payments) || 0
    by.set(h.term, x)
  }
  return [...by.values()].sort((a, b) => termOrder(b.term) - termOrder(a.term))
}

// ---------- the Juniors payment ledger (KV) ----------

export const JJ_LEDGER = 'jj:ledger'
export async function readJJLedger(cmd = kvCommand) {
  const flat = (await cmd(['HGETALL', JJ_LEDGER])) || []
  const out = []
  for (let i = 1; i < flat.length; i += 2) { try { const e = JSON.parse(flat[i]); if (e?.id) out.push(e) } catch {} }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)))
}
export async function saveJJLedger(entry, cmd = kvCommand) { await cmd(['HSET', JJ_LEDGER, entry.id, JSON.stringify(entry)]); return entry }
export async function dropJJLedger(id, cmd = kvCommand) { await cmd(['HDEL', JJ_LEDGER, id]) }

// ---------- the Juniors class on the timetable ----------

// This term's Juniors children by session, for the timetable, the coach's
// register and coach hours. Names and ages only. Read at most once a minute
// (any Juniors change in the portal clears it). A child who has left
// (removed in the portal) is not in the class.
export async function juniorsRoster(term, deps = {}) {
  const get = deps.kvGetJson || kvGetJson, set = deps.kvSetJson || kvSetJson
  const key = 'jfp:juniors-roster'
  let rows = await get(key)
  if (!Array.isArray(rows)) {
    rows = (await (deps.readRows || (() => readJuniorsRows(deps.tables || JUNIORS_TABLES)))()).map((r) => ({ id: r.id, term: r.term, player: r.player, dob: r.dob, day: r.day, time: r.time, location: r.location, status: r.status, paidVia: r.paidVia, removed: Boolean(r.removed) }))
    await set(key, rows, 60)
  }
  return rows.filter((r) => r.term === term && !r.removed)
}

// Every term, live (the Juniors tables) and earlier (the register), by year.
export function juniorsYears(data, earlier = []) {
  const all = [
    ...(data.terms || []).map((t) => ({ term: t, takenCents: data.byTerm[t].collectedCents, keptCents: data.byTerm[t].feesPending ? null : data.byTerm[t].keptCents, source: 'live' })),
    ...earlier.map((e) => ({ term: e.term, takenCents: e.takenCents, keptCents: null, source: 'register' })),
  ]
  const by = new Map()
  for (const t of all) {
    const y = Number(/(\d{4})/.exec(t.term)?.[1])
    if (!y) continue
    by.set(y, [...(by.get(y) || []), t])
  }
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([year, terms]) => ({
    year, terms: terms.sort((a, b) => termOrder(b.term) - termOrder(a.term)),
    takenCents: terms.reduce((x, t) => x + t.takenCents, 0),
    keptCents: terms.every((t) => t.keptCents != null) ? terms.reduce((x, t) => x + t.keptCents, 0) : null,
  }))
}

// ---------- cached, with last-known-good ----------

const STRIPE_CACHE = 'jfp:juniors-stripe'
// Set by every Juniors change in the portal (bustJJ): figures from before it are out of date.
const CLEARED = 'jj:money-cleared'

// { ...juniorsMoney, earlier, years, stale, error }. A failed refresh keeps
// the last good result, marked stale with its time; with no last good result
// it throws. deps.tables: config.juniors.tables as [{ table, term }].
export async function juniorsMoneyData({ fresh = false, quick = false } = {}, deps = {}) {
  const get = deps.kvGetJson || kvGetJson, set = deps.kvSetJson || kvSetJson
  const hit = await get(CACHE)
  const clearedRaw = await get(CLEARED)
  const cleared = Number.isFinite(Number(clearedRaw)) ? Number(clearedRaw) : 0
  const age = hit?.at ? Date.now() - Date.parse(hit.at) : Infinity
  // quick (first paint): the last good figures from the last 6 hours, marked
  // with their time. Never figures read before (or the same moment as) the
  // last change made in the portal.
  if (!fresh && hit?.at && Date.parse(hit.at) > cleared && age < (quick ? 6 * 3600 : FRESH_SECONDS) * 1000) return { ...hit, stale: false, quick: quick && age >= FRESH_SECONDS * 1000 }
  // Stamped with when the reading began, so a slow refresh that crossed a
  // change is never kept as newer than that change.
  const startedAt = new Date().toISOString()
  try {
    const rows = await (deps.readRows || (() => readJuniorsRows(deps.tables || JUNIORS_TABLES)))()
    // Stripe is the slow part: when only Airtable or the ledger changed, a
    // Stripe read from the last 10 minutes is used again.
    let stripe = null
    if (!fresh && !deps.readStripe) {
      const s = await get(STRIPE_CACHE)
      if (s?.at && Array.isArray(s.sessions) && Date.now() - Date.parse(s.at) < FRESH_SECONDS * 1000) stripe = s
    }
    if (!stripe) {
      stripe = await (deps.readStripe || readJuniorsStripe)(rows)
      if (!deps.readStripe) await set(STRIPE_CACHE, { ...stripe, at: new Date().toISOString() }, 60 * 60 * 24)
    }
    const jfpSessionIds = deps.jfpSessionIds ? await deps.jfpSessionIds() : []
    // The sheet only helps matching: if it cannot be read, say so and go on.
    let sheet
    try { sheet = await (deps.readSheet || readJuniorsSheet)() } catch (error) { console.error('jfp juniors sheet read failed', error.message); sheet = { read: false, why: 'The Joners Juniors sign-up sheet could not be read', rows: [] } }
    const rawLinks = await (deps.readLinks || (async () => (await get(JUNIORS_LINKS_KEY)) || []))()
    const links = Array.isArray(rawLinks) ? rawLinks : []
    // Cash and bank transfers: a failed read fails the refresh (never a zero).
    const ledger = await (deps.readLedger || readJJLedger)()
    const data = juniorsMoney(rows, stripe, { now: startedAt, jfpSessionIds, sheet, links, ledger })
    // Earlier terms (the register): extra, so a failure is said, not fatal.
    try { data.earlier = juniorsHistory(await (deps.readHistory || listVenueHistory)(), data.terms) } catch (error) { console.error('jfp juniors history failed', error.message); data.earlier = []; data.historyError = 'Earlier terms could not be read just now.' }
    data.years = juniorsYears(data, data.earlier)
    await set(CACHE, data, 60 * 60 * 24 * 30)
    return { ...data, stale: false }
  } catch (error) {
    console.error('jfp juniors money failed', error.message)
    if (hit?.at) return { ...hit, stale: true, error: 'Could not refresh Juniors from Airtable or Stripe. These are the last good figures.' }
    throw new Error(`Juniors money could not be read: ${error.message}`)
  }
}
