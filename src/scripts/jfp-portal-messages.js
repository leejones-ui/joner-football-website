// Portal Messages tab: email and text each family, one at a time. Every
// message is shown exactly as it will go, and only goes when Lee or Ligia
// approves it. Texts go through Messages on the HQ Mac.
import { esc, api, toast, money } from './jfp-common.js'
import { psHead, psSearch, psSelect, psBadge, psChips, psToolsMore } from './jfp-portal-ps.js'

const call = (action, body = {}) => api('/api/jfp-messages', { action, ...body })
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : when(iso) }
// Status as the portal design system's dot + word (was a coloured pill).
const DOT = { draft: 'grey', sending: 'violet', queued: 'violet', claimed: 'violet', sent: 'green', delivered: 'green', failed: 'red', unknown: 'orange', cancelled: 'grey', expired: 'grey' }
const badge = (m) => (m ? psBadge(DOT[m.status] || 'grey', m.statusLabel || m.status) : '<span class="muted small">None</span>')
const KIND = { pay: ['orange', 'Due on records'], paid: ['green', 'Paid'], noPrice: ['red', 'No fee set'] }
const OK = ['sent', 'delivered'], WAIT = ['queued', 'claimed', 'sending'], BAD = ['failed', 'unknown']
// One message status group, used by the filters and chips of both lists.
const group = (m) => (!m ? 'none' : OK.includes(m.status) ? 'sent' : WAIT.includes(m.status) ? 'waiting' : m.status === 'unknown' ? 'unknown' : m.status === 'failed' ? 'failed' : 'closed')

// Families list filters (kind starts on Due on records, as it always has) and
// the Sent and waiting list filters (s*).
let S = { kind: 'pay', email: '', text: '', pref: '', dnc: '', link: '', q: '', moreOpen: false, sq: '', sstatus: '', schannel: '' }
const F_MORE = ['pref', 'dnc', 'link']

