// Money: earlier terms and whole years (Lee, 12 Oct 2026: "I would love to
// have a drop down tab on Money so I can look at previous years, using the
// Money Register spreadsheet as a guide").
//
// Showing, at the top of Money, picks this term (the Money tab as it was),
// an earlier term or a whole year. An earlier term is read only: what came
// in, by venue and by session like the register, with Lee's typed totals
// beside the payments listed. A year adds its terms up (worked out on the
// server, action moneyYear), by venue, against the year before. Nothing here
// records or changes a payment.
import { esc, money } from './jfp-common.js'

const KIND = [['stripe', 'Stripe', '--c-series-1'], ['bank', 'Bank transfer', '--c-series-2'], ['cash', 'Cash', '--c-series-3'], ['other', 'Other or not noted', '--c-neutral']]
const yearOf = (t) => Number(/(\d{4})\s*$/.exec(t || '')?.[1]) || 0
const termNo = (t) => Number(/term\s*(\d)/i.exec(t || '')?.[1]) || 0
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const joinAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const sum = (list, f) => list.reduce((t, x) => t + (f(x) || 0), 0)

// "Terms 1 to 3", "Terms 1 and 2", "Term 4": terms of one year, plainly.
export function termsText(names) {
  const list = names.filter(Boolean)
  if (new Set(list.map(yearOf)).size > 1) return joinAnd(list)
  const ns = list.map(termNo).sort((a, b) => a - b)
  if (ns.length <= 1) return ns.length ? `Term ${ns[0]}` : ''
  const run = ns.length > 2 && ns.every((n, i) => !i || n === ns[i - 1] + 1)
  return run ? `Terms ${ns[0]} to ${ns.at(-1)}` : `Terms ${joinAnd(ns.map(String))}`
}
const pctText = (p) => (p == null ? '' : p && Math.abs(p) < 1 ? 'under 1%' : `${Math.round(Math.abs(p))}%`)
// "Up A$1,200 (4%) on 2025"
export function changeText(c, vs) {
  if (!c.diffCents) return `The same as ${vs}`
  const p = pctText(c.pct)
  return `${c.diffCents > 0 ? 'Up' : 'Down'} ${money(Math.abs(c.diffCents))}${p ? ` (${p})` : ''} on ${vs}`
}

// One of Lee's typed totals beside the payments listed under it.
function checkWhere(c, names) {
  if (c.scope === 'all') return 'for the term'
  if (c.scope === 'fields') {
    const n = c.venueIds.map((id) => names[id]).filter(Boolean)
    return n.length > 1 ? `for the fields (${joinAnd(n)} together)` : n.length ? `for the fields (${n[0]})` : 'for the fields'
  }
  return `for ${names[c.scope] || 'Belrose HQ'}`
}
export function checkHtml(c, names) {
  const where = checkWhere(c, names)
  if (!c.diffCents) return `<li class="ok">Matches your register: <b>${esc(money(c.registerCents))}</b> ${esc(where)}.</li>`
  return `<li class="bad">Your register says <b>${esc(money(c.registerCents))}</b> ${esc(where)}, the payments listed add up to <b>${esc(money(c.listedCents))}</b>.<small>${esc(money(Math.abs(c.diffCents)))} ${c.diffCents > 0 ? 'more' : 'less'} in the register than in the payments listed.</small></li>`
}

// ---------- Showing ----------

