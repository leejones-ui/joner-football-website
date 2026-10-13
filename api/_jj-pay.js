// Joners Juniors payments from the family account (stage 2).
//
// A Juniors payment request ("JJPAY-...") is the Juniors twin of a JFP
// payment request, kept on its own so Juniors money can never land in JFP:
//   - its own KV hash (jj:payreqs), never the JFP payreq list;
//   - its own Stripe metadata: jjPayreqId, programme "Joners Juniors", term,
//     the Juniors row ids and table. No jfpBookingId, so JFP Money and the
//     JFP webhook leave it alone (classifySession sees "other");
//   - when paid it marks the Juniors row(s) in that term's Juniors table
//     (Payment Status, Paid Via, a dated note with [JJ-CS] [JJ-PI] [JJ-PAID]
//     tags), which is how Juniors Money finds the payment and its real fee.
//     Never Term 4 Players, never the JFP Payment Ledger.
//
// Two kinds:
//   term  this term's fee (or what is left of it) for one or more children.
//   next  next term: hold the place or pay in full. Paying creates the
//         child's row in next term's table (config.juniors.tables[next term])
//         the first time, tagged [JJ-NEXT:<this term's row>] so a retry or
//         the rest after a hold finds the same row.
//
// The webhook (holiday-payment-webhook and juniors-payment-webhook) and the
// family's return to My account (jfp-confirm) both finalise; a short lease
// and per-row tags make a second run change nothing.
import crypto from 'node:crypto'
import { stripeFetch } from './_holiday-store.js'
import { kvCommand, kvPipeline, clean, newId, formatAud, audit, claimOnce, closeCheckout, CHECKOUT_EXPIRES_MINUTES, getConfig, sydneyToday, coachById } from './_jfp-store.js'
import { getJJRow, writeJJRow, readJJTable, tableFor, REC } from './_jj-data.js'
import { classLabelOf, nextTermOf, classForRow, classLabelFor } from './_jj-config.js'
import { sendJJReceipt, sendJJStaffAlert } from './_jj-email.js'

export const JJ_PAYREQS = 'jj:payreqs'
export const JJ_VIEWS = 'jj:payreq-views'
export const JJ_VIEWED_AT = 'jj:payreq-viewed-at'
export const JJ_PROGRAMME = 'Joners Juniors'
export const JJPAY = /^JJPAY-\d+-[0-9A-F]{6}$/
const OPEN = new Set(['open', 'checkout'])
export const isOpen = (q) => Boolean(q) && OPEN.has(q.status)
const LEASE_SECONDS = 120
export const JJ_PAY_EFFECTS = ['airtable', 'parentEmail', 'staffAlert']

// ---------- the store ----------

export async function saveJJPayreq(q) { await kvCommand(['HSET', JJ_PAYREQS, q.id, JSON.stringify(q)]); return q }
export async function getJJPayreq(id) {
  const c = clean(id, 60)
  if (!JJPAY.test(c)) return null
  try { return JSON.parse((await kvCommand(['HGET', JJ_PAYREQS, c])) || 'null') } catch { return null }
}
export async function listJJPayreqs() {
  const flat = (await kvCommand(['HGETALL', JJ_PAYREQS])) || []
  const out = []
  for (let i = 1; i < flat.length; i += 2) { try { const q = JSON.parse(flat[i]); if (q?.id) out.push(q) } catch {} }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}
export async function jjViews() {
  const [v, at] = await kvPipeline([['HGETALL', JJ_VIEWS], ['HGETALL', JJ_VIEWED_AT]])
  const hash = (raw) => { const o = {}; for (let i = 0; i + 1 < (raw || []).length; i += 2) o[raw[i]] = raw[i + 1]; return o }
  return { views: hash(v), viewedAt: hash(at) }
}
// The family opened the link: counted on its own key, never by rewriting the request.
export async function noteJJView(id) { await kvPipeline([['HINCRBY', JJ_VIEWS, id, '1'], ['HSET', JJ_VIEWED_AT, id, new Date().toISOString()]]) }

// No email in the link: it would end up in browser history and logs.
export const jjPayreqUrl = (site, q) => `${String(site || '').replace(/\/$/, '')}/jfp-account/?pay=${encodeURIComponent(q.id)}`

