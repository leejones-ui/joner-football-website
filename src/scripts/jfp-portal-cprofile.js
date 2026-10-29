// Coach profiles (Lee, 20 Oct 2026). Each coach fills theirs in on My profile;
// Our coaches shows every coach's to the team. Live straight away. Lee and
// Ligia can edit anyone's, set the role, and switch on families seeing
// their own coach's profile in My account.
import { esc } from './jfp-common.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const face = (url, name, size) => {
  const ini = String(name || '').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase()
  return url ? `<img class="cp-face" src="${esc(url)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px">` : `<span class="cp-face cp-ini" aria-hidden="true" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.8)}px">${esc(ini)}</span>`
}

// The full profile, read only. Used on Our coaches and in the edit preview.
export function profileHtml(c, meta) {
  const sec = (title, body) => (body ? `<div class="cp-sec"><p class="cp-kick">${esc(title)}</p>${body}</div>` : '')
  const rows = (list, fn) => (list?.length ? `<ul class="cp-list">${list.map(fn).join('')}</ul>` : '')
  return `<div class="cp-top">${face(c.photo, c.name, 88)}<div><h2>${esc(c.name)}</h2>${c.role ? `<p class="cp-role">${esc(c.role)}</p>` : ''}${c.since ? `<p class="muted small">At Joner Football ${esc(c.since.replace(/^Since/, 'since'))}</p>` : ''}</div></div>
    ${c.filled ? '' : '<p class="muted">No profile yet.</p>'}
    ${sec('About', c.about ? `<p class="cp-about" style="white-space:pre-line">${esc(c.about)}</p>` : '')}
    ${c.gallery?.length ? sec('Coaching photos', `<div class="cp-gal">${c.gallery.map((g) => `<img src="${esc(g.url)}" alt="${esc(g.caption || '')}" loading="lazy">`).join('')}</div>`) : ''}
    ${sec('Playing', (c.highest ? `<p><b>Highest level:</b> ${esc(c.highest)}</p>` : '') + rows(c.playing, (x) => `<li><b>${esc(x.club)}</b>${x.level ? ` · ${esc(x.level)}` : ''}${x.years ? ` <span class="muted">${esc(x.years)}</span>` : ''}</li>`))}
    ${sec('Coaching', rows(c.coaching, (x) => `<li><b>${esc(x.club)}</b>${x.team ? ` · ${esc(x.team)}` : ''}${x.years ? ` <span class="muted">${esc(x.years)}</span>` : ''}</li>`))}
    ${sec('Qualifications', rows(c.quals, (x) => `<li>${esc(x.name)}${x.year ? ` <span class="muted">${esc(x.year)}</span>` : ''}</li>`))}
    ${sec('What I want every player to leave with', c.leaveWith ? `<p class="cp-about" style="white-space:pre-line">${esc(c.leaveWith)}</p>` : '')}
    ${sec('Off the pitch', [['Hobbies', c.hobbies], ['Favourite player or team', c.favourite], ['Fun fact', c.funFact], ['Speaks', c.languages]].filter(([, v]) => v).map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join(''))}
    ${sec('Links', rows(c.links, (x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.label)}</a></li>`))}`
}

// The edit form. mount() fills `box`; onSaved gets the saved profile.
export function profileForm(box, { post, toast }, c, meta, onSaved) {
  let p = { ...c, playing: [...(c.playing || [])], coaching: [...(c.coaching || [])], quals: [...(c.quals || [])], links: [...(c.links || [])] }
  const nowY = new Date().getFullYear()
  const [jy, jm] = (p.joined || '').split('-')
  const repeat = (key, list, cols) => `<div class="cp-rep" data-rep="${key}">${(list.length ? list : [{}]).map((x) => `<div class="cp-rep-row">${cols.map(([f, label, ph, w]) => `<label class="j-field" style="flex:${w || 1}"><span>${esc(label)}</span><input class="j-input" data-k="${f}" value="${esc(x[f] || '')}" placeholder="${esc(ph)}" maxlength="100"></label>`).join('')}<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-rm aria-label="Remove">✕</button></div>`).join('')}</div>
    <button type="button" class="j-btn j-btn-line j-btn-sm" data-add="${key}">+ Add another</button>`
  const draw = () => {
    box.innerHTML = `<form class="cp-form" novalidate>
      ${meta.admin ? `<label class="j-field"><span>Role <span class="muted">(Lee and Ligia set this)</span></span><select class="j-input" name="role"><option value="">No role shown</option>${meta.roles.map((r) => `<option ${p.role === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>` : p.role ? `<p class="small"><b>Role:</b> ${esc(p.role)} <span class="muted">(Lee sets this)</span></p>` : ''}
      <div class="cp-block"><h3>At Joner Football since</h3><div class="j-two">
        <label class="j-field"><span>Month</span><select class="j-input" name="jm"><option value="">Month</option>${MONTHS.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${jm === String(i + 1).padStart(2, '0') ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="j-field"><span>Year</span><select class="j-input" name="jy"><option value="">Year</option>${Array.from({ length: 25 }, (_, i) => nowY - i).map((y) => `<option ${String(y) === jy ? 'selected' : ''}>${y}</option>`).join('')}</select></label></div></div>
      <div class="cp-block"><h3>About you</h3><label class="j-field"><span>A few lines parents and players would like to know. Leave a blank line between paragraphs.</span><textarea class="j-textarea" name="about" rows="8" maxlength="1600" placeholder="Where you grew up playing, why you coach, what a session with you feels like.">${esc(p.about || '')}</textarea></label></div>
      <div class="cp-block"><h3>Playing</h3><label class="j-field"><span>Highest level played</span><input class="j-input" name="highest" value="${esc(p.highest || '')}" maxlength="120" placeholder="NPL NSW First Grade"></label>
        ${repeat('playing', p.playing, [['club', 'Club', 'Manly United', 2], ['level', 'Level', 'NPL', 1.4], ['years', 'Years', '2012 to 2016', 1.2]])}</div>
      <div class="cp-block"><h3>Coaching</h3>${repeat('coaching', p.coaching, [['club', 'Club or academy', 'Joner Football', 2], ['team', 'Team or age group', 'U12 SAP', 1.4], ['years', 'Years', '2021 to now', 1.2]])}</div>
      <div class="cp-block"><h3>Qualifications</h3>${repeat('quals', p.quals, [['name', 'Qualification', 'Football Australia C Licence', 3], ['year', 'Year', '2023', 1]])}</div>
      <div class="cp-block"><h3>What you want every player to leave with</h3><label class="j-field"><span>Families see this as a quote on your profile</span><textarea class="j-textarea" name="leaveWith" rows="4" maxlength="600" placeholder="Confidence on the ball, and wanting to come back next week.">${esc(p.leaveWith || '')}</textarea></label></div>
      <div class="cp-block"><h3>Off the pitch</h3><p class="muted small" style="margin:-4px 0 8px">Families love getting to know you. Fill in what you are happy to share.</p>
        <label class="j-field"><span>Hobbies and interests</span><input class="j-input" name="hobbies" value="${esc(p.hobbies || '')}" maxlength="300" placeholder="Golf, the beach, coffee with my dog"></label>
        <label class="j-field"><span>Favourite player or team</span><input class="j-input" name="favourite" value="${esc(p.favourite || '')}" maxlength="120"></label>
        <label class="j-field"><span>A fun fact about you</span><input class="j-input" name="funFact" value="${esc(p.funFact || '')}" maxlength="300" placeholder="I once juggled a ball for an hour straight"></label>
        <label class="j-field"><span>Languages you speak</span><input class="j-input" name="languages" value="${esc(p.languages || '')}" maxlength="120" placeholder="English, Portuguese"></label></div>
      <div class="cp-block"><h3>Coaching photos</h3><p class="muted small" style="margin:-4px 0 8px">Up to 8 photos of you coaching. They save as soon as you add them and show on your profile for families.</p><div class="cp-galed" id="cp-galed"></div></div>
      <div class="cp-block"><h3>Links</h3><p class="muted small" style="margin:-4px 0 8px">Your own page, videos or a highlight reel. Families see them as buttons on your profile.</p>${repeat('links', p.links, [['label', 'Button words', 'Watch me coach the pros', 2], ['url', 'Link', 'https://youtube.com/...', 2]])}</div>
      <p class="muted small">Saves straight away. Every coach, Lee and Ligia can read it${meta.families ? ', and families see it in My account' : ''}.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="submit" class="j-btn j-btn-dark j-btn-lg">Save profile</button></div></form>`
    const f = box.querySelector('form')
    const grabRep = (key) => [...f.querySelectorAll(`[data-rep="${key}"] .cp-rep-row`)].map((r) => Object.fromEntries([...r.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value.trim()])))
    const grab = () => {
      p = { ...p, role: f.role ? f.role.value : p.role, joined: f.jy.value && f.jm.value ? `${f.jy.value}-${f.jm.value}` : '', about: f.about.value.trim(), highest: f.highest.value.trim(), playing: grabRep('playing'), coaching: grabRep('coaching'), quals: grabRep('quals'), links: grabRep('links'), languages: f.languages.value.trim(), favourite: f.favourite.value.trim(), leaveWith: f.leaveWith.value.trim(), hobbies: f.hobbies.value.trim(), funFact: f.funFact.value.trim() }
    }
    drawGallery(box.querySelector('#cp-galed'), { post, toast }, c.id, p.gallery || [], (g) => { p.gallery = g })
    f.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { grab(); p[b.dataset.add] = [...p[b.dataset.add], {}]; draw() }))
    f.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { const row = b.closest('.cp-rep-row'); const key = b.closest('[data-rep]').dataset.rep; const i = [...row.parentNode.children].indexOf(row); grab(); p[key] = p[key].filter((_, j) => j !== i); draw() }))
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); grab()
      if ((f.jy.value && !f.jm.value) || (!f.jy.value && f.jm.value)) return toast('Pick the month and the year you started.')
      const btn = f.querySelector('[type="submit"]'); btn.disabled = true
      const r = await post('coachProfileSave', { coachId: c.id, profile: { ...p, playing: p.playing.filter((x) => x.club), coaching: p.coaching.filter((x) => x.club), quals: p.quals.filter((x) => x.name), links: p.links.filter((x) => x.label && x.url) } })
      btn.disabled = false
      if (!r.ok) return toast(r.data.error)
      toast('Profile saved'); onSaved?.(r.data.profile)
    })
  }
  draw()
}

