// Session ideas (Lee, 19 Oct 2026): one place for coaches to find drills and
// whole sessions. Search across the JF App's videos (from Uscreen), Lee's
// spreadsheet of drill links by topic, the old JFP programs week by week, and
// how we plan a JFP session. Lee and Ligia keep the quick links (Edit).
import { esc } from './jfp-common.js'

// Topics cut across every source, matched on titles, tags and app categories.
const TOPICS = [
  ['speed', 'Speed and agility', /speed|agility|saq|reaction|footwork|fast feet|speedo/i],
  ['ball', 'Ball mastery', /ball mastery|ball work|ball skills|juggl/i],
  ['dribble', 'Dribbling', /dribbl|change direction|turn/i],
  ['pass', 'Passing and first touch', /pass|first touch|1st touch|combination|rondo/i],
  ['shoot', 'Shooting and finishing', /shoot|finish|strik|goal scor/i],
  ['1v1', '1v1s and 2v2s', /1v1|2v2|1 v 1|one v one/i],
  ['defend', 'Defending', /defend/i],
  ['head', 'Heading', /heading/i],
  ['aware', 'Awareness and scanning', /aware|cognit|scan|decision/i],
  ['warm', 'Warm ups', /warm[- ]?up|activation|prehab/i],
  ['gk', 'Goalkeepers', /goalkeep|keeper|\bgk\b/i],
  ['session', 'Full sessions', /full (training )?session|follow-along|session\b/i],
]
const SOURCES = [['all', 'Everything'], ['app', 'JF App'], ['sheet', 'Drill links'], ['coach', 'From coaches'], ['programs', 'JFP programs'], ['plan', 'How we plan']]
const S = { q: '', topic: '', place: '', source: 'all', app: null, appState: 'idle', shown: 48 }
// Where a drill is filmed (Lee, 20 Oct 2026): helps plan for HQ or the field.
const PLACES = [['', 'Anywhere'], ['hq', 'HQ (indoor)'], ['field', 'Field']]
const placeBadge = (p) => (p === 'hq' ? '<span class="ji-place">HQ</span>' : p === 'field' ? '<span class="ji-place ji-field">Field</span>' : '')
const PLATFORMS = [[/instagram\.com/, 'Instagram'], [/tiktok\.com/, 'TikTok'], [/youtube\.com|youtu\.be/, 'YouTube'], [/(^|\.)x\.com|twitter\.com/, 'X'], [/facebook\.com|fb\.watch/, 'Facebook']]
const platformOf = (u) => (PLATFORMS.find(([re]) => re.test(host(u))) || [0, host(u) || 'Link'])[1]
const topicLabel = (id) => (TOPICS.find((t) => t[0] === id) || [0, 'Other'])[1]

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
const norm = (s) => String(s || '').toLowerCase()
const topicsOf = (text) => TOPICS.filter((t) => t[2].test(text)).map((t) => t[0])

