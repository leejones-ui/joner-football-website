// How a family pays, drawn the same way on Home and on Fees (Lee, 14 Oct
// 2026, round 3: "Fees is confusing, it doesn't give the options to pay that
// we built"). One component per kind of payment, each a card with one big
// amount and one primary button:
//
//   oweCard      something to pay now: a payment link staff sent (or a family
//                invoice for several children), a term fee still owing, or
//                sessions Joner Football billed. Waiver (and kit) steps first.
//   aheadBlock   session by session and Pro players: "Pay ahead and save",
//                each way to pay ahead as its own card (the next session,
//                each commitment staff quoted, the rest of the term), the
//                best value marked, the dates each one covers, and what is
//                already paid. Sessions not paid ahead are billed after.
//   depositCard  next term (only while staff have it open): keep your spot
//                with the deposit, then "Your spot is held".
//
// Amounts here are only for showing. The server works out every amount again
// from Airtable and the quote when Pay is pressed.
import { esc } from './jfp-common.js'
import { ic } from './jfp-account-icons.js'
import { first, money } from './jfp-account-ui.js'

export const BILLED_AFTER = 'Sessions you do not pay ahead are billed after they happen.'
const waiverBtn = (attr, label = 'Sign') => `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" ${attr}>${esc(label)}</button>`

// ---------- pay now ----------

// Everything to pay now for JFP, newest first, the one opened from an email first.
// pane: which page draws it, so two copies never clash.
export function oweList(D, want = '') {
  const out = []
  for (const t of [...(D.todo || [])].sort((x, y) => Number(y.id === want) - Number(x.id === want))) {
    out.push({
      key: `pay:${t.id}`, todo: t.id,
      kicker: t.reason === 'trial' ? 'Book the trial' : t.reason === 'sessions' ? 'Sessions to pay' : t.places?.length > 1 ? 'One payment for the family' : 'Finish your booking',
      who: t.players.join(' and '),
      // A family invoice lists each child and their amount; one place, just where and what.
      lines: t.places?.length > 1 ? t.places.map((x) => [x.name, x.label, x.amountLabel]) : t.places?.length === 1 ? [[t.places[0].label, '', '']] : [[t.group || 'JFP', t.what || '', '']],
      amount: t.amountLabel,
      note: `${t.reason === 'trial' ? 'Books the trial.' : t.reason === 'sessions' ? 'Pays for these sessions.' : 'Locks the place in.'} Card, Apple Pay${t.afterpay ? ' or Afterpay' : ''}.`,
      expires: t.expiresAt || '',
      waiver: t.needsWaiver ? `data-waiver-for="${esc(t.id)}"` : '',
      kit: t.needsKit ? { done: t.kit, id: t.id } : null,
      btn: `data-pay="${esc(t.id)}"`,
      blocked: t.needsWaiver ? 'Sign the waiver first' : t.needsKit && !t.kit ? 'Confirm the playing kit first' : '',
      choose: t.canChoose ? t.id : '',
    })
  }
  for (const o of (D.owed || []).filter((x) => x.kind !== 'prepay')) {
    out.push({
      key: `owed:${o.rowId}`, owed: o.rowId,
      kicker: o.kind === 'term' ? 'Term fee to pay' : 'Sessions to pay',
      who: o.player,
      lines: [[o.group, o.kind === 'term' ? D.term : 'Sessions billed by Joner Football', '']],
      amount: o.amountLabel,
      note: o.kind === 'term' ? 'Locks the place in. Card, Apple Pay or Afterpay.' : 'Card or Apple Pay.',
      waiver: o.needsWaiver ? `data-waiver-player="${esc(o.playerKey)}"` : '',
      btn: `data-owed="${esc(o.rowId)}"`,
      blocked: o.needsWaiver ? 'Sign the waiver first' : '',
    })
  }
  return out
}

// Joners Juniors, on Fees (Home keeps its own Juniors card).
export function jjOweList(D) {
  const J = D.juniors
  if (!J) return []
  const out = (J.todo || []).map((t) => ({ key: `jj:${t.id}`, kicker: 'Joners Juniors', who: t.players.join(' and '), lines: t.places?.length ? t.places.map((x) => [x.name, '', x.amountLabel]) : [[t.what || J.term, '', '']], amount: t.amountLabel, note: 'Card, Apple Pay or Google Pay.', waiver: t.needsWaiver ? `data-waiver-for="${esc(t.id)}"` : '', btn: `data-jjpay="${esc(t.id)}"`, blocked: t.needsWaiver ? 'Sign the waiver first' : '' }))
  const asked = new Set((J.todo || []).flatMap((t) => t.players))
  for (const c of J.children || []) {
    if (!c.payment?.canPay || asked.has(c.name)) continue
    out.push({ key: `jjask:${c.rowId}`, kicker: 'Joners Juniors', who: c.name, lines: [[c.className || J.term, '', '']], amount: c.payment.state === 'part' ? 'What is left' : c.payment.label.replace(/ to pay$/, ''), note: 'Card, Apple Pay or Google Pay.', btn: `data-jjask="${esc(c.rowId)}"`, blocked: '' })
  }
  return out
}