// rows: [{ rowId, name, owingCents }]. kind 'term' or 'next'.
export async function createJJPayreq({ by, email, parentName, rows, amountCents, term, table, reason, kind = 'term', next = null, site = '' }) {
  const ids = rows.map((r) => r.rowId)
  if (!ids.length || !ids.every((id) => REC.test(id))) throw new Error('Choose the children for this payment.')
  if (!(Number.isInteger(amountCents) && amountCents >= 100 && amountCents <= 2000000)) throw new Error('The amount must be between A$1 and A$20,000.')
  const q = {
    id: newId('JJPAY'), programme: JJ_PROGRAMME, kind, reason,
    email, parentName,
    rows: rows.map((r) => ({ rowId: r.rowId, name: r.name, owingCents: Number(r.owingCents) || 0 })),
    rowIds: ids, playerNames: rows.map((r) => r.name),
    term, table, amountCents, next,
    status: 'open', createdBy: by, createdAt: new Date().toISOString(), siteUrl: site,
  }
  await saveJJPayreq(q)
  return q
}

// Close a request nobody should pay any more (staff, or a newer one replaced it).
// Returns false when it has just been paid on Stripe.
export async function cancelJJPayreq(q, by, why = '') {
  if (!isOpen(q)) return true
  if (q.status === 'checkout') {
    const closed = await closeCheckout(q.stripeSessionId)
    if (closed !== 'expired') return false
  }
  await saveJJPayreq({ ...q, status: 'cancelled', cancelledBy: by, cancelledAt: new Date().toISOString(), cancelReason: why })
  return true
}

// The open request for exactly these children and amount, or a new one (any
// other open request for them is closed first, so a family only ever sees one).
export async function ensureTermPayreq({ by, email, parentName, rows, amountCents, term, table, reason, site }) {
  const list = await listJJPayreqs()
  const want = [...rows.map((r) => r.rowId)].sort().join(',')
  const same = list.find((q) => isOpen(q) && q.kind === 'term' && q.email === email && [...q.rowIds].sort().join(',') === want && q.amountCents === amountCents)
  if (same) return { payreq: same, reused: true }
  for (const q of list.filter((x) => isOpen(x) && x.kind === 'term' && x.rowIds.some((id) => rows.some((r) => r.rowId === id)))) {
    if (!(await cancelJJPayreq(q, by, 'replaced by a newer payment request'))) return { busy: true }
  }
  return { payreq: await createJJPayreq({ by, email, parentName, rows, amountCents, term, table, reason, site }) }
}

// ---------- next term statuses ----------

// Per child (by this term's row id): invited, held, paid or no.
const nextKey = (term) => `jj:next:${term}`
export async function jjNextStatuses(term) {
  const flat = (await kvCommand(['HGETALL', nextKey(term)])) || []
  const out = {}
  for (let i = 0; i + 1 < flat.length; i += 2) { try { out[flat[i]] = JSON.parse(flat[i + 1]) } catch {} }
  return out
}
export async function setJJNextStatus(term, rowId, st) { await kvCommand(['HSET', nextKey(term), rowId, JSON.stringify({ ...st, at: new Date().toISOString() })]) }

// A family's choice for next term: a payment request for the hold or the
// full term (less a hold already paid).
export async function createNextPayreq({ config, row, choice, st, email, parentName, site }) {
  const nt = nextTermOf(config.juniors)
  if (choice === 'hold' && !nt.holdCents) throw new Error(`There is no hold for ${nt.name}: pay in full or tell us they are not returning.`)
  const heldPaid = st?.status === 'held' ? Number(st.paidCents) || 0 : 0
  const amountCents = choice === 'hold' ? nt.holdCents : Math.max(100, nt.fullCents - heldPaid)
  return createJJPayreq({
    by: email, email, parentName, rows: [{ rowId: row.id, name: row.player, owingCents: amountCents }], amountCents,
    term: config.juniors.term, table: tableFor(config, config.juniors.term), reason: 'next', kind: 'next', site,
    next: { term: nt.name, choice, fromRowId: row.id, fullCents: nt.fullCents, holdCents: nt.holdCents, holdPaidCents: heldPaid },
  })
}

// ---------- Stripe Checkout ----------