export async function renderIdeas(ui) {
  const { view, post, need, toast } = ui
  const [d, lr] = await Promise.all([post('ideasGet').then(need), post('ideasLinks')])
  // Links coaches add themselves (Lee, 20 Oct 2026), filed under a topic.
  let coachLinks = lr.ok ? lr.data.links || [] : []
  const coachItems = () => coachLinks.map((l) => ({ ...l, kind: 'coach', platform: platformOf(l.url), topicName: topicLabel(l.topic), hay: norm(`${topicLabel(l.topic)} ${l.title} ${l.note || ''} ${l.by} ${platformOf(l.url)}`), topics: [...new Set([l.topic, ...topicsOf(`${l.title} ${l.note || ''}`)])] }))
  const lib = d.library || []
  const programs = d.programs || []
  const guide = d.guide || null
  // One flat list of drill links from the sheet, each tagged with its sheet topic.
  const sheet = lib.flatMap((t) => t.links.map((l) => ({ ...l, topic: t.topic, kind: 'sheet', hay: norm(`${t.topic} ${l.title || ''} ${l.by || ''} ${l.platform}`), topics: topicsOf(`${t.topic} ${l.title || ''}`) })))
  const appItems = () => (S.app || []).map((v) => ({ ...v, kind: 'app', hay: norm(`${v.title} ${v.text} ${v.cats.join(' ')} ${v.tags.join(' ')}`), topics: topicsOf(`${v.title} ${v.cats.join(' ')} ${v.tags.join(' ')}`) }))

  const loadApp = async () => {
    if (S.appState !== 'idle') return
    S.appState = 'loading'
    const r = await post('ideasApp')
    S.app = r.ok ? r.data.videos : []
    S.appState = r.ok && S.app.length ? 'ready' : 'failed'
    paint()
  }

  const match = (x) => (!S.place || x.place === S.place) && (!S.topic || x.topics.includes(S.topic)) && (!S.q || S.q.split(/\s+/).every((w) => x.hay.includes(w)))
  const card = (x) => {
    if (x.kind === 'coach') return `<div class="ji-cw"><a class="j-card ji-card" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">
        <span class="ji-img ji-${esc(norm(x.platform))}"><span class="ji-plat">${esc(x.platform)}</span><span class="ji-badge ji-coach">From ${esc(String(x.by).split(' ')[0])}</span>${placeBadge(x.place)}</span>
        <span class="ji-bd"><b>${esc(x.title)}</b><span class="muted small">${esc(x.topicName)}${x.note ? ` · ${esc(x.note)}` : ''}</span></span></a>
        ${x.canRemove ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm ji-rm" data-il-rm="${esc(x.id)}">Remove</button>` : ''}</div>`
    if (x.kind === 'app') return `<a class="j-card ji-card" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">
        <span class="ji-img">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : ''}<span class="ji-badge ji-app">JF App</span>${placeBadge(x.place)}${x.min ? `<span class="ji-min">${x.min} min</span>` : ''}</span>
        <span class="ji-bd"><b>${esc(x.title)}</b>${x.text ? `<span class="muted small">${esc(x.text)}</span>` : ''}<span class="ji-tags">${x.cats.slice(0, 2).map((c) => `<i>${esc(c)}</i>`).join('')}</span></span></a>`
    const title = x.title || `${x.topic}${x.short ? ' (short clip)' : ''}`
    return `<a class="j-card ji-card" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">
        <span class="ji-img ji-${esc(norm(x.platform))}">${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : `<span class="ji-plat">${esc(x.platform)}</span>`}<span class="ji-badge">${esc(x.platform)}</span></span>
        <span class="ji-bd"><b>${esc(title)}</b><span class="muted small">${esc(x.by ? `${x.by} · ` : '')}${esc(x.topic)}</span>${x.gone ? '<span class="small" style="color:var(--j-amber,#b45309)">May have been taken down</span>' : ''}</span></a>`
  }
  const progHtml = () => {
    const rows = programs.map((p, pi) => {
      const sess = p.sessions.filter((s) => {
        const hay = norm(`${p.name} ${s.name} ${s.topic} ${s.items.map((i) => `${i.label || ''} ${i.title || ''} ${i.note || ''}`).join(' ')}`)
        return (!S.q || S.q.split(/\s+/).every((w) => hay.includes(w))) && (!S.topic || topicsOf(`${s.topic} ${s.items.map((i) => `${i.label || ''} ${i.title || ''}`).join(' ')}`).includes(S.topic))
      })
      if (!sess.length) return ''
      return `<details class="j-card ji-prog" ${S.q || S.topic || pi === 0 ? 'open' : ''}><summary><b>${esc(p.name)}</b><span class="muted small">${sess.length} session${sess.length === 1 ? '' : 's'}</span></summary>
        ${sess.map((s) => `<div class="ji-sess"><p><b>${esc(s.name)}</b> <span class="muted">${esc(s.topic)}</span></p><ul>${s.items.map((i) => i.url
          ? `<li><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.label || 'Video')}</a> <span class="muted small">${esc(i.title ? i.title : i.platform)}</span></li>`
          : `<li class="muted">${esc(i.note)}</li>`).join('')}</ul></div>`).join('')}</details>`
    }).join('')
    return rows || '<p class="muted">No program sessions match.</p>'
  }
  const planHtml = () => !guide ? '' : `<div class="ji-plan">
      <div class="j-card" style="padding:16px"><p class="ji-kick">Every session</p><ol class="ji-steps">${guide.steps.map((s) => `<li><b>${esc(s.t)}</b><span class="muted small">${esc(s.d)}</span></li>`).join('')}</ol></div>
      <div class="j-card" style="padding:16px"><p class="ji-kick">A 10 week block</p><ol class="ji-steps">${guide.topics.map((t) => `<li><b>${esc(t)}</b></li>`).join('')}</ol><p class="muted small" style="margin-top:8px">The first three set the base. Sessions 7 to 10 need to be challenging and add pressure.</p></div></div>`

  const quick = () => `<div class="ji-quick">${d.ideas.map((x) => `<a class="j-btn j-btn-line j-btn-sm" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.note || '')}">${esc(x.label)} ↗</a>`).join('')}${d.admin ? '<button type="button" class="j-btn j-btn-ghost j-btn-sm" id="id-edit">Edit quick links</button>' : ''}</div>`

  const results = () => {
    const out = []
    const showApp = S.source === 'all' || S.source === 'app'
    const showSheet = S.source === 'all' || S.source === 'sheet'
    const showCoach = S.source === 'all' || S.source === 'coach'
    if (showApp || showSheet || showCoach) {
      const app = showApp ? appItems().filter(match) : []
      const links = showSheet ? sheet.filter(match) : []
      const mine = showCoach ? coachItems().filter(match) : []
      // Coaches' own links lead: they are the newest and the most local.
      const list = [...mine, ...(S.source === 'all' ? interleave(app, links) : [...app, ...links])]
      const placeNote = S.place && showSheet ? `<p class="muted small">Showing JF App videos and coach links filmed ${S.place === 'hq' ? 'at HQ' : 'on the field'}. Lee's drill links have no venue, so they are hidden while this is on.</p>` : ''
      const emptyCoach = S.source === 'coach' && !coachLinks.length ? '<p class="muted">No coach links yet. Seen a good drill on Instagram, TikTok or YouTube? Press Add a link.</p>' : ''
      const appNote = showApp && S.appState === 'loading' ? '<p class="muted small">Loading the JF App videos…</p>' : showApp && S.appState === 'failed' ? '<p class="muted small">The JF App videos could not load just now. The drill links still work.</p>' : ''
      out.push(`<section class="ji-sec"><div class="ji-sec-h"><h2>Videos and drills</h2><span class="muted small">${list.length} found${showApp && S.app ? ` · ${S.app.length} in the JF App` : ''} · ${sheet.length} drill links${coachLinks.length ? ` · ${coachLinks.length} from coaches` : ''}</span></div>${appNote}
        ${placeNote}${emptyCoach}<div class="ji-grid">${list.slice(0, S.shown).map(card).join('') || (emptyCoach ? '' : '<p class="muted">Nothing matches. Try fewer words or another topic.</p>')}</div>
        ${list.length > S.shown ? `<button type="button" class="j-btn j-btn-line" id="ji-more" style="margin-top:12px">Show more (${list.length - S.shown} left)</button>` : ''}</section>`)
    }
    if (S.source === 'all' || S.source === 'programs') out.push(`<section class="ji-sec"><div class="ji-sec-h"><h2>JFP programs, week by week</h2><span class="muted small">From Lee's spreadsheet</span></div>${progHtml()}</section>`)
    if ((S.source === 'all' && !S.q && !S.topic) || S.source === 'plan') out.push(`<section class="ji-sec"><div class="ji-sec-h"><h2>How we plan a JFP session</h2></div>${planHtml()}</section>`)
    return out.join('')
  }

  const paint = () => {
    const box = view().querySelector('#ji-results')
    if (box) { box.innerHTML = results(); wireResults() }
  }
  const wireResults = () => {
    view().querySelector('#ji-more')?.addEventListener('click', () => { S.shown += 48; paint() })
    view().querySelectorAll('[data-il-rm]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to remove'; return }
      b.disabled = true
      const r = await post('ideasLinkDelete', { id: b.dataset.ilRm })
      if (!r.ok) { b.disabled = false; return toast(r.data.error) }
      coachLinks = coachLinks.filter((l) => l.id !== b.dataset.ilRm); toast('Removed'); paint()
    }))
  }
  // Any coach: add a link they have found, filed under a topic.
  const addLink = () => {
    const box = view().querySelector('#ji-add-box')
    if (!box.hidden) { box.hidden = true; return }
    box.hidden = false
    box.innerHTML = `<form class="j-card ji-addf" id="ji-add-form" novalidate>
      <p class="ji-kick">Add a link to the library</p>
      <label class="j-field"><span>Link</span><input class="j-input" name="url" inputmode="url" placeholder="https://www.instagram.com/reel/…" required></label>
      <div class="j-two"><label class="j-field"><span>Name it</span><input class="j-input" name="title" maxlength="100" placeholder="Rondo 4v1, tight spaces" required></label>
      <label class="j-field"><span>Group</span><select class="j-input" name="topic" required><option value="">Choose a group</option>${TOPICS.map(([id, label]) => `<option value="${id}" ${S.topic === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}<option value="other">Other</option></select></label></div>
      <label class="j-field"><span>Where is it done? <span class="muted">(optional)</span></span><select class="j-input" name="place"><option value="">Not sure, or either</option><option value="hq" ${S.place === 'hq' ? 'selected' : ''}>HQ (indoor)</option><option value="field" ${S.place === 'field' ? 'selected' : ''}>Field</option></select></label>
      <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" name="note" maxlength="240" placeholder="Good for U10s, needs 8 cones"></label>
      <p class="muted small">Every coach, Lee and Ligia will see it, with your name on it.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="submit" class="j-btn j-btn-dark">Add to library</button><button type="button" class="j-btn j-btn-line" id="ji-add-cancel">Cancel</button></div></form>`
    const f = box.querySelector('form')
    f.url.focus()
    box.querySelector('#ji-add-cancel').addEventListener('click', () => { box.hidden = true })
    f.addEventListener('submit', async (e) => {
      e.preventDefault()
      const url = f.url.value.trim(); const title = f.title.value.trim(); const topic = f.topic.value
      if (!/^https:\/\/\S+\.\S+$/.test(url)) return toast('Paste the full link, starting https://')
      if (title.length < 2) return toast('Give it a short name.')
      if (!topic) return toast('Choose a group for it.')
      const btn = f.querySelector('[type="submit"]'); btn.disabled = true
      const r = await post('ideasLinkAdd', { url, title, topic, place: f.place.value, note: f.note.value.trim() })
      btn.disabled = false
      if (!r.ok) return toast(r.data.error)
      coachLinks = [{ ...r.data.link, canRemove: true }, ...coachLinks]
      box.hidden = true; toast(`Added to ${topicLabel(topic)}`)
      S.source = 'coach'; S.topic = ''; S.q = ''; S.shown = 48
      read()
    })
  }
  const read = () => {
    view().innerHTML = `<div class="jp-head"><div><h1>Session ideas</h1><p class="muted small" style="margin-top:4px">Drills, videos and full sessions to take into your groups. Search the JF App and Lee's drill library together.</p></div></div>
      ${quick()}
      <div class="ji-addrow"><button type="button" class="j-btn j-btn-dark j-btn-sm" id="ji-add">+ Add a link</button><span class="muted small">Seen a good drill on Instagram, TikTok or YouTube? Add it to a group for every coach.</span></div>
      <div id="ji-add-box" hidden></div>
      <label class="ji-search"><span class="sr-only">Search</span><input class="j-input" id="ji-q" type="search" placeholder="Search: passing, 1v1, warm up, finishing…" value="${esc(S.q)}" autocomplete="off"></label>
      <div class="ji-chips" role="group" aria-label="Where to look">${SOURCES.map(([id, label]) => `<button type="button" class="j-chip" data-src="${id}" aria-pressed="${S.source === id}">${esc(label)}</button>`).join('')}</div>
      <div class="ji-chips" role="group" aria-label="Where it is filmed">${PLACES.map(([id, label]) => `<button type="button" class="j-chip" data-place="${id}" aria-pressed="${S.place === id}">${esc(label)}</button>`).join('')}</div>
      <div class="ji-chips" role="group" aria-label="Topic"><button type="button" class="j-chip" data-topic="" aria-pressed="${!S.topic}">All topics</button>${TOPICS.map(([id, label]) => `<button type="button" class="j-chip" data-topic="${id}" aria-pressed="${S.topic === id}">${esc(label)}</button>`).join('')}</div>
      <div id="ji-results">${results()}</div>`
    let t
    view().querySelector('#ji-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.q = norm(e.target.value).trim(); S.shown = 48; paint() }, 150) })
    view().querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => { S.source = b.dataset.src; S.shown = 48; view().querySelectorAll('[data-src]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint() }))
    view().querySelectorAll('[data-place]').forEach((b) => b.addEventListener('click', () => { S.place = b.dataset.place; S.shown = 48; view().querySelectorAll('[data-place]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint() }))
    view().querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('click', () => { S.topic = b.dataset.topic; S.shown = 48; view().querySelectorAll('[data-topic]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint() }))
    view().querySelector('#id-edit')?.addEventListener('click', edit)
    view().querySelector('#ji-add').addEventListener('click', addLink)
    wireResults()
    loadApp()
  }

  let ideas = d.ideas.map((x) => ({ ...x }))
  const edit = () => {
    const row = (x, i) => `<div class="j-card" style="padding:12px;margin-bottom:10px" data-id-row="${i}">
      <div class="j-two"><label class="j-field"><span>Name</span><input class="j-input" data-f="label" value="${esc(x.label)}" maxlength="80"></label><label class="j-field"><span>Link</span><input class="j-input" data-f="url" value="${esc(x.url)}" inputmode="url" placeholder="https://"></label></div>
      <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" data-f="note" value="${esc(x.note || '')}" maxlength="240"></label>
      <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-id-rm="${i}">Remove</button></div>`
    view().innerHTML = `<div class="jp-head"><div><h1>Quick links</h1><p class="muted small">The buttons at the top of Session ideas. Every coach sees them.</p></div></div>
      <div id="id-rows">${ideas.map(row).join('')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" id="id-add">Add a link</button><button type="button" class="j-btn j-btn-line" id="id-cancel">Cancel</button><button type="button" class="j-btn j-btn-dark" id="id-save">Save</button></div>`
    const grab = () => [...view().querySelectorAll('[data-id-row]')].map((r) => ({ label: r.querySelector('[data-f="label"]').value.trim(), url: r.querySelector('[data-f="url"]').value.trim(), note: r.querySelector('[data-f="note"]').value.trim() }))
    view().querySelector('#id-add').addEventListener('click', () => { ideas = [...grab(), { label: '', url: '', note: '' }]; edit() })
    view().querySelectorAll('[data-id-rm]').forEach((b) => b.addEventListener('click', () => { ideas = grab().filter((_, i) => i !== Number(b.dataset.idRm)); edit() }))
    view().querySelector('#id-cancel').addEventListener('click', () => { ideas = d.ideas.map((x) => ({ ...x })); read() })
    view().querySelector('#id-save').addEventListener('click', async () => {
      const list = grab().filter((x) => x.label || x.url)
      const bad = list.find((x) => !x.label || !/^https:\/\/\S+$/.test(x.url))
      if (bad) return toast('Each link needs a name and a full link starting https://')
      const r = await post('ideasSave', { ideas: list })
      if (!r.ok) return toast(r.data.error)
      d.ideas = r.data.ideas; ideas = d.ideas.map((x) => ({ ...x })); toast('Saved'); read()
    })
  }
  read()
}

// App videos and drill links take turns, so neither buries the other.
function interleave(a, b) {
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]) }
  return out
}
export const _test = { TOPICS, topicsOf, interleave, host, platformOf }
