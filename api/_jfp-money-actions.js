// Money actions for player charges, invoices and Match to player (Lee and
// Ligia, 14 Oct 2026). Admin only: jfp-portal-data.js checks the role, then
// hands these actions here with the helpers they share with Money > JFP
// (recordPaymentCore and the bank line guards), so a bank line or a Stripe
// payment is guarded exactly the same way wherever it is recorded.
import { siteUrl, getConfig as getHolidayConfig } from './_holiday-store.js'
import { clean, formatAud, audit, newId, sydneyToday, savePayreq, getPayreq, kvCommand, locationFor } from './_jfp-store.js'
import { getTerm4Row, updateTerm4Rows, appendNote, listLedger, loadRoster } from './_jfp-airtable.js'
import { isPeriodId, periodOf as holidayPeriodOf, periodLabel, pickablePeriods, rangeLabel, suggestPeriod, OTHER, OTHER_LABEL } from './_holiday-periods.js'
import { isProRow } from './_jfp-pro-money.js'
import { STRIPE_CLASS, STRIPE_PAY_ID, CLASS_LABEL, getStripeClass } from './_jfp-stripe-class.js'
import { syncRowLinks } from './_jfp-fee-sync.js'
import { jfpStripePayments } from './_jfp-stripe.js'
import { createPlayerCharge, recordChargePayment, cancelCharge, chargeFromStripe, extraMoneyData, getCharge, chargeView } from './_jfp-charges.js'
import { invoiceInput, newInvoice, getInvoice, saveInvoice, listInvoices, viewedMap, withInvoice, addInvoicePayment, settleInvoicePayreq, rowInvoicePayreq, publicInvoice, invoiceRow, invoiceUrl, owingOf, paidOf, ROW_PROGRAMMES, INVOICE_STATUS } from './_jfp-invoices.js'
import { listMatches, listRules, matchInput, rememberKey, saveMatch, saveRule, dropRule, silenceFlag } from './_jfp-stripe-match.js'
import { invoiceEmail, sendInvoiceEmail } from './_jfp-email.js'
import { invoicePdfAttachment } from './_jfp-fee-pdf.js'

export const MONEY_ACTIONS = new Set(['stripeClassOptions', 'stripeHoliday', 'stripeHolidayUndo', 'stripePro', 'stripeProUndo', 'stripeNotJfp', 'stripeNotJfpUndo', 'stripeMatch', 'stripeMatchRules', 'stripeMatchForget', 'extraMoney', 'createCharge', 'chargeRecord', 'chargeCancel', 'invoiceList', 'invoiceGet', 'invoiceSave', 'invoiceEmailPreview', 'invoiceSend', 'invoiceVoid', 'invoicePay', 'bankInvoice'])
const ISO = /^\d{4}-\d{2}-\d{2}$/
const fail = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra })
const refuse = (res, r) => fail(res, r.status || 400, r.error, r.code ? { code: r.code } : {})

// ---------- Match to player ----------

// Put one Stripe payment on the player(s): their term fee (as) 'jfp', or a
// paid Extra sessions charge ('extra'). Used by staff and by the Stripe sync
// for a remembered link or email. { ok, ... } or { ok: false, status, error }.
export async function applyStripeMatch({ config, principal, payment: p, rows, as, label = '', rule = '', existing = false, recordPaymentCore }) {
  if (as === 'extra' && rows.length !== 1) return { ok: false, status: 400, error: 'An extra session is for one player.' }
  let chargeId = ''
  if (as === 'jfp') {
    const r = await recordPaymentCore(principal, config, { rowIds: rows.map((x) => x.id), method: 'Stripe', stripeSessionId: p.id, existing })
    if (!r.ok) return r
  } else {
    const r = await chargeFromStripe({ config, principal, payment: p, row: rows[0], label, ref: `stripe:${p.id}` })
    if (!r.ok) return r
    chargeId = r.charge.id
  }
  await saveMatch({ id: p.id, intentId: p.intentId || '', rowIds: rows.map((x) => x.id), players: rows.map((x) => x.player), as, by: principal.email, at: new Date().toISOString(), cents: p.amountCents - (p.refundedCents || 0), ...(rule ? { rule } : {}), ...(chargeId ? { chargeId } : {}) })
  await silenceFlag(p.id)
  await audit({ by: principal.email, action: 'stripe.match', target: p.id, after: { rows: rows.map((x) => x.id), as, rule, chargeId } })
  return { ok: true, chargeId }
}

