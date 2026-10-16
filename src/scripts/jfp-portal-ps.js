// The portal design system's shared pieces (Lee, 14 Oct 2026). Every staff
// list page uses them in this order: psHead (title, count, main action,
// More), a .ps-tools toolbar (psSearch, then psSelect filters in a fixed
// order, More filters, Clear, an Updated line), psChips (quick filters with
// counts), then a .ps-table (it becomes cards on a phone) with psBadge for
// any status. CSS: the "Portal design system" block in jfp-portal.css.
import { esc } from './jfp-common.js'

const SEARCH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2" stroke-linecap="round"/></svg>'
export function psHead({ title, count = '', primary = '', more = false }) {
  return `<header class="ps-head"><div class="ps-title"><h1>${esc(title)}</h1>${count !== '' ? `<span class="ps-count">${esc(count)}</span>` : ''}</div>
    <div class="ps-actions">${more ? '<button type="button" class="j-btn j-btn-line" id="ps-more" aria-haspopup="menu">More</button>' : ''}${primary}</div></header>`
}
export function psSearch(id, placeholder, value, label) {
  return `<label class="ps-search"><span class="sr-only">${esc(label || placeholder)}</span>${SEARCH_SVG}<input class="j-input" id="${id}" type="search" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off"></label>`
}
export function psSelect(id, list, value, blank, label) {
  return `<select class="j-select ${value ? 'is-set' : ''}" id="${id}" aria-label="${esc(label || blank)}"><option value="">${esc(blank)}</option>${list.map((x) => `<option value="${esc(x.id)}" ${value === x.id ? 'selected' : ''}>${esc(x.label || x.name)}</option>`).join('')}</select>`
}
export const PS_PAY = { paid: ['green', 'Paid'], part: ['orange', 'Part paid'], unpaid: ['red', 'Unpaid'], session: ['pink', 'Session by session'] }
// The "?" help: guidance one tap away instead of a paragraph (Money redesign, 16 Oct 2026).
export function psHelp(text, label = 'About this') {
  return `<details class="ps-help jm-help"><summary aria-label="${esc(label)}" title="${esc(label)}">?</summary><div class="ps-help-body">${esc(text)}</div></details>`
}
export function psBadge(color, label) { return `<span class="ps-badge ${color}"><i></i>${esc(label)}</span>` }
// Quick filter chips. list: [{ key, value, label, count, color }] where color
// is a ps-badge colour (red, orange, green, pink, violet, grey). pressed(key, value).
const CHIP_COLOR = { red: '#E5383B', orange: '#F97316', green: '#12B76A', pink: '#EC4899', violet: '#7A5AF8', grey: '#98A2B3' }
export function psChips(list, pressed, id = '') {
  const shown = list.filter((c) => c.count > 0 || pressed(c.key, c.value))
  return shown.length ? `<div class="ps-chips" ${id ? `id="${id}"` : ''} aria-label="Quick filters">${shown.map((c) => `<button type="button" class="ps-chip" data-chip="${esc(c.key)}:${esc(c.value)}" aria-pressed="${pressed(c.key, c.value)}">${c.color ? `<i style="background:${CHIP_COLOR[c.color] || c.color}"></i>` : ''}${esc(c.label)} <b>${c.count}</b></button>`).join('')}</div>` : ''
}
// The More filters and Clear links. open: More filters showing; set: how
// many of those are set; active: any filter set at all.
export function psToolsMore(prefix, { open, set, active, hasMore = true }) {
  return `${hasMore ? `<button type="button" class="ps-link" id="${prefix}-morefilters" aria-expanded="${Boolean(open)}" aria-controls="${prefix}-morebox">${open ? 'Fewer filters' : `More filters${set ? ` (${set})` : ''}`}</button>` : ''}${active ? `<button type="button" class="ps-link" id="${prefix}-clear">Clear</button>` : ''}`
}
