// Money > Camps (Lee, 13 Oct 2026): what each camp brought in, a year at a
// time, from the summary the Mac copies out of Lee's camp sheets (Airtable
// "JFP Camps"; no names). A year total, by location, against last year, and
// live Stripe camp sign-ups on the Sydney account as a cross-check where the
// sheet has no figure. Read only.
import { esc, money } from './jfp-common.js'
import { moneyHead, bindTip, programmeSwitch, bindSwitch, remember, recall, quietOk } from './jfp-portal-programmes.js'

export const CAMPS_DEFINITION = 'From your camp sheets in Google Drive, copied by the camps import on the Mac (see the RUNBOOK, Camps money). Gross = what the sheet says came in. Net = your Profit figure where the sheet has one, else gross less refunds, fees and costs. Stripe fees are mostly already off the sheet\'s amounts. Camps in another currency are listed but not added into the A$ totals. "Stripe sign-ups" are camp registrations paid on the Sydney Stripe account, read live, as a check.'
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const amt = (c) => (c == null ? '<span class="muted">not in sheet</span>' : esc(money(c)))
const fmtDay = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '')
const dates = (c) => (c.start ? `${fmtDay(c.start)}${c.end && c.end !== c.start ? ` to ${fmtDay(c.end)}` : ''}` : '')
const key = (year) => `camps:${year || ''}`
const words = (t) => new Set(String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(camp|camps|the|and|joner|joners|football|jf|day|days|20\d\d)$/.test(w)))

export async function campsData(post, { year = 0, fresh = false } = {}) {
  const r = await post('campsMoney', { ...(year ? { year } : {}), ...(fresh ? { fresh: true } : {}) })
  if (!r.ok || !r.data?.camps) throw new Error(r.data?.error || 'Could not load camps.')
  remember(key(year), r.data.camps)
  remember(key(r.data.camps.year), r.data.camps)
  return r.data.camps
}
export async function campsStripeData(post, { year, fresh = false, quick = false }) {
  const k = `campsStripe:${year}`
  const r = await post('campsStripe', { year, ...(fresh ? { fresh: true } : {}), ...(quick ? { quick: true } : {}) })
  if (!r.ok || !r.data?.stripe) throw new Error(r.data?.error || 'Stripe could not be read just now.')
  remember(k, r.data.stripe)
  return r.data.stripe
}

// Stripe's camp name against the sheet's: two shared words (or one, when
// that is all the name has) and the same year.
export function matchStripe(camps, groups) {
  const out = new Map()
  for (const g of groups) {
    const gw = words(g.camp)
    let best = null, score = 0
    for (const c of camps) {
      const cw = words(`${c.camp} ${c.location}`)
      const s = [...gw].filter((w) => cw.has(w)).length
      if (s > score && (s >= 2 || (s >= 1 && gw.size <= 2))) { best = c; score = s }
    }
    if (best) out.set(best.id, [...(out.get(best.id) || []), g])
  }
  return out
}

function stripeCard(v, s) {
  if (!s) return '<p class="muted small" id="c-stripe-wait">Reading Stripe camp sign-ups</p>'
  if (s.error) return `<p class="muted small">${esc(s.error)}</p>`
  if (!s.camps.length) return `<p class="muted small">No camp sign-ups paid on the Sydney Stripe account in ${v.year}.</p>`
  const matched = matchStripe(v.camps, s.camps)
  const sheetFor = new Map()
  for (const [id, gs] of matched) for (const g of gs) sheetFor.set(g.camp, v.camps.find((c) => c.id === id))
  return `${s.quick ? '<p class="muted small">From the last Stripe read; checking for newer.</p>' : ''}<ul class="jm-feelist" id="c-stripe-list">${s.camps.map((g) => {
    const c = sheetFor.get(g.camp)
    const gap = c && c.grossCents == null ? ' · the sheet has no figure' : c ? ` · sheet ${esc(money(c.grossCents))}` : ' · not matched to a sheet camp'
    return `<li><span>${esc(g.camp)}<small>${plural(g.count, 'sign-up')} · taken ${esc(money(g.takenCents))}${g.refundedCents ? ` · refunded ${esc(money(g.refundedCents))}` : ''}${g.feeCents ? ` · fees ${esc(money(g.feeCents))}` : ''}${g.currency !== 'AUD' ? ` · ${esc(g.currency)}` : ''}${gap}</small></span><b>${esc(money(g.keptCents))}</b></li>`
  }).join('')}</ul>${s.truncated ? '<p class="muted small">Only the newest Stripe payments were read, so early sign-ups may be missing.</p>' : ''}`
}