export async function renderMessages(ui) {
  const { view, need, modal, closeModal, confirmBox } = ui
  const d = await need(await call('overview'))
  const loadedAt = Date.now()
  const route = d.route || {}
  // A stale check-in used to look exactly like a healthy one, because ok was
  // true when the Mac last spoke. Nothing running is the normal reason a text
  // sits in the queue doing nothing, so say so and say what to do about it.
  // (Lee lost an evening to this on 7 Oct 2026.)
  const STALE_MIN = 10
  const relayAgeMin = d.relay?.at ? Math.round((Date.now() - Date.parse(d.relay.at)) / 60000) : null
  const stale = relayAgeMin != null && relayAgeMin > STALE_MIN
  const warn = (t) => `<b style="color:var(--j-red,#B42318)">${t}</b>`
  const relayLine = !d.relay
    ? warn('The Mac has never checked in. Run ~/jfp-text watch on the HQ Mac.')
    : d.relay.ok === false
      ? `Mac last checked in ${ago(d.relay.at)} · ${warn(esc(d.relay.problem || 'not ready'))}`
      : stale
        ? `Mac last checked in ${ago(d.relay.at)} · ${warn('nothing is running on the Mac, so texts will sit here. Run ~/jfp-text watch on the HQ Mac.')}`
        : `Mac checked in ${ago(d.relay.at)}`
  const checkIt = d.messages.filter((m) => m.status === 'unknown')
  // The newest test text Lee sent himself: confirming it switches texts on.
  const lastTest = d.messages.find((m) => m.selfTest && !['draft', 'cancelled', 'expired'].includes(m.status))
  const sentAll = d.messages.filter((m) => m.status !== 'draft')
  const help = `<details class="ps-help"><summary aria-label="About this page" title="About this page">?</summary><div class="ps-help-body">Press Prepare on a family to see their email and text. Send the email, the text, or both. Each one goes once.${d.families.some((f) => f.kind === 'noPrice') ? '<br><br>"No fee set": nothing paid and no Term 4 Fee in Airtable. A blank fee is unknown, not zero, so these families cannot be messaged until the fee is set.' : ''}</div></details>`
  view().innerHTML = `
    ${psHead({ title: 'Messages', count: String(d.families.length) }).replace('</h1>', `</h1>${help}`)}
    ${d.dncError ? `<div class="j-box j-box-red" style="margin-bottom:12px">${esc(d.dncError)}</div>` : ''}
    <div class="j-card" style="padding:14px 16px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <div><b>Texts</b> ${route.verified ? `<span class="j-pill j-pill-green">Verified</span> <span class="small">Sends as ${esc(route.label || 'Messages on the HQ Mac')}${route.sender ? ` (${esc(route.sender.includes('@') ? route.sender : `•••• ${route.sender.slice(-3)}`)})` : ''}, iMessage or SMS</span>` : '<span class="j-pill j-pill-amber">Not verified yet</span> <span class="small">No family texts until Lee sends himself a test text and confirms it arrived.</span>'}
          <p class="muted small" style="margin-top:4px">${relayLine}. Texts go between ${d.textHours.from}am and ${d.textHours.to - 12}pm Sydney time, and expire if not sent within ${d.textExpiresHours} hours.</p></div>
        ${d.isOwner ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${route.verified ? '<button type="button" class="j-btn j-btn-line j-btn-sm" id="ms-unverify">Turn texts off</button>' : ''}<button type="button" class="j-btn j-btn-line j-btn-sm" id="ms-test">Send me a test text</button></div>` : ''}
      </div>
    </div>
    ${!route.verified && d.isOwner && lastTest ? `<div class="j-box ms-verify-box ${lastTest.status === 'sent' ? 'j-box-amber' : 'j-box-grey'}" style="margin-bottom:14px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <span>${lastTest.status === 'sent' ? `<b>One step to switch texts on.</b> Your test text went at ${esc(when(lastTest.events.at(-1)?.at))}. Did it arrive on your phone?` : `<b>Your test text is ${esc(String(lastTest.statusLabel || lastTest.status).toLowerCase())}.</b> When it has gone, confirm it here.`}</span>
      ${lastTest.status === 'sent' ? `<button type="button" class="j-btn j-btn-dark" data-verify="${esc(lastTest.id)}">Yes, it arrived: turn texts on</button>` : ''}</div>` : ''}
    <div id="ms-guide"></div>
    <div id="ms-campaign"></div>
    ${checkIt.length ? `<div class="j-box j-box-amber" style="margin-bottom:14px"><b>${checkIt.length} message${checkIt.length === 1 ? '' : 's'} to check.</b> The system could not tell if ${checkIt.length === 1 ? 'it' : 'they'} went. Look in Brevo or in Messages on the Mac, then settle it below. Nothing is sent again by itself.</div>` : ''}
    <div class="ps-tools" role="search" id="ms-ftools">
      ${psSearch('ms-q', 'Search family or player…', S.q, 'Search families by parent, email or player')}
      <span class="ps-more-filters" id="ms-fsel"></span>
      <span class="ps-meta">Updated ${esc(new Date(loadedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }))} · <button type="button" class="ps-link" id="ms-refresh" title="Read the messages again">Refresh</button></span>
    </div>
    <div id="ms-fchips"></div>
    <div class="ps-table-wrap"><table class="ps-table ms-ps"><thead><tr><th>Parent</th><th>Players</th><th>Records</th><th>Email</th><th>Text</th><th class="ps-end"><span class="sr-only">Prepare</span></th></tr></thead><tbody id="ms-frows"></tbody></table></div>
    <p class="muted small" id="ms-fcount" style="margin-top:8px"></p>
    ${d.noEmail.length ? `<p class="muted small">No parent email in Airtable: ${esc(d.noEmail.map((x) => x.name).join(', '))}.</p>` : ''}
    <h2 style="margin:22px 0 10px">Sent and waiting</h2>
    <div class="ps-tools" role="search" id="ms-stools">
      ${psSearch('ms-sq', 'Search parent or email…', S.sq, 'Search sent messages by parent or email')}
      <span class="ps-more-filters" id="ms-ssel"></span>
    </div>
    <div id="ms-schips"></div>
    <div class="ps-table-wrap"><table class="ps-table ms-ps"><thead><tr><th>Parent</th><th>Channel</th><th>Status</th><th>Detail</th><th class="ps-end"><span class="sr-only">Actions</span></th></tr></thead><tbody id="ms-srows"></tbody></table></div>
    <p class="muted small" id="ms-scount" style="margin-top:8px"></p>`
  drawGuide(ui, renderMessages)
  drawCampaign(ui, renderMessages)

  const $ = (id) => view().querySelector(`#${id}`)
  const again = () => renderMessages(ui)

  // ---- Families: search, Records, Email, Text, More filters, chips, table.
  const famHay = (f) => `${f.parent} ${f.email} ${f.players.map((p) => p.name).join(' ')}`.toLowerCase()
  const fMatch = (f) => {
    if (S.kind && f.kind !== S.kind) return false
    if (S.email === 'notSent' && f.lastEmail && OK.includes(f.lastEmail.status)) return false
    if (S.email === 'sent' && group(f.lastEmail) !== 'sent') return false
    if (S.email === 'problem' && !BAD.includes(f.lastEmail?.status)) return false
    if (S.text === 'noPhone' ? !f.phoneProblem : S.text === 'problem' ? !BAD.includes(f.lastText?.status) : S.text && group(f.lastText) !== S.text) return false
    if (S.pref && (S.pref === 'unasked' ? Boolean(f.pref?.text) : f.pref?.text !== S.pref)) return false
    if (S.dnc && Boolean(f.dnc) !== (S.dnc === 'yes')) return false
    if (S.link && Boolean(f.openLink) !== (S.link === 'open')) return false
    return !S.q || famHay(f).includes(S.q)
  }
  const fActive = () => ['q', 'kind', 'email', 'text', ...F_MORE].filter((k) => S[k]).length
  const famRow = (f) => `<tr data-s="${esc(famHay(f))}">
      <td data-col="who"><div class="ps-who"><div><b>${esc(f.parent || '')}</b><span class="ps-sub">${esc(f.email)}</span>${f.dnc ? `<span class="ps-sub">${psBadge('red', 'Do Not Contact')}</span>` : ''}</div></div></td>
      <td data-col="group" class="small">${f.players.map((x) => esc(x.name)).join('<br>')}</td>
      <td data-col="pay">${psBadge(KIND[f.kind][0], `${KIND[f.kind][1]}${f.kind === 'pay' ? ` ${money(f.owingCents)}` : ''}`)}${f.openLink ? '<span class="ps-sub">Pay link open</span>' : ''}${f.invitedAt ? `<span class="ps-sub">Emailed ${esc(when(f.invitedAt))}</span>` : ''}</td>
      <td data-col="flags"><span class="ms-lbl">Email </span>${badge(f.lastEmail)}</td>
      <td data-col="flags"><span class="ms-lbl">Text </span>${badge(f.lastText)}<span class="ps-sub">${f.phoneProblem ? esc(f.phoneProblem) : `${esc(f.phone)} · Texts: ${f.pref ? esc(f.pref.text) : 'not asked'}`}</span></td>
      <td class="ps-end ps-keep">${f.kind === 'noPrice' || f.dnc ? '' : `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-prep="${esc(f.email)}">Prepare</button>`}</td>
    </tr>`
  const drawFamTools = () => {
    const moreSet = F_MORE.filter((k) => S[k]).length
    if (moreSet) S.moreOpen = true
    $('ms-fsel').innerHTML = `${psSelect('ms-kind', [{ id: 'pay', label: 'Due on records' }, { id: 'paid', label: 'Paid' }, { id: 'noPrice', label: 'No fee set' }], S.kind, 'Records')}
      ${psSelect('ms-email', [{ id: 'notSent', label: 'Not emailed yet' }, { id: 'sent', label: 'Emailed' }, { id: 'problem', label: 'Failed or to check' }], S.email, 'Email')}
      ${psSelect('ms-text', [{ id: 'none', label: 'Not texted yet' }, { id: 'waiting', label: 'Waiting for the Mac' }, { id: 'sent', label: 'Texted' }, { id: 'problem', label: 'Failed or to check' }, { id: 'noPhone', label: 'No usable mobile' }], S.text, 'Text')}
      <span class="ps-more-filters" id="ms-f-morebox" ${S.moreOpen ? '' : 'hidden'}>${psSelect('ms-pref', [{ id: 'yes', label: 'Happy to get texts' }, { id: 'no', label: 'No texts' }, { id: 'unasked', label: 'Not asked' }], S.pref, 'Texts OK?')}${psSelect('ms-dnc', [{ id: 'yes', label: 'Do Not Contact' }, { id: 'no', label: 'Can be contacted' }], S.dnc, 'Do Not Contact')}${psSelect('ms-link', [{ id: 'open', label: 'Pay link open' }, { id: 'none', label: 'No pay link open' }], S.link, 'Pay link')}</span>
      ${psToolsMore('ms-f', { open: S.moreOpen, set: moreSet, active: fActive() })}`
    const n = (fn) => d.families.filter(fn).length
    $('ms-fchips').innerHTML = psChips([
      { key: 'kind', value: 'pay', label: 'Due on records', count: n((f) => f.kind === 'pay'), color: 'orange' },
      { key: 'kind', value: 'paid', label: 'Paid', count: n((f) => f.kind === 'paid'), color: 'green' },
      { key: 'kind', value: 'noPrice', label: 'No fee set', count: n((f) => f.kind === 'noPrice'), color: 'red' },
      { key: 'email', value: 'notSent', label: 'Not emailed yet', count: n((f) => !f.lastEmail || !OK.includes(f.lastEmail.status)), color: 'grey' },
      { key: 'email', value: 'problem', label: 'Email to check', count: n((f) => BAD.includes(f.lastEmail?.status)), color: 'red' },
      { key: 'text', value: 'problem', label: 'Text to check', count: n((f) => BAD.includes(f.lastText?.status)), color: 'red' },
      { key: 'dnc', value: 'yes', label: 'Do Not Contact', count: n((f) => f.dnc), color: 'grey' },
    ], (k, v) => S[k] === v)
  }
  const drawFam = () => {
    const list = d.families.filter(fMatch)
    $('ms-frows').innerHTML = list.map(famRow).join('') || `<tr><td colspan="6"><div class="ps-empty">No families here.${fActive() ? ' <button type="button" class="ps-link" data-ms-fclear>Clear filters</button>' : ''}</div></td></tr>`
    const c = view().querySelector('.ps-head .ps-count')
    if (c) c.textContent = list.length === d.families.length ? String(d.families.length) : `${list.length} of ${d.families.length}`
    $('ms-fcount').textContent = `${list.length} of ${d.families.length} families`
  }
  const fClear = () => { Object.assign(S, { q: '', kind: '', email: '', text: '', pref: '', dnc: '', link: '' }); $('ms-q').value = ''; drawFamTools(); drawFam() }

  // ---- Sent and waiting: search, Status, Channel, chips, table (newest 80).
  const S_STATUS = [{ id: 'sent', label: 'Sent' }, { id: 'waiting', label: 'Waiting' }, { id: 'unknown', label: 'Check it' }, { id: 'failed', label: 'Failed' }, { id: 'closed', label: 'Cancelled or expired' }]
  const sHay = (m) => (m.selfTest ? 'test text to lee' : `${m.parentName || ''} ${m.email || ''} ${m.target?.ref || ''}`).toLowerCase()
  const sMatch = (m) => (!S.sstatus || group(m) === S.sstatus) && (!S.schannel || (S.schannel === 'email' ? m.channel === 'email' : m.channel !== 'email')) && (!S.sq || sHay(m).includes(S.sq))
  const sActive = () => ['sq', 'sstatus', 'schannel'].filter((k) => S[k]).length
  const sentRow = (m) => `<tr>
      <td data-col="who"><div class="ps-who"><div>${m.selfTest ? '<b>Test text to Lee</b>' : `<b>${esc(m.parentName)}</b><span class="ps-sub">${esc(m.email)}</span>`}</div></div></td>
      <td data-col="group" class="small">${m.channel === 'email' ? 'Email' : `Text to ${esc(m.target?.ref || '')}`}<span class="ps-sub">${esc(when(m.events.at(-1)?.at))}</span></td>
      <td data-col="pay">${badge(m)}${m.receipt?.senderMismatch ? `<span class="ps-sub">${psBadge('red', 'Different sender')}</span>` : ''}</td>
      <td data-col="flags" class="small">${esc(m.events.at(-1)?.what || '')}${m.receipt?.service ? ` · ${esc(m.receipt.service)}` : ''}<span class="ps-sub">Approved by ${esc(m.approvedBy || m.requestedBy || '')}</span></td>
      <td class="ps-end ps-keep">${m.status === 'queued' ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-cancel="${esc(m.id)}">Cancel</button>` : ''}${m.status === 'unknown' ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-settle="${esc(m.id)}">Settle</button>` : ''}${d.isOwner && m.selfTest && m.status === 'sent' && !route.verified ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-verify="${esc(m.id)}">It arrived</button>` : ''}</td>
    </tr>`
  const drawSentTools = () => {
    $('ms-ssel').innerHTML = `${psSelect('ms-sstatus', S_STATUS, S.sstatus, 'Status')}${psSelect('ms-schannel', [{ id: 'email', label: 'Email' }, { id: 'text', label: 'Text' }], S.schannel, 'Channel')}
      ${psToolsMore('ms-s', { active: sActive(), hasMore: false })}`
    const n = (g) => sentAll.filter((m) => group(m) === g).length
    $('ms-schips').innerHTML = psChips([
      { key: 'sstatus', value: 'sent', label: 'Sent', count: n('sent'), color: 'green' },
      { key: 'sstatus', value: 'waiting', label: 'Waiting', count: n('waiting'), color: 'violet' },
      { key: 'sstatus', value: 'unknown', label: 'Check it', count: n('unknown'), color: 'orange' },
      { key: 'sstatus', value: 'failed', label: 'Failed', count: n('failed'), color: 'red' },
    ], (k, v) => S[k] === v)
  }
  const drawSent = () => {
    const list = sentAll.filter(sMatch)
    $('ms-srows').innerHTML = list.slice(0, 80).map(sentRow).join('') || `<tr><td colspan="5"><div class="ps-empty">${sentAll.length ? 'No messages match.' : 'Nothing sent yet.'}${sActive() ? ' <button type="button" class="ps-link" data-ms-sclear>Clear filters</button>' : ''}</div></td></tr>`
    $('ms-scount').textContent = `${list.length} of ${sentAll.length} messages${list.length > 80 ? ' · newest 80 shown, search to find older ones' : ''}`
  }
  const sClear = () => { Object.assign(S, { sq: '', sstatus: '', schannel: '' }); $('ms-sq').value = ''; drawSentTools(); drawSent() }

  drawFamTools(); drawFam(); drawSentTools(); drawSent()

  // Filters as you type (Lee, 14 Oct 2026: it only searched on Enter). Only
  // the rows redraw, so the search box keeps its focus.
  $('ms-q').addEventListener('input', (e) => { S.q = e.target.value.trim().toLowerCase(); drawFamTools(); drawFam() })
  $('ms-sq').addEventListener('input', (e) => { S.sq = e.target.value.trim().toLowerCase(); drawSentTools(); drawSent() })
  $('ms-ftools').addEventListener('change', (e) => {
    const k = { 'ms-kind': 'kind', 'ms-email': 'email', 'ms-text': 'text', 'ms-pref': 'pref', 'ms-dnc': 'dnc', 'ms-link': 'link' }[e.target.id]
    if (k) { S[k] = e.target.value; drawFamTools(); drawFam() }
  })
  $('ms-ftools').addEventListener('click', (e) => {
    if (e.target.closest('#ms-f-morefilters')) { S.moreOpen = !S.moreOpen; drawFamTools() }
    if (e.target.closest('#ms-f-clear')) fClear()
    if (e.target.closest('#ms-refresh')) again()
  })
  $('ms-stools').addEventListener('change', (e) => {
    const k = { 'ms-sstatus': 'sstatus', 'ms-schannel': 'schannel' }[e.target.id]
    if (k) { S[k] = e.target.value; drawSentTools(); drawSent() }
  })
  $('ms-stools').addEventListener('click', (e) => { if (e.target.closest('#ms-s-clear')) sClear() })
  $('ms-fchips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]'); if (!b) return
    const [k, v] = b.dataset.chip.split(':'); S[k] = S[k] === v ? '' : v; drawFamTools(); drawFam()
  })
  $('ms-schips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]'); if (!b) return
    const [k, v] = b.dataset.chip.split(':'); S[k] = S[k] === v ? '' : v; drawSentTools(); drawSent()
  })

  const cancelMsg = async (id) => {
    if (!(await confirmBox('Cancel this text? It will not be sent.', { ok: 'Cancel it', danger: true }))) return
    const r = await call('cancel', { id }); toast(r.ok ? 'Cancelled' : r.data.error); again()
  }
  const verify = (id) => {
    const box = modal(`<h2 style="margin-bottom:8px">Did the test text arrive?</h2><p class="small" style="margin-bottom:12px">Only say yes if it is on your phone. Every parent's text will come from the same sender.</p>
      <label class="j-field"><span>Name shown to staff for this route</span><input class="j-input" id="vr-label" value="Lee (Messages on the HQ Mac)"></label>
      <label class="j-field"><span>Texts start "Hi Sarah, it's ... from Joner Football"</span><input class="j-input" id="vr-name" value="Lee" maxlength="30"></label>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="j-btn j-btn-line" data-close>Not yet</button><button type="button" class="j-btn j-btn-dark" id="vr-yes">Yes, it arrived</button></div>`)
    box.querySelector('#vr-yes').addEventListener('click', async () => {
      const r = await call('verifyRoute', { id, arrived: true, label: box.querySelector('#vr-label').value, senderName: box.querySelector('#vr-name').value })
      closeModal(); toast(r.ok ? 'Texts are on' : r.data.error); again()
    })
  }
  // Rows redraw as filters change, so their buttons are handled on the table body.
  $('ms-frows').addEventListener('click', (e) => {
    if (e.target.closest('[data-ms-fclear]')) return fClear()
    const b = e.target.closest('[data-prep]')
    if (b) prepare(ui, d, d.families.find((f) => f.email === b.dataset.prep))
  })
  $('ms-srows').addEventListener('click', (e) => {
    if (e.target.closest('[data-ms-sclear]')) return sClear()
    const c = e.target.closest('[data-cancel]'); if (c) return cancelMsg(c.dataset.cancel)
    const s = e.target.closest('[data-settle]'); if (s) return settle(ui, s.dataset.settle)
    const v = e.target.closest('[data-verify]'); if (v) return verify(v.dataset.verify)
  })
  view().querySelectorAll('.ms-verify-box [data-verify]').forEach((b) => b.addEventListener('click', () => verify(b.dataset.verify)))
  view().querySelector('#ms-test')?.addEventListener('click', () => {
    const box = modal(`<h2 style="margin-bottom:8px">Send yourself a test text</h2><p class="small" style="margin-bottom:12px">It goes through the same queue and the office Mac (your work number) as family texts. The Mac has to be running the text helper.</p>
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
      <div class="j-two" style="margin:8px 0"><label class="j-field"><span>Texts for this family</span><select class="j-select" id="pr-pref"><option value="">Not asked</option><option value="yes" ${f.pref?.text !== 'no' ? 'selected' : ''}>Yes, they are happy to get texts</option><option value="no" ${f.pref?.text === 'no' ? 'selected' : ''}>No texts</option></select></label>
      <label class="j-field"><span>How they agreed</span><input class="j-input" id="pr-how" value="${esc(f.pref?.how || (f.pref?.text ? '' : 'A current JFP family: we text them about their own booking'))}" placeholder="e.g. they text Ligia already"></label></div>
      <label class="j-field"><span>The text, exactly as it will go (${'<span id="pr-len"></span>'} characters)</span><textarea class="j-textarea" id="pr-text" rows="5">${esc(tx.text)}</textarea></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" id="pr-save">Save changes</button><button type="button" class="j-btn j-btn-dark" id="pr-textgo" ${textOk ? '' : 'disabled'}>Send this text</button></div>
      ${textOk ? '' : `<p class="j-box j-box-amber small" style="margin-top:8px">Texts are not switched on yet. ${d.isOwner ? 'Close this, then press <b>Yes, it arrived: turn texts on</b> at the top of Messages (send yourself a test text first if there is none).' : 'Lee switches them on from the top of Messages.'}</p>`}` : `<p class="muted small">No text: ${esc(r.data.phoneProblem || 'no usable mobile')}.</p>`}
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
    if (!(await confirmAgain(ui, `Send this text to <b>${esc(tx.target.ref)}</b>? It goes from 0404 780 351 within a minute (${d.textHours.from}am to ${d.textHours.to - 12}pm).`))) return
    const s = await call('approve', { id: textId, payloadHash: textHash })
    toast(s.ok ? 'Text on its way from 0404 780 351' : s.data.error, 6000)
    if (s.ok) { e.target.disabled = true; e.target.textContent = 'On its way' }
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

// The sign-in message to every family (Lee, 12 Oct 2026): prepare drafts for
// all, show one email and one text exactly, then Lee sends in batches.
async function drawCampaign(ui, rerender) {
  const { need, confirmBox } = ui
  const el = document.getElementById('ms-campaign')
  if (!el) return
  const c = await need(await call('campaign'))
  const e = c.email, t = c.text
  const any = e.draft + e.sent + e.problem + t.draft + t.queued + t.sent + t.problem
  el.innerHTML = `<div class="j-card" style="padding:14px 16px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div><b>Sign-in message to every family</b> <span class="muted small">Email + text: sign in with the email on file, see sessions and term info, pay anything left (ignore if paid).</span>
        <p class="small" style="margin-top:6px">Emails: <b>${e.draft}</b> ready · ${e.sent} sent${e.problem ? ` · <span style="color:var(--j-red)">${e.problem} to check</span>` : ''} &nbsp;|&nbsp; Texts: <b>${t.draft}</b> ready · ${t.queued} waiting for the Mac · ${t.sent} sent${t.problem ? ` · <span style="color:var(--j-red)">${t.problem} to check</span>` : ''}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="j-btn j-btn-line j-btn-sm" id="mc-prep">${any ? 'Prepare any missing' : 'Prepare for every family'}</button>
        ${e.draft || t.draft ? '<button type="button" class="j-btn j-btn-line j-btn-sm" id="mc-show">Show exactly what goes</button>' : ''}
        ${c.isOwner && e.draft ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" id="mc-send-e">Send ${e.draft} emails</button>` : ''}
        ${c.isOwner && t.draft ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" id="mc-send-t" ${c.route?.verified ? '' : 'disabled title="Verify the text route first"'}>Queue ${t.draft} texts</button>` : ''}
      </div>
    </div>
    ${t.draft && !c.route?.verified ? '<p class="muted small" style="margin-top:6px">Texts wait until the 0404 780 351 test text is verified above.</p>' : ''}
    <div id="mc-preview" hidden style="margin-top:12px"></div>
  </div>`
  document.getElementById('mc-prep')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Preparing...'
    const r = await call('prepareCampaign')
    if (!r.ok) { b.disabled = false; return toast(r.data.error) }
    const x = r.data
    toast(`Ready: ${x.emails} emails, ${x.texts} texts${x.noPhone.length ? `. ${x.noPhone.length} with no usable mobile` : ''}${x.dnc.length ? `. ${x.dnc.length} Do Not Contact left out` : ''}`)
    rerender(ui)
  })
  document.getElementById('mc-show')?.addEventListener('click', () => {
    const p = document.getElementById('mc-preview')
    p.hidden = !p.hidden
    p.innerHTML = `${c.sample.subject ? `<p class="small"><b>Email</b> · Subject: ${esc(c.sample.subject)}</p><iframe title="Email preview" style="width:100%;height:620px;border:1px solid var(--j-line);border-radius:10px;background:#fff" srcdoc="${esc(c.sample.html)}"></iframe>` : ''}
      ${c.sample.text ? `<p class="small" style="margin-top:12px"><b>Text</b> (${c.sample.text.length} characters)</p><div class="j-box" style="white-space:pre-wrap">${esc(c.sample.text)}</div>` : ''}
      <p class="muted small" style="margin-top:8px">One family shown. Every family gets the same words with their own name, players and email.</p>`
  })
  const sendAll = async (channel, n, b) => {
    const basis = channel === 'text' ? 'Current JFP family: service message about their place and account (Lee, 12 Oct 2026)' : ''
    if (!(await confirmBox(channel === 'email'
      ? `Email <b>${n}</b> families the sign-in message now? Each goes once. Do Not Contact families are left out.`
      : `Queue <b>${n}</b> texts from your work number? They go between 8am and 8pm, each once. Families who said no to texts or are Do Not Contact are left out.`, { ok: 'Send' }))) return
    b.disabled = true
    let sent = 0, queued = 0, skipped = 0, problem = 0
    for (let i = 0; i < 20; i++) {
      b.textContent = channel === 'email' ? `Sending... ${sent}` : `Queuing... ${queued}`
      const r = await call('sendCampaign', { channel, confirm: true, basis })
      if (!r.ok) { toast(r.data.error || 'Stopped. Nothing is lost: press again.'); break }
      sent += r.data.sent; queued += r.data.queued; skipped += r.data.skipped.length; problem += r.data.problem
      if (!r.data.left) break
    }
    toast(channel === 'email' ? `Sent ${sent} emails${skipped ? `, ${skipped} left out` : ''}${problem ? `, ${problem} to check` : ''}` : `Queued ${queued} texts${skipped ? `, ${skipped} left out` : ''}`)
    rerender(ui)
  }
  document.getElementById('mc-send-e')?.addEventListener('click', (ev) => sendAll('email', e.draft, ev.currentTarget))
  document.getElementById('mc-send-t')?.addEventListener('click', (ev) => sendAll('text', t.draft, ev.currentTarget))
}

// The account guide to everyone (Lee, 16 Oct 2026): every Term 4 family,
// recent requests and new accounts. Prepare, look at each group's email and
// text exactly, then Lee sends emails and texts in batches.
let GUIDE_PREP = null
const GUIDE_LABEL = { term: 'Term 4 families', enquiry: 'Requests (last 60 days)', account: 'New accounts' }
async function drawGuide(ui, rerender) {
  const { need, confirmBox } = ui
  const el = document.getElementById('ms-guide')
  if (!el) return
  const c = await need(await call('guide'))
  const e = c.email, t = c.text
  const split = (x) => Object.entries(x.byGroup).filter(([, n]) => n).map(([g, n]) => `${n} ${GUIDE_LABEL[g].toLowerCase()}`).join(', ')
  el.innerHTML = `<div class="j-card" style="padding:14px 16px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div><b>Account guide to everyone</b> <span class="muted small">Email + text: how the account works, the email to sign in with, player information, fees and waiver if still to do, Can't make it, extra sessions, holiday training.</span>
        <p class="small" style="margin-top:6px">Emails: <b>${e.draft}</b> ready${e.draft ? ` (${esc(split(e))})` : ''} · ${e.sent} sent${e.problem ? ` · <span style="color:var(--j-red)">${e.problem} to check</span>` : ''} &nbsp;|&nbsp; Texts: <b>${t.draft}</b> ready · ${t.queued} waiting for the Mac · ${t.sent} sent${t.problem ? ` · <span style="color:var(--j-red)">${t.problem} to check</span>` : ''}</p></div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:10px">
      ${Object.entries(GUIDE_LABEL).map(([g, l]) => `<label class="small" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-gg="${g}" checked> ${esc(l)}</label>`).join('')}
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="mg-prep">${e.draft || t.draft ? 'Prepare again' : 'Prepare'}</button>
      ${c.samples.length ? '<button type="button" class="j-btn j-btn-line j-btn-sm" id="mg-show">Show exactly what goes</button>' : ''}
      ${c.isOwner && e.draft ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" id="mg-send-e">Send ${e.draft} emails</button>` : ''}
      ${c.isOwner && t.draft ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" id="mg-send-t" ${c.route?.verified ? '' : 'disabled title="Verify the text route first"'}>Queue ${t.draft} texts</button>` : ''}
    </div>
    <p class="muted small" style="margin-top:6px">Do Not Contact and "Texts: no" are left out. Each email is written again from the records the moment it goes, so a to-do or an amount is never out of date. Anyone already sent it is not sent it again.</p>
    <div id="mg-out" class="small" style="margin-top:6px"></div>
    <div id="mg-preview" hidden style="margin-top:12px"></div>
  </div>`
  document.getElementById('mg-prep').addEventListener('click', async (ev) => {
    const groups = [...el.querySelectorAll('[data-gg]:checked')].map((x) => x.dataset.gg)
    if (!groups.length) return toast('Tick who gets it.')
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Preparing...'
    const r = await call('prepareGuide', { groups })
    if (!r.ok) { b.disabled = false; b.textContent = 'Prepare'; return toast(r.data.error) }
    const x = r.data
    toast(`Ready: ${x.emails} emails, ${x.texts} texts`)
    GUIDE_PREP = x
    rerender(ui)
  })
  if (GUIDE_PREP) {
    const x = GUIDE_PREP
    const line = (label, list) => (list.length ? `<details><summary>${list.length} ${esc(label)}</summary><p class="muted">${esc(list.join(' · '))}</p></details>` : '')
    document.getElementById('mg-out').innerHTML = line('Do Not Contact, left out', x.dnc) + line('with no usable mobile (email only)', x.noPhone) + line('said no to texts (email only)', x.noTexts) + line('already sent it', x.already) + line('Term 4 players with no email in Airtable', x.noEmail)
  }
  document.getElementById('mg-show')?.addEventListener('click', () => {
    const p = document.getElementById('mg-preview')
    p.hidden = !p.hidden
    const draw = (i) => {
      const x = c.samples[i]
      p.innerHTML = `<div class="j-chips" style="margin-bottom:10px">${c.samples.map((y, j) => `<button type="button" class="j-chip" data-gs="${j}" aria-pressed="${i === j}">${esc(GUIDE_LABEL[y.group])}</button>`).join('')}</div>
        <p class="small">Example: ${esc(x.to)}</p>
        ${x.subject ? `<p class="small"><b>Email</b> · Subject: ${esc(x.subject)}</p><iframe title="Email preview" style="width:100%;height:720px;border:1px solid var(--j-line);border-radius:10px;background:#fff" srcdoc="${esc(x.html)}"></iframe>` : ''}
        ${x.text ? `<p class="small" style="margin-top:12px"><b>Text</b> (${x.text.length} characters)</p><div class="j-box" style="white-space:pre-wrap">${esc(x.text)}</div>` : '<p class="muted small">No text for this example (no usable mobile).</p>'}
        <p class="muted small" style="margin-top:8px">Everyone in a group gets the same words with their own name, players, email and to-do list.</p>`
      p.querySelectorAll('[data-gs]').forEach((b) => b.addEventListener('click', () => draw(Number(b.dataset.gs))))
    }
    if (!p.hidden) draw(0)
  })
  const sendAll = async (channel, n, b) => {
    const basis = channel === 'text' ? 'Service message about their Joner Football account: current JFP families, their own request, or the account they made (Lee, 16 Oct 2026)' : ''
    if (!(await confirmBox(channel === 'email'
      ? `Email the account guide to <b>${n}</b> people now? Each goes once. Do Not Contact is left out.`
      : `Queue <b>${n}</b> account guide texts from your work number? They go between 8am and 8pm, each once. Texts: no and Do Not Contact are left out.`, { ok: 'Send' }))) return
    b.disabled = true
    let sent = 0, queued = 0, skipped = 0, problem = 0
    for (let i = 0; i < 40; i++) {
      b.textContent = channel === 'email' ? `Sending... ${sent}` : `Queuing... ${queued}`
      const r = await call('sendGuide', { channel, confirm: true, basis })
      if (!r.ok) { toast(r.data.error || 'Stopped. Nothing is lost: press again.'); break }
      sent += r.data.sent; queued += r.data.queued; skipped += r.data.skipped.length; problem += r.data.problem
      if (!r.data.left) break
    }
    toast(channel === 'email' ? `Sent ${sent} emails${skipped ? `, ${skipped} left out` : ''}${problem ? `, ${problem} to check` : ''}` : `Queued ${queued} texts${skipped ? `, ${skipped} left out` : ''}`)
    rerender(ui)
  }
  document.getElementById('mg-send-e')?.addEventListener('click', (ev) => sendAll('email', e.draft, ev.currentTarget))
  document.getElementById('mg-send-t')?.addEventListener('click', (ev) => sendAll('text', t.draft, ev.currentTarget))
}
