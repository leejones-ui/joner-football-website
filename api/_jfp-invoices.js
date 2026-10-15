// Custom invoices (Lee, 14 Oct 2026): a proper invoice for a parent who asks
// for one. Staff make it in Money > Invoices: the family and player(s), line
// items, a due date and notes. INV-<n>, its own page (/jfp-invoice/?i=<token>,
// an unguessable token, no sign-in, nothing about any other family), a print
// page for the PDF, an email (preview, then Send), and two ways to pay: card
// (a Stripe Checkout tied to the invoice and the player) or bank transfer
// (the business bank details from Settings, only when staff saved them, with
// the reference "INV-<n> <player>").
//
// Two kinds of invoice, by program:
//   JFP or Pro sessions: the invoice is for a place, so its payment request
//     names the players' Term 4 rows and paying it records on those rows and
//     the ledger exactly as any JFP link does (Pro rows stay Pro money).
//   Extra sessions or Other: a player charge (_jfp-charges.js, kind
//     'invoice'), never a term fee.
// A bank transfer with the invoice number in its reference is matched on
// Money > JFP > Bank transfers to check and recorded against the invoice.
//
// Coaching income is GST-registered and taxable in Xero (2100 All Coaching
// Income and 220 In-Person Coaching are GST on Income), and prices include
// GST, so an invoice says "Includes GST of A$X" (one eleventh).
import crypto from 'node:crypto'
import { kvCommand, kvPipeline, kvGetJson, kvSetJson, clean, formatAud, savePayreq, getPayreq, normName, audit, sydneyToday, validEmail, closeCheckout, dateLabel, CHECKOUT_EXPIRES_MINUTES } from './_jfp-store.js'
import { programmeLabel } from './_jfp-prices.js'
import { playerMeta } from './_jfp-quick.js'
import { bankOffered } from './_jfp-invoice-pdf.js'

export const INVOICE_PROGRAMMES = ['jfp', 'pro', 'extra', 'other']
export const ROW_PROGRAMMES = new Set(['jfp', 'pro'])
export const INVOICE_LIMITS = { lines: 30, description: 200, qty: 100, unitMax: 2000000, totalMax: 2000000, notes: 1000, players: 6 }
export const INVOICE_STATUS = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', part: 'Part paid', paid: 'Paid', void: 'Void' }
export const INVOICE_ID = /^INV-\d{1,9}$/
export const TOKEN = /^[A-Za-z0-9_-]{24,64}$/
const LONG = 60 * 60 * 24 * 800
const key = (id) => `jfp:invoice:${id}`
const INDEX = 'jfp:invoices'
const SEQ = 'jfp:invoice-seq'
const tokenKey = (t) => `jfp:invoice-token:${t}`
export const VIEWED = 'jfp:invoice-viewed'
const ISO = /^\d{4}-\d{2}-\d{2}$/
// Invoice numbers start at 1001 so the first one does not look like a test.
export const SEQ_START = 1000

export const gstOf = (cents) => Math.round(cents / 11)
export const paidOf = (inv) => (inv.payments || []).reduce((t, p) => t + (p.cents || 0), 0)
export const owingOf = (inv) => (inv.voidedAt ? 0 : Math.max(0, inv.totalCents - paidOf(inv)))
export function invoiceStatus(inv, viewedAt = '') {
  if (inv.voidedAt) return 'void'
  const paid = paidOf(inv)
  if (paid >= inv.totalCents) return 'paid'
  if (paid > 0) return 'part'
  if (!inv.issuedAt) return 'draft'
  return viewedAt || inv.viewedAt ? 'viewed' : 'sent'
}

// The lines staff typed, checked. { ok, lines, totalCents } or { ok: false, error }.
export function cleanLines(list) {
  if (!Array.isArray(list) || !list.length) return { ok: false, error: 'Add at least one line.' }
  if (list.length > INVOICE_LIMITS.lines) return { ok: false, error: `At most ${INVOICE_LIMITS.lines} lines.` }
  const lines = []
  for (const [i, x] of list.entries()) {
    const description = clean(x?.description, INVOICE_LIMITS.description)
    const qty = Number(x?.qty ?? 1)
    const unitCents = Number(x?.unitCents)
    if (!description) return { ok: false, error: `Line ${i + 1}: say what it is for.` }
    if (!Number.isInteger(qty) || qty < 1 || qty > INVOICE_LIMITS.qty) return { ok: false, error: `Line ${i + 1}: the quantity must be 1 to ${INVOICE_LIMITS.qty}.` }
    if (!Number.isInteger(unitCents) || unitCents < 0 || unitCents > INVOICE_LIMITS.unitMax) return { ok: false, error: `Line ${i + 1}: enter the price.` }
    lines.push({ description, qty, unitCents, totalCents: qty * unitCents, ...(clean(x?.priceId, 50) ? { priceId: clean(x.priceId, 50) } : {}) })
  }
  const totalCents = lines.reduce((t, l) => t + l.totalCents, 0)
  if (totalCents < 100) return { ok: false, error: 'The invoice must be at least A$1.' }
  if (totalCents > INVOICE_LIMITS.totalMax) return { ok: false, error: 'That is more than A$20,000. Make two invoices.' }
  return { ok: true, lines, totalCents }
}