export function campsCsv(v, { csvCell, aud }) {
  const out = []
  const add = (...cells) => out.push(cells.map(csvCell).join(','))
  const t = v.totals
  add('Camps money', String(v.year), `Downloaded ${new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}`)
  add('')
  add('Summary (A$ camps)', 'A$')
  add('Camps', t.camps); add('Players', t.players ?? '')
  add('Gross', aud(t.grossCents)); add('Refunds', aud(t.refundsCents)); add('Stripe fees', aud(t.feesCents)); add('Costs', aud(t.costsCents)); add('Net', aud(t.netCents))
  for (const o of t.other) add(`${o.currency} camps (not in the A$ totals)`, o.camps, aud(o.grossCents), aud(o.netCents))
  add('')
  add('Camp', 'Location', 'Start', 'End', 'Players', 'Gross', 'Refunds', 'Stripe fees', 'Costs', 'Net', 'Currency', 'Sheet', 'Tab', 'Notes')
  for (const c of v.camps) add(c.camp, c.location, c.start, c.end, c.players ?? '', aud(c.grossCents), aud(c.refundsCents), aud(c.feesCents), aud(c.costsCents), aud(c.netCents), c.currency, c.sheet, c.tab, c.notes)
  return out.join('\r\n')
}

function setHash(year) { history.replaceState(null, '', `#money?programme=camps${year ? `&year=${year}` : ''}`) }