async function stripeMatch(res, principal, config, body, deps) {
  const m = matchInput(body)
  if (!m.paymentId) return fail(res, 400, 'Choose the Stripe payment.')
  if (!m.rowIds.length) return fail(res, 400, 'Choose the player it was for.')
  const all = await jfpStripePayments({ since: config.moneySince, fresh: true, term: config.term })
  const p = [...all.payments, ...(all.next || []), ...(all.pro || [])].find((x) => x.id === m.paymentId)
  if (!p) return fail(res, 404, 'That Stripe payment was not found.')
  if ((await listMatches())[p.id]) return fail(res, 409, 'That payment is already matched.')
  const rows = []
  for (const id of m.rowIds) { const r = await getTerm4Row(id); if (!r) return fail(res, 404, 'Player row not found.'); rows.push(r) }
  const key = rememberKey(p, m.remember)
  if (m.remember && !key) return fail(res, 400, m.remember === 'link' ? 'This payment did not come through a Stripe payment link, so there is no link to remember. Remember the email instead.' : 'This payment has no email to remember.')
  const r = await applyStripeMatch({ config, principal, payment: p, rows, as: m.as, label: m.label, existing: body.existing === true, recordPaymentCore: deps.recordPaymentCore })
  if (!r.ok) return refuse(res, r)
  if (key) await saveRule(key, { rowIds: rows.map((x) => x.id), players: rows.map((x) => x.player), as: m.as, by: principal.email, at: new Date().toISOString(), from: p.id, ...(m.label ? { label: m.label } : {}) })
  return res.status(200).json({ success: true, as: m.as, remembered: key, chargeId: r.chargeId || '' })
}

// The remembered links and emails, so staff can see and forget them.
async function matchRules(res) {
  const rules = await listRules()
  return res.status(200).json({ success: true, rules: Object.entries(rules).map(([k, r]) => ({ key: k, kind: k.split(':')[0], value: k.slice(k.indexOf(':') + 1), players: r.players, as: r.as, by: r.by, at: r.at })) })
}
async function matchForget(res, principal, body) {
  const k = clean(body.key, 200)
  if (!/^(link|email):/.test(k)) return fail(res, 400, 'That is not a remembered link or email.')
  await dropRule(k)
  await audit({ by: principal.email, action: 'stripe.matchForget', target: k })
  return res.status(200).json({ success: true })
}

// ---------- a Stripe payment that is not JFP term income (Lee, 18 Oct 2026) ----------
// The Stripe twin of the bank line buttons: Holiday training (the same
// questions as bankHoliday), Pro sessions and Not JFP. Stored in
// jfp:stripe-class (_jfp-stripe-class.js) with the payment's Stripe fee.
// Classification only: no money moves, nothing is written to Airtable, so
// Hermes may do it as well as Lee and Ligia.

// What the modal asks: the holidays, coaches and locations bankHoliday takes,
// the Pro players, and the holiday a payment on this date most likely paid for.
async function stripeClassOptions(res, config, body) {
  const [hc, roster] = await Promise.all([getHolidayConfig().catch(() => ({ coaches: [] })), loadRoster().catch(() => ({ players: [] }))])
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : ''
  return res.status(200).json({
    success: true,
    holiday: {
      periods: [...pickablePeriods(sydneyToday()).map((p) => ({ id: p.id, label: p.label, range: rangeLabel(p) })), { id: OTHER, label: OTHER_LABEL, range: '' }],
      coaches: (hc.coaches || []).slice().sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name })),
      locations: config.locations.map((l) => l.name), defaultLocation: locationFor(config, 'Belrose HQ').name,
      suggested: suggestPeriod(date),
    },
    pro: { players: roster.players.filter((r) => isProRow(r.paymentType) && r.holdsPlace).map((r) => ({ rowId: r.id, player: r.player })).sort((a, b) => a.player.localeCompare(b.player)) },
  })
}

