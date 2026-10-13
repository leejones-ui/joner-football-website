// Money's programme picker, the short header every programme view shares,
// and the last reading of each programme kept in the page (Lee, 13 Oct 2026:
// "when I click on JFP / holiday training etc it takes a while to load").
//
// Switching paints the programme's last reading at once and asks for the
// latest behind it; after the first paint the other programmes are read
// quietly too, so the first switch is quick as well. Kept in memory only
// (never in the browser's storage: the figures have families in them).
import { esc } from './jfp-common.js'

export const PROGRAMMES = [['jfp', 'JFP'], ['juniors', 'Joners Juniors'], ['holiday', 'Holiday training'], ['pro', 'Pro sessions'], ['camps', 'Camps'], ['all', 'Everything']]
export const PROGRAMME_LABEL = Object.fromEntries(PROGRAMMES)
// Money views (#money?programme=...). Joners Juniors has its own page.
export const MONEY_VIEWS = new Set(['jfp', 'holiday', 'pro', 'camps', 'all'])

export function programmeSwitch(current) {
  return `<label class="jm-show jm-prog"><span class="muted small">Programme</span><select class="j-select" id="m-prog">${PROGRAMMES.map(([v, l]) => `<option value="${v}"${v === current ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`
}

// ui: { view, filter, go }. JFP, holiday, Pro, camps and Everything are views
// of Money; Joners Juniors has its Money page in its own section.
export function bindSwitch(ui) {
  ui.view().querySelector('#m-prog')?.addEventListener('change', (e) => {
    const want = e.target.value
    if (want === 'juniors') { ui.filter.programme = 'jfp'; return ui.go('jj-money', { instant: true }) }
    ui.filter.programme = MONEY_VIEWS.has(want) ? want : 'jfp'
    ui.go('money', { instant: true })
    history.replaceState(null, '', ui.filter.programme === 'jfp' ? '#money' : `#money?programme=${ui.filter.programme}`)
  })
}

const clock = (at) => {
  const d = at ? new Date(at) : new Date()
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' })
}
const dayClock = (at) => {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })
  return d.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' }) === today ? clock(at) : d.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

// The header: Money, the controls in one row, and one small line:
// "Updated 1:53 pm · Refresh (i)". tip is HTML (already escaped) for the (i).
// refresh: the id of the Refresh button, or '' for none.
export function moneyHead({ controls = '', at = '', note = '', tip = '', refresh = 'm-refresh', loading = false } = {}) {
  const when = loading ? 'Loading' : at ? `Updated ${esc(dayClock(at))}` : ''
  return `<div class="jd-head jm-head"><div class="jm-title"><h1>Money</h1><p class="jm-upd" id="m-upd">${[when ? `<span id="m-when">${when}</span>` : '', note ? `<span>${note}</span>` : ''].filter(Boolean).join(' · ')}${refresh ? `${when || note ? ' · ' : ''}<button type="button" class="jm-link" id="${refresh}">Refresh</button>` : ''}${tip ? ` <span class="jm-tipwrap"><button type="button" class="jm-tip" data-tip aria-expanded="false" aria-label="About these figures" title="About these figures">i</button></span>` : ''}</p>${tip ? `<div class="jm-tipbox" id="m-tipbox" role="note" hidden>${tip}</div>` : ''}</div><div class="jd-sync">${controls}</div></div>`
}
export function bindTip(root) {
  const b = root.querySelector('[data-tip]'), box = root.querySelector('#m-tipbox')
  if (!b || !box) return
  b.addEventListener('click', () => { box.hidden = !box.hidden; b.setAttribute('aria-expanded', String(!box.hidden)) })
}
// "Updated" after a quiet refresh.
export function markUpdated(root, at) {
  const el = root.querySelector('#m-when')
  if (el) el.textContent = `Updated ${dayClock(at)}`
}

// ---------- the last reading of each programme ----------

const KEPT = new Map()
export function remember(key, data) { KEPT.set(key, { data, at: Date.now() }) }
export function recall(key, maxAgeMs = Infinity) {
  const hit = KEPT.get(key)
  return hit && Date.now() - hit.at < maxAgeMs ? hit : null
}
export function forget(prefix = '') { for (const k of [...KEPT.keys()]) if (k.startsWith(prefix)) KEPT.delete(k) }

// A quiet redraw only when nobody is part way through something.
export function quietOk() {
  if (document.getElementById('jp-modal') || document.getElementById('jp-side') || document.getElementById('jp-menu') || document.querySelector('.jp-confirm-over, .j-sheet, .jf-changed, .jm-drawer, #m-tipbox:not([hidden])')) return false
  const a = document.activeElement
  return !(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName))
}

// After the first paint of any Money view: read the other programmes once,
// quietly and one at a time, so switching to them is quick. Runs again only
// when its readings are 10 minutes old. readers: [[programme, async fn]].
const PRE = { at: 0, running: false }
export function prefetchOthers(current, readers, { delayMs = 1200 } = {}) {
  if (PRE.running || Date.now() - PRE.at < 600000) return
  PRE.running = true
  setTimeout(async () => {
    try {
      for (const [prog, read] of readers) {
        if (prog === current || document.visibilityState === 'hidden') continue
        try { await read() } catch {}
      }
      PRE.at = Date.now()
    } finally { PRE.running = false }
  }, delayMs)
}
