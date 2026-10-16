// Portal Announcements tab (Lee, 17 Oct 2026): one-way notices that families
// read on Home in My account. Not a chat and not a send: nothing is emailed or
// texted, families just see it next time they open the app. Admin only.
import { esc, api, toast } from './jfp-common.js'
import { psHead, psBadge, psHelp } from './jfp-portal-ps.js'

const call = (action, body = {}) => api('/api/jfp-portal-data', { action, ...body })

export async function renderAnnouncements(ui) {
  const { view, need, modal, closeModal, confirmBox } = ui
  const d = await need(await call('announceList'))
  const draw = (data) => {
    const list = data.announcements || []
    const live = list.filter((a) => a.live).length
    view().innerHTML = `${psHead({ title: 'Announcements', count: list.length ? `${live} showing now` : '', primary: '<button type="button" class="j-btn j-btn-dark" id="an-new">+ New announcement</button>' }).replace('</h1>', `</h1>${psHelp('Notices families see on Home in My account. One way only: families cannot reply, and nothing is emailed or texted. Choose who sees it (everyone, one location or one group) and the dates it shows.', 'About announcements')}`)}
      <div class="ps-table-wrap"><table class="ps-table ps-flat"><thead><tr><th>Announcement</th><th>Who sees it</th><th>Shows</th><th class="ps-end"><span class="sr-only">Edit</span></th></tr></thead><tbody>
        ${list.map((a, i) => `<tr><td data-col="who"><b>${a.pinned ? 'Pinned · ' : ''}${esc(a.title)}</b><span class="ps-sub">${esc(a.body.slice(0, 120))}${a.body.length > 120 ? '…' : ''}</span></td><td data-col="group">${esc(a.audienceLabel)}</td><td data-col="pay">${psBadge(a.live ? 'green' : 'grey', a.live ? 'Showing now' : a.from > todayIso() ? 'Starts later' : 'Finished')}<span class="ps-sub">From ${esc(a.fromLabel)}${a.untilLabel ? ` to ${esc(a.untilLabel)}` : ''}</span></td><td class="ps-end ps-keep"><button type="button" class="j-btn j-btn-line j-btn-sm" data-an-edit="${i}">Edit</button> <button type="button" class="j-btn j-btn-line j-btn-sm" data-an-del="${i}">Delete</button></td></tr>`).join('') || '<tr><td colspan="4"><div class="ps-empty">No announcements yet. Families see them on Home in My account.</div></td></tr>'}
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
  }
  const edit = (a, data) => {
    const opt = data.options || { locations: [], groups: [] }
    const type = a.audience?.type || 'all'
    const box = modal(`<h2 style="margin-bottom:6px">${a.id ? 'Edit announcement' : 'New announcement'}</h2>
      <p class="muted small" style="margin:-4px 0 14px">Families see this on Home in My account. They cannot reply. Nothing is emailed or texted.</p>
      <label class="j-label" for="an-title">Title</label><input class="j-input" id="an-title" maxlength="90" value="${esc(a.title || '')}" placeholder="Saturday sessions are on">
      <label class="j-label" for="an-body" style="margin-top:12px">Message</label><textarea class="j-input" id="an-body" rows="6" maxlength="1200" placeholder="What families need to know">${esc(a.body || '')}</textarea>
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
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="an-save">${a.id ? 'Save' : 'Post announcement'}</button></div>`, { wide: true })
    const $b = (id) => box.querySelector(`#${id}`)
    $b('an-type').addEventListener('change', (e) => { $b('an-loc').hidden = e.target.value !== 'location'; $b('an-group').hidden = e.target.value !== 'group' })
    $b('an-save').addEventListener('click', async (e) => {
      const t = $b('an-type').value
      const body = { id: a.id || '', title: $b('an-title').value, body: $b('an-body').value, audience: { type: t, id: t === 'location' ? $b('an-loc').value : t === 'group' ? $b('an-group').value : '' }, from: $b('an-from').value, until: $b('an-until').value, pinned: $b('an-pin').checked }
      e.target.disabled = true
      const r = await call('announceSave', body)
      e.target.disabled = false
      if (!r.ok) { $b('an-err').textContent = r.data.error || 'Could not save.'; return }
      closeModal(); toast(a.id ? 'Saved.' : 'Posted. Families see it on Home.'); draw(r.data)
    })
  }
  draw(d)
}

function todayIso() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }) }