// The questions for each kind, checked as bankHoliday and bankPro check them.
async function classFields(kind, config, body) {
  const sessionDate = clean(body.sessionDate, 10)
  if (sessionDate && !ISO.test(sessionDate)) return { status: 400, error: 'The session date does not look right.' }
  const note = clean(body.note, 200)
  if (kind === 'holiday') {
    const period = clean(body.period, 20)
    if (!isPeriodId(period)) return { status: 400, error: 'Pick the school holiday it was for, or Other dates.' }
    if (sessionDate && period !== OTHER && holidayPeriodOf(sessionDate) !== period) return { status: 400, error: `That session date is not in the ${periodLabel(period)}. Pick the right holiday, or leave the date blank.` }
    const hc = await getHolidayConfig()
    const coachIn = clean(body.coach, 60).toLowerCase()
    const coach = coachIn ? hc.coaches.find((c) => c.id === coachIn || c.name.toLowerCase() === coachIn) : null
    if (coachIn && !coach) return { status: 400, error: 'Pick a coach from the list, or leave it blank.' }
    const locIn = clean(body.location, 80).toLowerCase() || 'belrose'
    const loc = config.locations.find((l) => l.id === locIn || l.name.toLowerCase() === locIn)
    if (!loc) return { status: 400, error: 'Pick a location from the list.' }
    return { fields: { period, sessionDate, coach: coach?.name || '', location: loc.name, note } }
  }
  if (kind === 'pro') {
    const rowId = clean(body.rowId, 30)
    let player = null
    if (rowId) {
      const r = (await loadRoster()).players.find((x) => x.id === rowId)
      if (!r || !isProRow(r.paymentType)) return { status: 400, error: 'Pick a Pro player from the list, or leave it blank.' }
      player = r
    }
    return { fields: { sessionDate, rowId: player?.id || '', player: player?.player || '', note } }
  }
  return { fields: { note } }
}

const already = (kind) => `That Stripe payment is already marked as ${CLASS_LABEL[kind]}.`
async function stripeClassify(res, principal, config, body, kind) {
  const id = clean(body.id, 220)
  if (!STRIPE_PAY_ID.test(id)) return fail(res, 400, 'Choose the Stripe payment.')
  const f = await classFields(kind, config, body)
  if (f.error) return refuse(res, f)
  // Twice is nothing new: the same answer again, no second audit entry.
  const had = await getStripeClass(id)
  if (had) return had.kind === kind ? res.status(200).json({ success: true, already: true, line: had }) : fail(res, 409, already(had.kind))
  if ((await kvCommand(['SET', `jfp:paylock:${id}`, '1', 'NX', 'EX', '20'])) !== 'OK') return fail(res, 409, 'That Stripe payment is being saved just now. Refresh to check.')
  try {
    const all = await jfpStripePayments({ since: config.moneySince, fresh: true, term: config.term })
    const p = [...all.payments, ...(all.next || [])].find((x) => x.id === id)
    if (!p) return fail(res, (all.pro || []).some((x) => x.id === id) ? 409 : 404, (all.pro || []).some((x) => x.id === id) ? 'That Stripe payment is already Pro sessions money.' : 'That Stripe payment was not found in JFP payments.')
    if ((await listMatches())[p.id]) return fail(res, 409, 'That Stripe payment is matched to a player. It cannot be marked as well.')
    const ledger = await listLedger(config.term)
    if (ledger.some((l) => [l['Payment ID'], l['Stripe Checkout Session ID'], l['Stripe Payment Intent ID']].some((v) => v && (v === p.id || (p.intentId && v === p.intentId))))) return fail(res, 409, 'That Stripe payment is already recorded for a player.')
    const rec = {
      id: p.id, intentId: p.intentId || '', kind, cents: p.amountCents, refundedCents: p.refundedCents || 0,
      feeCents: p.feeKnown ? p.feeCents || 0 : null, feeGstCents: p.feeKnown ? p.feeGstCents || 0 : null, feeKnown: Boolean(p.feeKnown), payMethod: p.payMethod || '',
      date: sydneyToday(Date.parse(p.at)), payer: p.name || '', email: p.email || '', product: p.product || '', linkId: p.linkId || '',
      ...f.fields, by: principal.email, at: new Date().toISOString(),
    }
    if (Number(await kvCommand(['HSETNX', STRIPE_CLASS, id, JSON.stringify(rec)])) !== 1) {
      const now = await getStripeClass(id)
      return now?.kind === kind ? res.status(200).json({ success: true, already: true, line: now }) : fail(res, 409, already(now?.kind || kind))
    }
    // Not flagged on Telegram as "not matched to a player" any more.
    await silenceFlag(p.id).catch(() => {})
    await audit({ by: principal.email, action: `money.stripe${kind[0].toUpperCase()}${kind.slice(1)}`, target: id, after: { cents: rec.cents, feeCents: rec.feeCents, date: rec.date, ...f.fields } })
    return res.status(200).json({ success: true, line: rec, ...(kind === 'holiday' ? { periodLabel: periodLabel(rec.period) } : {}) })
  } finally { await kvCommand(['DEL', `jfp:paylock:${id}`]).catch(() => {}) }
}
// Back to JFP payments (Unmatched Stripe, if no family email is on a row).
async function stripeUnclassify(res, principal, body, kind) {
  const id = clean(body.id, 220)
  if (!STRIPE_PAY_ID.test(id)) return fail(res, 400, 'Choose the Stripe payment.')
  const had = await getStripeClass(id)
  if (!had) return fail(res, 404, `That Stripe payment is not marked as ${CLASS_LABEL[kind]}.`)
  if (had.kind !== kind) return fail(res, 409, `That Stripe payment is marked as ${CLASS_LABEL[had.kind]}, not ${CLASS_LABEL[kind]}.`)
  await kvCommand(['HDEL', STRIPE_CLASS, id])
  await audit({ by: principal.email, action: `money.stripe${kind[0].toUpperCase()}${kind.slice(1)}Undo`, target: id, before: { cents: had.cents, date: had.date, ...(had.period ? { period: had.period } : {}) } })
  return res.status(200).json({ success: true, id })
}