// Everything an invoice needs from the form, checked. rows: the players'
// Term 4 rows (looked up by the caller). { ok, v } or { ok: false, error }.
export function invoiceInput(body = {}, { rows = [], today = sydneyToday() } = {}) {
  const bad = (error) => ({ ok: false, status: 400, error })
  const programme = INVOICE_PROGRAMMES.includes(body.programme) ? body.programme : ''
  if (!programme) return bad('Pick the program: JFP, Pro sessions, Extra sessions or Other.')
  const l = cleanLines(body.lines)
  if (!l.ok) return bad(l.error)
  if (!rows.length && !clean(body.playerName, 80)) return bad('Choose the player (or players) the invoice is for.')
  if (rows.length > INVOICE_LIMITS.players) return bad(`At most ${INVOICE_LIMITS.players} players on one invoice.`)
  if (ROW_PROGRAMMES.has(programme) && !rows.length) return bad(`A ${programmeLabel(programme)} invoice is for a player's place: choose the player from the list.`)
  const email = validEmail(body.email) || rows[0]?.email || ''
  if (!email) return bad('There is no parent email. Type one, or add it to the player first.')
  const dueDate = body.dueDate ? clean(body.dueDate, 10) : ''
  if (dueDate && !ISO.test(dueDate)) return bad('The due date does not look right.')
  const players = rows.length ? rows.map((r) => ({ rowId: r.id, name: r.player })) : [{ rowId: '', name: clean(body.playerName, 80) }]
  return {
    ok: true,
    v: {
      programme, lines: l.lines, totalCents: l.totalCents, gstCents: gstOf(l.totalCents), email,
      parentName: clean(body.parentName, 120) || rows[0]?.parent || '', players, dueDate, notes: clean(body.notes, INVOICE_LIMITS.notes),
      issueDate: body.issueDate && ISO.test(body.issueDate) ? body.issueDate : today,
    },
  }
}

// ---------- store ----------

export async function getInvoice(id) { const c = clean(id, 20).toUpperCase(); return INVOICE_ID.test(c) ? kvGetJson(key(c)) : null }
export async function saveInvoice(inv) { await kvSetJson(key(inv.id), inv, LONG); await kvCommand(['ZADD', INDEX, String(inv.number), inv.id]); return inv }
export async function invoiceByToken(t) {
  const c = String(t || '')
  if (!TOKEN.test(c)) return null
  const id = await kvCommand(['GET', tokenKey(c)])
  const inv = id ? await getInvoice(id) : null
  return inv && inv.token === c ? inv : null
}
export async function listInvoices(limit = 2000) {
  const ids = await kvCommand(['ZREVRANGE', INDEX, '0', String(limit - 1)])
  if (!ids?.length) return []
  return (await kvPipeline(ids.map((id) => ['GET', key(id)]))).map((x) => { try { return typeof x === 'string' ? JSON.parse(x) : null } catch { return null } }).filter(Boolean)
}
export async function viewedMap() {
  const flat = await kvCommand(['HGETALL', VIEWED]).catch(() => [])
  const o = {}
  for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) o[flat[i]] = flat[i + 1]
  return o
}
export async function newInvoice(v, principal) {
  const n = SEQ_START + Number(await kvCommand(['INCR', SEQ]))
  const token = crypto.randomBytes(24).toString('base64url')
  const inv = { id: `INV-${n}`, number: n, token, ...v, payments: [], createdBy: principal.email, createdAt: new Date().toISOString() }
  await kvCommand(['SET', tokenKey(token), inv.id, 'EX', String(LONG)])
  return saveInvoice(inv)
}

// One lock per invoice for every write after it is issued (payments, void,
// viewed is on its own hash), so a payment can never be lost to a race.
export async function withInvoice(id, fn) {
  const lock = `jfp:invoice-lock:${id}`
  let got = false
  for (let i = 0; i < 30 && !(got = (await kvCommand(['SET', lock, '1', 'NX', 'EX', '15'])) === 'OK'); i++) await new Promise((r) => setTimeout(r, 100))
  if (!got) return { ok: false, status: 409, error: 'That invoice is being saved right now. Try again in a moment.' }
  try {
    const inv = await getInvoice(id)
    if (!inv) return { ok: false, status: 404, error: 'Invoice not found.' }
    return await fn(inv)
  } finally { await kvCommand(['DEL', lock]).catch(() => {}) }
}