// Grouped by year, newest first: the whole year, then its terms, newest first.
export function showingPicker(terms, current, f) {
  const years = [...new Set(terms.map(yearOf).filter(Boolean))].sort((a, b) => b - a)
  const value = f.year ? `year:${f.year}` : f.term ? `term:${f.term}` : ''
  const opt = (v, label) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`
  return `<label class="jm-show"><span class="muted small">Showing</span><select class="j-select" id="m-show">${years.map((y) => `<optgroup label="${y}">${opt(`year:${y}`, `${y}, whole year`)}${terms.filter((t) => yearOf(t) === y).map((t) => (t === current ? opt('', `${t} (this term)`) : opt(`term:${t}`, t))).join('')}</optgroup>`).join('')}</select></label>`
}
export function bindShowing(ui) {
  ui.view().querySelector('#m-show')?.addEventListener('change', (e) => {
    const v = e.target.value
    Object.assign(ui.filter, { term: v.startsWith('term:') ? v.slice(5) : '', year: v.startsWith('year:') ? v.slice(5) : '' })
    ui.render()
  })
}
function head(ui, sub, extra = '') {
  return `<div class="jd-head"><div><h1>Money</h1><p>${esc(sub)}</p></div><div class="jd-sync">${ui.programmeSwitch}${showingPicker(ui.terms, ui.current, ui.filter)}${extra}</div></div>`
}
function bindHead(ui) {
  bindShowing(ui)
  ui.bindSwitch()
}
const locSwitch = (list, sel) => `<div class="jm-locs" id="m-locs" role="group" aria-label="Venue">${list.map((l) => `<button type="button" data-mloc="${esc(l.id)}" aria-pressed="${sel === l.id}"><span class="nm">${esc(l.name)}</span> <span class="amt">${esc(money(l.cents))} taken</span></button>`).join('')}</div>`
function bindLocs(ui, redraw) {
  ui.view().querySelector('#m-locs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mloc]')
    if (!b || b.dataset.mloc === ui.filter.loc) return
    ui.filter.loc = b.dataset.mloc
    ui.view().querySelectorAll('#m-locs [data-mloc]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mloc === ui.filter.loc)))
    ui.setHash()
    redraw()
  })
}
const tile = (ui, key, label, cents, colour, note = '', i = 1) => `<section class="jd-card jd-tile jm-tile" style="--i:${i}" data-tile="${esc(key)}"><span class="lbl"><span class="jd-key">${colour ? `<i style="background:${ui.cssVar(colour)}"></i>` : ''}${esc(label)}</span></span><span class="val">${typeof cents === 'number' ? esc(money(cents)) : esc(cents)}</span>${note ? `<span class="note">${esc(note)}</span>` : ''}</section>`
const methodTiles = (ui, m, count) => {
  const list = KIND.filter(([k]) => k !== 'other' || m.other > 0).map(([k, l, c], i) => tile(ui, k, l, m[k] || 0, c, '', i + 1))
  return `<div class="jm-tiles" data-n="${list.length + 1}">${list.join('')}${count}</div>`
}

// ---------- an earlier term (read only) ----------

// The term's figures for every venue or one venue.
export function pastScope(v, loc) {
  const reg = v.source === 'register'
  const venues = (v.venues || []).filter((x) => x.receivedCents || x.payments || x.players)
  const one = loc ? venues.find((x) => x.id === loc) : null
  const juniorsOf = (list) => sum(list, (x) => sum(x.groups || [], (g) => (/joners juniors/i.test(g.label || '') ? g.receivedCents : 0)))
  const jj = (list) => { const j = list.map((x) => x.juniors).filter(Boolean); return j.length ? { paidCents: sum(j, (x) => x.paidCents), paid: sum(j, (x) => x.paid), players: sum(j, (x) => x.players), creditCents: sum(j, (x) => x.creditCents) } : null }
  if (!one) {
    const loose = v.unlinkedByKind || {}
    const kind = (k) => sum(venues, (x) => x[`${k}Cents`]) + (loose[k] || 0)
    return {
      id: '', name: 'All venues', reg, taken: v.incomeCents || 0, fees: reg ? null : v.stripeFeesCents || 0, kept: reg ? null : v.netIncomeCents ?? (v.incomeCents || 0) - (v.stripeFeesCents || 0),
      methods: { stripe: kind('stripe'), bank: kind('bank'), cash: kind('cash'), other: kind('other') }, payments: v.paymentsCount ?? sum(venues, (x) => x.payments), players: reg ? null : sum(venues, (x) => x.players),
      venues, checks: v.registerChecks || [], people: v.players || [], unlinked: v.unlinked || { cents: 0, count: 0 }, unlinkedFee: v.unlinkedFeeCents || 0,
      costs: v.venueCostsCents || 0, profit: v.profitCents, hasCosts: (v.venuesWithCosts || 0) > 0, canCost: false, juniorsCents: reg ? juniorsOf(venues) : 0, juniors: reg ? null : jj(venues),
    }
  }
  return {
    id: one.id, name: one.name, reg, taken: one.receivedCents || 0, fees: reg ? null : one.stripeFeeCents || 0, kept: reg ? null : one.netCents ?? (one.receivedCents || 0) - (one.stripeFeeCents || 0),
    methods: { stripe: one.stripeCents || 0, bank: one.bankCents || 0, cash: one.cashCents || 0, other: one.otherCents || 0 }, payments: one.payments ?? one.players ?? 0, players: reg ? null : one.players,
    venues: [one], checks: (v.registerChecks || []).filter((c) => c.scope !== 'all' && c.venueIds.includes(one.id)), people: (v.players || []).filter((p) => p.locationId === one.id), unlinked: { cents: 0, count: 0 }, unlinkedFee: 0,
    costs: one.costsCents || 0, profit: one.profitCents, hasCosts: (one.costLines || []).length > 0, canCost: one.id !== 'other', juniorsCents: reg ? juniorsOf([one]) : 0, juniors: reg ? null : jj([one]),
  }
}

function pastTop(ui, v, s, names) {
  const pending = !s.reg && !s.id ? v.feesPendingCount || 0 : 0
  const count = tile(ui, 'payments', s.reg ? 'Payments listed' : 'Payments', String(s.payments || 0), '', s.reg ? 'in your register' : `${plural(s.players || 0, 'player')} paid`, 5)
  const checks = s.checks.length
    ? `<div class="jy-register" id="m-register"><h3 class="jy-h3">Your register's typed totals</h3><ul class="jy-checks">${s.checks.map((c) => checkHtml(c, names)).join('')}</ul></div>`
    : s.reg ? '<p class="jy-note" id="m-register">No total typed in your register for this.</p>' : ''
  const profit = s.hasCosts
    ? `<p class="jm-profit" id="m-profit">Profit after costs <b>${esc(s.profit < 0 ? `-${money(-s.profit)}` : money(s.profit))}</b><small>Venue costs ${esc(money(s.costs))}${s.reg ? ', taken less costs: Stripe fees weren\'t recorded' : ''}. Coach wages aren't in this unless you add them as a cost.</small></p>`
    : s.canCost ? `<button type="button" class="jm-linkbtn" data-venue="${esc(s.id)}" data-vterm="${esc(v.term)}" id="m-add-costs">Add ${esc(s.name)}'s costs for ${esc(v.term)} to see profit</button>` : ''
  return `<div class="jd-grid">
    <section class="jd-card jd-hero jm-hero jm-net jy-hero" style="--i:0"><div>
      <p class="lbl">Taken · ${esc(v.term)}${s.id ? ` · ${esc(s.name)}` : ''}</p>
      <p class="big" id="m-taken">${esc(money(s.taken))}</p>
      ${s.fees == null ? '<p class="jm-sum" id="m-nofees">Stripe fees weren\'t recorded for this term.</p>' : `<p class="jm-sum" id="m-sum"><span>Kept after Stripe fees <b>${esc(money(s.kept))}</b></span> · <span>Stripe fees <b>${esc(money(s.fees))}</b></span></p>`}
      ${pending ? `<p class="jm-pending">${plural(pending, 'Stripe payment')} in the ledger ${pending === 1 ? 'has' : 'have'} no fee, so kept may be a little high.</p>` : ''}
      ${s.juniorsCents ? `<p class="jy-note" id="m-jj">Includes ${esc(money(s.juniorsCents))} of Joners Juniors: your register lists it under Belrose HQ.</p>` : ''}
      ${profit}</div>
      ${checks}
    </section>
    ${methodTiles(ui, s.methods, count)}
    </div>
    ${s.juniors ? `<p class="jm-note" id="m-juniors">Joners Juniors ${esc(money(s.juniors.paidCents))}: ${s.juniors.paid} of ${s.juniors.players} paid${s.juniors.creditCents ? `, ${esc(money(s.juniors.creditCents))} with last term's credit` : ''}. Not in the JFP total.</p>` : ''}
    ${!s.id && s.unlinked.cents ? `<p class="jm-note" id="m-unlinked">${esc(money(s.unlinked.cents))} (${plural(s.unlinked.count, 'payment')}) belongs to players no longer on the term list, so it isn't on a venue.</p>` : ''}`
}