export function oweCard(x, pane = 'fees') {
  const steps = []
  if (x.waiver) steps.push(`<li class="ja-row"><span class="ja-num">1</span><div><b>Sign the waiver</b><small>Every JFP player needs one on file before paying.</small></div>${waiverBtn(x.waiver)}</li>`)
  if (x.kit) steps.push(`<li class="ja-row"><span class="ja-num ${x.kit.done ? 'done' : ''}">${x.kit.done ? ic('check') : steps.length + 1}</span><div><b>JF playing kit</b><small>${x.kit.done ? `Done: ${esc(String(x.kit.done).toLowerCase())}.` : 'Required for every player.'}</small>${x.kit.done ? '' : `<span class="ja-kit-btns"><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-kit="ordered" data-kit-for="${esc(x.kit.id)}">I have ordered it</button><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-kit="has" data-kit-for="${esc(x.kit.id)}">Already has one</button></span>`}</div><span></span></li>`)
  const attrs = pane === 'home' && x.todo ? ` data-todo="${esc(x.todo)}"` : pane === 'home' && x.owed ? ` data-todo-owed="${esc(x.owed)}"` : ''
  const lines = x.lines.filter(([a, b, c]) => a || b || c)
  return `<article class="ja-card ja-pay${pane === 'home' ? ' ja-todo' : ''}"${attrs} data-pay-card="${esc(x.key)}">
    <div class="ja-pay-top"><p class="ja-kicker"><i></i>${esc(x.kicker)}</p>${x.expires ? `<span class="ja-chip">Held until ${esc(new Date(x.expires).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}</span>` : ''}</div>
    <h3 class="ja-pay-who">${esc(x.who)}</h3>
    ${lines.length ? `<ul class="ja-pay-lines">${lines.map(([a, b, c]) => `<li><span>${esc(a)}${b ? `<small>${esc(b)}</small>` : ''}</span>${c ? `<b>${esc(c)}</b>` : ''}</li>`).join('')}</ul>` : ''}
    <p class="ja-amt"><span>${esc(x.amount)}</span> <small>to pay</small></p>
    ${steps.length ? `<ul class="ja-list ja-pay-steps">${steps.join('')}</ul>` : ''}
    <button type="button" class="ja-btn ja-btn-red ja-btn-block ja-btn-lg" ${x.btn} ${x.blocked ? `disabled title="${esc(x.blocked)}"` : ''}>${ic('lock')}Pay ${esc(x.amount)}</button>
    <p class="ja-small ja-muted ja-pay-note">${esc(x.blocked ? `${x.blocked}, then pay.` : x.note)}</p>
    ${x.choose ? `<p><button type="button" class="ja-link ja-small" data-choose-again="${esc(x.choose)}">Choose a different option</button></p>` : ''}
  </article>`
}

// ---------- pay ahead ----------

// The ways to pay ahead for one place, best value marked.
export function aheadOptions(o) {
  const list = o.quote?.options?.length
    ? o.quote.options.map((x) => ({ key: x.key, n: x.n, per: x.perCents, total: x.totalCents, save: x.saveCents || 0, commit: Boolean(x.commit), rest: Boolean(x.rest), dates: x.dates || [] }))
    : [
      { key: 'one', n: 1, per: o.perCents, total: o.perCents, save: 0, dates: o.dates.slice(0, 1) },
      ...(o.max > 2 ? [{ key: 'count', n: 2, per: o.perCents, total: 2 * o.perCents, save: 0, dates: o.dates.slice(0, 2) }] : []),
      ...(o.rest ? [{ key: 'rest', n: o.rest.n, per: o.rest.perCents, total: o.rest.totalCents, save: 0, rest: true, dates: o.dates.slice(0, o.rest.n) }] : []),
    ]
  const best = list.reduce((b, x) => (x.save > (b?.save || 0) ? x : b), null)
  return list.map((x) => ({ ...x, best: Boolean(best && x === best) }))
}
function optTitle(x) {
  if (x.key === 'one') return 'Next session'
  if (x.key === 'count') return 'Choose how many'
  if (x.commit) return x.rest ? `Rest of term, ${x.n} in a row` : `${x.n} in a row`
  return 'Rest of term'
}
function optSub(x) {
  if (x.key === 'one') return x.dates[0]?.label || ''
  if (x.key === 'count') return `${money(x.per)} a session`
  if (x.commit) return `${money(x.per)} each${x.save ? `, save ${money(x.save)}` : ''}`
  return `${x.n} sessions at ${money(x.per)}`
}
function optCard(o, x, { blocked, pane }) {
  const dis = blocked ? `disabled title="${esc(blocked)}"` : ''
  const dates = x.dates.map((d) => d.label)
  const fold = x.key !== 'one' && dates.length ? `<details class="ja-fold"><summary>${x.key === 'count' ? 'Dates' : `Dates covered (${dates.length})`}</summary><p data-count-dates>${esc(dates.join(', '))}</p></details>` : ''
  const count = x.key === 'count' ? `<label class="j-field ja-count"><span>How many sessions?</span><select class="j-select" data-owed-n="${esc(o.rowId)}" data-pane-of="${esc(pane)}">${Array.from({ length: o.max }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n} session${n > 1 ? 's' : ''}, ${esc(money(n * o.perCents))}</option>`).join('')}</select></label>` : ''
  const btn = x.key === 'count'
    ? `<button type="button" class="ja-btn ja-btn-line ja-btn-block" data-owed="${esc(o.rowId)}" data-owed-count ${dis}>Pay <span data-count-total>${esc(money(x.total))}</span></button>`
    : `<button type="button" class="ja-btn ${x.best ? 'ja-btn-red' : 'ja-btn-light'} ja-btn-block" data-owed="${esc(o.rowId)}" data-owed-option="${esc(x.key)}" ${dis}>Pay ${esc(money(x.total))}</button>`
  return `<div class="ja-opt-card${x.best ? ' is-best' : ''}" data-opt="${esc(x.key)}">
    ${x.best ? `<span class="ja-best">${ic('spark')}Best value</span>` : ''}
    <p class="ja-opt-t">${esc(optTitle(x))}</p>
    <p class="ja-opt-amt" ${x.key === 'count' ? 'data-count-total' : ''}>${esc(money(x.total))}</p>
    <p class="ja-opt-s">${esc(optSub(x))}</p>
    ${count}${fold}
    ${btn}
    ${x.commit ? '<p class="ja-opt-fine">Missed sessions are not refunded.</p>' : ''}
  </div>`
}

// What this place already has paid ahead (dates still to come).
function alreadyPaid(D, o) {
  const e = (D.players || []).flatMap((p) => p.enrolments || []).find((x) => x.rowId === o.rowId)
  const upcoming = new Set((e?.sessions || []).map((s) => s.iso))
  const label = new Map((e?.sessions || []).map((s) => [s.iso, s.label]))
  const paid = (e?.paidDates || []).filter((d) => upcoming.has(d))
  const started = (e?.openDates || []).filter((d) => upcoming.has(d))
  const out = []
  if (paid.length) out.push(`<li>${ic('check')}<span><b>Already paid: ${paid.length} session${paid.length > 1 ? 's' : ''} to come</b><small>${esc(paid.map((d) => label.get(d)).join(', '))}</small></span></li>`)
  else if (o.quote?.commitment?.left) out.push(`<li>${ic('check')}<span><b>Already paid: ${esc(o.quote.commitment.left)} committed session${o.quote.commitment.left > 1 ? 's' : ''} to come</b></span></li>`)
  if (started.length) out.push(`<li class="amber">${ic('clock')}<span><b>Payment started</b><small>${esc(started.map((d) => label.get(d)).join(', '))}. Finish it above, or choose again.</small></span></li>`)
  return out.length ? `<ul class="ja-paid-list">${out.join('')}</ul>` : ''
}

// compact (Home): the next session and the best value, then "All ways to pay".
export function aheadBlock(D, o, { pane = 'fees', compact = false } = {}) {
  const all = aheadOptions(o)
  const best = all.find((x) => x.best)
  const shown = compact ? [all[0], best || all.find((x) => x.key === 'rest')].filter((x, i, a) => x && a.indexOf(x) === i) : all
  const blocked = o.needsWaiver ? 'Sign the waiver first' : ''
  return `<article class="ja-card ja-ahead${pane === 'home' ? ' ja-todo' : ''}" ${pane === 'home' ? `data-todo-owed="${esc(o.rowId)}"` : `data-fees-owed="${esc(o.rowId)}"`}>
    <div class="ja-pay-top"><p class="ja-kicker"><i></i>${pane === 'home' ? 'Pay ahead and save' : 'Session by session'}</p></div>
    <h3 class="ja-pay-who">${esc(o.player)}</h3>
    <p class="ja-pay-sub">${esc(o.group)}</p>
    <p class="ja-upc"><b>Upcoming sessions: ${esc(o.left)} left this term at ${esc(o.perLabel)}</b><small>${esc(o.left)} session${o.left === 1 ? '' : 's'} come${o.left === 1 ? 's' : ''} to ${esc(o.leftLabel || money(o.left * o.perCents))}. ${BILLED_AFTER}</small></p>
    ${alreadyPaid(D, o)}
    ${o.needsWaiver ? `<p class="j-box j-box-amber ja-small" style="margin-top:12px">Sign the waiver first, then pay. <button type="button" class="ja-link" data-waiver-player="${esc(o.playerKey)}">Sign the waiver</button></p>` : ''}
    <div class="ja-opts-grid${shown.length === 1 ? ' one' : ''}">${shown.map((x) => optCard(o, x, { blocked, pane })).join('')}</div>
    ${compact && shown.length < all.length ? `<p style="margin-top:12px"><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-go-pay="${esc(o.rowId)}">All ways to pay ${ic('arrow')}</button></p>` : ''}
  </article>`
}

// ---------- next term deposit ----------

// Only while staff have next term open (Next term tab in the portal). One
// card per player with a place now.
export function depositCards(D, { compact = false, self = false } = {}) {
  const k = D.keep || {}
  if (!k.open || !D.nextTerm?.players?.length) return ''
  const until = k.holdUntilLabel ? `until ${k.holdUntilLabel}` : `until ${k.name} bookings open to everyone`
  return D.nextTerm.players.filter((x) => x.status !== 'no').map((x) => {
    const whose = self ? 'Your' : `${first(x.player)}'s`
    const place = x.dayTime ? `${whose} ${x.dayTime} place` : `${whose} place`
    if (x.status === 'paid') return `<article class="ja-card ja-deposit is-done" data-deposit="${esc(x.rowId)}"><p class="ja-kicker"><i></i>${esc(D.nextTerm.name)}</p><h3 class="ja-deposit-t">${ic('check')}${esc(self ? 'Your' : `${first(x.player)}'s`)} spot for ${esc(D.nextTerm.name)} is locked in</h3><p class="ja-muted">Paid in full. ${esc(x.group)}.</p></article>`
    if (x.status === 'held') return `<article class="ja-card ja-deposit is-done" data-deposit="${esc(x.rowId)}"><p class="ja-kicker"><i></i>${esc(D.nextTerm.name)}</p><h3 class="ja-deposit-t">${ic('check')}${esc(self ? 'Your' : `${first(x.player)}'s`)} spot for ${esc(D.nextTerm.name)} is held</h3><p class="ja-muted">${esc(x.group)}. Pay the rest (${esc(x.afterHoldLabel)}) when you know your schedule.</p><div class="ja-actions"><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-next="full" data-row="${esc(x.rowId)}">Pay the rest, ${esc(x.afterHoldLabel)}</button></div></article>`
    return `<article class="ja-card ja-deposit" data-deposit="${esc(x.rowId)}">
      <div class="ja-deposit-copy">
        <p class="ja-kicker"><i></i>${esc(D.nextTerm.name)} · current players first</p>
        <h3 class="ja-deposit-t">Keep your spot for ${esc(D.nextTerm.name)}</h3>
        <p class="ja-deposit-p">${esc(place)} is held for current players ${esc(until)}. Pay a ${esc(x.holdLabel)} deposit to lock it in.</p>
        ${compact ? '' : `<p class="ja-small ja-muted" style="margin-top:8px">The deposit comes off the ${esc(D.nextTerm.name)} fee and is non-refundable.${k.holdUntilLabel ? ' After that date the place can go to a family on the waitlist.' : ''}</p>`}
      </div>
      <div class="ja-deposit-pay">
        <p class="ja-amt"><span>${esc(x.holdLabel)}</span> <small>deposit</small></p>
        <button type="button" class="ja-btn ja-btn-red ja-btn-block ja-btn-lg" data-next="hold" data-row="${esc(x.rowId)}">${ic('lock')}Pay ${esc(x.holdLabel)} deposit</button>
        <p class="ja-small ja-muted" style="margin-top:10px">Or <button type="button" class="ja-link" data-next="full" data-row="${esc(x.rowId)}">pay the full term, ${esc(x.fullLabel)}</button>. Not coming back? <button type="button" class="ja-link" data-go="keep">Tell us</button>.</p>
      </div>
    </article>`
  }).join('')
}

