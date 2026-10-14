// Money > Everything (Lee, 13 Oct 2026): every programme's money for one
// year, side by side. Each programme fills its own card as its figures come
// in (from the same quick readings its own view uses), so a slow one never
// holds up the rest. Taken is after refunds; kept is after Stripe's fees.
import { esc, money } from './jfp-common.js'
import { moneyHead, bindTip, programmeSwitch, bindSwitch, PROGRAMME_LABEL } from './jfp-portal-programmes.js'

export const EVERYTHING_DEFINITION = 'Each program for the calendar year picked. JFP: the year\'s terms (this term live; earlier terms from the payment ledger or your Money Register). Joners Juniors: its terms that year. Holiday training: by session date. Pro sessions: by the day the money came in. Camps: from the camp sheets, before camp costs (the Camps view has net after costs). Taken is after refunds; kept is after Stripe\'s fees where they are known (older JFP terms from the register have none).'
const ORDER = ['jfp', 'juniors', 'holiday', 'pro', 'camps']
const inYear = (rows, year) => rows.filter((r) => String(r.month || '').startsWith(`${year}-`))
const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)

// From each programme's own reading to { takenCents, keptCents, note }, or null (no figures that year).
export const FIGURES = {
  jfp: (y) => {
    if (!y) return null
    const s = y.scopes?.[''] || {}
    // Older terms (the register) have no Stripe fees: kept is after the fees that are known.
    const notes = [y.soFar ? `${y.current} still running` : '', y.missing?.length ? `no figures for ${y.missing.join(', ')}` : '', s.noFeeTerms?.length ? `no Stripe fees for ${s.noFeeTerms.join(', ')}` : ''].filter(Boolean)
    return { takenCents: s.takenCents || 0, keptCents: (s.takenCents || 0) - (s.stripeFeeCents || 0), note: notes.join(' · ') || `${(y.sources || []).length} terms` }
  },
  juniors: (d, year) => {
    const y = (d?.years || []).find((x) => Number(x.year) === year)
    return y ? { takenCents: y.takenCents || 0, keptCents: y.keptCents ?? null, note: `${(y.terms || []).length} term${(y.terms || []).length === 1 ? '' : 's'}` } : null
  },
  holiday: (v, year) => {
    const rows = inYear(v?.byMonth?.session || [], year)
    return rows.length ? { takenCents: sum(rows, 'takenCents') - sum(rows, 'refundedCents'), keptCents: sum(rows, 'keptCents'), note: `${sum(rows, 'count')} payment${sum(rows, 'count') === 1 ? '' : 's'}` } : null
  },
  pro: (v, year) => {
    const rows = inYear(v?.byMonth || [], year)
    return rows.length ? { takenCents: sum(rows, 'takenCents') - sum(rows, 'refundedCents'), keptCents: sum(rows, 'keptCents'), note: `${sum(rows, 'count')} payment${sum(rows, 'count') === 1 ? '' : 's'}` } : null
  },
  camps: (v, year) => {
    if (!v || v.year !== year || !v.camps?.length) return null
    const t = v.totals
    const taken = (t.grossCents || 0) - (t.refundsCents || 0)
    return { takenCents: taken, keptCents: taken - (t.feesCents || 0), note: `${t.camps} camp${t.camps === 1 ? '' : 's'}${t.netCents != null ? ` · ${money(t.netCents)} after costs` : ''}` }
  },
}

function card(prog, state) {
  const label = PROGRAMME_LABEL[prog]
  const body = state === undefined ? '<p class="muted small">Loading</p>'
    : state?.error ? `<p class="muted small">${esc(state.error)}</p>`
      : state === null ? '<p class="muted small">No figures for this year.</p>'
        : `<p class="je-kept"><span class="lbl">Kept</span><b>${state.keptCents == null ? '–' : esc(money(state.keptCents))}</b></p><p class="je-taken">Taken <b>${esc(money(state.takenCents))}</b></p><p class="muted small">${esc(state.note || '')}</p>`
  return `<section class="jd-card je-card" data-eprog="${prog}"><h2>${esc(label)}</h2>${body}<button type="button" class="jm-link je-open" data-eopen="${prog}">Open ${esc(label)}</button></section>`
}
function totalCard(states) {
  const got = ORDER.filter((p) => states[p] && !states[p].error)
  const waiting = ORDER.filter((p) => states[p] === undefined).map((p) => PROGRAMME_LABEL[p])
  const failed = ORDER.filter((p) => states[p]?.error).map((p) => PROGRAMME_LABEL[p])
  const kept = got.every((p) => states[p].keptCents != null) ? sum(got.map((p) => states[p]), 'keptCents') : null
  return `<section class="jd-card jd-hero jm-hero jm-net je-total" id="e-total"><div><p class="lbl">Kept after Stripe fees, every program</p><p class="big" id="e-kept">${kept == null ? '–' : esc(money(kept))}</p>
    <p class="jm-sum"><span>Taken <b id="e-taken">${esc(money(sum(got.map((p) => states[p]), 'takenCents')))}</b></span></p>
    ${waiting.length ? `<p class="muted small">Still loading: ${esc(waiting.join(', '))}</p>` : ''}${failed.length ? `<p class="muted small">Not counted (could not be read): ${esc(failed.join(', '))}</p>` : ''}${got.some((p) => states[p].keptCents == null) ? '<p class="muted small">Kept is blank while a program\'s fees are not known.</p>' : ''}</div></section>`
}

// ui: { view, filter, go, readers: { jfp(year), juniors(), holiday(), pro(), camps(year) }, stale() }
export async function renderEverything(ui) {
  const now = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }).slice(0, 4))
  const year = Number(ui.filter.year) >= 2020 && Number(ui.filter.year) <= now ? Number(ui.filter.year) : now
  ui.filter.year = year
  history.replaceState(null, '', `#money?programme=all&year=${year}`)
  const states = {}
  const picker = `<label class="jm-show"><span class="muted small">Year</span><select class="j-select" id="e-year">${[0, 1, 2, 3].map((n) => now - n).map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>`
  ui.view().innerHTML = `${moneyHead({ controls: `${programmeSwitch('all')}${picker}`, at: new Date().toISOString(), tip: esc(EVERYTHING_DEFINITION), refresh: '' })}
    <div id="e-total-wrap">${totalCard(states)}</div>
    <div class="je-grid" id="e-grid">${ORDER.map((p) => card(p, undefined)).join('')}</div>`
  bindTip(ui.view())
  bindSwitch(ui)
  ui.view().querySelector('#e-year').addEventListener('change', (e) => { ui.filter.year = Number(e.target.value); renderEverything(ui) })
  ui.view().querySelector('#e-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-eopen]')
    if (!b) return
    const p = b.dataset.eopen
    if (p === 'juniors') { ui.filter.programme = 'jfp'; return ui.go('jj-money', { instant: true }) }
    if (p === 'jfp') Object.assign(ui.moneyFilter || {}, { year: year === now ? '' : String(year), term: '' })
    ui.filter.programme = p
    ui.go('money', { instant: true })
  })
  const put = (p, state) => {
    if (ui.stale() || Number(ui.filter.year) !== year) return
    states[p] = state
    const el = ui.view().querySelector(`[data-eprog="${p}"]`)
    if (el) el.outerHTML = card(p, state)
    const t = ui.view().querySelector('#e-total-wrap')
    if (t) t.innerHTML = totalCard(states)
  }
  await Promise.all(ORDER.map(async (p) => {
    try { put(p, FIGURES[p](await ui.readers[p](year), year)) } catch (e) { put(p, { error: e?.message || 'Could not be read just now.' }) }
  }))
}