// What the family sees on Stripe's page.
function lineItems(q) {
  const each = q.kind === 'term' && q.rows.length > 1 && q.rows.reduce((t, r) => t + r.owingCents, 0) === q.amountCents
  const list = each
    ? q.rows.map((r) => ({ cents: r.owingCents, name: `Joners Juniors ${q.term}: ${r.name}` }))
    : [{ cents: q.amountCents, name: q.next ? `Joners Juniors ${q.next.term}${q.next.choice === 'hold' ? ' (hold the place)' : q.next.holdPaidCents ? ' (the rest of the term)' : ''}: ${q.playerNames.join(', ')}` : `Joners Juniors ${q.term}: ${q.playerNames.join(', ')}` }]
  const out = {}
  list.forEach((x, i) => {
    out[`line_items[${i}][quantity]`] = '1'
    out[`line_items[${i}][price_data][currency]`] = 'aud'
    out[`line_items[${i}][price_data][unit_amount]`] = String(x.cents)
    out[`line_items[${i}][price_data][product_data][name]`] = x.name.slice(0, 250)
  })
  return out
}

// Returns { ok, url } or { ok:false, status, error, code }.
export async function startJJCheckout(q, base) {
  if (q.status === 'paid') return { ok: false, status: 409, error: 'This is already paid.', code: 'paid' }
  if (!isOpen(q)) return { ok: false, status: 410, error: 'This payment is no longer open. Contact Joner Football.' }
  if (q.status === 'checkout' && q.stripeSessionId) {
    const closed = await closeCheckout(q.stripeSessionId)
    if (closed === 'complete') return { ok: false, status: 409, error: 'This payment has gone through and is being processed. Refresh in a minute.', code: 'processing' }
    if (closed === 'error') return { ok: false, status: 503, error: 'Could not check your earlier payment. Try again in a minute.' }
  }
  const term = q.next ? q.next.term : q.term
  const description = `Joners Juniors ${term}: ${q.playerNames.join(', ')}`.slice(0, 400)
  const session = await stripeFetch('/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment',
      customer_email: q.email,
      expires_at: String(Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRES_MINUTES * 60),
      success_url: `${base}/jfp-account/?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/jfp-account/`,
      ...lineItems(q),
      'metadata[jjPayreqId]': q.id,
      'metadata[programme]': JJ_PROGRAMME,
      'metadata[term]': term,
      'metadata[jjRowIds]': q.rowIds.join(','),
      'metadata[jjTable]': q.table || '',
      'metadata[amountCents]': String(q.amountCents),
      'payment_intent_data[metadata][jjPayreqId]': q.id,
      'payment_intent_data[metadata][programme]': JJ_PROGRAMME,
      'payment_intent_data[metadata][term]': term,
      'payment_intent_data[description]': description,
    },
  })
  // Staff may have changed or cancelled it while the page was opening.
  const now = await getJJPayreq(q.id)
  if (!now || now.amountCents !== q.amountCents || !isOpen(now)) {
    await closeCheckout(session.id)
    return { ok: false, status: 409, error: 'This payment was just updated. Refresh the page and try again.', code: 'changed' }
  }
  await saveJJPayreq({ ...now, status: 'checkout', stripeSessionId: session.id, siteUrl: base })
  return { ok: true, url: session.url }
}

export const jjPayreqIdFromSession = (session) => {
  const id = clean(session?.metadata?.jjPayreqId || '', 60)
  return JJPAY.test(id) ? id : ''
}

// ---------- finalising ----------

async function takeLease(id) {
  const token = crypto.randomBytes(12).toString('hex')
  return (await kvCommand(['SET', `jj:pay-lease:${id}`, token, 'NX', 'EX', String(LEASE_SECONDS)])) === 'OK' ? token : ''
}
async function dropLease(id, token) { if (token) await kvCommand(['EVAL', "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", '1', `jj:pay-lease:${id}`, token]) }

// Stripe's own fee, from the balance transaction (as JFP). null while not known.
async function stripeFee(intentId) {
  if (!intentId) return null
  try {
    const pi = await stripeFetch(`/payment_intents/${encodeURIComponent(intentId)}?expand[]=latest_charge.balance_transaction`)
    const bt = pi?.latest_charge?.balance_transaction
    return typeof bt?.fee === 'number' ? bt.fee : null
  } catch (error) { console.warn('jj stripe fee read failed', error.message); return null }
}

