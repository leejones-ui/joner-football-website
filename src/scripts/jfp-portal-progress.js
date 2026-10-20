// Progress over the terms (Lee, 20 Oct 2026), the coach's side: while a
// coach writes a new report, each skill shows the level on the player's last
// sent report, with an arrow once a new rating is picked. The server only
// sends these for a player this coach may report on (reportStart).
import { esc } from './jfp-common.js'

const ARROW = { up: '↑', down: '↓', same: '=' }
const SAID = { up: 'Up on last time', down: 'Down on last time', same: 'Same as last time' }

// last: { label, sentAt, overall, ratings: { k: 1..5 } } or null
export function lastIntro(last, dateLabel) {
  if (!last) return ''
  return `<p class="pgr-intro small">Last report: <b>${esc(last.label)}</b>${last.sentAt ? `, sent ${esc(dateLabel(last.sentAt))}` : ''}${last.overall != null ? `, overall ${esc(last.overall)}` : ''}. Its level shows under each skill so you can see the change.</p>`
}

export function lastTag(last, k, scale, now) {
  if (!last) return ''
  return `<small class="pgr-last" data-pgr="${esc(k)}">${tagInner(last, k, scale, now)}</small>`
}

function tagInner(last, k, scale, now) {
  const v = last.ratings?.[k] || 0
  if (!v) return 'Last: not rated'
  const ch = now ? (now > v ? 'up' : now < v ? 'down' : 'same') : ''
  return `Last: ${v} ${esc(scale[v - 1])}${ch ? ` <span class="pgr-ch ${ch}" title="${esc(SAID[ch])}" aria-label="${esc(SAID[ch])}">${ARROW[ch]}</span>` : ''}`
}

// After a rating changes.
export function refreshTag(row, last, k, scale, now) {
  const el = row.querySelector('[data-pgr]')
  if (el && last) el.innerHTML = tagInner(last, k, scale, now)
}