// By session, like the register: each venue's sessions, biggest first.
function pastSessions(v, s) {
  const reg = s.reg
  const venues = s.venues.filter((x) => (x.groups || []).length)
  if (!venues.length) return ''
  const kept = (x) => x.netCents ?? x.receivedCents - (x.stripeFeeCents || 0)
  const row = (g) => `<tr><td>${esc(g.label)}${g.coach ? `<small>${esc(g.coach)}</small>` : ''}</td><td class="num">${reg ? g.payments ?? g.players : g.players}</td><td class="num">${esc(money(g.receivedCents))}</td>${reg ? '' : `<td class="num">${esc(money(kept(g)))}</td>`}</tr>`
  // Every venue's own heading, as the register has HQ and the fields apart.
  const body = venues.map((x) => `${s.id ? '' : `<tr class="jy-vrow"><th colspan="2" scope="rowgroup">${esc(x.name)}</th><th class="num">${esc(money(x.receivedCents))}</th>${reg ? '' : `<th class="num">${esc(money(kept(x)))}</th>`}</tr>`}${x.groups.map(row).join('')}`).join('')
  const all = venues.flatMap((x) => x.groups)
  return `<section class="jd-card jy-card" id="m-sessions"><h2>${reg ? 'By session' : 'By group'}</h2><p class="sub">${reg ? 'The sessions in your register and the payments listed under each' : 'Each group and coach, from the payments in the ledger'}</p>
    <div class="jp-scroll"><table class="jp-table jm-table jy-table"><thead><tr><th>${reg ? 'Session' : 'Group'}</th><th class="num">${reg ? 'Payments' : 'Players'}</th><th class="num">Taken</th>${reg ? '' : '<th class="num">Kept</th>'}</tr></thead><tbody>
      ${body}
      <tr class="jv-total"><td>Total</td><td class="num">${sum(all, (g) => (reg ? g.payments ?? g.players : g.players))}</td><td class="num">${esc(money(sum(all, (g) => g.receivedCents)))}</td>${reg ? '' : `<td class="num">${esc(money(sum(all, kept)))}</td>`}</tr>
    </tbody></table></div></section>`
}