// ---------- this term and history (Fees) ----------

const KIND = { term: 'Term fee', sessions: 'Session by session', pro: 'Pro sessions', trial: 'Trial' }

// Each place this term, with a clear "Paid in full" when it is.
export function placeCards(F, D) {
  if (!F.places.length) return ''
  const recFor = (x) => F.records.find((r) => r.players.includes(x.player) && ['JFP', 'Pro sessions'].includes(r.programme))
  return `<div class="ja-places">${F.places.map((x) => {
    const r = recFor(x)
    const full = x.kind === 'term' && x.feeCents > 0 && x.owingCents === 0
    const head = `<div class="ja-place-head"><div><b>${esc(x.player)}</b><small>${esc(KIND[x.kind] || '')} · ${esc(x.group)}</small></div>${full ? `<span class="ja-dot ok">Paid</span>` : x.kind === 'term' && x.owingCents ? `<span class="ja-dot bad">${esc(money(x.owingCents))} to pay</span>` : ''}</div>`
    if (full) {
      return `<article class="ja-card ja-place is-paid">${head}<div class="ja-paidfull">${ic('check')}<div><b>Paid in full</b><span class="ja-amt-s">${esc(x.paidLabel)}</span>${r?.dateLabel ? `<small>Paid ${esc(r.dateLabel)}${r.method ? ` · ${esc(r.method)}` : ''}</small>` : ''}</div>${r?.receiptUrl ? `<a class="ja-btn ja-btn-line ja-btn-sm" href="${esc(r.receiptUrl)}" target="_blank" rel="noopener noreferrer">${ic('receipt')}Receipt</a>` : ''}</div></article>`
    }
    const body = x.kind === 'term'
      ? `<p class="ja-small ja-muted">Paid ${esc(x.paidLabel)} of ${esc(x.feeLabel)}.${x.owingCents ? ' Pay the rest above.' : ''}</p>`
      : x.kind === 'trial' ? `<p class="ja-small ja-muted">Trial paid ${esc(x.paidLabel)}.</p>`
        : `<p class="ja-small ja-muted">Paid ${esc(x.paidLabel)} for sessions so far${x.owingCents ? `, ${esc(money(x.owingCents))} billed to pay` : ''}${x.prepaidSessions ? `. ${esc(x.prepaidSessions)} session${x.prepaidSessions > 1 ? 's' : ''} paid ahead` : ''}.</p>${x.commitment ? `<p class="ja-small ja-muted">Committed to ${esc(x.commitment.sessions)} sessions, ${esc(x.commitment.left)} to come${x.commitment.leftDates.length ? `: ${esc(x.commitment.leftDates.join(', '))}` : ''}.</p>` : ''}`
    return `<article class="ja-card ja-place">${head}${body}</article>`
  }).join('')}</div>`
}