// Split cents over rows by weight, to the cent (the JFP rule).
export function splitBy(total, weights) {
  const sum = weights.reduce((t, w) => t + Math.max(0, w), 0)
  if (!sum) { const base = Math.floor(total / weights.length); return weights.map((_, i) => base + (i < total - base * weights.length ? 1 : 0)) }
  const raw = weights.map((w) => (Math.max(0, w) / sum) * total)
  const out = raw.map(Math.floor)
  let rest = total - out.reduce((t, v) => t + v, 0)
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0])
  for (let k = 0; rest > 0; k = (k + 1) % out.length, rest -= 1) out[order[k][1]] += 1
  return out
}
const viaWith = (prev, method) => [...new Set(String(prev || '').split(/\s*\+\s*/).filter((x) => x && !/credit/i.test(x)).concat(method))].join(' + ')
const tags = (q, extra = '') => `[JJ-CS:${q.stripeSessionId}]${q.stripePaymentIntentId ? ` [JJ-PI:${q.stripePaymentIntentId}]` : ''} [JJ-PAID:${q.id}]${extra}`

async function flag(q, reason, extra = '') {
  q.needsAttention = [...new Set([...(q.needsAttention ? String(q.needsAttention).split(', ') : []), reason])].join(', ')
  await saveJJPayreq(q)
  await audit({ by: 'system', action: `jj.payment.${reason}`, target: q.id, after: { extra } })
  if (await claimOnce(`jj:attention:${q.id}:${reason}`)) { try { await sendJJStaffAlert({ payreq: q, reason }) } catch (error) { console.error('jj attention alert failed', error.message) } }
}

async function runEffect(name, q, fn, { idempotent = false } = {}) {
  const cur = q.effects?.[name]
  if (cur?.status === 'done') return
  if (cur?.status === 'uncertain' && !idempotent) return
  const attempts = (cur?.attempts || 0) + 1
  q.effects = { ...(q.effects || {}), [name]: { status: 'running', at: new Date().toISOString(), attempts } }
  await saveJJPayreq(q)
  try {
    await fn()
    q.effects[name] = { status: 'done', at: new Date().toISOString(), attempts }
  } catch (error) {
    console.error(`jj ${name} failed for ${q.id}`, error.message)
    const m = String(error?.message || error)
    q.effects[name] = { status: idempotent || /Airtable \d{3}|Brevo \d{3}|not configured|no-table|row-missing/i.test(m) ? 'failed' : 'uncertain', at: new Date().toISOString(), attempts, error: m.slice(0, 300) }
  }
  await saveJJPayreq(q)
}

// This term: each child's row marked paid (split by what each owed).
async function applyTerm(q) {
  const rows = []
  for (const r of q.rows) {
    const row = await getJJRow(q.table, r.rowId, q.term)
    if (!row) { await flag(q, 'row-missing', r.name); throw new Error(`row-missing: ${r.rowId}`) }
    rows.push(row)
  }
  const paid = q.paidCents ?? q.amountCents
  const share = splitBy(paid, q.rows.map((r) => r.owingCents))
  const fees = q.stripeFeeCents != null ? splitBy(q.stripeFeeCents, share) : null
  for (const [i, row] of rows.entries()) {
    if (row.paidRequests.includes(q.id)) continue
    const full = share[i] >= q.rows[i].owingCents
    await writeJJRow(q.table, {
      id: row.id,
      set: { status: full ? 'Paid' : 'Partially Paid', paidVia: viaWith(row.paidVia, 'Stripe'), paidAt: sydneyToday() },
      note: `Paid ${formatAud(share[i])} online from the family account (Juniors payment ${q.id}${rows.length > 1 ? `, one payment for ${rows.length} children` : ''}), Stripe fee ${fees ? formatAud(fees[i]) : 'not known yet'}. ${tags(q)}`,
    })
  }
  q.rowShares = Object.fromEntries(rows.map((row, i) => [row.id, share[i]]))
  if (q.rows.some((r, i) => share[i] > r.owingCents)) await flag(q, 'overpaid', q.playerNames.join(', '))
}

