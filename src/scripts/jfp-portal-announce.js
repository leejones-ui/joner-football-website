// Portal Announcements tab (Lee, 17 Oct 2026): one-way notices that families
// read on Home in My account. Not a chat and not a send: nothing is emailed or
// texted, families just see it next time they open the app.
// From (Lee, 29 Oct 2026): Lee Jones, Joner Football or a coach. Coaches post
// their own, signed by them, and Lee or Ligia approves before families see it.
import { esc, api, toast } from './jfp-common.js'
import { psHead, psBadge, psHelp } from './jfp-portal-ps.js'

const call = (action, body = {}) => api('/api/jfp-portal-data', { action, ...body })

export async function renderAnnouncements(ui) {
  const { view, need, modal, closeModal, confirmBox } = ui
  const d = await need(await call('announceList'))
  const draw = (data) => {
    const list = data.announcements || []
    const live = list.filter((a) => a.live).length
    const admin = data.options?.admin
    const waiting = list.filter((a) => a.status === 'pending').length
    const state = (a) => a.status === 'pending' ? psBadge('orange', 'Waiting for approval') : a.status === 'declined' ? psBadge('red', 'Not approved') : psBadge(a.live ? 'green' : 'grey', a.live ? 'Showing now' : a.from > todayIso() ? 'Starts later' : 'Finished')
    view().innerHTML = `${psHead({ title: 'Announcements', count: list.length ? `${live} showing now${waiting ? ` · ${waiting} waiting for approval` : ''}` : '', primary: '<button type="button" class="j-btn j-btn-dark" id="an-new">+ New announcement</button>' }).replace('</h1>', `</h1>${psHelp(admin ? 'Notices families see on Home in My account. One way only: families cannot reply, and nothing is emailed or texted. Choose who it is from, who sees it and the dates it shows. Coaches can write one too: it waits here for you to approve.' : 'Write a notice for families. Lee or Ligia approves it first, then families see it on Home in My account, signed by you. Families cannot reply, and nothing is emailed or texted.', 'About announcements')}`)}
      <div class="ps-table-wrap"><table class="ps-table ps-flat"><thead><tr><th>Announcement</th><th>From</th><th>Who sees it</th><th>Shows</th><th class="ps-end"><span class="sr-only">Edit</span></th></tr></thead><tbody>
        ${list.map((a, i) => `<tr><td data-col="who"><b>${a.pinned ? 'Pinned · ' : ''}${esc(a.title)}</b><span class="ps-sub">${esc(a.body.slice(0, 120))}${a.body.length > 120 ? '…' : ''}</span>${a.status === 'declined' && a.declineNote ? `<span class="ps-sub" style="color:var(--j-red)">Note: ${esc(a.declineNote)}</span>` : ''}</td><td data-col="coach">${esc(a.authorView?.name || 'Joner Football')}</td><td data-col="group">${esc(a.audienceLabel)}</td><td data-col="pay">${state(a)}<span class="ps-sub">From ${esc(a.fromLabel)}${a.untilLabel ? ` to ${esc(a.untilLabel)}` : ''}</span></td><td class="ps-end ps-keep">${admin && a.status === 'pending' ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-an-ok="${i}">Approve</button> <button type="button" class="j-btn j-btn-line j-btn-sm" data-an-no="${i}">Decline</button> ` : ''}<button type="button" class="j-btn j-btn-line j-btn-sm" data-an-edit="${i}">Edit</button> <button type="button" class="j-btn j-btn-line j-btn-sm" data-an-del="${i}">Delete</button></td></tr>`).join('') || `<tr><td colspan="5"><div class="ps-empty">${admin ? 'No announcements yet. Families see them on Home in My account.' : 'You have not written one yet. Lee or Ligia approves it, then families see it on Home.'}</div></td></tr>`}
      </tbody></table></div>`
    view().querySelector('#an-new').addEventListener('click', () => edit({}, data))
    view().querySelectorAll('[data-an-edit]').forEach((b) => b.addEventListener('click', () => edit(list[Number(b.dataset.anEdit)], data)))
    view().querySelectorAll('[data-an-del]').forEach((b) => b.addEventListener('click', async () => {
      const a = list[Number(b.dataset.anDel)]
      if (!(await confirmBox(`Delete "${esc(a.title)}"? Families stop seeing it at once.`, { ok: 'Delete', danger: true }))) return
      const r = await call('announceDelete', { id: a.id })
      if (!r.ok) return toast(r.data.error || 'Could not delete.')
      toast('Deleted.'); draw(r.data)
    }))
    view().querySelectorAll('[data-an-ok]').forEach((b) => b.addEventListener('click', async () => {
      const a = list[Number(b.dataset.anOk)]
      b.disabled = true
      const r = await call('announceDecide', { id: a.id, decision: 'approve' })
      if (!r.ok) { b.disabled = false; return toast(r.data.error || 'Could not approve.') }
      toast('Approved. Families see it on Home.'); draw(r.data)
    }))
    view().querySelectorAll('[data-an-no]').forEach((b) => b.addEventListener('click', () => {
      const a = list[Number(b.dataset.anNo)]
      const box = modal(`<h2 style="margin-bottom:6px">Decline "${esc(a.title)}"?</h2><p class="muted small" style="margin:-4px 0 12px">Families never see it. ${esc(a.authorView?.name || 'The coach')} sees it as not approved, with your note.</p>
        <label class="j-label" for="an-note">Note for the coach (optional)</label><textarea class="j-input" id="an-note" rows="3" maxlength="300" placeholder="What to change"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="an-decline">Decline</button></div>`)
      box.querySelector('#an-decline').addEventListener('click', async (e) => {
        e.target.disabled = true
        const r = await call('announceDecide', { id: a.id, decision: 'decline', note: box.querySelector('#an-note').value })
        e.target.disabled = false
        if (!r.ok) return toast(r.data.error || 'Could not decline.')
        closeModal(); toast('Declined.'); draw(r.data)
      })
    }))
  }
  const edit = (a, data) => {
    const opt = data.options || { locations: [], groups: [] }
    const type = a.audience?.type || 'all'
    const who = a.author?.type === 'coach' ? `coach:${a.author.coachId}` : a.author?.type || (a.id ? 'jf' : 'lee')
    const box = modal(`<h2 style="margin-bottom:6px">${a.id ? 'Edit announcement' : 'New announcement'}</h2>
      <p class="muted small" style="margin:-4px 0 14px">${opt.admin ? 'Families see this on Home in My account. They cannot reply. Nothing is emailed or texted.' : 'Lee or Ligia approves it first. Then families see it on Home in My account, signed by you. They cannot reply.'}</p>
      ${opt.admin ? `<label class="j-label" for="an-from-who">From</label><select class="j-select" id="an-from-who"><option value="lee" ${who === 'lee' ? 'selected' : ''}>Lee Jones</option><option value="jf" ${who === 'jf' ? 'selected' : ''}>Joner Football</option>${(opt.coaches || []).map((c) => `<option value="coach:${esc(c.id)}" ${who === `coach:${c.id}` ? 'selected' : ''}>${esc(c.name)} (coach)</option>`).join('')}</select><div style="height:12px"></div>` : `<p class="small" style="margin:0 0 12px">From: <b>${esc(opt.me || 'you')}</b></p>`}
      <label class="j-label" for="an-title">Title</label><input class="j-input" id="an-title" maxlength="90" value="${esc(a.title || '')}" placeholder="Saturday sessions are on">
      <label class="j-label" for="an-body" style="margin-top:12px">Message</label><textarea class="j-input" id="an-body" rows="6" maxlength="1200" placeholder="What families need to know">${esc(a.body || '')}</textarea>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px">
        <div><label class="j-label" for="an-btn">Button words (optional)</label><input class="j-input" id="an-btn" maxlength="40" value="${esc(a.button?.label || '')}" placeholder="Book extra sessions"></div>
        <div><label class="j-label" for="an-url">Button link</label><input class="j-input" id="an-url" inputmode="url" value="${esc(a.button?.url || '')}" placeholder="jonerfootball.com/jfp-booking#extra"></div>
      </div>
      <label class="j-label" for="an-type" style="margin-top:12px">Who sees it</label>
      <select class="j-select" id="an-type"><option value="all" ${type === 'all' ? 'selected' : ''}>Every family</option><option value="location" ${type === 'location' ? 'selected' : ''}>Families at one location</option><option value="group" ${type === 'group' ? 'selected' : ''}>Families in one group</option></select>
      <select class="j-select" id="an-loc" aria-label="Location" style="margin-top:8px" ${type === 'location' ? '' : 'hidden'}><option value="">Choose the location</option>${opt.locations.map((l) => `<option value="${esc(l.id)}" ${type === 'location' && a.audience?.id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
      <select class="j-select" id="an-group" aria-label="Group" style="margin-top:8px" ${type === 'group' ? '' : 'hidden'}><option value="">Choose the group</option>${opt.groups.map((g) => `<option value="${esc(g.id)}" ${type === 'group' && a.audience?.id === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:12px">
        <div><label class="j-label" for="an-from">Show from</label><input class="j-input" type="date" id="an-from" value="${esc(a.from || todayIso())}"></div>
        <div><label class="j-label" for="an-until">Until (optional)</label><input class="j-input" type="date" id="an-until" value="${esc(a.until || '')}"></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px;min-height:44px"><input type="checkbox" id="an-pin" ${a.pinned ? 'checked' : ''}> Pin to the top</label>
      <p class="small" id="an-err" style="color:var(--j-red);min-height:18px" role="alert"></p>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="an-save">${!opt.admin ? 'Send for approval' : a.id ? 'Save' : 'Post announcement'}</button></div>`, { wide: true })
    const $b = (id) => box.querySelector(`#${id}`)
    $b('an-type').addEventListener('change', (e) => { $b('an-loc').hidden = e.target.value !== 'location'; $b('an-group').hidden = e.target.value !== 'group' })
    $b('an-save').addEventListener('click', async (e) => {
      const t = $b('an-type').value
      const body = { id: a.id || '', title: $b('an-title').value, body: $b('an-body').value, audience: { type: t, id: t === 'location' ? $b('an-loc').value : t === 'group' ? $b('an-group').value : '' }, from: $b('an-from').value, until: $b('an-until').value, pinned: $b('an-pin').checked, button: { label: $b('an-btn').value, url: $b('an-url').value } }
      if (opt.admin) { const w = $b('an-from-who').value; body.author = w.startsWith('coach:') ? { type: 'coach', coachId: w.slice(6) } : { type: w } }
      e.target.disabled = true
      const r = await call('announceSave', body)
      e.target.disabled = false
      if (!r.ok) { $b('an-err').textContent = r.data.error || 'Could not save.'; return }
      closeModal(); toast(!opt.admin ? 'Sent to Lee and Ligia to approve.' : a.id ? 'Saved.' : 'Posted. Families see it on Home.'); draw(r.data)
    })
  }
  draw(d)
}

function todayIso() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }) }
