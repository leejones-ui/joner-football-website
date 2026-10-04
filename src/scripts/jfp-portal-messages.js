// Portal Messages tab: email and text each family, one at a time. Every
// message is shown exactly as it will go, and only goes when Lee or Ligia
// approves it. Texts go through Messages on the HQ Mac.
import { esc, api, toast, money } from './jfp-common.js'

const call = (action, body = {}) => api('/api/jfp-messages', { action, ...body })
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : when(iso) }
const PILL = { draft: 'grey', sending: 'blue', queued: 'blue', claimed: 'blue', sent: 'green', delivered: 'green', failed: 'red', unknown: 'amber', cancelled: 'grey', expired: 'grey' }
const pill = (m) => (m ? `<span class="j-pill j-pill-${PILL[m.status] || 'grey'}">${esc(m.statusLabel || m.status)}</span>` : '<span class="muted small">None</span>')
const KIND = { pay: ['amber', 'Due on records'], paid: ['green', 'Paid'], noPrice: ['red', 'No fee set'] }

let S = { filter: 'pay', q: '' }

export async function renderMessages(ui) {
  const { view, need, modal, closeModal, confirmBox } = ui
  const d = await need(await call('overview'))
  const route = d.route || {}
  const relayLine = d.relay ? `Mac last checked in ${ago(d.relay.at)}${d.relay.ok === false ? ` · <b style="color:var(--j-red,#B42318)">${esc(d.relay.problem || 'not ready')}</b>` : ''}` : 'The Mac has not checked in yet'
  const counts = { pay: 0, paid: 0, noPrice: 0, check: 0 }
  for (const f of d.families) counts[f.kind] += 1
  const checkIt = d.messages.filter((m) => m.status === 'unknown')
  const list = d.families.filter((f) => {
    if (S.q && !`${f.parent} ${f.email} ${f.players.map((p) => p.name).join(' ')}`.toLowerCase().includes(S.q)) return false
    if (S.filter === 'all') return true
    if (S.filter === 'notSent') return !f.lastEmail || !['sent', 'delivered'].includes(f.lastEmail.status)
    return f.kind === S.filter
  })
  view().innerHTML = `
    <div class="jp-head"><div><h1>Messages</h1><p class="muted small">Email and text each family, one at a time. Prepare shows the exact email and text. Nothing goes until you approve that message, and each one goes once. Amounts are what is due on the current records, checked again just before sending.</p></div></div>
    ${d.dncError ? `<div class="j-box j-box-red" style="margin-bottom:12px">${esc(d.dncError)}</div>` : ''}
    <div class="j-card" style="padding:14px 16px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <div><b>Texts</b> ${route.verified ? `<span class="j-pill j-pill-green">Verified</span> <span class="small">Sends as ${esc(route.label || 'Messages on the HQ Mac')}${route.sender ? ` (${esc(route.sender.includes('@') ? route.sender : `•••• ${route.sender.slice(-3)}`)})` : ''}, iMessage or SMS</span>` : '<span class="j-pill j-pill-amber">Not verified yet</span> <span class="small">No family texts until Lee sends himself a test text and confirms it arrived.</span>'}
          <p class="muted small" style="margin-top:4px">${relayLine}. Texts go between ${d.textHours.from}am and ${d.textHours.to - 12}pm Sydney time, and expire if not sent within ${d.textExpiresHours} hours.</p></div>
        ${d.isOwner ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${route.verified ? '<button type="button" class="j-btn j-btn-line j-btn-sm" id="ms-unverify">Turn texts off</button>' : ''}<button type="button" class="j-btn j-btn-line j-btn-sm" id="ms-test">Send me a test text</button></div>` : ''}
      </div>
    </div>
    ${checkIt.length ? `<div class="j-box j-box-amber" style="margin-bottom:14px"><b>${checkIt.length} message${checkIt.length === 1 ? '' : 's'} to check.</b> The system could not tell if ${checkIt.length === 1 ? 'it' : 'they'} went. Look in Brevo or in Messages on the Mac, then settle it below. Nothing is sent again by itself.</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <div class="jp-seg" id="ms-f">${[['pay', `Due on records (${counts.pay})`], ['paid', `Paid (${counts.paid})`], ['noPrice', `No fee set (${counts.noPrice})`], ['notSent', 'Not emailed yet'], ['all', 'All']].map(([v, l]) => `<button type="button" data-f="${v}" aria-pressed="${S.filter === v}">${esc(l)}</button>`).join('')}</div>
      <input class="j-input" id="ms-q" placeholder="Search family or player" value="${esc(S.q)}" style="max-width:260px;padding:8px 10px;font-size:14px">
    </div>
    <div class="jp-scroll"><table class="jp-table"><thead><tr><th>Family</th><th>Players</th><th>Records</th><th>Email</th><th>Text</th><th></th></tr></thead><tbody>
    ${list.map((f) => `<tr>
      <td><b>${esc(f.parent || '')}</b><br><span class="muted small">${esc(f.email)}</span>${f.dnc ? '<br><span class="j-pill j-pill-red">Do Not Contact</span>' : ''}</td>
      <td class="small">${f.players.map((x) => esc(x.name)).join('<br>')}</td>
      <td><span class="j-pill j-pill-${KIND[f.kind][0]}">${esc(KIND[f.kind][1])}${f.kind === 'pay' ? ` ${esc(money(f.owingCents))}` : ''}</span>${f.openLink ? '<br><span class="muted small">Pay link open</span>' : ''}${f.invitedAt ? `<br><span class="muted small">Emailed ${esc(when(f.invitedAt))}</span>` : ''}</td>
      <td>${pill(f.lastEmail)}</td>
      <td>${pill(f.lastText)}<br><span class="muted small">${f.phoneProblem ? esc(f.phoneProblem) : `${esc(f.phone)} · Texts: ${f.pref ? esc(f.pref.text) : 'not asked'}`}</span></td>
      <td>${f.kind === 'noPrice' || f.dnc ? '' : `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-prep="${esc(f.email)}">Prepare</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">No families here.</td></tr>'}
    </tbody></table></div>
    ${counts.noPrice ? '<p class="muted small" style="margin-top:8px">"No fee set": nothing paid and no Term 4 Fee in Airtable. A blank fee is unknown, not zero, so these families cannot be messaged until the fee is set.</p>' : ''}
    ${d.noEmail.length ? `<p class="muted small">No parent email in Airtable: ${esc(d.noEmail.map((x) => x.name).join(', '))}.</p>` : ''}
    <h2 style="margin:22px 0 10px">Sent and waiting</h2>
    <div class="jp-scroll"><table class="jp-table"><thead><tr><th>When</th><th>Family</th><th>Channel</th><th>Status</th><th>Detail</th><th></th></tr></thead><tbody>
    ${d.messages.filter((m) => m.status !== 'draft').slice(0, 80).map((m) => `<tr>
      <td class="small">${esc(when(m.events.at(-1)?.at))}</td>
      <td class="small">${m.selfTest ? '<b>Test text to Lee</b>' : `<b>${esc(m.parentName)}</b><br><span class="muted">${esc(m.email)}</span>`}</td>
      <td class="small">${m.channel === 'email' ? 'Email' : `Text to ${esc(m.target?.ref || '')}`}</td>
      <td>${pill(m)}${m.receipt?.senderMismatch ? '<br><span class="j-pill j-pill-red">Different sender</span>' : ''}</td>
      <td class="small">${esc(m.events.at(-1)?.what || '')}${m.receipt?.service ? ` · ${esc(m.receipt.service)}` : ''}<br><span class="muted">Approved by ${esc(m.approvedBy || m.requestedBy || '')}</span></td>
      <td>${m.status === 'queued' ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-cancel="${esc(m.id)}">Cancel</button>` : ''}${m.status === 'unknown' ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-settle="${esc(m.id)}">Settle</button>` : ''}${d.isOwner && m.selfTest && m.status === 'sent' && !route.verified ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-verify="${esc(m.id)}">It arrived</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing sent yet.</td></tr>'}
    </tbody></table></div>`

  const again = () => renderMessages(ui)
  view().querySelector('#ms-f').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { S.filter = b.dataset.f; again() } })
  view().querySelector('#ms-q').addEventListener('change', (e) => { S.q = e.target.value.trim().toLowerCase(); again() })
  view().querySelectorAll('[data-prep]').forEach((b) => b.addEventListener('click', () => prepare(ui, d, d.families.find((f) => f.email === b.dataset.prep))))
  view().querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Cancel this text? It will not be sent.', { ok: 'Cancel it', danger: true }))) return
    const r = await call('cancel', { id: b.dataset.cancel }); toast(r.ok ? 'Cancelled' : r.data.error); again()
  }))
  view().querySelectorAll('[data-settle]').forEach((b) => b.addEventListener('click', () => settle(ui, b.dataset.settle)))
  view().querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', async () => {
    const box = modal(`<h2 style="margin-bottom:8px">Did the test text arrive?</h2><p class="small" style="margin-bottom:12px">Only say yes if it is on your phone. Families' texts will come from the same sender.</p>
      <label class="j-field"><span>Name shown to staff for this route</span><input class="j-input" id="vr-label" value="Lee (Messages on the HQ Mac)"></label>
      <label class="j-field"><span>Texts start "Hi Sarah, it's ... from Joner Football"</span><input class="j-input" id="vr-name" value="Lee" maxlength="30"></label>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="j-btn j-btn-line" data-close>Not yet</button><button type="button" class="j-btn j-btn-dark" id="vr-yes">Yes, it arrived</button></div>`)
    box.querySelector('#vr-yes').addEventListener('click', async () => {
      const r = await call('verifyRoute', { id: b.dataset.verify, arrived: true, label: box.querySelector('#vr-label').value, senderName: box.querySelector('#vr-name').value })
      closeModal(); toast(r.ok ? 'Texts are on' : r.data.error); again()
    })
  }))
  view().querySelector('#ms-test')?.addEventListener('click', () => {
    const box = modal(`<h2 style="margin-bottom:8px">Send yourself a test text</h2><p class="small" style="margin-bottom:12px">It goes through the same queue and the HQ Mac as family texts. The Mac has to be running the text helper.</p>
      <label class="j-field"><span>Your mobile</span><input class="j-input" id="st-phone" inputmode="tel" placeholder="04xx xxx xxx"></label>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="st-go">Queue the test</button></div>`)
    box.querySelector('#st-go').addEventListener('click', async () => {
      const r = await call('selfTest', { phone: box.querySelector('#st-phone').value }); closeModal(); toast(r.ok ? 'Test queued for the Mac' : r.data.error); again()
    })
  })
  view().querySelector('#ms-unverify')?.addEventListener('click', async () => {
    if (!(await confirmBox('Turn family texts off? Nothing new can be approved until you verify again.', { ok: 'Turn off', danger: true }))) return
    await call('unverifyRoute'); again()
  })
}

async function settle(ui, id) {
  const box = ui.modal(`<h2 style="margin-bottom:8px">What happened to this message?</h2><p class="small" style="margin-bottom:12px">Check first: for an email, Brevo's transactional log. For a text, Messages on the HQ Mac (and the family's reply, if any). This does not send anything.</p>
    <label class="j-field"><span>Where you checked</span><input class="j-input" id="se-note" placeholder="e.g. it is in Messages on the Mac"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" data-close>Not sure yet</button><button type="button" class="j-btn j-btn-line" data-o="not_sent">It did not go</button><button type="button" class="j-btn j-btn-dark" data-o="delivered">It went</button></div>`)
  box.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', async () => {
    const r = await call('reconcile', { id, outcome: b.dataset.o, note: box.querySelector('#se-note').value })
    if (!r.ok) return toast(r.data.error)
    ui.closeModal(); toast('Saved'); renderMessages(ui)
  }))
}