function pastPaid(ui, s) {
  if (s.reg) return ''
  return `<details class="jv-players jd-card jy-card" id="m-paid" ${ui.isOpen('m-paid')}><summary>Who paid (${s.people.length})</summary>
    <div class="jp-scroll" style="margin-top:8px"><table class="jp-table jm-table jy-table"><thead><tr><th>Player</th><th class="num">Paid</th><th class="num">Kept</th></tr></thead><tbody>
      ${s.people.map((p) => `<tr><td>${esc(p.player)}<small>${esc([p.group, p.coach].filter(Boolean).join(' · '))}</small></td><td class="num">${esc(money(p.receivedCents))}</td><td class="num">${esc(money(p.netReceivedCents ?? p.receivedCents))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No payments.</td></tr>'}
    </tbody></table></div></details>`
}

function pastNotes(v) {
  return `<div class="jv-notes muted small" id="m-notes">${v.source === 'register'
    ? `<p>${esc(v.term)} from your Money Register (the Google Sheet): the payments listed under each session${v.importedAt ? `, copied ${esc(day(v.importedAt))}` : ''}. Game analysis isn't counted.</p>`
    : `<p>${esc(v.term)} from the payment ledger: every Stripe, bank transfer and cash payment recorded for the term, and Stripe's fee on each.</p>`}</div>`
}

// The download for one earlier term, for the venue picked.
export function pastCsv(ui, v, s) {
  const out = []
  const add = (...cells) => out.push(cells.map(ui.csvCell).join(','))
  const aud = (c) => (c == null ? '' : (c / 100).toFixed(2))
  add('JFP money', v.term, s.name, `Downloaded ${new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}`)
  add(v.source === 'register' ? `From your Money Register${v.importedAt ? `, copied ${v.importedAt}` : ''}` : 'From the payment ledger')
  add('')
  add('Summary', 'A$')
  add('Taken', aud(s.taken))
  if (s.fees == null) add('Stripe fees', 'Not recorded for this term')
  else { add('Stripe fees', aud(s.fees)); add('Kept after Stripe fees', aud(s.kept)) }
  for (const [k, l] of KIND) add(l, aud(s.methods[k] || 0))
  add(s.reg ? 'Payments listed' : 'Payments', s.payments || 0)
  if (s.hasCosts) { add('Venue costs', aud(s.costs)); add('Profit after costs', aud(s.profit)) }
  const names = Object.fromEntries((v.venues || []).map((x) => [x.id, x.name]))
  for (const c of s.checks) add(`Your register's typed total ${checkWhere(c, names)}`, aud(c.registerCents), 'Payments listed', aud(c.listedCents), 'Difference', aud(c.diffCents))
  if (!s.id && s.unlinked.cents) add('Not on a venue (players no longer on the term list)', aud(s.unlinked.cents))
  add('')
  add(s.reg ? 'By session' : 'By group')
  add('Venue', s.reg ? 'Session' : 'Group', 'Coach', s.reg ? 'Payments' : 'Players', 'Taken (A$)', ...KIND.map(([, l]) => `${l} (A$)`), ...(s.reg ? [] : ['Stripe fees (A$)', 'Kept (A$)']))
  const groups = s.venues.flatMap((x) => (x.groups || []).map((g) => ({ ...g, venue: x.name })))
  for (const g of groups) add(g.venue, g.label, g.coach || '', s.reg ? g.payments ?? g.players : g.players, aud(g.receivedCents), ...KIND.map(([k]) => aud(g[`${k}Cents`] || 0)), ...(s.reg ? [] : [aud(g.stripeFeeCents || 0), aud(g.netCents ?? g.receivedCents - (g.stripeFeeCents || 0))]))
  add('Total', '', '', sum(groups, (g) => (s.reg ? g.payments ?? g.players : g.players)), aud(sum(groups, (g) => g.receivedCents)), ...KIND.map(([k]) => aud(sum(groups, (g) => g[`${k}Cents`]))), ...(s.reg ? [] : [aud(sum(groups, (g) => g.stripeFeeCents)), aud(sum(groups, (g) => g.netCents ?? g.receivedCents - (g.stripeFeeCents || 0)))]))
  if (!s.reg) {
    add('')
    add('Who paid')
    add('Player', 'Group', 'Coach', 'Venue', 'Paid (A$)', 'Stripe fee (A$)', 'Kept (A$)')
    for (const p of s.people) add(p.player, p.group, p.coach || '', names[p.locationId] || '', aud(p.receivedCents), aud(p.stripeFeeCents || 0), aud(p.netReceivedCents ?? p.receivedCents))
    add('Total', '', '', '', aud(sum(s.people, (p) => p.receivedCents)), aud(sum(s.people, (p) => p.stripeFeeCents)), aud(sum(s.people, (p) => p.netReceivedCents ?? p.receivedCents)))
  }
  return out.join('\r\n')
}

export async function renderPastTerm(ui) {
  const f = ui.filter, term = f.term
  ui.view().innerHTML = `${head(ui, term)}<p class="muted">Loading ${esc(term)}</p>`
  bindHead(ui)
  let v
  try { v = await ui.pastTerm(term) } catch (e) {
    if (ui.stale()) return
    ui.view().innerHTML = `${head(ui, term)}<div class="j-box j-box-red">${esc(e.message)} Try again in a minute.</div>`
    return bindHead(ui)
  }
  if (ui.stale()) return
  if (!v) { ui.toast(`No figures for ${term}.`); f.term = ''; return ui.render() }
  const reg = v.source === 'register'
  const venues = (v.venues || []).filter((x) => x.receivedCents || x.payments || x.players)
  if (f.loc && !venues.some((x) => x.id === f.loc)) f.loc = ''
  ui.setHash()
  const names = Object.fromEntries(venues.map((x) => [x.id, x.name]))
  ui.view().innerHTML = `${head(ui, `${term}: ${reg ? 'from your Money Register' : 'from the payment ledger'}`)}
    <p class="jm-note jy-ro" id="m-readonly">Looking back, so nothing here can be changed. To record a payment, pick ${esc(ui.current)} (this term) in Showing.</p>
    <div class="jm-scope">${locSwitch([{ id: '', name: 'All', cents: v.incomeCents || 0 }, ...venues.map((x) => ({ id: x.id, name: x.name, cents: x.receivedCents }))], f.loc)}<button type="button" class="j-btn j-btn-line j-btn-sm jm-csv" id="m-csv">Download for accountant</button></div>
    <div id="m-scope"></div>`
  bindHead(ui)
  const draw = () => {
    const s = pastScope(v, f.loc)
    ui.view().querySelector('#m-scope').innerHTML = `${pastTop(ui, v, s, names)}${pastSessions(v, s)}${pastPaid(ui, s)}${pastNotes(v)}`
    ui.keepFolds(ui.view().querySelector('#m-scope'))
  }
  draw()
  bindLocs(ui, draw)
  ui.view().querySelector('#m-csv').addEventListener('click', () => {
    const s = pastScope(v, f.loc)
    ui.saveFile(`jfp-money-${ui.slug(term)}-${s.id || 'all'}.csv`, pastCsv(ui, v, s))
  })
}

// ---------- a whole year ----------

const CHART = { el: null, bars: null, ui: null }
export function redrawYearChart() { if (CHART.el?.isConnected) termChart(CHART.el, CHART.ui, CHART.bars, false) }
// Taken, term by term: one bar a term; the term running now is paler.
function termChart(el, ui, bars, animate) {
  Object.assign(CHART, { el, bars, ui })
  const W = Math.max(280, el.clientWidth || 0), H = 230, L = 54, B = 42, T = 24
  const max = ui.niceMax(Math.max(...bars.map((b) => b.cents || 0), 1))
  const band = (W - L) / Math.max(bars.length, 1)
  const bw = Math.min(64, band * 0.58)
  const y = (val) => T + (H - T - B) * (1 - val / max)
  const ticks = [0, 0.5, 1].map((x) => x * max)
  const fill = ui.cssVar('--c-series-1')
  const cols = bars.map((b, i) => {
    const x = L + band * i + (band - bw) / 2, base = H - B
    let body = `<text class="lab" x="${x + bw / 2}" y="${base - 8}" text-anchor="middle">${esc(b.none || '')}</text>`
    if (b.cents > 0) {
      const top = y(b.cents), r = Math.min(4, (base - top) / 2)
      body = `<path class="seg" d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z" fill="${fill}"${b.current ? ' fill-opacity=".45"' : ''}/>`
        + `<text class="val fade" style="--i:${i}" x="${x + bw / 2}" y="${top - 7}" text-anchor="middle">${esc(ui.compact(b.cents))}</text>`
    }
    return `<g class="band" tabindex="0" data-tip="${esc(b.tip)}" aria-label="${esc(b.aria)}"><rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}"/><g class="col" style="--i:${i}">${body}</g>`
      + `<text class="lab" x="${x + bw / 2}" y="${H - 24}" text-anchor="middle">${esc(b.label)}</text><text class="lab" x="${x + bw / 2}" y="${H - 9}" text-anchor="middle">${esc(b.sub || '')}</text></g>`
  }).join('')
  el.classList.toggle('anim', Boolean(animate))
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Taken, term by term">
    <g class="grid">${ticks.map((t) => `<line x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
    <g class="axis">${ticks.map((t) => `<text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${esc(ui.compact(t))}</text>`).join('')}</g>${cols}</svg>`
  ui.bindTips(el)
}

// Four slots a year, so a term with no figures shows as that.
function slots(y, s) {
  return [1, 2, 3, 4].map((n) => {
    const name = `Term ${n} ${y.year}`
    const t = s.perTerm.find((x) => x.n === n)
    return t ? { n, name, t } : { n, name, none: y.notYet.includes(name) ? 'Not yet' : 'No figures' }
  })
}

function keptText(y, s) {
  if (!s.feeTerms.length) return `Stripe fees weren't recorded for ${y.year}.`
  const what = `Kept after Stripe fees <b>${esc(money(s.keptCents))}</b>`
  if (!s.noFeeTerms.length) return `${what} · Stripe fees <b>${esc(money(s.stripeFeeCents))}</b>`
  return `${what} for ${esc(termsText(s.feeTerms))} (Stripe fees ${esc(money(s.stripeFeeCents))}). Stripe fees weren't recorded for ${esc(termsText(s.noFeeTerms))}.`
}

function compareHtml(y, s, name) {
  const c = s.compare || { none: 'nodata', previousYear: y.year - 1 }
  const vs = String(c.previousYear)
  if (c.none === 'nodata') return `<p class="jy-note" id="y-compare">No figures for ${esc(vs)} to compare with.</p>`
  if (c.none === 'running') return `<p class="jy-note" id="y-compare">${esc(joinAnd(c.running))} is still running, so there's nothing to compare yet.</p>`
  if (c.none) return `<p class="jy-note" id="y-compare">${esc(vs)} has no figures for the same terms, so there's nothing to compare.</p>`
  if (c.nothingBefore) return `<p class="jy-note" id="y-compare">Nothing${s === y.scopes[''] ? '' : ` at ${esc(name)}`} in ${esc(termsText(c.terms.map((n) => `Term ${n} ${vs}`)))} of ${esc(vs)} to compare with.</p>`
  // All of both years: "Up A$X (Y%) on 2025". Some terms: "Terms 1 to 3: up A$X (Y%) on the same terms of 2025".
  const versus = c.allTerms ? vs : `the same terms of ${vs}`
  const said = (x) => (c.allTerms ? changeText(x, versus) : changeText(x, versus).replace(/^./, (ch) => ch.toLowerCase()))
  const lead = c.allTerms ? '' : `${termsText(c.terms.map((n) => `Term ${n} ${y.year}`))}: `
  const notes = [
    c.running?.length ? `${termsText(c.running)} ${y.year} is still running, so it isn't in this.` : '',
    c.leftOut?.filter((t) => !c.running?.includes(t)).length ? `${vs} has no figures for ${termsText(c.leftOut.filter((t) => !c.running?.includes(t)))}.` : '',
    c.beforeOnly?.length ? `${y.year} has no figures for ${termsText(c.beforeOnly)}.` : '',
  ].filter(Boolean)
  const jj = c.withoutJuniors ? `<p class="jy-note" id="y-compare-jj">Leaving Joners Juniors out of both years: ${esc(changeText(c.withoutJuniors, versus).replace(/^./, (ch) => ch.toLowerCase()))}. Your register counts Joners Juniors under Belrose HQ; the payment ledger and this term keep it apart.</p>` : ''
  return `<p class="jy-compare ${c.diffCents > 0 ? 'up' : c.diffCents < 0 ? 'down' : ''}" id="y-compare">${esc(lead)}${esc(said(c))}.</p>${notes.length ? `<p class="jy-note" id="y-compare-note">${esc(notes.join(' '))}</p>` : ''}${jj}`
}

function yearTop(ui, y, s, name) {
  const usedRegister = s.registerTerms.length > 0
  const regNote = usedRegister ? `<p class="jy-note" id="y-register">${s.listedCents !== s.takenCents ? `Uses the totals you typed in your register for ${esc(termsText(s.registerTerms))}. The payments listed add up to <b>${esc(money(s.listedCents))}</b>.` : `Matches the totals you typed in your register for ${esc(termsText(s.registerTerms))}.`}</p>` : ''
  const count = tile(ui, 'payments', 'Payments', String(s.payments || 0), '', '', 5)
  const byMethod = s.listedCents !== s.takenCents ? `<p class="jm-note" id="y-methods">Stripe, bank transfer, cash and other add up to the ${esc(money(s.listedCents))} in payments listed.</p>` : ''
  return `<div class="jd-grid">
    <section class="jd-card jd-hero jm-hero jm-net jy-hero" style="--i:0"><div>
      <p class="lbl">Taken in ${esc(y.soFar ? `${y.year} so far` : String(y.year))}${s === y.scopes[''] ? '' : ` · ${esc(name)}`}</p>
      <p class="big" id="y-taken">${esc(money(s.takenCents))}</p>
      <p class="jm-sum" id="y-kept">${keptText(y, s)}</p>
      ${s.feesPending ? `<p class="jm-pending">${plural(s.feesPending, 'Stripe fee')} not known yet, so kept may be a little high.</p>` : ''}
      ${compareHtml(y, s, name)}
      ${regNote}</div>
    </section>
    ${methodTiles(ui, s.methods, count)}
  </div>${byMethod}`
}

function yearTerms(y, s) {
  const row = ({ name, t, none }) => {
    if (!t) return `<tr class="jy-none"><th scope="row">${esc(name)}<small>${esc(none)}</small></th><td class="num jy-blank"></td><td class="num jy-blank"></td></tr>`
    const notes = [
      t.source === 'register' ? 'From your register' : t.source === 'ledger' ? 'From the payment ledger' : 'Live, so far',
      t.registerCents != null ? (t.registerCents !== t.listedCents ? `your typed total · payments listed ${money(t.listedCents)}` : 'matches your typed total') : '',
      t.current && t.refundedCents ? `after ${money(t.refundedCents)} refunded` : '',
    ].filter(Boolean).join(' · ')
    return `<tr data-term="${esc(t.term)}"><th scope="row"><button type="button" class="jy-open" data-open-term="${esc(t.term)}">${esc(t.term)}</button><small>${esc(notes)}</small></th><td class="num" data-label="Taken">${esc(money(t.takenCents))}</td><td class="num" data-label="Kept after fees">${t.feesKnown ? esc(money(t.keptCents)) : '<span class="muted">Not recorded</span>'}</td></tr>`
  }
  return `<section class="jd-card jy-card" id="y-terms"><h2>Term by term</h2><p class="sub">Tap a term to open it</p>
    <div class="jc" id="y-chart"></div>
    <div class="jp-scroll" style="margin-top:12px"><table class="jp-table jm-table jy-table jy-stack"><thead><tr><th>Term</th><th class="num">Taken</th><th class="num">Kept after fees</th></tr></thead><tbody>
      ${slots(y, s).map(row).join('')}
      <tr class="jv-total"><th scope="row">${esc(y.soFar ? `${y.year} so far` : `${y.year}`)}</th><td class="num" data-label="Taken">${esc(money(s.takenCents))}</td><td class="num" data-label="Kept after fees">${s.keptCents == null ? '<span class="muted">Not recorded</span>' : `<span>${esc(money(s.keptCents))}${s.noFeeTerms.length ? `<small>${esc(termsText(s.feeTerms))}</small>` : ''}</span>`}</td></tr>
    </tbody></table></div></section>`
}

// Every venue, term by term. Money not on a venue has its own lines, so each
// term's column adds up to the term.
function yearVenues(y) {
  const all = y.scopes['']
  if (!y.venues.length) return ''
  const terms = all.perTerm
  const cell = (label, cents) => `<td class="num" data-label="${esc(label)}">${esc(money(cents || 0))}</td>`
  const line = (name, values, total, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><th scope="row">${esc(name)}</th>${values.map((c, i) => cell(`Term ${terms[i].n}`, c)).join('')}${cell(String(y.year), total)}</tr>`
  const rows = y.venues.map((v) => { const s = y.scopes[v.id]; return line(v.name, terms.map((t) => s.perTerm.find((x) => x.n === t.n)?.takenCents || 0), s.takenCents) })
  if (terms.some((t) => t.registerGapCents)) rows.push(line('In your typed totals, not in the payments listed', terms.map((t) => t.registerGapCents), sum(terms, (t) => t.registerGapCents), 'jy-extra'))
  if (terms.some((t) => t.unlinkedCents)) rows.push(line('Not linked to a player (not on a venue)', terms.map((t) => t.unlinkedCents), sum(terms, (t) => t.unlinkedCents), 'jy-extra'))
  rows.push(line('All venues', terms.map((t) => t.takenCents), all.takenCents, 'jv-total'))
  return `<section class="jd-card jy-card" id="y-venues"><h2>By venue</h2><p class="sub">Each venue, term by term</p>
    <div class="jp-scroll"><table class="jp-table jm-table jy-table jy-stack"><thead><tr><th>Venue</th>${terms.map((t) => `<th class="num">Term ${t.n}</th>`).join('')}<th class="num">${y.year}</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></section>`
}

function yearDiffs(y, s) {
  if (!s.differences.length) return ''
  const names = Object.fromEntries(y.venues.map((v) => [v.id, v.name]))
  // The term's figure is the grand total Lee typed (HQ then takes his HQ total); with no grand total typed, it is the payments listed.
  const uses = (c) => (s.perTerm.find((t) => t.term === c.term)?.registerCents != null ? `${c.term} uses your typed total.` : `${c.term} uses the payments listed: no total for the whole term was typed.`)
  return `<section class="jd-card jy-card" id="y-diffs"><h2>Your register's typed totals</h2><p class="sub">Where a total you typed differs from the payments listed under it</p>
    <ul class="jy-checks">${s.differences.map((c) => checkHtml(c, names).replace('<li class="bad">', `<li class="bad"><b>${esc(c.term)}.</b> `).replace('</small></li>', ` ${esc(uses(c))}</small></li>`)).join('')}</ul></section>`
}

function yearNotes(y, s) {
  const by = (src) => y.sources.filter((x) => x.source === src).map((x) => x.term)
  const reg = by('register'), led = by('ledger'), live = by('live')
  const copied = y.sources.find((x) => x.importedAt)?.importedAt
  const notes = [
    reg.length ? `${termsText(reg)} from your Money Register${copied ? ` (copied ${day(copied)})` : ''}. Game analysis isn't counted.` : '',
    led.length ? `${termsText(led)} from the payment ledger, with Stripe's fee on each payment.` : '',
    live.length ? `${termsText(live)} live from Stripe and Airtable, so far.` : '',
    s.juniorsCents ? `Your register counts Joners Juniors under Belrose HQ: ${money(s.juniorsCents)} of this is Joners Juniors.${led.length || live.length ? ' The payment ledger and this term leave it out (Joners Juniors has its own page: pick Joners Juniors at the top).' : ''}` : '',
    y.missing.length ? `No figures for ${termsText(y.missing)}.` : '',
    `Worked out at ${new Date(y.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}. Refresh reads everything again.`,
  ].filter(Boolean)
  return `<div class="jv-notes muted small" id="y-notes">${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>`
}

// The download for a year, for the venue picked.
export function yearCsv(ui, y, s, name) {
  const out = []
  const add = (...cells) => out.push(cells.map(ui.csvCell).join(','))
  const aud = (c) => (c == null ? '' : (c / 100).toFixed(2))
  add('JFP money', y.soFar ? `${y.year} so far` : `${y.year}, whole year`, name, `Downloaded ${new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}`)
  add('')
  add('Summary', 'A$')
  add('Taken', aud(s.takenCents))
  if (s.listedCents !== s.takenCents) add('Payments listed add up to', aud(s.listedCents))
  if (s.feeTerms.length) { add('Stripe fees', aud(s.stripeFeeCents), termsText(s.feeTerms)); add('Kept after Stripe fees', aud(s.keptCents), termsText(s.feeTerms)) }
  if (s.noFeeTerms.length) add('Stripe fees not recorded for', termsText(s.noFeeTerms))
  for (const [k, l] of KIND) add(l, aud(s.methods[k] || 0))
  const c = s.compare
  if (c && !c.none && !c.nothingBefore) add(`Compared with ${c.previousYear}`, aud(c.diffCents), c.pct == null ? '' : `${c.pct}%`, termsText(c.terms.map((n) => `Term ${n} ${y.year}`)))
  if (c?.withoutJuniors) add(`Compared with ${c.previousYear}, without Joners Juniors`, aud(c.withoutJuniors.diffCents), c.withoutJuniors.pct == null ? '' : `${c.withoutJuniors.pct}%`)
  add('')
  add('By term')
  add('Term', 'From', 'Taken (A$)', 'Your typed total (A$)', 'Payments listed (A$)', 'Difference (A$)', 'Stripe fees (A$)', 'Kept after Stripe fees (A$)', ...KIND.map(([, l]) => `${l} (A$)`), 'Payments')
  const FROM = { register: 'Your Money Register', ledger: 'Payment ledger', live: 'Live, so far' }
  for (const t of s.perTerm) add(t.term, FROM[t.source] || t.source, aud(t.takenCents), aud(t.registerCents), aud(t.listedCents), t.registerCents == null ? '' : aud(t.registerCents - t.listedCents), t.feesKnown ? aud(t.stripeFeeCents) : 'Not recorded', t.feesKnown ? aud(t.keptCents) : '', ...KIND.map(([k]) => aud(t.methods[k] || 0)), t.payments || 0)
  add('Total', '', aud(s.takenCents), '', aud(s.listedCents), '', aud(s.stripeFeeCents), aud(s.keptCents), ...KIND.map(([k]) => aud(s.methods[k] || 0)), s.payments || 0)
  if (s === y.scopes[''] && y.venues.length) {
    const terms = s.perTerm
    add('')
    add('By venue')
    add('Venue', ...terms.map((t) => `${t.term} (A$)`), `${y.year} (A$)`)
    for (const v of y.venues) { const x = y.scopes[v.id]; add(v.name, ...terms.map((t) => aud(x.perTerm.find((p) => p.n === t.n)?.takenCents || 0)), aud(x.takenCents)) }
    if (terms.some((t) => t.registerGapCents)) add('In your typed totals, not in the payments listed', ...terms.map((t) => aud(t.registerGapCents)), aud(sum(terms, (t) => t.registerGapCents)))
    if (terms.some((t) => t.unlinkedCents)) add('Not linked to a player', ...terms.map((t) => aud(t.unlinkedCents)), aud(sum(terms, (t) => t.unlinkedCents)))
    add('All venues', ...terms.map((t) => aud(t.takenCents)), aud(s.takenCents))
  }
  for (const d of s.differences) add(`${d.term}: your typed total ${checkWhere(d, Object.fromEntries(y.venues.map((v) => [v.id, v.name])))}`, aud(d.registerCents), 'Payments listed', aud(d.listedCents))
  return out.join('\r\n')
}

export async function renderMoneyYear(ui) {
  const f = ui.filter, year = Number(f.year)
  const refresh = '<button type="button" class="j-btn j-btn-line j-btn-sm" id="y-refresh">Refresh</button>'
  ui.view().innerHTML = `${head(ui, `${year}`)}<p class="muted">Adding up ${year}</p>`
  bindHead(ui)
  let y
  try { y = await ui.yearData(year) } catch (e) {
    if (ui.stale()) return
    ui.view().innerHTML = `${head(ui, `${year}`)}<div class="j-box j-box-red">${esc(e.message)} Try again in a minute.</div>`
    return bindHead(ui)
  }
  if (ui.stale()) return
  if (!y) { ui.toast(`No figures for ${year}.`); f.year = ''; return ui.render() }
  if (f.loc && !y.scopes[f.loc]) f.loc = ''
  ui.setHash()
  const live = y.sources.find((x) => x.error)
  ui.view().innerHTML = `${head(ui, y.soFar ? `${year} so far: ${y.current} is still running` : `${year}, the whole year`, refresh)}
    ${live ? `<div class="j-box j-box-amber" style="margin-bottom:12px">${esc(live.error)} ${esc(live.term)} is Airtable figures only for now.</div>` : ''}
    <div class="jm-scope">${locSwitch([{ id: '', name: 'All', cents: y.scopes[''].takenCents }, ...y.venues.map((v) => ({ id: v.id, name: v.name, cents: y.scopes[v.id].takenCents }))], f.loc)}<button type="button" class="j-btn j-btn-line j-btn-sm jm-csv" id="m-csv">Download for accountant</button></div>
    <div id="m-scope"></div>`
  bindHead(ui)
  const nameOf = () => (f.loc ? y.venues.find((v) => v.id === f.loc)?.name || '' : 'All venues')
  const draw = (animate) => {
    const s = y.scopes[f.loc] || y.scopes['']
    const box = ui.view().querySelector('#m-scope')
    box.innerHTML = `${yearTop(ui, y, s, nameOf())}${yearTerms(y, s)}${f.loc ? '' : yearVenues(y)}${yearDiffs(y, s)}${yearNotes(y, s)}`
    const bars = slots(y, s).map(({ n, name, t, none }) => ({
      label: `Term ${n}`, sub: t?.current ? 'so far' : '', cents: t?.takenCents || 0, current: Boolean(t?.current), none: t ? '' : none,
      tip: t ? `<b>${esc(name)}</b><span class="row">Taken ${esc(money(t.takenCents))}</span>${t.feesKnown ? `<span class="row">Kept ${esc(money(t.keptCents))}</span>` : ''}${t.registerCents != null && t.registerCents !== t.listedCents ? `<span class="row">Payments listed ${esc(money(t.listedCents))}</span>` : ''}` : `<b>${esc(name)}</b><span class="row">${esc(none)}</span>`,
      aria: t ? `${name}: ${money(t.takenCents)} taken${t.current ? ' so far' : ''}` : `${name}: ${none}`,
    }))
    termChart(box.querySelector('#y-chart'), ui, bars, animate)
  }
  draw(ui.animate !== false)
  bindLocs(ui, () => draw(false))
  const v = ui.view()
  v.querySelector('#m-csv').addEventListener('click', () => ui.saveFile(`jfp-money-${year}-${f.loc || 'all'}.csv`, yearCsv(ui, y, y.scopes[f.loc] || y.scopes[''], nameOf())))
  v.querySelector('#y-refresh').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    try { await ui.yearData(year, { fresh: true }); ui.toast(`${year} added up again`) } catch (err) { ui.toast(err.message) }
    ui.render()
  })
  v.querySelector('#m-scope').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-term]')
    if (!b) return
    Object.assign(f, { term: b.dataset.openTerm === ui.current ? '' : b.dataset.openTerm, year: '' })
    ui.render()
  })
}
