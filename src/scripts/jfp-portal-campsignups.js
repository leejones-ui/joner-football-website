// Camps in the Joner Football Portal (Lee, 10 Nov 2026): every camp sign-up
// in one place instead of the Google Sheet. Places left per day, the list of
// sign-ups, a day list to tick players in and out (drop and shop), the
// waitlist, add or change a sign-up by hand, and the camp's own settings.
// Lee and Ligia only.
import { esc, api, toast, money } from './jfp-common.js'
import { psHead, psSearch, psSelect, psBadge, psHelp } from './jfp-portal-ps.js'

const call = (action, body = {}) => api('/api/jfp-portal-data', { action, ...body })
const S = { view: 'list', q: '', day: '', status: '', listDay: '', campId: '' }
try { Object.assign(S, JSON.parse(sessionStorage.getItem('jfp-camps') || '{}')) } catch {}
const keep = () => { try { sessionStorage.setItem('jfp-camps', JSON.stringify(S)) } catch {} }

const STATUS = { paid: ['green', 'Paid'], unpaid: ['red', 'Not paid yet'], held: ['orange', 'Paying now'], cancelled: ['grey', 'Cancelled'] }
const fullName = (p) => `${p.firstName} ${p.surname}`.trim()
const dayShort = (camp, ids) => camp.days.filter((d) => ids.includes(d.id)).map((d) => d.short).join(' + ')
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const dollars = (c) => (c == null ? '' : String(Math.round(c) / 100))
const live = (b) => b.status === 'paid' || b.status === 'unpaid'