// ---------- charges (Money > Extra sessions) ----------

async function createCharge(req, res, principal, config, body) {
  const r = await createPlayerCharge({ config, principal, rowId: body.rowId, profileKey: body.profileKey, email: body.email, playerName: body.playerName, amountCents: Number(body.amountCents), label: body.label, kind: body.kind || 'extra', sessionDate: body.sessionDate, coachId: body.coachId, groupId: body.groupId, ref: body.ref ? `staff:${clean(body.ref, 80)}` : '', note: body.note, siteUrl: siteUrl(req), notifyFamily: true })
  if (!r.ok) return refuse(res, r)
  return res.status(200).json({ success: true, emailed: r.emailed === true, existing: r.existing, charge: chargeView(r.charge), payreqId: r.payreqId, accountUrl: `${siteUrl(req)}/jfp-account/?pay=${encodeURIComponent(r.payreqId)}` })
}

// ---------- invoices ----------

async function rowsFor(ids) {
  const rows = []
  for (const id of [...new Set((Array.isArray(ids) ? ids : []).map((x) => clean(x, 30)).filter(Boolean))].slice(0, 6)) {
    const r = await getTerm4Row(id)
    if (!r) return { error: 'A player row was not found in Airtable. Refresh and try again.' }
    rows.push(r)
  }
  return { rows }
}

async function invoiceList(req, res) {
  const [all, viewed] = await Promise.all([listInvoices(), viewedMap()])
  const list = all.map((inv) => invoiceRow(inv, { viewedAt: viewed[inv.id] || '', base: siteUrl(req) }))
  const counts = Object.fromEntries(Object.keys(INVOICE_STATUS).map((k) => [k, list.filter((x) => x.status === k).length]))
  return res.status(200).json({ success: true, invoices: list, counts: { ...counts, overdue: list.filter((x) => x.overdue).length, all: list.length }, owingCents: list.reduce((t, x) => t + x.owingCents, 0) })
}

async function invoiceDetail(req, config, inv) {
  const viewed = (await viewedMap())[inv.id] || ''
  const view = publicInvoice(inv, config, { viewedAt: viewed })
  return { invoice: invoiceRow(inv, { viewedAt: viewed, base: siteUrl(req) }), view, email: { to: inv.email, ...invoiceEmail({ view, url: invoiceUrl(siteUrl(req), inv) }) } }
}