function draw(ui, v) {
  const t = v.totals
  const c = v.compare
  ui.filter.year = v.year
  setHash(v.year)
  const picker = `<label class="jm-show"><span class="muted small">Year</span><select class="j-select" id="c-year">${(v.years.length ? v.years : [{ year: v.year, camps: 0 }]).map((y) => `<option value="${y.year}"${y.year === v.year ? ' selected' : ''}>${y.year}${y.camps ? ` · ${plural(y.camps, 'camp')}` : ''}</option>`).join('')}</select></label>`
  const diff = (x) => (x == null ? '' : `${x.diffCents >= 0 ? '+' : '−'}${money(Math.abs(x.diffCents))}${x.pct != null ? ` (${x.pct >= 0 ? '+' : ''}${x.pct}%)` : ''}`)
  const tiles = [
    ['gross', 'Gross', t.grossCents, '--c-series-1', `${plural(t.audCamps, 'camp')}${t.refundsCents ? ` · refunds ${money(t.refundsCents)}` : ''}`],
    ['costs', 'Costs', t.costsCents, '--c-series-2', t.costsCents == null ? 'Not in the sheets' : 'From the sheets'],
    ['players', 'Players', null, '--c-series-3', t.players == null ? 'Not in the sheets' : 'Booked across the camps'],
    ['last', `Against ${c?.year || v.year - 1}`, null, '--c-neutral', c ? `Net ${c.netCents == null ? 'not known' : money(c.netCents)} then` : 'No camps that year'],
  ]
  const tileVal = (k, val) => (k === 'players' ? esc(t.players == null ? '–' : String(t.players)) : k === 'last' ? esc(c?.net ? diff(c.net) : '–') : val == null ? '–' : esc(money(val)))
  ui.view().innerHTML = `
    ${moneyHead({ controls: `${programmeSwitch('camps')}${picker}<button type="button" class="j-btn j-btn-line j-btn-sm" id="c-csv">Download CSV</button>`, at: v.at, note: v.importedAt ? `sheets ${esc(fmtDay(v.importedAt.slice(0, 10)))}` : '', tip: esc(CAMPS_DEFINITION), refresh: 'c-refresh' })}
    ${!v.camps.length ? `<div class="j-box j-box-grey">No camps for ${v.year} in the import yet. Run the camps import on the Mac to add them.</div>` : ''}
    <div class="jd-grid">
      <section class="jd-card jd-hero jm-hero jm-net" style="--i:0"><div>
        <p class="lbl">Net · ${v.year} camps</p>
        <p class="big" id="c-net">${t.netCents == null ? '–' : esc(money(t.netCents))}</p>
        <p class="jm-sum" id="c-sum"><span>Gross <b>${t.grossCents == null ? '–' : esc(money(t.grossCents))}</b></span> · <span>Refunds <b>${esc(money(t.refundsCents || 0))}</b></span> · <span>Costs <b>${t.costsCents == null ? '–' : esc(money(t.costsCents))}</b></span>${t.feesCents ? ` · <span>Stripe fees <b>${esc(money(t.feesCents))}</b></span>` : ''}</p>
        ${t.other.length ? `<p class="muted small">Not in these A$ totals: ${t.other.map((o) => `${plural(o.camps, 'camp')} in ${esc(o.currency)}`).join(', ')}.</p>` : ''}</div>
      </section>
      <div class="jm-tiles" data-n="4">${tiles.map(([k, l, val, col, note], i) => `<section class="jd-card jd-tile jm-tile" style="--i:${i + 1}" data-ctile="${k}"><span class="lbl"><span class="jd-key"><i style="background:var(${col})"></i>${esc(l)}</span></span><span class="val">${tileVal(k, val)}</span><span class="note">${esc(note)}</span></section>`).join('')}</div>
    </div>
    <section class="jd-card jh-sheet" id="c-camps-card"><h2>Camps in ${v.year}</h2><p class="sub">${plural(v.camps.length, 'camp')}, in date order</p>
      ${v.camps.length ? stackTable('c-camps', ['Camp', 'Players', 'Gross', 'Costs', 'Net'], v.camps.map((x) => [`${esc(x.camp)}<br><small class="muted">${esc([x.location, dates(x)].filter(Boolean).join(' · '))}${x.currency !== 'AUD' ? ` · ${esc(x.currency)}` : ''}</small>`, esc(x.players == null ? '–' : String(x.players)), amt(x.grossCents), amt(x.costsCents), `<b>${amt(x.netCents)}</b>`]), v.camps.length > 1 ? ['Total (A$)', esc(t.players == null ? '–' : String(t.players)), t.grossCents == null ? '–' : esc(money(t.grossCents)), t.costsCents == null ? '–' : esc(money(t.costsCents)), t.netCents == null ? '–' : esc(money(t.netCents))] : null) : '<p class="muted small">None yet.</p>'}
    </section>
    <div class="jh-groups">
      <section class="jd-card jh-card" id="c-loc"><h2>By location</h2><p class="sub">Net where the sheet has it</p>
        ${v.byLocation.length ? `<ul class="jm-feelist">${v.byLocation.map((l) => `<li><span>${esc(l.location)}<small>${plural(l.camps, 'camp')}${l.players != null ? ` · ${plural(l.players, 'player')}` : ''} · gross ${l.grossCents == null ? '–' : esc(money(l.grossCents))}${l.currency !== 'AUD' ? ` · ${esc(l.currency)}` : ''}</small></span><b>${l.netCents == null ? '–' : esc(money(l.netCents))}</b></li>`).join('')}</ul>` : '<p class="muted small">Nothing yet.</p>'}</section>
      <section class="jd-card jh-card" id="c-compare"><h2>Against ${c?.year || v.year - 1}</h2><p class="sub">The whole of each year's camps</p>
        ${c ? `<ul class="jm-feelist"><li><span>Net<small>${c.netCents == null ? 'not known' : esc(money(c.netCents))} in ${c.year}</small></span><b>${esc(diff(c.net) || '–')}</b></li><li><span>Gross<small>${c.grossCents == null ? 'not known' : esc(money(c.grossCents))} in ${c.year}</small></span><b>${esc(diff(c.gross) || '–')}</b></li><li><span>Camps<small>${c.camps} in ${c.year}</small></span><b>${t.camps - c.camps >= 0 ? '+' : '−'}${Math.abs(t.camps - c.camps)}</b></li>${c.playersDiff != null ? `<li><span>Players<small>${c.players} in ${c.year}</small></span><b>${c.playersDiff >= 0 ? '+' : '−'}${Math.abs(c.playersDiff)}</b></li>` : ''}</ul>` : `<p class="muted small">No camps imported for ${v.year - 1}.</p>`}</section>
      <section class="jd-card jh-card" id="c-stripe"><h2>Stripe sign-ups</h2><p class="sub">Camp registrations paid on the Sydney Stripe account in ${v.year}, read live</p><div id="c-stripe-body">${stripeCard(v, recall(`campsStripe:${v.year}`)?.data)}</div></section>
    </div>`
  bindTip(ui.view())
  bindSwitch(ui)
  const v$ = (s) => ui.view().querySelector(s)
  v$('#c-year').addEventListener('change', (e) => { ui.filter.year = Number(e.target.value); renderCampsMoney(ui) })
  v$('#c-refresh').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    try { await Promise.all([campsData(ui.post, { year: v.year, fresh: true }), campsStripeData(ui.post, { year: v.year, fresh: true })]); ui.toast('Camps read again') } catch (err) { ui.toast(err.message) }
    renderCampsMoney(ui)
  })
  v$('#c-csv').addEventListener('click', () => ui.saveFile(`jfp-camps-${v.year}.csv`, campsCsv(v, ui)))
}

