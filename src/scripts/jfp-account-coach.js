// Your coach (Lee, 20 Oct 2026): families see the profile of the coaches on
// their child's group, only while Lee has it switched on (the API leaves
// enrolment.coaches out otherwise). Never a coach's email or mobile here.
import { esc, openSheet } from './jfp-common.js'
import { first, pageHead } from './jfp-account-ui.js'
import { ic } from './jfp-account-icons.js'

const SKILLS = { speed: 'Speed and agility', ball: 'Ball mastery', dribble: 'Dribbling', pass: 'Passing and first touch', shoot: 'Shooting and finishing', '1v1': '1v1s and 2v2s', defend: 'Defending', head: 'Heading', aware: 'Awareness and scanning', gk: 'Goalkeeping' }
const KNOWN = new Map()
const face = (c, size) => c.photo
  ? `<img src="${esc(c.photo)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;object-position:50% 20%;flex:none">`
  : `<span aria-hidden="true" style="width:${size}px;height:${size}px;border-radius:50%;background:var(--ja-soft,#eef0f3);display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex:none">${esc(String(c.name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2))}</span>`

// The coach row on a player's card on the Family tab.
export function coachRow(p) {
  const seen = new Map()
  for (const e of p.enrolments || []) for (const c of e.coaches || []) if (!seen.has(c.id)) seen.set(c.id, c)
  if (!seen.size) return ''
  for (const c of seen.values()) KNOWN.set(c.id, c)
  return `<div class="ja-coach-row"><span class="ja-small ja-muted">${seen.size === 1 ? 'Coach' : 'Coaches'}</span>${[...seen.values()].map((c) => `<button type="button" class="ja-coach-chip" data-coach-profile="${esc(c.id)}">${face(c, 32)}<span><b>${esc(c.name)}</b>${c.role ? `<small>${esc(c.role)}</small>` : ''}</span></button>`).join('')}</div>`
}