async function invoiceSave(req, res, principal, config, body) {
  const got = await rowsFor(body.rowIds)
  if (got.error) return fail(res, 404, got.error)
  const r = invoiceInput(body, { rows: got.rows })
  if (!r.ok) return refuse(res, r)
  if (body.id) {
    const out = await withInvoice(clean(body.id, 20), async (inv) => {
      if (inv.issuedAt || inv.voidedAt) return { ok: false, status: 409, error: 'This invoice has been sent, so it cannot be changed. Void it and make a new one.' }
      const next = { ...inv, ...r.v, updatedAt: new Date().toISOString(), updatedBy: principal.email }
      await saveInvoice(next)
      return { ok: true, invoice: next }
    })
    if (!out.ok) return refuse(res, out)
    await audit({ by: principal.email, action: 'invoice.save', target: out.invoice.id, after: { cents: out.invoice.totalCents, programme: out.invoice.programme } })
    return res.status(200).json({ success: true, ...(await invoiceDetail(req, config, out.invoice)) })
  }
  const inv = await newInvoice(r.v, principal)
  await audit({ by: principal.email, action: 'invoice.create', target: inv.id, after: { cents: inv.totalCents, programme: inv.programme, rows: inv.players.map((p) => p.rowId).filter(Boolean) } })
  return res.status(200).json({ success: true, ...(await invoiceDetail(req, config, inv)) })
}

// Issued once: the payment request the family pays (in My account and on the
// invoice page). JFP and Pro invoices name the rows; the rest are charges.
async function issue(req, principal, config, inv) {
  if (inv.issuedAt) return { ok: true, invoice: inv }
  if (ROW_PROGRAMMES.has(inv.programme)) {
    // The invoice is what the family owes for the place: when the rows owe
    // less (nothing billed yet, or more sessions), the last row's fee goes up
    // by the difference, so Money, the balance and the ledger agree. A void
    // puts it back.
    const rows = []
    for (const p of inv.players.filter((x) => x.rowId)) { const r = await getTerm4Row(p.rowId); if (!r) return { ok: false, status: 404, error: `${p.name}'s row is not in Airtable any more.` }; rows.push(r) }
    const c = (aud) => (typeof aud === 'number' ? Math.round(aud * 100) : 0)
    const owing = rows.reduce((t, r) => t + Math.max(0, c(r.feeAud) - c(r.paidAud)), 0)
    let feeRaised = null
    if (owing < inv.totalCents && rows.length) {
      const r = rows.at(-1)
      const diff = inv.totalCents - owing
      const fee = Math.max(c(r.feeAud), c(r.paidAud)) + diff
      await updateTerm4Rows([{ id: r.id, fields: { 'Term 4 Fee': fee / 100, 'Term 4 Payment Status': c(r.paidAud) > 0 ? 'Partially Paid' : 'Unpaid', 'Term 4 Notes': appendNote(r.notes, `Invoice ${inv.id} by ${principal.name || principal.email}: ${formatAud(diff)} added to the fee (the invoice is ${formatAud(inv.totalCents)}).`) } }])
      feeRaised = { rowId: r.id, cents: diff, before: { fee: r.feeAud ?? 0, status: r.paymentStatus || 'Unpaid' } }
    }
    const q = rowInvoicePayreq(inv, { principal, siteUrl: siteUrl(req), id: newId('PAY') })
    await savePayreq(q)
    // Another open link on these rows now asks for less: the invoice holds this part (_jfp-fee-sync.js).
    await syncRowLinks(rows.map((r) => r.id), { by: principal.email, why: `invoice ${inv.id} issued` })
    return { ok: true, invoice: { ...inv, payreqId: q.id, issuedAt: new Date().toISOString(), ...(feeRaised ? { feeRaised } : {}) } }
  }
  const c = await createPlayerCharge({ config, principal, kind: 'invoice', programme: inv.programme, rowId: inv.players[0]?.rowId || '', email: inv.email, playerName: inv.players.map((p) => p.name).join(' and '), parentName: inv.parentName, amountCents: inv.totalCents, label: `Invoice ${inv.id}`, ref: `invoice:${inv.id}`, invoiceId: inv.id, siteUrl: siteUrl(req) })
  if (!c.ok) return c
  return { ok: true, invoice: { ...inv, payreqId: c.payreqId, chargeId: c.charge.id, issuedAt: new Date().toISOString() } }
}