function stackTable(id, head, rows, foot = null) {
  return `<div class="jp-scroll"><table class="jp-table jy-table jy-stack" id="${id}"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((cell, i) => (i ? `<td class="num" data-label="${esc(head[i])}">${cell}</td>` : `<th scope="row">${cell}</th>`)).join('')}</tr>`).join('')}${foot ? `<tr class="jv-total">${foot.map((cell, i) => (i ? `<td class="num" data-label="${esc(head[i])}"><b>${cell}</b></td>` : `<th scope="row">${cell}</th>`)).join('')}</tr>` : ''}</tbody></table></div>`
}

// The Stripe check fills its own card when it comes in; it never holds up the page.
async function fillStripe(ui, v) {
  const k = `campsStripe:${v.year}`
  const hit = recall(k)
  if (hit && Date.now() - hit.at < 120000 && !hit.data.quick) return
  let s
  try { s = await campsStripeData(ui.post, { year: v.year, quick: !hit }) } catch (e) { s = { error: e.message } }
  const put = (x) => { const el = ui.view().querySelector('#c-stripe-body'); if (el && !ui.stale() && ui.filter.year === v.year) el.innerHTML = stripeCard(v, x) }
  put(s)
  if (s.quick) { const later = await campsStripeData(ui.post, { year: v.year }).catch(() => null); if (later) put(later) }
}

// ui: { view, post, toast, filter, go, saveFile, csvCell, aud, stale() }
export async function renderCampsMoney(ui) {
  const year = Number(ui.filter.year) || 0
  const hit = recall(key(year))
  if (hit) { draw(ui, hit.data); fillStripe(ui, hit.data) } else {
    ui.view().innerHTML = `${moneyHead({ controls: programmeSwitch('camps'), loading: true, refresh: '' })}<p class="muted">Loading camps</p>`
    bindSwitch(ui)
  }
  if (hit && Date.now() - hit.at < 60000) return
  let v
  try { v = await campsData(ui.post, { year }) } catch (e) {
    if (hit || ui.stale()) return
    ui.view().innerHTML = `${moneyHead({ controls: programmeSwitch('camps'), refresh: '' })}<div class="j-box j-box-amber">${esc(e.message)}</div><button type="button" class="j-btn j-btn-line j-btn-sm" id="c-retry" style="margin-top:10px">Try again</button>`
    bindSwitch(ui)
    ui.view().querySelector('#c-retry').addEventListener('click', () => renderCampsMoney(ui))
    return
  }
  if (ui.stale()) return
  if (!hit || quietOk()) { const y = window.scrollY; draw(ui, v); window.scrollTo(0, y) }
  fillStripe(ui, v)
}