// Our coaches (Lee, 29 Oct 2026: a parent asked for a link to read about the
// coaches). Every finished profile; tap one for the whole profile.
const snippet = (t, n = 150) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, s.lastIndexOf(' ', n)).replace(/[,.;:]$/, '')}...` : s }
export function renderCoaches(el, D) {
  const list = D.ourCoaches || []
  for (const c of list) KNOWN.set(c.id, c)
  el.innerHTML = `${pageHead('Joner Football', 'Our coaches', 'The coaches who run every JFP session. Tap a coach to read their story.')}
    ${list.length ? `<div class="ja-coaches">${list.map((c) => `<button type="button" class="ja-card ja-coach-card" data-coach-profile="${esc(c.id)}">
      ${face(c, 88)}<span class="ja-coach-txt"><b class="ja-h3">${esc(c.name)}</b>${c.role || c.since ? `<small class="ja-muted">${esc([c.role, c.since ? c.since.replace(/^Since/, 'With us since') : ''].filter(Boolean).join(' · '))}</small>` : ''}<span class="ja-small">${esc(snippet(c.about))}</span><span class="ja-coach-more">Read more${ic('right')}</span></span></button>`).join('')}</div>`
    : '<div class="ja-card"><p class="ja-muted">Coach profiles are on their way.</p></div>'}`
}

// The full profile (Lee, 29 Oct 2026: "clean that up in terms of it all
// matching"): one row style for playing and coaching, qualifications as tags,
// coaching photos, Off the pitch, and the leave-with line as a quote.
// "Coaches best" is no longer shown to families.
const paras = (t) => String(t || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join('')
export function coachSheet(id) {
  const c = KNOWN.get(id)
  if (!c) return
  const since = c.since ? c.since.replace(/^Since /, '').replace(/ · .*/, '') : ''
  const sheet = openSheet({ title: c.name, subtitle: [c.role, since ? `At Joner Football since ${since}` : ''].filter(Boolean).join(' · ') })
  const sec = (t, body) => (body ? `<section class="ja-cp-sec"><h4 class="ja-cp-h">${esc(t)}</h4>${body}</section>` : '')
  const rows = (list, sub) => (list?.length ? `<div class="ja-cp-rows">${list.map((x) => `<div class="ja-cp-row"><span><b>${esc(x.club)}</b>${sub(x) ? `<small>${esc(sub(x))}</small>` : ''}</span>${x.years ? `<em>${esc(x.years)}</em>` : ''}</div>`).join('')}</div>` : '')
  const facts = [c.highest, c.quals?.[0]?.name, since ? `JF since ${since.replace(/^\w+ /, '')}` : ''].filter(Boolean)
  const off = [['Hobbies', c.hobbies], ['Favourite team', c.favTeam], ['Favourite players', c.favPlayers], ...(c.favTeam || c.favPlayers ? [] : [['Favourite player or team', c.favourite]]), ['Fun fact', c.funFact], ['Speaks', c.languages]].filter(([, v]) => v)
  const gal = c.gallery || []
  sheet.body.innerHTML = `<div class="ja-cp">
    <div class="ja-cp-hero">${face(c, 112)}${facts.length ? `<div class="ja-cp-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}${c.coachesOn?.length ? `<div class="ja-cp-on">${ic('calendar')}<span>${c.coachesOn.map((x) => `<span>${esc(x)}</span>`).join('')}</span></div>` : ''}</div>
    ${c.about ? `<div class="ja-cp-about">${paras(c.about)}</div>` : `<p class="ja-muted">${esc(first(c.name))} has not written a profile yet.</p>`}
    ${gal.length ? `<section class="ja-cp-sec"><h4 class="ja-cp-h">On the pitch</h4><div class="ja-cp-gal">${gal.map((g, i) => `<button type="button" class="ja-cp-ph" data-gal="${i}"><img src="${esc(g.url)}" alt="${esc(g.caption || `${first(c.name)} coaching`)}" loading="lazy">${g.caption ? `<small>${esc(g.caption)}</small>` : ''}</button>`).join('')}</div></section>` : ''}
    ${c.leaveWith ? `<blockquote class="ja-cp-quote"><h4 class="ja-cp-h">What I want every player to leave with</h4>${paras(c.leaveWith)}</blockquote>` : ''}
    ${sec('Playing', rows(c.playing, (x) => x.level))}
    ${sec('Coaching', rows(c.coaching, (x) => x.team))}
    ${sec('Qualifications', c.quals?.length ? `<div class="ja-cp-tags">${c.quals.map((q) => `<span>${esc(q.name)}${q.year ? ` <i>${esc(q.year)}</i>` : ''}</span>`).join('')}</div>` : '')}
    ${c.drill ? sec('My favourite drill', `<div class="ja-cp-rows"><div class="ja-cp-row"><span><b>${esc(c.drill.name)}</b>${c.drill.url ? '<small>In the Joner Football app</small>' : ''}</span>${c.drill.url ? `<a class="ja-btn ja-btn-line ja-btn-sm" href="${esc(c.drill.url)}" target="_blank" rel="noopener noreferrer">Watch</a>` : ''}</div></div>`) : ''}
    ${sec('Off the pitch', off.length ? `<dl class="ja-cp-off">${off.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '')}
    ${c.links?.length ? `<div class="ja-cp-sec ja-cp-links">${c.links.map((l, i) => `<a class="ja-btn ${i ? 'ja-btn-line' : 'ja-btn-red'} ja-btn-block" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}${ic('ext', 'ext')}</a>`).join('')}</div>` : ''}
  </div>`
  // A coaching photo full size; tap anywhere to close.
  sheet.body.querySelectorAll('[data-gal]').forEach((b) => b.addEventListener('click', () => {
    const g = gal[Number(b.dataset.gal)]
    const o = document.createElement('div')
    o.className = 'ja-cp-zoom'
    o.innerHTML = `<img src="${esc(g.url)}" alt="">${g.caption ? `<p>${esc(g.caption)}</p>` : ''}`
    o.addEventListener('click', () => o.remove())
    document.body.append(o)
  }))
}