async function invoiceSend(req, res, principal, config, body) {
  const id = clean(body.id, 20)
  const out = await withInvoice(id, async (inv) => {
    if (inv.voidedAt) return { ok: false, status: 409, error: 'This invoice is void.' }
    const r = await issue(req, principal, config, inv)
    if (!r.ok) return r
    await saveInvoice(r.invoice)
    return { ok: true, invoice: r.invoice }
  })
  if (!out.ok) return refuse(res, out)
  let inv = out.invoice
  let emailed = false, emailError = '', pdfWarning = ''
  if (body.sendEmail === true) {
    if ((await kvCommand(['SET', `jfp:invoice-email-lock:${inv.id}`, '1', 'NX', 'EX', '30'])) !== 'OK') return fail(res, 409, 'It was just emailed. Wait a moment before sending it again.')
    try {
      // The PDF tax invoice rides along; if it cannot be made the email still goes.
      const pdf = await invoicePdfAttachment(inv, config, siteUrl(req))
      await sendInvoiceEmail({ to: inv.email, name: inv.parentName, view: publicInvoice(inv, config), url: invoiceUrl(siteUrl(req), inv), attachment: pdf.attachment })
      emailed = true
      pdfWarning = pdf.pdfWarning || ''
      const saved = await withInvoice(inv.id, async (x) => { const next = { ...x, emailedAt: new Date().toISOString(), emailCount: (x.emailCount || 0) + 1 }; await saveInvoice(next); return { ok: true, invoice: next } })
      if (saved.ok) inv = saved.invoice
    } catch (error) { emailError = `The invoice is ready, but the email to ${inv.email} did not send. ${String(error.message || error).slice(0, 160)} Copy the link and send it yourself.` }
    await kvCommand(['DEL', `jfp:invoice-email-lock:${inv.id}`]).catch(() => {})
  }
  await audit({ by: principal.email, action: 'invoice.send', target: inv.id, after: { emailed, payreq: inv.payreqId } })
  return res.status(200).json({ success: true, emailed, emailTo: emailed ? inv.email : '', emailError, pdfWarning, ...(await invoiceDetail(req, config, inv)) })
}

async function invoiceVoid(req, res, principal, config, body) {
  const out = await withInvoice(clean(body.id, 20), async (inv) => {
    if (inv.voidedAt) return { ok: true, invoice: inv }
    if (paidOf(inv) > 0) return { ok: false, status: 409, error: 'Money has come in on this invoice, so it cannot be voided. Refunds are made in Stripe.' }
    const q = inv.payreqId ? await getPayreq(inv.payreqId) : null
    if (q?.status === 'paid') return { ok: false, status: 409, error: 'This invoice has just been paid.' }
    if (inv.chargeId) { const c = await cancelCharge({ id: inv.chargeId, principal, why: `Invoice ${inv.id} void` }); if (!c.ok) return c }
    const next = { ...inv, voidedAt: new Date().toISOString(), voidedBy: principal.email, voidReason: clean(body.why, 200) }
    await saveInvoice(next)
    // What the invoice added to a row's fee comes off again.
    if (inv.feeRaised) {
      const r = await getTerm4Row(inv.feeRaised.rowId)
      if (r) await updateTerm4Rows([{ id: r.id, fields: { 'Term 4 Fee': inv.feeRaised.before.fee, 'Term 4 Payment Status': inv.feeRaised.before.status, 'Term 4 Notes': appendNote(r.notes, `Invoice ${inv.id} void by ${principal.name || principal.email}: the ${formatAud(inv.feeRaised.cents)} it added to the fee is taken off.`) } }]).catch((error) => console.error('jfp invoice void fee failed', error))
    }
    if (!inv.chargeId) { const s = await settleInvoicePayreq(next); if (!s.ok) return { ok: false, status: 409, error: s.error } }
    // The fee is back as it was: any other open link on the rows follows it.
    const voidRows = inv.players.map((p) => p.rowId).filter(Boolean)
    if (voidRows.length) await syncRowLinks(voidRows, { by: principal.email, why: `invoice ${inv.id} void` })
    return { ok: true, invoice: next }
  })
  if (!out.ok) return refuse(res, out)
  await audit({ by: principal.email, action: 'invoice.void', target: out.invoice.id })
  return res.status(200).json({ success: true, ...(await invoiceDetail(req, config, out.invoice)) })
}