// Next term: the child's row in next term's table, made the first time.
async function applyNext(q, config) {
  const term = q.next.term
  const table = tableFor(config, term)
  if (!table) { await flag(q, 'no-table', term); throw new Error(`no-table: no Airtable table for ${term}`) }
  const lock = `jj:next-lock:${q.next.fromRowId}`
  if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '30'])) !== 'OK') throw new Error('Airtable 409: the next term row is being written by another payment')
  try {
    const paid = (q.paidCents ?? q.amountCents) + Number(q.next.holdPaidCents || 0)
    const held = paid < q.next.fullCents
    const status = held ? 'Partially Paid' : 'Paid'
    const existing = (await readJJTable(table, { term, fresh: true })).find((r) => r.nextFrom === q.next.fromRowId)
    let nextRowId = existing?.id || ''
    if (existing) {
      if (!existing.paidRequests.includes(q.id)) await writeJJRow(table, { id: existing.id, set: { status, paidVia: viaWith(existing.paidVia, 'Stripe') }, note: `${held ? 'Hold' : 'Payment'} of ${formatAud(q.paidCents ?? q.amountCents)} online for ${term} (Juniors payment ${q.id})${held ? '' : ', now paid in full'}. ${tags(q)}` })
    } else {
      const from = await getJJRow(q.table, q.next.fromRowId, q.term)
      if (!from) { await flag(q, 'row-missing', q.playerNames.join(', ')); throw new Error(`row-missing: ${q.next.fromRowId}`) }
      // The same class the child is in this term (more than one class, stage 3).
      const cls = classForRow(config.juniors, from) || config.juniors.classes[0]
      const coach = coachById(config, cls?.coachId || '')
      nextRowId = await writeJJRow(table, {
        set: {
          player: from.player, parent: from.parent, ...(from.emails[0] ? { email: from.emails[0] } : {}), ...(from.emails[1] ? { email2: from.emails[1] } : {}),
          ...(from.mobile ? { mobile: from.mobile } : {}), ...(from.mobile2 ? { mobile2: from.mobile2 } : {}), ...(from.dobText ? { dob: from.dobText } : {}),
          term, day: cls?.day, time: cls?.time, location: cls?.location, coach: coach?.airtableName || '', className: classLabelFor(config.juniors, cls),
          fee: q.next.fullCents / 100, status, paidVia: 'Stripe', ...(from.waiverStatus ? { waiverStatus: from.waiverStatus } : {}),
          ...(from.medical ? { medical: from.medical } : {}),
        },
        note: `Re-enrolled online from ${q.term} by the family: ${held ? `place held, ${formatAud(paid)} paid` : `paid in full, ${formatAud(paid)}`} (Juniors payment ${q.id}). [JJ-NEXT:${q.next.fromRowId}] ${tags(q)}`,
      })
    }
    q.nextRowId = nextRowId
    await setJJNextStatus(term, q.next.fromRowId, { status: held ? 'held' : 'paid', payreqId: q.id, paidCents: paid, nextRowId })
  } finally { await kvCommand(['DEL', lock]).catch(() => {}) }
}

async function runEffects(q, retry = new Set()) {
  const config = await getConfig()
  for (const k of retry) delete q.effects?.[k]
  await runEffect('airtable', q, () => (q.next ? applyNext(q, config) : applyTerm(q)), { idempotent: true })
  if (q.effects?.airtable?.status !== 'done') return
  // Recorded now: a missing table or row is no longer a problem.
  const left = String(q.needsAttention || '').split(', ').filter((x) => x && !['no-table', 'row-missing'].includes(x)).join(', ')
  if (left !== (q.needsAttention || '')) { q.needsAttention = left; await saveJJPayreq(q) }
  await runEffect('parentEmail', q, () => sendJJReceipt({ payreq: q, jj: config.juniors, siteUrl: q.siteUrl || '' }))
  await runEffect('staffAlert', q, () => sendJJStaffAlert({ payreq: q }))
}

