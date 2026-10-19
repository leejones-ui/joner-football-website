// Session ideas (Lee, 19 Oct 2026): where coaches go for drills and whole
// sessions. The JF App, the YouTube channel and Lee's spreadsheet of training
// videos. Lee and Ligia keep the list (Edit the list); coaches read it.
import { esc } from './jfp-common.js'

export async function renderIdeas(ui) {
  const { view, post, need, toast } = ui
  const d = await need(await post('ideasGet'))
  let ideas = d.ideas.map((x) => ({ ...x }))
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
  const read = () => {
    view().innerHTML = `<div class="jp-head"><div><h1>Session ideas</h1><p class="muted small" style="margin-top:4px">Drills and full sessions to take into your groups.</p></div>${d.admin ? '<button type="button" class="j-btn j-btn-line" id="id-edit">Edit the list</button>' : ''}</div>
      <div class="jd-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${ideas.map((x) => `<a class="j-card" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" style="padding:16px;display:block;text-decoration:none;color:inherit">
        <b style="font-size:16px">${esc(x.label)}</b><p class="muted small" style="margin-top:6px">${esc(x.note || '')}</p><p class="small" style="margin-top:10px;color:var(--j-focus)">${esc(host(x.url))} ↗</p></a>`).join('') || '<p class="muted">Nothing here yet.</p>'}</div>
      ${d.admin && !ideas.some((x) => /docs\.google\.com\/spreadsheets/.test(x.url)) ? '<p class="j-box j-box-amber small" style="margin-top:14px">Lee\'s training video spreadsheet is not on the list yet. Edit the list and paste its link.</p>' : ''}`
    view().querySelector('#id-edit')?.addEventListener('click', edit)
  }
  const edit = () => {
    const row = (x, i) => `<div class="j-card" style="padding:12px;margin-bottom:10px" data-id-row="${i}">
      <div class="j-two"><label class="j-field"><span>Name</span><input class="j-input" data-f="label" value="${esc(x.label)}" maxlength="80"></label><label class="j-field"><span>Link</span><input class="j-input" data-f="url" value="${esc(x.url)}" inputmode="url" placeholder="https://"></label></div>
      <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" data-f="note" value="${esc(x.note || '')}" maxlength="240"></label>
      <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-id-rm="${i}">Remove</button></div>`
    view().innerHTML = `<div class="jp-head"><div><h1>Session ideas</h1><p class="muted small">Every coach sees these links.</p></div></div>
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