// Coaching photos: each upload or removal saves on its own (coachGalleryPhoto).
function galleryDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight))
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k)
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
      URL.revokeObjectURL(url)
      resolve(cv.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(/heic|heif/i.test(file.type + file.name) ? 'This browser cannot open iPhone HEIC photos. Export it as a JPG first.' : 'That file could not be read as a photo.')) }
    img.src = url
  })
}
function drawGallery(el, { post, toast }, coachId, gallery, onChange) {
  el.innerHTML = `${gallery.map((g) => `<figure class="cp-gph"><img src="${esc(g.url)}" alt=""><input class="j-input j-input-sm" data-cap="${g.v}" value="${esc(g.caption || '')}" maxlength="80" placeholder="Caption (optional)"><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-grm="${g.v}">Remove</button></figure>`).join('')}
    ${gallery.length < 8 ? '<label class="cp-gadd"><input type="file" accept="image/*" multiple hidden><span>+ Add photos</span></label>' : ''}`
  const done = (r) => { if (!r.ok) { toast(r.data.error); return false } gallery = r.data.profile.gallery; onChange(gallery); drawGallery(el, { post, toast }, coachId, gallery, onChange); return true }
  el.querySelector('input[type=file]')?.addEventListener('change', async (e) => {
    const lab = el.querySelector('.cp-gadd span'); lab.textContent = 'Uploading...'
    for (const file of [...e.target.files].slice(0, 8 - gallery.length)) {
      try { if (!done(await post('coachGalleryPhoto', { coachId, dataUrl: await galleryDataUrl(file) }))) break } catch (x) { toast(x.message); break }
    }
    toast('Photos saved')
  })
  el.querySelectorAll('[data-grm]').forEach((b) => b.addEventListener('click', async () => { if (done(await post('coachGalleryPhoto', { coachId, remove: Number(b.dataset.grm) }))) toast('Photo removed') }))
  el.querySelectorAll('[data-cap]').forEach((i) => i.addEventListener('change', async () => { if (done(await post('coachGalleryPhoto', { coachId, v: Number(i.dataset.cap), caption: i.value.trim() }))) toast('Caption saved') }))
}

