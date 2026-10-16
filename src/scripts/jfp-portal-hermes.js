// Settings > Hermes access (Lee, 16 Oct 2026): the on/off switch for Hermes on
// the Mac mini, emails Hermes asked for that wait for Lee's yes, and the last
// things Hermes did. Server side: api/_jfp-agent.js.
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'never')

export async function mountHermesSettings(el, { post, toast, modal, closeModal }) {
  if (!el) return
  const r = await post('agentAccess')
  if (!r.ok) { el.innerHTML = `<h2>Hermes access</h2><p class="small">${esc(r.data.error || 'Could not load.')}</p>`; return }
  const { agent: a, held, recent } = r.data
  el.innerHTML = `<h2>Hermes access</h2><div class="ss-list">
      <div class="ss-row is-switch"><div class="ss-lbl"><label for="s-hermes-on">Hermes can work the portal</label><small>${a.set ? `Full access as Lee, from the Mac mini. Last used ${esc(when(a.lastUsedAt))}${a.lastAction ? ` (${esc(a.lastAction)})` : ''}.` : 'No key set up yet.'} Texts need your yes in the chat; emails to families wait below until you send them.</small></div>
        <div class="ss-ctl"><span class="ss-saved" data-saved-for="s-hermes-on" aria-live="polite"></span><label class="ss-switch"><input type="checkbox" role="switch" id="s-hermes-on" ${a.enabled ? 'checked' : ''} ${a.set ? '' : 'disabled'}><span aria-hidden="true"></span></label></div></div>
      <div class="ss-row"><div class="ss-lbl" style="grid-column:1/-1;max-width:none"><span>Emails waiting for your yes</span><small>${held.length ? `${held.length} held. Nothing has gone to the family yet.` : 'None.'}</small></div></div>
      ${held.map((h) => `<div class="ss-row is-switch"><div class="ss-lbl"><span>${esc(h.subject)}</span><small>To ${esc(h.to.join(', '))} · ${esc(when(h.at))}</small></div><div class="ss-ctl"><button type="button" class="j-btn j-btn-line j-btn-sm" data-hv="${esc(h.id)}">View</button><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-hd="${esc(h.id)}">Discard</button><button type="button" class="j-btn j-btn-dark j-btn-sm" data-hs="${esc(h.id)}">Send</button></div></div>`).join('')}
    </div>
    <details class="ss-more"><summary>What Hermes did (last ${recent.length})</summary><div class="ss-list">${recent.map((e) => `<div class="ss-row"><div class="ss-lbl"><span>${esc(e.action)}</span><small>${esc(e.target || '')} · ${esc(when(e.at))}</small></div></div>`).join('') || '<div class="ss-row"><div class="ss-lbl"><small>Nothing yet.</small></div></div>'}</div></details>`
  const box = el.querySelector('#s-hermes-on')
  box?.addEventListener('change', async () => {
    const tick = el.querySelector('[data-saved-for="s-hermes-on"]')
    box.disabled = true; tick.textContent = 'Saving'
    const s = await post('agentSwitch', { enabled: box.checked })
    box.disabled = false
    if (!s.ok) { box.checked = !box.checked; tick.textContent = ''; return toast(s.data.error || 'Could not save.') }
    tick.textContent = box.checked ? 'On' : 'Off'
    toast(box.checked ? 'Hermes can work the portal again' : 'Hermes is switched off')
  })
  const byId = (id) => held.find((h) => h.id === id)
  el.onclick = async (e) => {
    const v = e.target.closest('[data-hv]'), d = e.target.closest('[data-hd]'), s = e.target.closest('[data-hs]')
    if (v) {
      const h = byId(v.dataset.hv)
      modal(`<h2>${esc(h.subject)}</h2><p class="small">To ${esc(h.to.join(', '))}</p><iframe title="The email exactly as it will go" style="width:100%;height:60vh;border:1px solid #E5E7EB;border-radius:10px;background:#fff" srcdoc="${esc(h.html || '')}"></iframe><div class="j-row" style="margin-top:12px"><button type="button" class="j-btn j-btn-line" id="hv-close">Close</button></div>`)
      document.getElementById('hv-close').addEventListener('click', closeModal)
      return
    }
    if (!d && !s) return
    const id = (d || s).dataset.hd || (d || s).dataset.hs
    if (s && !confirm(`Send "${byId(id)?.subject}" to ${byId(id)?.to.join(', ')}?`)) return
    ;(d || s).disabled = true
    const out = await post(s ? 'agentRelease' : 'agentDiscard', { id })
    if (!out.ok) { (d || s).disabled = false; return toast(out.data.error || 'Could not do that.') }
    toast(s ? 'Sent' : 'Discarded')
    mountHermesSettings(el, { post, toast, modal, closeModal })
  }
}