// A payment on an invoice that did not come by card: on the rows (JFP, Pro)
// through recordPaymentCore with every guard, or on the charge. bankLine: a
// line from Bank transfers to check (its id is the ledger Payment ID).
async function payInvoice({ principal, config, inv, method, cents, date, note, bankLine = null, confirmTwin = false, deps }) {
  const owing = owingOf(inv)
  if (inv.voidedAt) return { ok: false, status: 409, error: 'This invoice is void.' }
  if (!inv.issuedAt) return { ok: false, status: 409, error: 'Send the invoice (or mark it ready) before recording a payment.' }
  if (owing <= 0) return { ok: false, status: 409, error: 'This invoice is already paid.' }
  if (!Number.isInteger(cents) || cents <= 0 || cents > owing) return { ok: false, status: 400, error: `Enter the amount, up to the ${formatAud(owing)} still owing on ${inv.id}.` }
  const words = `Invoice ${inv.id}${note ? `. ${note}` : ''}`
  let paymentId = ''
  if (ROW_PROGRAMMES.has(inv.programme)) {
    const r = await deps.recordPaymentCore(principal, config, { rowIds: inv.players.map((p) => p.rowId).filter(Boolean), amountCents: cents, method: bankLine ? 'bank' : method, date: bankLine ? bankLine.date : date, note: words, ...(bankLine ? { externalId: bankLine.id, confirmTwin } : {}) })
    if (!r.ok) return r
    paymentId = bankLine?.id || newId(method === 'cash' ? 'CASH' : 'BANK')
  } else {
    if (bankLine) {
      const g = await deps.bankGuard(bankLine.id, bankLine, { confirmTwin })
      if (g.error) return { ok: false, status: g.status, error: g.error, code: g.code }
      try {
        const claimed = { ...g.line, kind: 'invoice', invoiceId: inv.id }
        if ((await kvCommand(['SET', deps.bankClaim(bankLine.id), JSON.stringify(claimed), 'NX'])) !== 'OK') return { ok: false, status: 409, error: 'That bank transfer is already recorded.' }
        const r = await recordChargePayment({ id: inv.chargeId, method: 'bank', amountCents: cents, date: bankLine.date, note: words, principal, paymentId: bankLine.id })
        if (!r.ok) { await kvCommand(['DEL', deps.bankClaim(bankLine.id)]).catch(() => {}); return r }
        await kvCommand(['HSET', deps.BANK.recorded, bankLine.id, JSON.stringify(claimed)]).catch((error) => console.error('jfp bank recorded list failed', error))
      } finally { await kvCommand(['DEL', `jfp:paylock:${bankLine.id}`]).catch(() => {}) }
      paymentId = bankLine.id
    } else {
      paymentId = newId(method === 'cash' ? 'CASH' : method === 'bank' ? 'BANK' : 'OFF')
      const r = await recordChargePayment({ id: inv.chargeId, method, amountCents: cents, date, note: words, principal, paymentId })
      if (!r.ok) return r
    }
  }
  const a = await addInvoicePayment(inv.id, { id: paymentId, method: bankLine ? 'bank' : method, cents, date: bankLine ? bankLine.date : date, by: principal.email, note: clean(note, 200) })
  if (!a.ok) return a
  // Charges settle their own request; a row invoice's request asks for the rest.
  if (!inv.chargeId) await settleInvoicePayreq(a.invoice)
  await audit({ by: principal.email, action: 'invoice.payment', target: inv.id, after: { method: bankLine ? 'bank' : method, cents, bank: bankLine?.id || '' } })
  return { ok: true, invoice: a.invoice }
}

async function invoicePay(req, res, principal, config, body, deps) {
  const inv = await getInvoice(clean(body.id, 20))
  if (!inv) return fail(res, 404, 'Invoice not found.')
  const method = ['bank', 'cash', 'other'].includes(body.method) ? body.method : ''
  if (!method) return fail(res, 400, 'How was it paid: bank transfer, cash or other?')
  const date = ISO.test(body.date || '') ? body.date : sydneyToday()
  if (date > sydneyToday()) return fail(res, 400, 'The payment date cannot be in the future.')
  const cents = body.amountCents == null || body.amountCents === '' ? owingOf(inv) : Number(body.amountCents)
  const r = await payInvoice({ principal, config, inv, method, cents, date, note: clean(body.note, 200), deps })
  if (!r.ok) return refuse(res, r)
  return res.status(200).json({ success: true, ...(await invoiceDetail(req, config, r.invoice)) })
}