// My profile: the coach's own form under their photo card.
export async function mountMyProfile(box, ui) {
  const r = await ui.post('coachProfiles')
  if (!r.ok) { box.innerHTML = ''; return }
  const meta = r.data
  const me = meta.coaches.find((c) => c.mine)
  if (!me) { box.innerHTML = '<p class="muted small">Your login is not linked to a coach yet, so there is no profile to fill in. Ask Lee.</p>'; return }
  box.innerHTML = `<div class="jp-head" style="margin-top:22px"><div><h2>Your coaching profile</h2><p class="muted small">How long you have been with us, your playing and coaching, your qualifications and a bit about you.</p></div></div><div class="j-card" style="padding:18px;max-width:760px" id="cp-form"></div>`
  profileForm(box.querySelector('#cp-form'), ui, me, meta, () => {})
}

// Our coaches: every coach's profile. The one coaches tab (20 Oct 2026):
// for Lee and Ligia it also holds what the old Coaches tab did (ui.adminTop,
// ui.details from jfp-portal.js).
export async function renderTeam(ui) {
  const { view, post, need, modal, closeModal, toast } = ui
  const meta = await need(await post('coachProfiles'))
  const cards = meta.coaches.map((c, i) => `<button type="button" class="j-card cp-card" data-cp="${i}">${face(c.photo, c.name, 64)}<span class="cp-card-bd"><b>${esc(c.name)}</b>${c.role ? `<span class="cp-role">${esc(c.role)}</span>` : ''}<span class="muted small">${esc(c.since || (c.filled ? '' : 'No profile yet'))}</span>${c.quals?.[0] ? `<span class="small">${esc(c.quals[0].name)}${c.quals.length > 1 ? ` +${c.quals.length - 1}` : ''}</span>` : ''}</span></button>`).join('')
  view().innerHTML = `<div class="jp-head"><div><h1>Our coaches</h1><p class="muted small">Every Joner Football coach. Fill in yours on My profile.</p></div></div>
    ${meta.admin ? `<label class="j-check" style="max-width:760px;margin-bottom:14px"><input type="checkbox" id="cp-fam" ${meta.families ? 'checked' : ''}> <span><b>Families see their coach's profile.</b> In My account, each family sees the profile of the coaches on their child's group. Off means families see no coach names, as now.</span></label>` : ''}
    <div class="cp-grid">${cards}</div>`
  // Lee and Ligia: coach logins, coach alerts and Add a coach, from the old Coaches tab.
  if (meta.admin) ui.adminTop?.(() => renderTeam(ui))
  view().querySelectorAll('[data-cp]').forEach((b) => b.addEventListener('click', () => {
    const c = meta.coaches[Number(b.dataset.cp)]
    const box = modal(`<div class="cp-view">${profileHtml(c, meta)}</div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">${c.canEdit ? '<button type="button" class="j-btn j-btn-line" data-edit>Edit</button>' : ''}<button type="button" class="j-btn j-btn-dark" data-close>Close</button></div>`, { wide: true })
    box.querySelector('[data-close]').addEventListener('click', closeModal)
    box.querySelector('[data-edit]')?.addEventListener('click', () => {
      const m = modal(`<h2 style="margin-bottom:12px">${esc(c.name)}</h2><div id="cp-details"></div><h3 style="margin-bottom:8px">Profile</h3><div id="cp-ed"></div><button type="button" class="j-btn j-btn-line" data-close style="margin-top:10px">Close</button>`, { wide: true })
      m.querySelector('[data-close]').addEventListener('click', closeModal)
      // Photo, name, sign-in email, mobile and alerts: Lee and Ligia only.
      if (meta.admin) ui.details?.(m.querySelector('#cp-details'), c.id, (close) => { if (close) { closeModal(); renderTeam(ui) } })
      profileForm(m.querySelector('#cp-ed'), { post, toast }, c, meta, () => { closeModal(); renderTeam(ui) })
    })
  }))
  view().querySelector('#cp-fam')?.addEventListener('change', async (e) => {
    const r = await post('coachProfilesFamilies', { on: e.target.checked })
    if (!r.ok) { e.target.checked = !e.target.checked; return toast(r.data.error) }
    toast(r.data.on ? 'Families now see their coach\'s profile' : 'Coach profiles hidden from families')
  })
}