export function historyCard(F) {
  const totals = F.totals.length ? `<p class="ja-hist-total"><b>${esc(F.paidLabel)}</b> paid so far${F.totals.length > 1 ? `: ${F.totals.map((t) => `${esc(t.label)} ${esc(t.amountLabel)}`).join(' · ')}` : ''}</p>` : ''
  return `<div class="ja-card">${totals}${F.records.length
    ? `<ul class="ja-hist">${F.records.map((r) => `<li data-fee-record><span class="ja-hist-ic">${ic(r.method === 'Cash' || r.method === 'Bank transfer' ? 'check' : 'card')}</span><div><b>${esc(r.what)}${r.players.length ? `, ${esc(r.players.join(' and '))}` : ''}</b><small>${esc(r.dateLabel || 'Date not recorded')} · ${esc(r.programme)} · ${esc(r.method)}${r.refundedLabel ? ` · ${esc(r.refundedLabel)} refunded` : ''}</small></div><span class="ja-hist-amt">${esc(r.amountLabel)}${r.receiptUrl ? `<a class="ja-link ja-small" href="${esc(r.receiptUrl)}" target="_blank" rel="noopener noreferrer">Receipt</a>` : ''}</span></li>`).join('')}</ul>`
    : '<p class="ja-small ja-muted">No payments yet.</p>'}
    <p class="ja-small ja-muted" style="margin-top:14px">Card payments show Stripe's receipt where Stripe has one. Cash and bank transfers show once Joner Football records them. Something missing? <button type="button" class="ja-link" data-go="contact">Contact us</button></p></div>`
}
