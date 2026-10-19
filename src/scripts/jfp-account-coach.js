// Your coach (Lee, 20 Oct 2026): families see the profile of the coaches on
// their child's group, only while Lee has it switched on (the API leaves
// enrolment.coaches out otherwise). Never a coach's email or mobile here.
import { esc, openSheet } from './jfp-common.js'
import { first } from './jfp-account-ui.js'

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

export function coachSheet(id) {
  const c = KNOWN.get(id)
  if (!c) return
  const sheet = openSheet({ title: c.name, subtitle: [c.role, c.since ? c.since.replace(/^Since/, 'At Joner Football since') : ''].filter(Boolean).join(' · ') })
  const sec = (t, body) => (body ? `<div class="ja-cp-sec"><p class="ja-label">${esc(t)}</p>${body}</div>` : '')
  const ul = (list, fn) => (list?.length ? `<ul class="ja-cp-list">${list.map(fn).join('')}</ul>` : '')
  sheet.body.innerHTML = `<div style="display:flex;justify-content:center;margin-bottom:12px">${face(c, 120)}</div>
    ${c.about ? `<p style="white-space:pre-line">${esc(c.about)}</p>` : `<p class="ja-muted">${esc(first(c.name))} has not written a profile yet.</p>`}
    ${sec('Playing', (c.highest ? `<p>Highest level: <b>${esc(c.highest)}</b></p>` : '') + ul(c.playing, (x) => `<li><b>${esc(x.club)}</b>${x.level ? `, ${esc(x.level)}` : ''}${x.years ? ` <span class="ja-muted">${esc(x.years)}</span>` : ''}</li>`))}
    ${sec('Coaching', ul(c.coaching, (x) => `<li><b>${esc(x.club)}</b>${x.team ? `, ${esc(x.team)}` : ''}${x.years ? ` <span class="ja-muted">${esc(x.years)}</span>` : ''}</li>`))}
    ${sec('Qualifications', ul(c.quals, (x) => `<li>${esc(x.name)}${x.year ? ` <span class="ja-muted">${esc(x.year)}</span>` : ''}</li>`))}
    ${sec('Coaches best', [c.skills?.length ? `<p>${esc(c.skills.map((s) => SKILLS[s] || s).join(', '))}</p>` : '', c.ages?.length ? `<p class="ja-small ja-muted">Ages: ${esc(c.ages.join(', '))}</p>` : ''].join(''))}
    ${sec('Speaks', c.languages ? `<p>${esc(c.languages)}</p>` : '')}
    ${sec('Favourite player or team', c.favourite ? `<p>${esc(c.favourite)}</p>` : '')}
    ${sec('What I want every player to leave with', c.leaveWith ? `<p>${esc(c.leaveWith)}</p>` : '')}`
}
