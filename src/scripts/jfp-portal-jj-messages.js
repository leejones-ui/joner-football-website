// Joners Juniors > Messages (stage 3): one email to a whole class, families
// who still owe, families with no waiver, or one family. "Show the email"
// makes the exact emails and shows them; nothing goes until Send. Served by
// /api/jfp-messages (the same message store and checks as JFP Messages).
import { esc, api, toast } from './jfp-common.js'

const call = (action, body = {}) => api('/api/jfp-messages', { action, ...body })
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const M = { audience: '', classId: '', email: '', subject: '', text: '', signIn: true, prepared: null }
const pill = (c, l) => `<span class="j-pill j-pill-${c}">${esc(l)}</span>`

export async function renderJJMessages(ui) {
  const d = await ui.need(await call('jjMsgOverview'))
  if (!M.audience) { M.audience = 'class'; M.classId = d.classes[0]?.id || '' }
  const who = [
    ...d.classes.map((c) => ['class', c.id, `${d.classes.length > 1 ? c.label : 'The whole class'} (${c.families})`]),
    ['unpaid', '', `Still owe (${d.counts.unpaid})`], ['waiver', '', `No waiver (${d.counts.waiver})`], ['one', '', 'One family'],
  ]
  const p = M.prepared
  ui.view().innerHTML = `<div class="jj-view">
    <div class="jd-head"><div><h1>Messages</h1><p>Joners Juniors · ${esc(d.term)} · Nothing is sent until you press Send</p></div></div>
    ${d.dncError ? `<div class="j-box j-box-red" style="margin-bottom:12px">${esc(d.dncError)}</div>` : ''}
    <section class="jd-card"><h2>1. Who gets it</h2>
      <div class="jm-chips" id="jg-who" role="group" aria-label="Who gets it" style="margin-top:8px">${who.map(([a, c, l]) => `<button type="button" data-aud="${a}" data-cls="${esc(c)}" aria-pressed="${M.audience === a && (a !== 'class' || M.classId === c)}">${esc(l)}</button>`).join('')}</div>
      ${M.audience === 'one' ? `<label class="j-field" style="margin-top:10px"><span>Family</span><select class="j-select" id="jg-fam"><option value="">Choose a family</option>${d.families.map((f) => `<option value="${esc(f.email)}" ${f.email === M.email ? 'selected' : ''}>${esc(f.parent || f.email)}: ${esc(f.children.map((c) => c.name).join(', '))}${f.dnc ? ' (Do Not Contact)' : ''}</option>`).join('')}</select></label>` : ''}
      ${d.noEmail.length ? `<p class="muted small" style="margin-top:8px">No parent email, so not included: ${esc(d.noEmail.join(', '))}.</p>` : ''}
    </section>
    <section class="jd-card" style="margin-top:12px"><h2>2. The email</h2>
      <label class="j-field" style="margin-top:8px"><span>Subject</span><input class="j-input" id="jg-subject" maxlength="120" value="${esc(M.subject)}" placeholder="For example: No class this Saturday"></label>
      <label class="j-field"><span>Message</span><textarea class="j-textarea" id="jg-text" rows="6" maxlength="3000" placeholder="It starts with Hi and the parent's name, and ends with the child's class and next class.">${esc(M.text)}</textarea></label>
      <label class="j-check"><input type="checkbox" id="jg-signin" ${M.signIn ? 'checked' : ''}> Add the "Open your account" button</label>
      <div class="jj-actions"><button type="button" class="j-btn j-btn-dark" id="jg-prepare">Show the email</button></div>
    </section>
    <div id="jg-ready">${p ? readyHtml(p) : ''}</div>
    <section class="jd-card" style="margin-top:16px" id="jg-sent"><h2>Sent before</h2>
      ${d.batches.length ? `<ul class="jj-pays">${d.batches.map((b) => `<li data-batch="${esc(b.id)}"><span><b>${esc(b.subject)}</b><br><span class="muted small">${esc(b.label)} · ${esc(when(b.at))} · ${esc(b.byName || '')}</span>${b.checkIt.length ? `<br>${b.checkIt.map((m) => `<button type="button" class="link" data-settle="${esc(m.id)}">Check it: ${esc(m.parent || m.email)}</button>`).join(' ')}` : ''}</span>
        <span>${b.sent ? pill('green', `${b.sent} sent`) : ''}${b.draft ? pill('grey', `${b.draft} not sent`) : ''}${b.problem ? pill('red', `${b.problem} problem`) : ''}${b.cancelled ? pill('grey', `${b.cancelled} cancelled`) : ''}${b.draft ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-drop="${esc(b.id)}">Cancel</button>` : ''}</span></li>`).join('')}</ul>` : '<p class="muted small">Nothing sent yet.</p>'}
    </section>
  </div>`
  const v = ui.view()
  const keep = () => { M.subject = v.querySelector('#jg-subject').value; M.text = v.querySelector('#jg-text').value; M.signIn = v.querySelector('#jg-signin').checked; M.email = v.querySelector('#jg-fam')?.value ?? M.email }
  v.querySelectorAll('#jg-who [data-aud]').forEach((b) => b.addEventListener('click', () => { keep(); M.audience = b.dataset.aud; M.classId = b.dataset.cls; M.prepared = null; renderJJMessages(ui) }))
  v.querySelector('#jg-fam')?.addEventListener('change', () => { keep(); M.prepared = null })
  v.querySelector('#jg-prepare').addEventListener('click', async (e) => {
    const btn = e.currentTarget
    keep()
    if (M.subject.trim().length < 3) return toast('Write the subject.')
    if (M.text.trim().length < 10) return toast('Write the message.')
    if (M.audience === 'one' && !M.email) return toast('Choose the family.')
    btn.disabled = true
    // An earlier one not sent is dropped first, so only this one can go.
    if (M.prepared?.batch?.id) await call('jjMsgCancel', { batchId: M.prepared.batch.id })
    const r = await call('jjMsgPrepare', { audience: M.audience, classId: M.classId, email: M.email, subject: M.subject, text: M.text, signIn: M.signIn })
    btn.disabled = false
    if (!r.ok) return toast(r.data.error || 'Could not make the email.')
    M.prepared = r.data
    v.querySelector('#jg-ready').innerHTML = readyHtml(r.data)
    bindReady(ui)
    v.querySelector('#jg-ready').scrollIntoView?.({ block: 'start' })
  })
  v.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await ui.confirmBox('Cancel the emails not sent yet?', { ok: 'Cancel them', danger: true }))) return
    const r = await call('jjMsgCancel', { batchId: b.dataset.drop })
    toast(r.ok ? `${r.data.cancelled} cancelled.` : r.data.error || 'Could not cancel.')
    if (M.prepared?.batch?.id === b.dataset.drop) M.prepared = null
    renderJJMessages(ui)
  }))
  v.querySelectorAll('[data-settle]').forEach((b) => b.addEventListener('click', () => settle(ui, b.dataset.settle)))
  bindReady(ui)
}

function readyHtml(p) {
  return `<section class="jd-card" style="margin-top:12px" id="jg-preview"><h2>3. Check it, then Send</h2>
    <p class="sub">${esc(p.batch.label)}: <b>${p.families.length}</b> famil${p.families.length === 1 ? 'y' : 'ies'}. This is exactly what ${p.previews.length > 1 ? 'the first two get' : 'they get'}; the others differ only in names and class.</p>
    ${p.previews.map((x) => `<div class="j-card jj-prev" style="padding:12px;margin:10px 0"><p class="small" style="overflow-wrap:anywhere"><b>To ${esc(x.parent || x.email)}</b><br>Subject: ${esc(x.subject)}</p><iframe title="Email preview" class="jj-frame" srcdoc="${esc(x.html)}"></iframe></div>`).join('')}
    <details style="margin-top:6px"><summary style="min-height:40px;display:flex;align-items:center;cursor:pointer">Every family (${p.families.length})</summary><p class="small muted">${esc(p.families.map((f) => `${f.parent || f.email} (${f.players.join(', ')})`).join('; '))}</p></details>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" id="jg-drop">Not now</button><button type="button" class="j-btn j-btn-dark" id="jg-send">Send to ${p.families.length}</button></div>
  </section>`
}

function bindReady(ui) {
  const v = ui.view()
  const p = M.prepared
  if (!p) return
  v.querySelector('#jg-drop')?.addEventListener('click', async () => { await call('jjMsgCancel', { batchId: p.batch.id }); M.prepared = null; toast('Not sent.'); renderJJMessages(ui) })
  v.querySelector('#jg-send')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    if (!(await ui.confirmBox(`Send "${esc(p.batch.subject)}" to <b>${p.families.length}</b> famil${p.families.length === 1 ? 'y' : 'ies'} now?`, { ok: 'Send' }))) return
    btn.disabled = true
    let sent = 0, left = p.families.length
    const failed = [], skipped = []
    for (let i = 0; i < 20 && left > 0; i += 1) {
      btn.textContent = `Sending ${Math.min(sent + 10, p.families.length)} of ${p.families.length}`
      const r = await call('jjMsgSend', { batchId: p.batch.id, confirm: true })
      if (!r.ok) { toast(r.data.error || 'Sending stopped. Nothing is lost: try again.', 7000); break }
      sent += r.data.sent.length; failed.push(...r.data.failed); skipped.push(...r.data.skipped)
      if (left === r.data.left && !r.data.sent.length) break
      left = r.data.left
    }
    toast(`Sent ${sent}${skipped.length ? `. Left out ${skipped.length} (${skipped[0].why})` : ''}${failed.length ? `. Not sent ${failed.length} (${failed[0].error})` : ''}.`, failed.length || skipped.length ? 8000 : 4000)
    M.prepared = null; M.subject = ''; M.text = ''
    renderJJMessages(ui)
  })
}

// "Check it": Brevo did not answer clearly. A person looks in Brevo and says what happened.
function settle(ui, id) {
  const box = ui.modal(`<h2 style="margin-bottom:4px">Did it go?</h2><p class="muted small" style="margin-bottom:12px">Brevo did not answer clearly. Look in Brevo, then say what happened. Nothing is sent again from here.</p>
    <label class="j-field"><span>Where you checked</span><input class="j-input" id="js-note" maxlength="300" placeholder="For example: Brevo transactional log"></label>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-out="not_sent">It did not go</button><button type="button" class="j-btn j-btn-dark" data-out="delivered">It went</button></div>`)
  box.querySelectorAll('[data-out]').forEach((b) => b.addEventListener('click', async () => {
    const r = await call('reconcile', { id, outcome: b.dataset.out, note: box.querySelector('#js-note').value.trim() })
    if (!r.ok) return toast(r.data.error || 'Could not save that.')
    ui.closeModal(); toast('Saved.'); renderJJMessages(ui)
  }))
}
