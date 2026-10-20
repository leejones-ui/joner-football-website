// Progress over the terms (Lee, 20 Oct 2026): "A few skill ratings on each
// report, shown as a progress line on the family's page". One card per
// player at the top of Player reports: a small line of the overall level
// term by term, and each skill's level now with an arrow against the report
// before. Built on the server from sent reports only (api/_jfp-progress.js).
import { esc } from './jfp-common.js'
import { first } from './jfp-account-ui.js'

const ARROW = {
  up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5 13 9H9.6v3.5H6.4V9H3z"/></svg>',
  down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5 3 7h3.4V3.5h3.2V7H13z"/></svg>',
  same: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6.6h9v2.8h-9z"/></svg>',
}
const SAID = { up: 'Up', down: 'Down', same: 'The same' }
const short = (p) => `T${p.termNo} ${p.year}`
const one = (v) => (v == null ? '' : Number(v).toFixed(1))

// The overall level per term as a small line. Scale 1 to 5 up the side.
export function progressChart(points) {
  const W = 320, H = 136, L = 24, R = 16, T = 20, B = 26
  const pts = points.filter((p) => p.overall != null)
  const n = pts.length
  const P = 24 // room so the first and last dots and their labels clear the edges
  const x = (i) => (n === 1 ? L + (W - L - R) / 2 : L + P + ((W - L - R - 2 * P) * i) / (n - 1))
  const y = (v) => T + ((5 - v) / 4) * (H - T - B)
  const grid = [1, 2, 3, 4, 5].map((v) => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`).join('')
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.overall).toFixed(1)}`).join(' ')
  const area = n > 1 ? `<path class="a" d="${line} L${x(n - 1).toFixed(1)} ${y(1)} L${x(0).toFixed(1)} ${y(1)} Z"/>` : ''
  const showLabel = (i) => n <= 6 || i === 0 || i === n - 1
  const dots = pts.map((p, i) => `<circle class="${i === n - 1 ? 'd now' : 'd'}" cx="${x(i).toFixed(1)}" cy="${y(p.overall).toFixed(1)}" r="${i === n - 1 ? 5.5 : 4}"/>
    ${showLabel(i) ? `<text class="v" x="${x(i).toFixed(1)}" y="${(y(p.overall) - 10).toFixed(1)}" text-anchor="middle">${esc(one(p.overall))}</text><text class="ax" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(short(p))}</text>` : ''}`).join('')
  const said = pts.map((p) => `${p.label} ${one(p.overall)}`).join(', ')
  return `<svg class="ja-prog-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Overall level by term, out of 5: ${said}`)}">${grid}${area}${n > 1 ? `<path class="l" d="${line}"/>` : ''}${dots}</svg>`
}

function summary(p) {
  const now = p.overall.now
  if (p.count < 2) return now != null ? `Overall ${esc(one(now))} out of 5 on the ${esc(p.points.at(-1).label)} report.` : ''
  const o = p.overall
  const lead = o.change === 'up' ? `up from ${esc(one(o.prev))}` : o.change === 'down' ? `down from ${esc(one(o.prev))}` : o.change === 'same' ? 'the same as' : 'compared with'
  const head = now != null ? `Overall ${esc(one(now))} out of 5, ${lead} in ${esc(p.since)}.` : ''
  const c = p.counts
  const parts = [c.up && `up in ${c.up}`, c.same && `the same in ${c.same}`, c.down && `down in ${c.down}`].filter(Boolean)
  const tail = parts.length ? ` Skills: ${parts.join(', ')}.` : ''
  return head + tail
}

export function progressCard(p) {
  const rated = p.skills.filter((s) => s.now != null)
  const many = p.count > 1
  return `<article class="ja-card ja-prog">
    <div class="ja-prog-head"><h2>${esc(first(p.player))}'s progress</h2><span class="ja-muted">${esc(p.count === 1 ? p.points[0].label : `${p.points[0].label} to ${p.points.at(-1).label}`)}</span></div>
    ${progressChart(p.points)}
    ${many ? '' : '<p class="ja-prog-start">Your progress line starts here. It grows with each term\'s report.</p>'}
    <p class="ja-prog-sum">${summary(p)}</p>
    ${rated.length ? `<ul class="ja-prog-list${many ? '' : ' is-first'}">${rated.map((s) => `<li><span class="nm">${esc(s.l)}</span><span class="lv">${esc(s.word)}</span>${many ? (s.change ? `<span class="ar ${s.change}" title="${esc(`${SAID[s.change]} since ${p.since}`)}">${ARROW[s.change]}<span class="sr-only">${esc(`${SAID[s.change]} since ${p.since}`)}</span></span>` : '<span class="ar none" title="Not rated last time"><span class="sr-only">Not rated last time</span></span>') : ''}</li>`).join('')}</ul>` : ''}
  </article>`
}

// progress: [{ player, count, points, skills, counts, overall, since }]
export function progressHtml(progress) {
  const list = (progress || []).filter((p) => p.count > 0)
  if (!list.length) return ''
  return `<p class="ja-label">Progress</p>${list.map(progressCard).join('')}<p class="ja-label">Reports</p>`
}