async function prepare(ui, d, f, createLink = false) {
  const r = await call('prepare', { email: f.email, createLink })
  if (!r.ok) return toast(r.data.error)
  const ev = r.data.evidence
  const evidence = `<div class="j-card" style="padding:12px;margin-bottom:12px"><p class="small" style="margin-bottom:6px"><b>Due according to current records</b> <span class="muted">(read from Airtable just now)</span></p>
    <table class="jp-table"><thead><tr><th>Player</th><th>Fee</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${ev.rows.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.fee == null ? '<span class="muted">blank</span>' : `A$${esc(x.fee)}`}</td><td>${x.paid == null ? '<span class="muted">blank</span>' : `A$${esc(x.paid)}`}</td><td>${x.balance == null ? '<span class="muted">blank</span>' : `A$${esc(x.balance)}`}</td><td class="small">${esc(x.status || '')}</td></tr>`).join('')}</tbody></table>
    ${ev.link ? `<p class="muted small" style="margin-top:6px">Pay link ${esc(ev.link.id)}: ${esc(money(ev.link.amountCents))}, ${esc(ev.link.status)}.</p>` : ''}</div>`
  if (r.data.needsLink) {
    const box = ui.modal(`<h2 style="margin-bottom:8px">${esc(f.parent)}</h2>${evidence}<p class="small" style="margin-bottom:12px">There is no open pay link. Create one for <b>${esc(money(r.data.family.owingCents))}</b>, the amount due on these records? Nothing is sent yet.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="j-btn j-btn-line" data-close>Not now</button><button type="button" class="j-btn j-btn-dark" id="pl-go">Create the pay link</button></div>`, { wide: true })
    box.querySelector('#pl-go').addEventListener('click', () => { ui.closeModal(); prepare(ui, d, f, true) })
    return
  }
  const em = r.data.email, tx = r.data.text
  const textOk = d.route?.verified
  const box = ui.modal(`<h2 style="margin-bottom:4px">${esc(f.parent)}</h2><p class="muted small" style="margin-bottom:12px">${esc(f.email)} · prepared by you, ${esc(when(em.createdAt))}</p>
    ${evidence}
    <h3 style="margin:6px 0">Email</h3>
    <p class="small"><b>To:</b> ${esc(f.email)} · <b>Subject:</b> ${esc(em.subject)}</p>
    <iframe title="Email exactly as it will go" style="width:100%;height:420px;border:1px solid #E5E7EB;border-radius:10px;margin:8px 0;background:#fff" srcdoc="${esc(em.html)}"></iframe>
    ${f.invitedAt ? `<div class="j-box j-box-amber small" style="margin-bottom:8px">Already emailed ${esc(when(f.invitedAt))}. ${d.isOwner ? '<label class="j-check" style="padding:4px 0 0"><input type="checkbox" id="pr-again"> <span>Send again anyway</span></label>' : 'Only Lee can send another.'}</div>` : ''}
    <button type="button" class="j-btn j-btn-dark" id="pr-email">Approve and send this email</button>
    <h3 style="margin:18px 0 6px">Text</h3>
    ${tx ? `<p class="small"><b>To:</b> ${esc(tx.target.ref)} · <b>From:</b> ${esc(d.route?.label || 'Messages on the HQ Mac')}${d.route?.sender ? '' : ' (not verified yet)'}</p>
      <div class="j-two" style="margin:8px 0"><label class="j-field"><span>Texts for this family</span><select class="j-select" id="pr-pref"><option value="">Not asked</option><option value="yes" ${f.pref?.text === 'yes' ? 'selected' : ''}>Yes, they are happy to get texts</option><option value="no" ${f.pref?.text === 'no' ? 'selected' : ''}>No texts</option></select></label>
      <label class="j-field"><span>How they agreed</span><input class="j-input" id="pr-how" value="${esc(f.pref?.how || '')}" placeholder="e.g. they text Ligia already"></label></div>
      <label class="j-field"><span>The text, exactly as it will go (${'<span id="pr-len"></span>'} characters)</span><textarea class="j-textarea" id="pr-text" rows="5">${esc(tx.text)}</textarea></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" id="pr-save">Save changes</button><button type="button" class="j-btn j-btn-dark" id="pr-textgo" ${textOk ? '' : 'disabled title="Texts are not verified yet"'}>Approve this text</button></div>` : `<p class="muted small">No text: ${esc(r.data.phoneProblem || 'no usable mobile')}.</p>`}
    <div style="display:flex;justify-content:flex-end;margin-top:16px"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
  let emailHash = em.payloadHash, textHash = tx?.payloadHash, textId = tx?.id
  const len = () => { const t = box.querySelector('#pr-text'); if (t) box.querySelector('#pr-len').textContent = t.value.length }
  len(); box.querySelector('#pr-text')?.addEventListener('input', len)
  box.querySelector('#pr-email').addEventListener('click', async (e) => {
    if (!(await confirmAgain(ui, `Send this email to <b>${esc(f.email)}</b> now?`))) return
    e.target.disabled = true; e.target.textContent = 'Sending'
    const s = await call('approve', { id: em.id, payloadHash: emailHash, replace: Boolean(box.querySelector('#pr-again')?.checked) })
    toast(s.ok ? 'Email sent' : s.data.error, 6000)
    if (!s.ok && s.data.code !== 'emailed_before') { e.target.textContent = 'Not sent'; return }
    e.target.textContent = s.ok ? 'Sent' : 'Approve and send this email'; e.target.disabled = s.ok
  })
  box.querySelector('#pr-save')?.addEventListener('click', async () => {
    const pref = box.querySelector('#pr-pref').value
    if (pref) { const p = await call('setPref', { email: f.email, text: pref, how: box.querySelector('#pr-how').value }); if (!p.ok) return toast(p.data.error); f.pref = { text: pref } }
    const t = await call('editText', { id: textId, text: box.querySelector('#pr-text').value })
    if (!t.ok) return toast(t.data.error)
    textHash = t.data.message.payloadHash
    toast('Saved')
  })
  box.querySelector('#pr-textgo')?.addEventListener('click', async (e) => {
    const pref = box.querySelector('#pr-pref').value
    if (pref !== (f.pref?.text || '')) { const p = await call('setPref', { email: f.email, text: pref, how: box.querySelector('#pr-how').value }); if (!p.ok) return toast(p.data.error); f.pref = { text: pref } }
    if (box.querySelector('#pr-text').value.trim() !== (await call('get', { id: textId })).data.message.text) return toast('Save your changes first, then approve.')
    if (!(await confirmAgain(ui, `Approve this text to <b>${esc(tx.target.ref)}</b>? The Mac sends it next time it checks (${d.textHours.from}am to ${d.textHours.to - 12}pm).`))) return
    const s = await call('approve', { id: textId, payloadHash: textHash })
    toast(s.ok ? 'Text approved, waiting for the Mac' : s.data.error, 6000)
    if (s.ok) { e.target.disabled = true; e.target.textContent = 'Approved' }
  })
  box.querySelector('[data-close]')?.addEventListener('click', () => renderMessages(ui))
}

// A confirm that does not close the message window behind it.
function confirmAgain(ui, message) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div')
    wrap.className = 'jp-confirm-over'
    wrap.innerHTML = `<div class="jp-modal" role="dialog" aria-modal="true" style="z-index:1002"><p style="font-size:15px;margin-bottom:18px">${message}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="j-btn j-btn-line" data-no>Cancel</button><button type="button" class="j-btn j-btn-dark" data-yes>Yes, send</button></div></div>`
    document.querySelector('.jfp').appendChild(wrap)
    const done = (v) => { wrap.remove(); resolve(v) }
    wrap.querySelector('[data-no]').addEventListener('click', () => done(false))
    wrap.querySelector('[data-yes]').addEventListener('click', () => done(true))
  })
}