// A payment onto the invoice, never the same one twice (its id).
export async function addInvoicePayment(id, pay) {
  return withInvoice(id, async (inv) => {
    if (pay.id && (inv.payments || []).some((p) => p.id === pay.id)) return { ok: true, invoice: inv, already: true }
    inv.payments = [...(inv.payments || []), { id: pay.id, method: pay.method, cents: pay.cents, date: pay.date || sydneyToday(), at: new Date().toISOString(), by: pay.by || '', ...(pay.note ? { note: pay.note } : {}) }]
    if (paidOf(inv) >= inv.totalCents && !inv.paidAt) inv.paidAt = new Date().toISOString()
    await saveInvoice(inv)
    return { ok: true, invoice: inv }
  })
}

// After a bank or cash payment on a JFP / Pro invoice: its payment request
// asks for what is left, or reads paid when nothing is.
export async function settleInvoicePayreq(inv) {
  const q = inv.payreqId ? await getPayreq(inv.payreqId) : null
  if (!q || !['open', 'checkout'].includes(q.status)) return { ok: true }
  if (q.status === 'checkout' && q.stripeSessionId && (await closeCheckout(q.stripeSessionId)) === 'complete') return { ok: false, error: 'The family is paying by card right now. Check again in a minute.' }
  const left = owingOf(inv)
  if (inv.voidedAt) await savePayreq({ ...q, status: 'cancelled', stripeSessionId: '', cancelledAt: new Date().toISOString(), cancelReason: 'Invoice void' })
  else if (left <= 0) await savePayreq({ ...q, status: 'paid', stripeSessionId: '', paidAt: new Date().toISOString(), paidCents: paidOf(inv), paidOffline: true, paidMethod: (inv.payments || []).at(-1)?.method || 'bank' })
  else await savePayreq({ ...q, amountCents: left, status: 'open', stripeSessionId: '' })
  return { ok: true }
}

// The payment request for a JFP or Pro invoice: the players' rows, so paying
// it records on them like any row link. Charges make their own (_jfp-charges.js).
export function rowInvoicePayreq(inv, { principal, siteUrl = '', id }) {
  const rows = inv.players.filter((p) => p.rowId)
  return {
    id, invoiceId: inv.id, reason: 'invoice', ...(inv.programme === 'pro' ? { programme: 'pro' } : {}),
    email: inv.email, parentName: inv.parentName,
    playerNames: rows.map((p) => p.name), playerKeys: rows.map((p) => normName(p.name)), term4Ids: rows.map((p) => p.rowId),
    groupId: '', groupLabel: `Invoice ${inv.id}`, productLabel: `Invoice ${inv.id}`,
    amountCents: owingOf(inv), afterpay: false, status: 'open',
    createdBy: principal.email, createdAt: new Date().toISOString(), expiresAt: '', siteUrl,
  }
}

// ---------- what families see ----------

export function bankReference(config, inv) {
  const first = String(inv.players[0]?.name || '').trim().split(/\s+/)[0] || ''
  return String(config.invoice?.reference || 'INV-<n> <player>').replace('<n>', String(inv.number)).replace('<player>', first).replace(/\s+/g, ' ').trim().slice(0, 40)
}
export const invoiceUrl = (base, inv) => `${base}/jfp-invoice/?i=${encodeURIComponent(inv.token)}`