// Bank transfers to check > "Invoice": the line, by the invoice number in its reference.
async function bankInvoice(req, res, principal, config, body, deps) {
  const inv = await getInvoice(clean(body.invoiceId, 20))
  if (!inv) return fail(res, 404, 'Invoice not found.')
  const found = await deps.bankLineFor(String(body.id || ''))
  if (found.error) return refuse(res, found)
  const line = { id: String(body.id), date: found.seen.date, cents: found.seen.cents, payer: found.seen.payer || '' }
  const cents = body.amountCents == null || body.amountCents === '' ? Math.min(line.cents, owingOf(inv)) : Number(body.amountCents)
  if (cents > line.cents) return fail(res, 400, `Only ${formatAud(line.cents)} came in on that transfer.`)
  const r = await payInvoice({ principal, config, inv, method: 'bank', cents, date: line.date, note: `Bank transfer from ${line.payer || 'the bank'} matched by the invoice reference`, bankLine: line, confirmTwin: body.confirmTwin === true, deps })
  if (!r.ok) return refuse(res, r)
  return res.status(200).json({ success: true, invoice: invoiceRow(r.invoice, { base: siteUrl(req) }) })
}

export async function moneyAction(req, res, principal, config, body, action, deps) {
  switch (action) {
    case 'stripeClassOptions': return stripeClassOptions(res, config, body)
    case 'stripeHoliday': return stripeClassify(res, principal, config, body, 'holiday')
    case 'stripeHolidayUndo': return stripeUnclassify(res, principal, body, 'holiday')
    case 'stripePro': return stripeClassify(res, principal, config, body, 'pro')
    case 'stripeProUndo': return stripeUnclassify(res, principal, body, 'pro')
    case 'stripeNotJfp': return stripeClassify(res, principal, config, body, 'notJfp')
    case 'stripeNotJfpUndo': return stripeUnclassify(res, principal, body, 'notJfp')
    case 'stripeMatch': return stripeMatch(res, principal, config, body, deps)
    case 'stripeMatchRules': return matchRules(res)
    case 'stripeMatchForget': return matchForget(res, principal, body)
    case 'extraMoney': return res.status(200).json({ success: true, extra: await extraMoneyData({ month: /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : '' }) })
    case 'createCharge': return createCharge(req, res, principal, config, body)
    case 'chargeRecord': {
      const r = await recordChargePayment({ id: clean(body.id, 60), method: body.method, amountCents: body.amountCents, date: clean(body.date, 10), note: body.note, principal })
      if (!r.ok) return refuse(res, r)
      // A charge an invoice made: the invoice gets the payment too.
      if (r.charge.invoiceId) { const p = r.charge.payments.at(-1); await addInvoicePayment(r.charge.invoiceId, { id: p.id, method: p.method, cents: p.cents, date: p.date, by: principal.email }) }
      return res.status(200).json({ success: true, charge: chargeView(r.charge), ...(r.warning ? { warning: r.warning } : {}) })
    }
    case 'chargeCancel': {
      const c = await getCharge(clean(body.id, 60))
      if (c?.invoiceId) return fail(res, 400, `This charge is invoice ${c.invoiceId}. Void the invoice instead.`)
      const r = await cancelCharge({ id: clean(body.id, 60), principal, why: body.why })
      return r.ok ? res.status(200).json({ success: true, charge: chargeView(r.charge) }) : refuse(res, r)
    }
    case 'invoiceList': return invoiceList(req, res)
    case 'invoiceGet': case 'invoiceEmailPreview': {
      const inv = await getInvoice(clean(body.id, 20))
      return inv ? res.status(200).json({ success: true, ...(await invoiceDetail(req, config, inv)) }) : fail(res, 404, 'Invoice not found.')
    }
    case 'invoiceSave': return invoiceSave(req, res, principal, config, body)
    case 'invoiceSend': return invoiceSend(req, res, principal, config, body)
    case 'invoiceVoid': return invoiceVoid(req, res, principal, config, body)
    case 'invoicePay': return invoicePay(req, res, principal, config, body, deps)
    case 'bankInvoice': return bankInvoice(req, res, principal, config, body, deps)
    default: return fail(res, 400, 'Unknown action')
  }
}