// Returns { ok, recorded, busy?, attention?, payreq }. recorded false: the
// webhook answers 500 so Stripe tries again (the row was not written yet).
export async function finaliseJJPayreq(id, session) {
  let q = await getJJPayreq(id)
  if (!q) return { ok: false, reason: 'unknown' }
  const sid = session?.id || ''
  const intent = typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id || ''
  const lease = await takeLease(id)
  if (!lease) return { ok: false, busy: true, payreq: q }
  try {
    q = await getJJPayreq(id)
    if (q.status === 'cancelled') {
      if (!(q.unexpected || []).some((x) => x.sessionId === sid)) { q.unexpected = [...(q.unexpected || []), { sessionId: sid, intentId: intent, cents: Number(session?.amount_total || 0), at: new Date().toISOString() }]; await flag(q, 'paid-after-cancel') }
      return { ok: true, attention: 'paid-after-cancel', recorded: true, payreq: q }
    }
    if (q.status === 'paid' && q.stripeSessionId && sid && q.stripeSessionId !== sid) {
      if (!(q.unexpected || []).some((x) => x.sessionId === sid)) { q.unexpected = [...(q.unexpected || []), { sessionId: sid, intentId: intent, cents: Number(session?.amount_total || 0), at: new Date().toISOString() }]; await flag(q, 'second-payment') }
      return { ok: true, attention: 'second-payment', recorded: true, already: true, payreq: q }
    }
    if (q.status !== 'paid') {
      q = { ...q, status: 'paid', paidAt: new Date().toISOString(), stripeSessionId: sid || q.stripeSessionId, stripePaymentIntentId: intent, paidCents: Number(session?.amount_total) || q.amountCents }
      q.stripeFeeCents = await stripeFee(intent)
      await saveJJPayreq(q)
      await audit({ by: q.email, action: 'jj.payreq.paid', target: q.id, after: { cents: q.paidCents, rows: q.rowIds, term: q.next?.term || q.term } })
    }
    const retry = new Set(JJ_PAY_EFFECTS.filter((k) => q.effects?.[k]?.status === 'failed' || (k === 'airtable' && ['running', 'uncertain'].includes(q.effects?.[k]?.status))))
    await runEffects(q, retry)
    return { ok: true, recorded: q.effects?.airtable?.status === 'done', payreq: q }
  } finally { await dropLease(id, lease) }
}

// Staff "Try again": failed or unfinished steps (an email with an unclear
// outcome is left alone, so nobody gets two).
export async function repairJJPayreq(id) {
  const q = await getJJPayreq(id)
  if (!q || q.status !== 'paid') return { ok: false, reason: 'not-paid' }
  const lease = await takeLease(id)
  if (!lease) return { ok: false, reason: 'busy' }
  try {
    const fresh = await getJJPayreq(id)
    if (fresh.stripeFeeCents == null) fresh.stripeFeeCents = await stripeFee(fresh.stripePaymentIntentId)
    const retry = new Set(JJ_PAY_EFFECTS.filter((k) => ['failed', 'running'].includes(fresh.effects?.[k]?.status) || (k === 'airtable' && fresh.effects?.[k]?.status === 'uncertain')))
    await runEffects(fresh, retry)
    return { ok: true, payreq: fresh }
  } finally { await dropLease(id, lease) }
}

// The Stripe page expired: the request opens again (only for the session it waited on).
export async function expireJJPayreq(id, session) {
  const q = await getJJPayreq(id)
  if (q?.status === 'checkout' && (!session?.id || q.stripeSessionId === session.id)) { await saveJJPayreq({ ...q, status: 'open', stripeSessionId: '' }); return { changed: true } }
  return { changed: false }
}

// One answer for both webhooks: the session is read from Stripe, never the request body.
export async function jjWebhook(type, session) {
  const id = jjPayreqIdFromSession(session)
  if (!id) return null
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    if (session.payment_status !== 'paid') return { status: 200, body: { success: true, skipped: 'not-paid', jjId: id } }
    const r = await finaliseJJPayreq(id, session)
    if (r.busy || r.recorded === false) return { status: 500, body: { success: false, jjId: id, busy: Boolean(r.busy), recorded: false } }
    return { status: 200, body: { success: true, jjId: id, attention: r.attention || '' } }
  }
  if (type === 'checkout.session.expired' || type === 'checkout.session.async_payment_failed') {
    const over = session.status === 'expired' || (type === 'checkout.session.async_payment_failed' && session.payment_status !== 'paid')
    if (!over) return { status: 200, body: { success: true, skipped: 'session-not-expired', jjId: id } }
    const r = await expireJJPayreq(id, session)
    return { status: 200, body: { success: true, jjId: id, released: r.changed } }
  }
  return { status: 200, body: { success: true, ignored: type, jjId: id } }
}