export async function renderCampSignups(ui) {
  const { view, need } = ui
  let d = await need(await call('campList', S.campId ? { campId: S.campId } : {}))
  const set = (data) => { d = data; S.campId = data.camp.id; keep(); draw() }

  function draw() {
    const camp = d.camp
    const rows = d.bookings
    const paid = rows.filter((b) => b.status === 'paid')
    const players = rows.filter(live).reduce((t, b) => t + b.players.length, 0)
    const taken = paid.reduce((t, b) => t + (b.amountPaidCents || 0), 0)
    const counts = camp.days.map((x) => `${x.short} ${d.counts[x.id].taken} of ${camp.capacityPerDay}`).join(' · ')
    const statusBadge = camp.status === 'open' ? psBadge('green', 'Bookings open') : camp.status === 'closed' ? psBadge('red', 'Bookings closed') : psBadge('grey', 'Hidden')
    view().innerHTML = `${psHead({ title: 'Camps', count: counts, primary: '<button type="button" class="j-btn j-btn-dark" id="cs-add">+ Add a sign-up</button>' }).replace('</h1>', `</h1>${psHelp('Every camp sign-up lands here, paid through Stripe on the website. Places count per day and include families paying right now, so the last place cannot be sold twice. Use the day list on the day to tick players in at drop off and out at pick up. Refunds are done by hand in Stripe: cancel here first so the place opens again.', 'About camps')}`)}
      <div class="cs-bar">
        ${d.camps.length > 1 ? `<select class="j-select" id="cs-camp" aria-label="Camp">${d.camps.map((c) => `<option value="${esc(c.id)}" ${c.id === camp.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>` : `<b class="cs-name">${esc(camp.title)}</b>`}
        ${statusBadge}
        <span class="cs-links"><a class="j-btn j-btn-line j-btn-sm" href="${esc(d.publicUrl)}" target="_blank" rel="noopener">View page</a><button type="button" class="j-btn j-btn-line j-btn-sm" id="cs-csv">Download CSV</button><button type="button" class="j-btn j-btn-line j-btn-sm" id="cs-settings">Settings</button></span>
      </div>
      <div class="cs-days">
        ${d.days.map((x) => { const c = d.counts[x.id]; const pct = Math.min(100, Math.round((c.taken / camp.capacityPerDay) * 100)); return `<section class="cs-day"><p class="cs-lbl">${esc(x.label)}</p><p class="cs-big">${c.taken}<small> of ${camp.capacityPerDay}</small></p><div class="cs-meter" aria-hidden="true"><i style="width:${pct}%"></i></div><p class="cs-note">${c.left ? `${c.left} place${c.left === 1 ? '' : 's'} left` : 'Full'}${x.past ? ' · day has been' : ''}</p></section>` }).join('')}
        <section class="cs-day"><p class="cs-lbl">Paid so far</p><p class="cs-big">${esc(money(taken))}</p><p class="cs-note">${paid.length} sign-up${paid.length === 1 ? '' : 's'} · ${players} player${players === 1 ? '' : 's'}</p></section>
      </div>
      <div class="ps-seg cs-seg" role="group" aria-label="Show">${[['list', 'Sign-ups'], ['day', 'Day list'], ['wait', `Waitlist${d.waitlist.length ? ` (${d.waitlist.length})` : ''}`]].map(([k, l]) => `<button type="button" data-cs-view="${k}" aria-pressed="${S.view === k}">${esc(l)}</button>`).join('')}</div>
      <div id="cs-body"></div>`
    const $ = (s) => view().querySelector(s)
    $('#cs-add').addEventListener('click', () => editBooking(null))
    $('#cs-settings').addEventListener('click', settings)
    $('#cs-csv').addEventListener('click', () => ui.saveFile(`camp-${camp.id}-signups.csv`, csv()))
    $('#cs-camp')?.addEventListener('change', async (e) => { S.campId = e.target.value; set(await need(await call('campList', { campId: S.campId }))) })
    view().querySelectorAll('[data-cs-view]').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.csView; keep(); draw() }))
    if (S.view === 'day') drawDay(); else if (S.view === 'wait') drawWait(); else drawList()
  }

  function drawList(typing = false) {
    const camp = d.camp
    const body = view().querySelector('#cs-body')
    const q = S.q.trim().toLowerCase()
    const list = d.bookings.filter((b) => (!S.day || b.dayIds.includes(S.day)) && (!S.status || b.status === S.status) && (!q || `${b.id} ${b.parentName} ${b.email} ${b.mobile} ${b.players.map(fullName).join(' ')}`.toLowerCase().includes(q)))
    const table = `<div class="ps-table-wrap"><table class="ps-table ps-flat"><thead><tr><th>Player</th><th>Days</th><th>Parent</th><th>Status</th><th class="ps-end"><span class="sr-only">Open</span></th></tr></thead><tbody>
      ${list.map((b) => `<tr data-cs-open="${esc(b.id)}"><td data-col="who"><b>${esc(b.players.map(fullName).join(', '))}</b><span class="ps-sub">${esc(b.players.map((p) => `age ${p.age || '?'}`).join(', '))}${b.players.some((p) => p.medical) ? ' · <span class="cs-flag">medical note</span>' : ''}${b.attention ? ' · <span class="cs-flag">needs a look</span>' : ''}</span></td><td data-col="group">${esc(dayShort(camp, b.dayIds))}</td><td data-col="flags">${esc(b.parentName)}<span class="ps-sub">${esc(b.mobile)}</span></td><td data-col="pay">${psBadge(...STATUS[b.status])}<span class="ps-sub">${b.status === 'paid' ? esc(`${money(b.amountPaidCents || 0)} · ${b.method || 'Stripe'}`) : b.status === 'held' ? 'On the Stripe page' : ''}</span></td><td class="ps-end"><button type="button" class="j-btn j-btn-line j-btn-sm">Open</button></td></tr>`).join('') || `<tr><td colspan="5"><div class="ps-empty">${d.bookings.length ? 'Nothing matches those filters.' : 'No sign-ups yet. They appear here the moment a family pays.'}</div></td></tr>`}
      </tbody></table></div>`
    if (typing) { body.querySelector('.ps-table-wrap').outerHTML = table; bindRows(); return }
    body.innerHTML = `<div class="ps-tools" role="search">${psSearch('cs-q', 'Search players, parents, email, mobile…', S.q, 'Search camp sign-ups')}${psSelect('cs-day', camp.days.map((x) => ({ id: x.id, label: x.label })), S.day, 'Every day', 'Day')}${psSelect('cs-status', Object.entries(STATUS).map(([id, [, label]]) => ({ id, label })), S.status, 'Any status', 'Status')}</div>${table}`
    body.querySelector('#cs-q').addEventListener('input', (e) => { S.q = e.target.value; keep(); drawList(true) })
    body.querySelector('#cs-day').addEventListener('change', (e) => { S.day = e.target.value; keep(); drawList() })
    body.querySelector('#cs-status').addEventListener('change', (e) => { S.status = e.target.value; keep(); drawList() })
    bindRows()
  }
  const bindRows = () => view().querySelectorAll('[data-cs-open]').forEach((r) => r.addEventListener('click', () => openBooking(d.bookings.find((b) => b.id === r.dataset.csOpen))))

  // The day list: one line per player, ticked in at drop off and out at pick up.
  function drawDay() {
    const camp = d.camp
    if (!camp.days.some((x) => x.id === S.listDay)) S.listDay = (camp.days.find((x) => x.date >= new Date().toISOString().slice(0, 10)) || camp.days[0]).id
    const kids = d.bookings.filter((b) => live(b) && b.dayIds.includes(S.listDay)).flatMap((b) => b.players.map((p, i) => ({ b, p, i, c: b.checkins?.[`${S.listDay}|${i}`]?.state || '' }))).sort((x, y) => fullName(x.p).localeCompare(fullName(y.p)))
    const n = (s) => kids.filter((k) => k.c === s).length
    view().querySelector('#cs-body').innerHTML = `<div class="ps-tools"><div class="ps-seg" role="group" aria-label="Day">${camp.days.map((x) => `<button type="button" data-cs-ld="${esc(x.id)}" aria-pressed="${S.listDay === x.id}">${esc(x.short)}</button>`).join('')}</div><span class="ps-meta">${kids.length} players · ${n('in')} here · ${n('out')} picked up</span><button type="button" class="j-btn j-btn-line j-btn-sm" id="cs-print">Print</button></div>
      <div class="ps-table-wrap"><table class="ps-table ps-flat cs-daylist"><thead><tr><th>Player</th><th>Collecting and contacts</th><th>Notes</th><th class="ps-end">Here</th></tr></thead><tbody>
      ${kids.map((k) => `<tr><td data-col="who"><b>${esc(fullName(k.p))}</b><span class="ps-sub">Age ${esc(k.p.age || '?')} · Jersey ${esc(k.p.jerseySize || '?')}${k.b.status === 'unpaid' ? ' · <span class="cs-flag">not paid yet</span>' : ''}</span></td><td data-col="group">${esc(k.b.parentName)} <a href="tel:${esc(k.b.mobile)}">${esc(k.b.mobile)}</a>${k.b.pickup ? `<span class="ps-sub">Collecting: ${esc(k.b.pickup)}</span>` : ''}${k.b.emergencyName ? `<span class="ps-sub">Emergency: ${esc(k.b.emergencyName)} <a href="tel:${esc(k.b.emergencyMobile)}">${esc(k.b.emergencyMobile)}</a></span>` : ''}</td><td data-col="flags">${k.p.medical ? `<span class="cs-flag">${esc(k.p.medical)}</span>` : '<span class="ps-sub">None</span>'}</td><td class="ps-end ps-keep"><div class="cs-check" role="group" aria-label="${esc(fullName(k.p))}">${[['in', 'In'], ['out', 'Picked up']].map(([s, l]) => `<button type="button" class="j-btn j-btn-sm ${k.c === s ? 'j-btn-dark' : 'j-btn-line'}" data-cs-ck="${esc(k.b.id)}|${k.i}|${s}" aria-pressed="${k.c === s}">${l}</button>`).join('')}</div></td></tr>`).join('') || '<tr><td colspan="4"><div class="ps-empty">Nobody booked on this day yet.</div></td></tr>'}
      </tbody></table></div>`
    view().querySelectorAll('[data-cs-ld]').forEach((b) => b.addEventListener('click', () => { S.listDay = b.dataset.csLd; keep(); drawDay() }))
    view().querySelector('#cs-print').addEventListener('click', () => window.print())
    view().querySelectorAll('[data-cs-ck]').forEach((btn) => btn.addEventListener('click', async () => {
      const [id, i, s] = btn.dataset.csCk.split('|')
      const b = d.bookings.find((x) => x.id === id)
      const now = b.checkins?.[`${S.listDay}|${i}`]?.state || ''
      btn.disabled = true
      const r = await call('campCheckin', { campId: d.camp.id, id, player: Number(i), day: S.listDay, state: now === s ? '' : s })
      if (!r.ok) { btn.disabled = false; return toast(r.data.error || 'Could not save.') }
      Object.assign(b, r.data.booking)
      drawDay()
    }))
  }

  function drawWait() {
    const camp = d.camp
    view().querySelector('#cs-body').innerHTML = `<p class="ps-sub-line">Families who wanted a full day. Nobody is told automatically: when a place opens, call or email the first in line.</p>
      <div class="ps-table-wrap"><table class="ps-table ps-flat"><thead><tr><th>Family</th><th>Days</th><th>Asked</th><th class="ps-end"><span class="sr-only">Remove</span></th></tr></thead><tbody>
      ${d.waitlist.map((w) => `<tr><td data-col="who"><b>${esc(w.parentName)}</b><span class="ps-sub"><a href="mailto:${esc(w.email)}">${esc(w.email)}</a> · <a href="tel:${esc(w.mobile)}">${esc(w.mobile)}</a>${w.players ? ` · ${esc(w.players)}` : ''}</span></td><td data-col="group">${esc(dayShort(camp, w.days || []) || 'Any day')}</td><td data-col="flags">${esc(when(w.at))}</td><td class="ps-end ps-keep"><button type="button" class="j-btn j-btn-line j-btn-sm" data-cs-wr="${esc(w.id)}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4"><div class="ps-empty">Nobody on the waitlist.</div></td></tr>'}
      </tbody></table></div>`
    view().querySelectorAll('[data-cs-wr]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await ui.confirmBox('Remove this family from the waitlist?', { ok: 'Remove' }))) return
      const r = await call('campWaitlistRemove', { campId: camp.id, id: b.dataset.csWr })
      if (!r.ok) return toast(r.data.error || 'Could not remove.')
      set(r.data)
    }))
  }

  function openBooking(b) {
    if (!b) return
    const camp = d.camp
    const line = (k, v) => (v ? `<div class="cs-kv"><span>${esc(k)}</span><b>${v}</b></div>` : '')
    const box = ui.modal(`<h2 style="margin-bottom:4px">${esc(b.players.map(fullName).join(', '))}</h2>
      <p class="muted small" style="margin:0 0 12px">${psBadge(...STATUS[b.status])} · ${esc(dayShort(camp, b.dayIds))} · ${esc(b.id)}</p>
      ${b.attention ? `<div class="j-box j-box-amber" style="margin-bottom:12px">${esc(b.attention)}</div>` : ''}
      ${b.players.map((p, i) => `<div class="cs-player"><p class="cs-lbl">Player ${b.players.length > 1 ? i + 1 : ''}</p>${line('Name', esc(fullName(p)))}${line('Age', esc(p.age))}${line('Jersey size', esc(p.jerseySize))}${line('Camp before', esc(p.previousCamp))}${line('Club / level', esc(p.clubLevel))}${line('Medical', p.medical ? `<span class="cs-flag">${esc(p.medical)}</span>` : '')}</div>`).join('')}
      <div class="cs-player"><p class="cs-lbl">Family</p>${line('Parent', esc(b.parentName))}${line('Email', `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`)}${line('Mobile', `<a href="tel:${esc(b.mobile)}">${esc(b.mobile)}</a>`)}${line('Emergency', b.emergencyName ? `${esc(b.emergencyName)} <a href="tel:${esc(b.emergencyMobile)}">${esc(b.emergencyMobile)}</a>` : '')}${line('Collecting', esc(b.pickup))}${line('Heard about it', esc(b.heardAbout))}${line('Anything else', esc(b.extraInfo))}${line('Staff note', esc(b.note))}</div>
      <div class="cs-player"><p class="cs-lbl">Payment</p>${line('Price', esc(money(b.priceCents || 0)))}${line('Paid', b.status === 'paid' ? esc(`${money(b.amountPaidCents || 0)} by ${b.method || 'Stripe'}${b.paidAt ? `, ${when(b.paidAt)}` : ''}`) : '')}${b.paymentIntent ? line('Stripe', `<a href="https://dashboard.stripe.com/payments/${esc(b.paymentIntent)}" target="_blank" rel="noopener">Open in Stripe</a>`) : ''}${line('Signed up', esc(`${when(b.createdAt)}${b.source === 'portal' ? ` (added by ${b.addedBy || 'staff'})` : ''}`))}${b.status === 'cancelled' ? line('Cancelled', esc(`${when(b.cancelledAt)}: ${b.cancelReason || ''}`)) : ''}${line('Email', b.effects?.parentEmail === 'done' ? `Sent${b.resentAt ? ` (again ${esc(when(b.resentAt))})` : ''}` : b.effects?.parentEmail === 'failed' ? '<span class="cs-flag">Did not send</span>' : '')}</div>
      <div class="cs-actions">${b.status !== 'cancelled' && b.status !== 'held' ? '<button type="button" class="j-btn j-btn-line" id="cs-edit">Edit</button>' : ''}${b.status === 'unpaid' ? '<button type="button" class="j-btn j-btn-dark" id="cs-paid">Mark paid</button>' : ''}${b.status === 'paid' ? '<button type="button" class="j-btn j-btn-line" id="cs-resend">Send the email again</button>' : ''}${live(b) ? '<button type="button" class="j-btn j-btn-line cs-danger" id="cs-cancel">Cancel sign-up</button>' : ''}<button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
    const q = (s) => box.querySelector(s)
    q('#cs-edit')?.addEventListener('click', () => editBooking(b))
    q('#cs-resend')?.addEventListener('click', async (e) => {
      e.target.disabled = true
      const r = await call('campResend', { campId: camp.id, id: b.id })
      e.target.disabled = false
      if (!r.ok) return toast(r.data.error || 'Could not send.')
      ui.closeModal(); toast(r.data.sent || 'Sent.'); set(r.data)
    })
    q('#cs-paid')?.addEventListener('click', () => {
      const m = ui.modal(`<h2>Mark paid</h2><label class="j-label" for="cs-pm">How they paid</label><select class="j-select" id="cs-pm">${d.options.methods.filter((x) => x !== 'Not paid yet' && x !== 'Stripe').map((x) => `<option>${esc(x)}</option>`).join('')}</select>
        <label class="j-label" for="cs-pa" style="margin-top:10px">Amount (A$)</label><input class="j-input" id="cs-pa" inputmode="decimal" value="${esc(dollars(b.priceCents))}">
        <div class="cs-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="cs-pok">Mark paid</button></div>`)
      m.querySelector('#cs-pok').addEventListener('click', async (e) => {
        e.target.disabled = true
        const r = await call('campMarkPaid', { campId: camp.id, id: b.id, method: m.querySelector('#cs-pm').value, amount: m.querySelector('#cs-pa').value })
        if (!r.ok) { e.target.disabled = false; return toast(r.data.error || 'Could not save.') }
        ui.closeModal(); toast('Marked paid.'); set(r.data)
      })
    })
    q('#cs-cancel')?.addEventListener('click', () => {
      const m = ui.modal(`<h2>Cancel ${esc(b.players.map((p) => p.firstName).join(' and '))}?</h2><p class="muted small">Their places open again straight away. Nothing is emailed to the family.${b.status === 'paid' && b.method === 'Stripe' ? ' Refund them by hand in Stripe afterwards (we link you there).' : ''}</p>
        <label class="j-label" for="cs-cr">Reason</label><input class="j-input" id="cs-cr" maxlength="200" placeholder="Family asked to cancel">
        <div class="cs-actions"><button type="button" class="j-btn j-btn-line" data-close>Keep it</button><button type="button" class="j-btn j-btn-dark cs-danger" id="cs-cok">Cancel sign-up</button></div>`)
      m.querySelector('#cs-cok').addEventListener('click', async (e) => {
        e.target.disabled = true
        const r = await call('campCancel', { campId: camp.id, id: b.id, reason: m.querySelector('#cs-cr').value })
        if (!r.ok) { e.target.disabled = false; return toast(r.data.error || 'Could not cancel.') }
        ui.closeModal(); set(r.data)
        if (r.data.refund) { const z = ui.modal(`<h2>Cancelled</h2><p>To refund ${esc(r.data.refund.amount)}, open the payment in Stripe and press Refund.</p><div class="cs-actions"><button type="button" class="j-btn j-btn-line" data-close>Close</button><a class="j-btn j-btn-dark" href="${esc(r.data.refund.url)}" target="_blank" rel="noopener">Open in Stripe</a></div>`); z.querySelector('a').addEventListener('click', () => ui.closeModal()) } else toast('Cancelled. The places are free again.')
      })
    })
  }

  // Add by hand (cash, bank, a free place) or change a sign-up.
  function editBooking(b) {
    const camp = d.camp
    const o = d.options
    const ps = b ? b.players.map((p) => ({ ...p })) : [{}]
    const sel = (name, list, v, blank) => `<select class="j-select" data-f="${name}"><option value="">${esc(blank)}</option>${list.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`
    const playerHtml = (p, i) => `<fieldset class="cs-fs" data-pl="${i}"><legend>Player ${i + 1}${i ? ` <button type="button" class="ps-link" data-rm="${i}">Remove</button>` : ''}</legend><div class="cs-grid">
      <label><span class="j-label">First name</span><input class="j-input" data-f="firstName" value="${esc(p.firstName || '')}"></label>
      <label><span class="j-label">Surname</span><input class="j-input" data-f="surname" value="${esc(p.surname || '')}"></label>
      <label><span class="j-label">Age</span><input class="j-input" data-f="age" inputmode="numeric" value="${esc(p.age || '')}"></label>
      <label><span class="j-label">Jersey size</span>${sel('jerseySize', o.jerseySizes, p.jerseySize, 'Choose')}</label>
      <label><span class="j-label">Joner camp before?</span>${sel('previousCamp', ['Yes', 'No'], p.previousCamp, 'Choose')}</label>
      <label><span class="j-label">Club / level</span><input class="j-input" data-f="clubLevel" value="${esc(p.clubLevel || '')}"></label></div>
      <label><span class="j-label">Medical notes</span><input class="j-input" data-f="medical" value="${esc(p.medical || '')}"></label></fieldset>`
    const box = ui.modal(`<h2 style="margin-bottom:10px">${b ? 'Change sign-up' : 'Add a sign-up'}</h2>
      <p class="j-label">Days</p><div class="cs-daypick">${camp.days.map((x) => `<label class="cs-tick"><input type="checkbox" value="${esc(x.id)}" ${!b || b.dayIds.includes(x.id) ? 'checked' : ''}> ${esc(x.label)} <small>${d.counts[x.id].left} left</small></label>`).join('')}</div>
      <div id="cs-pls">${ps.map(playerHtml).join('')}</div>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="cs-addpl" style="margin:4px 0 12px">+ Another player</button>
      <div class="cs-grid">
        <label><span class="j-label">Parent name</span><input class="j-input" id="cs-pn" value="${esc(b?.parentName || '')}"></label>
        <label><span class="j-label">Email</span><input class="j-input" id="cs-em" type="email" value="${esc(b?.email || '')}"></label>
        <label><span class="j-label">Mobile</span><input class="j-input" id="cs-mo" inputmode="tel" value="${esc(b?.mobile || '')}"></label>
        <label><span class="j-label">Emergency contact name</span><input class="j-input" id="cs-en" value="${esc(b?.emergencyName || '')}"></label>
        <label><span class="j-label">Emergency mobile</span><input class="j-input" id="cs-ex" inputmode="tel" value="${esc(b?.emergencyMobile || '')}"></label>
        <label><span class="j-label">Who is collecting</span><input class="j-input" id="cs-pk" value="${esc(b?.pickup || '')}"></label>
        <label><span class="j-label">Heard about it</span><select class="j-select" id="cs-hd"><option value="">Choose</option>${o.heardAbout.map((x) => `<option ${x === b?.heardAbout ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label><span class="j-label">Staff note</span><input class="j-input" id="cs-nt" value="${esc(b?.note || '')}"></label>
      </div>
      <label><span class="j-label">Anything else from the family</span><input class="j-input" id="cs-xi" value="${esc(b?.extraInfo || '')}"></label>
      ${b ? '' : `<div class="cs-grid" style="margin-top:10px"><label><span class="j-label">How they paid</span><select class="j-select" id="cs-me">${o.methods.filter((x) => x !== 'Stripe').map((x) => `<option>${esc(x)}</option>`).join('')}</select></label><label><span class="j-label">Amount (A$, blank = camp price)</span><input class="j-input" id="cs-am" inputmode="decimal"></label></div>
      <label class="cs-tick"><input type="checkbox" id="cs-se"> Email the family the booking details now (paid only)</label>`}
      <label class="cs-tick"><input type="checkbox" id="cs-fo"> Add even if the day is full</label>
      <p class="small" id="cs-err" role="alert" style="color:var(--j-red);min-height:18px"></p>
      <div class="cs-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="cs-save">${b ? 'Save' : 'Add sign-up'}</button></div>`, { wide: true })
    const q = (s) => box.querySelector(s)
    const read = () => [...box.querySelectorAll('[data-pl]')].map((fs) => Object.fromEntries([...fs.querySelectorAll('[data-f]')].map((x) => [x.dataset.f, x.value])))
    const redraw = (list) => { q('#cs-pls').innerHTML = list.map(playerHtml).join(''); bindRm() }
    const bindRm = () => box.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', () => { const l = read(); l.splice(Number(x.dataset.rm), 1); redraw(l) }))
    bindRm()
    q('#cs-addpl').addEventListener('click', () => { const l = read(); if (l.length < 6) redraw([...l, { surname: l[0]?.surname || '' }]) })
    q('#cs-save').addEventListener('click', async (e) => {
      const booking = { days: [...box.querySelectorAll('.cs-daypick input:checked')].map((x) => x.value), players: read(), parentName: q('#cs-pn').value, email: q('#cs-em').value, mobile: q('#cs-mo').value, emergencyName: q('#cs-en').value, emergencyMobile: q('#cs-ex').value, pickup: q('#cs-pk').value, heardAbout: q('#cs-hd').value, extraInfo: q('#cs-xi').value }
      e.target.disabled = true
      const r = b
        ? await call('campEdit', { campId: camp.id, id: b.id, booking, note: q('#cs-nt').value, force: q('#cs-fo').checked })
        : await call('campAdd', { campId: camp.id, booking, note: q('#cs-nt').value, method: q('#cs-me').value, amount: q('#cs-am').value, sendEmail: q('#cs-se').checked, force: q('#cs-fo').checked })
      e.target.disabled = false
      if (!r.ok) { q('#cs-err').textContent = r.data.error || 'Could not save.'; return }
      ui.closeModal(); toast(b ? 'Saved.' : 'Sign-up added.'); set(r.data)
    })
  }

  function settings() {
    const c = d.camp
    const box = ui.modal(`<h2 style="margin-bottom:10px">Camp settings</h2>
      <div class="cs-grid">
        <label><span class="j-label">Bookings</span><select class="j-select" id="st-status">${[['open', 'Open'], ['closed', 'Closed (page shows, no booking)'], ['hidden', 'Hidden']].map(([v, l]) => `<option value="${v}" ${c.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label><span class="j-label">Places per day</span><input class="j-input" id="st-cap" inputmode="numeric" value="${c.capacityPerDay}"></label>
        <label><span class="j-label">One day, per player (A$)</span><input class="j-input" id="st-one" inputmode="decimal" value="${dollars(c.prices.oneDay)}"></label>
        <label><span class="j-label">Every day, per player (A$)</span><input class="j-input" id="st-all" inputmode="decimal" value="${dollars(c.prices.allDays)}"></label>
        <label><span class="j-label">Show "N places left" from</span><input class="j-input" id="st-low" inputmode="numeric" value="${c.lowAt}"></label>
        <label><span class="j-label">Ages</span><input class="j-input" id="st-ages" value="${esc(c.ages)}"></label>
        <label><span class="j-label">Times</span><input class="j-input" id="st-times" value="${esc(c.timesLabel)}"></label>
        <label><span class="j-label">Drop off line</span><input class="j-input" id="st-arr" value="${esc(c.arriveLabel)}"></label>
        <label><span class="j-label">Venue</span><input class="j-input" id="st-loc" value="${esc(c.location)}"></label>
        <label><span class="j-label">Address</span><input class="j-input" id="st-addr" value="${esc(c.address)}"></label>
      </div>
      ${c.days.map((x) => `<div class="cs-grid"><label><span class="j-label">Day name</span><input class="j-input" data-dl="${esc(x.id)}" value="${esc(x.label)}"></label><label><span class="j-label">Date</span><input class="j-input" type="date" data-dd="${esc(x.id)}" value="${esc(x.date)}"></label></div>`).join('')}
      <label><span class="j-label">What to bring (one per line, goes in the email)</span><textarea class="j-input" id="st-bring" rows="5">${esc(c.bring.join('\n'))}</textarea></label>
      <label><span class="j-label">Who gets the sign-up alert (emails)</span><input class="j-input" id="st-staff" value="${esc(c.staffEmails.join(', '))}"></label>
      <p class="small muted" style="margin-top:8px">Price changes apply to new bookings only. Families already booked keep what they paid.</p>
      <div class="cs-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="st-save">Save</button></div>`, { wide: true })
    const v = (id) => box.querySelector(`#${id}`).value
    box.querySelector('#st-save').addEventListener('click', async (e) => {
      e.target.disabled = true
      const r = await call('campSave', { campId: c.id, settings: { status: v('st-status'), capacityPerDay: v('st-cap'), oneDay: v('st-one'), allDays: v('st-all'), lowAt: v('st-low'), ages: v('st-ages'), timesLabel: v('st-times'), arriveLabel: v('st-arr'), location: v('st-loc'), address: v('st-addr'), bring: v('st-bring'), staffEmails: v('st-staff'), days: c.days.map((x) => ({ id: x.id, label: box.querySelector(`[data-dl="${x.id}"]`).value, date: box.querySelector(`[data-dd="${x.id}"]`).value })) } })
      e.target.disabled = false
      if (!r.ok) return toast(r.data.error || 'Could not save.')
      ui.closeModal(); toast('Saved. The camp page shows it straight away.'); set(r.data)
    })
  }

  function csv() {
    const camp = d.camp
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const out = [['Booking', 'Status', ...camp.days.map((x) => x.short), 'Player first name', 'Surname', 'Age', 'Jersey size', 'Camp before', 'Club / level', 'Medical', 'Parent', 'Email', 'Mobile', 'Emergency contact', 'Emergency mobile', 'Collecting', 'Heard about', 'Anything else', 'Paid A$', 'Method', 'Signed up'].map(cell).join(',')]
    for (const b of d.bookings.filter(live)) for (const [j, p] of b.players.entries()) out.push([b.id, STATUS[b.status][1], ...camp.days.map((x) => (b.dayIds.includes(x.id) ? 'Yes' : '')), p.firstName, p.surname, p.age, p.jerseySize, p.previousCamp, p.clubLevel, p.medical, b.parentName, b.email, b.mobile, b.emergencyName, b.emergencyMobile, b.pickup, b.heardAbout, b.extraInfo, b.status === 'paid' && !j ? dollars(b.amountPaidCents || 0) : '', b.method || '', when(b.createdAt)].map(cell).join(','))
    return out.join('\r\n')
  }

  draw()
}