// The page and the PDF: this invoice only. No other family, no staff names,
// no coach names, no emails other than the one it is addressed to.
export function publicInvoice(inv, config, { viewedAt = '' } = {}) {
  const st = invoiceStatus(inv, viewedAt)
  const owing = owingOf(inv)
  // Only when bank transfer is switched on in Settings > Invoices (Lee, 16 Oct 2026).
  const bank = bankOffered(config) ? { accountName: config.invoice.accountName, bsb: `${config.invoice.bsb.slice(0, 3)}-${config.invoice.bsb.slice(3)}`, accountNumber: config.invoice.accountNumber, reference: bankReference(config, inv) } : null
  return {
    number: inv.id, status: st, statusLabel: INVOICE_STATUS[st],
    issueDate: inv.issueDate, issueLabel: dateLabel(inv.issueDate), dueDate: inv.dueDate || '', dueLabel: inv.dueDate ? dateLabel(inv.dueDate) : '',
    billTo: { name: inv.parentName || '', email: inv.email }, players: inv.players.map((p) => p.name),
    program: programmeLabel(inv.programme),
    lines: inv.lines.map((l) => ({ description: l.description, qty: l.qty, unitLabel: formatAud(l.unitCents), totalLabel: formatAud(l.totalCents), unitCents: l.unitCents, totalCents: l.totalCents })),
    totalCents: inv.totalCents, totalLabel: formatAud(inv.totalCents), gstCents: inv.gstCents, gstLabel: formatAud(inv.gstCents),
    paidCents: paidOf(inv), paidLabel: formatAud(paidOf(inv)), owingCents: owing, owingLabel: formatAud(owing),
    notes: inv.notes || '',
    business: { name: 'Joner Football', address: 'Joner Football HQ, 20 Narabang Way (Unit 2), Belrose NSW 2085', email: 'ligia@jonerfootball.com', ...(config.invoice?.abn ? { abn: config.invoice.abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') } : {}) },
    bank: owing > 0 && st !== 'void' ? bank : null,
    canPayCard: owing > 0 && !['draft', 'void'].includes(st),
    draft: st === 'draft',
  }
}

// Staff list and detail.
export function invoiceRow(inv, { viewedAt = '', base = '' } = {}) {
  const st = invoiceStatus(inv, viewedAt)
  return {
    id: inv.id, number: inv.number, status: st, statusLabel: INVOICE_STATUS[st], programme: inv.programme, programmeLabel: programmeLabel(inv.programme),
    parentName: inv.parentName, email: inv.email, players: inv.players, lines: inv.lines, totalCents: inv.totalCents, gstCents: inv.gstCents, paidCents: paidOf(inv), owingCents: owingOf(inv),
    issueDate: inv.issueDate, dueDate: inv.dueDate || '', overdue: Boolean(inv.dueDate && inv.dueDate < sydneyToday() && owingOf(inv) > 0 && !['draft', 'void'].includes(st)),
    notes: inv.notes || '', payments: inv.payments || [], issuedAt: inv.issuedAt || '', emailedAt: inv.emailedAt || '', viewedAt: viewedAt || inv.viewedAt || '', paidAt: inv.paidAt || '', voidedAt: inv.voidedAt || '',
    payreqId: inv.payreqId || '', chargeId: inv.chargeId || '', url: base ? invoiceUrl(base, inv) : '', createdAt: inv.createdAt, createdBy: inv.createdBy,
  }
}

// The Stripe page from the invoice's own page: each line while nothing is
// paid, one "balance" line after a part payment. The invoice, the player and
// the payment request ride on it (jfpBookingId), so the webhook finds it.
export function invoiceCheckoutBody(inv, q, base, nowMs = Date.now()) {
  const owing = q.amountCents
  const who = inv.players.map((p) => p.name).filter(Boolean).join(', ')
  const lines = paidOf(inv) === 0 && inv.lines.reduce((t, l) => t + l.totalCents, 0) === owing && inv.lines.every((l) => l.unitCents > 0)
    ? inv.lines.map((l) => ({ name: `${inv.id}: ${l.description}${who ? ` (${who})` : ''}`, cents: l.unitCents, qty: l.qty }))
    : [{ name: `${inv.id}: balance${who ? ` (${who})` : ''}`, cents: owing, qty: 1 }]
  const meta = {
    jfpBookingId: q.id, jfpInvoice: inv.id, source: 'invoice', ...playerMeta(q),
    // A charge counts in its own program; a JFP invoice is JFP; a Pro one says so as every Pro link does.
    ...(q.charge ? { jfpProgramme: q.programme, jfpCharge: q.charge.id } : q.programme === 'pro' ? { jfpProduct: 'pro' } : {}),
  }
  const out = {
    mode: 'payment', customer_email: inv.email,
    expires_at: String(Math.floor(nowMs / 1000) + CHECKOUT_EXPIRES_MINUTES * 60),
    success_url: `${base}/jfp-invoice/?i=${encodeURIComponent(inv.token)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/jfp-invoice/?i=${encodeURIComponent(inv.token)}`,
    'payment_method_types[0]': 'card',
    'payment_intent_data[description]': `Joner Football ${inv.id}${who ? `, ${who}` : ''}`.slice(0, 400),
  }
  lines.forEach((l, i) => {
    out[`line_items[${i}][quantity]`] = String(l.qty)
    out[`line_items[${i}][price_data][currency]`] = 'aud'
    out[`line_items[${i}][price_data][unit_amount]`] = String(l.cents)
    out[`line_items[${i}][price_data][product_data][name]`] = l.name.slice(0, 250)
  })
  for (const [k, v] of Object.entries(meta)) { out[`metadata[${k}]`] = String(v); out[`payment_intent_data[metadata][${k}]`] = String(v) }
  return out
}

// Bank transfers to check: the open invoices a reference can name.
export const openForBank = (invoices) => invoices.filter((inv) => inv.issuedAt && !inv.voidedAt && owingOf(inv) > 0).map((inv) => ({ id: inv.id, number: inv.number, owingCents: owingOf(inv), totalCents: inv.totalCents, players: inv.players.map((p) => p.name), programme: inv.programme }))
