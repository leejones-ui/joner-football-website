// Camps in the Joner Football Portal (Lee, 10 Nov 2026): every camp sign-up
// in one place instead of the Google Sheet. Places left per day, the list of
// sign-ups, a day list to tick players in and out (drop and shop), the
// waitlist, add or change a sign-up by hand, and the camp's own settings.
// Lee and Ligia only.
import { esc, api, toast, money } from './jfp-common.js'
import { psHead, psSearch, psSelect, psBadge, psHelp } from './jfp-portal-ps.js'

const call = (action, body = {}) => api('/api/jfp-portal-data', { action, ...body })
const S = { view: 'list', q: '', day: '', status: '', listDay: '', campId: '', sort: 'age' }
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
    const refunded = rows.reduce((t, b) => t + (b.refundedCents || 0), 0)
    const counts = camp.days.map((x) => `${x.short} ${d.counts[x.id].taken} of ${camp.capacityPerDay}`).join(' · ')
    const statusBadge = camp.status === 'open' ? psBadge('green', 'Bookings open') : camp.status === 'closed' ? psBadge('red', 'Bookings closed') : psBadge('grey', 'Hidden')
    view().innerHTML = `${psHead({ title: 'Camps', count: counts, primary: '<button type="button" class="j-btn j-btn-dark" id="cs-add">+ Add a sign-up</button>' }).replace('</h1>', `</h1>${psHelp('Every camp sign-up lands here the moment a family pays on the website. Places count per day and include families paying right now, so the last place cannot be sold twice. The website only says Limited places until a day is nearly full. Day list is your register, sorted by age for grouping. Not finished is families who started and did not pay: they get reminder emails. Refunds are done by hand in Stripe: cancel here first so the place opens again.', 'About camps')}`)}
      <div class="cs-bar">
        ${d.camps.length > 1 ? `<select class="j-select" id="cs-camp" aria-label="Camp">${d.camps.map((c) => `<option value="${esc(c.id)}" ${c.id === camp.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>` : `<b class="cs-name">${esc(camp.title)}</b>`}
        ${statusBadge}
        <span class="cs-links"><a class="j-btn j-btn-line j-btn-sm" href="${esc(d.publicUrl)}" target="_blank" rel="noopener">View page</a><button type="button" class="j-btn j-btn-line j-btn-sm" id="cs-csv">Download CSV</button><button type="button" class="j-btn j-btn-line j-btn-sm" id="cs-settings">Settings</button></span>
      </div>
      <div class="cs-days">
        ${d.days.map((x) => { const c = d.counts[x.id]; const pct = Math.min(100, Math.round((c.taken / camp.capacityPerDay) * 100)); return `<section class="cs-day"><p class="cs-lbl">${esc(x.label)}</p><p class="cs-big">${c.taken}<small> of ${camp.capacityPerDay}</small></p><div class="cs-meter" aria-hidden="true"><i style="width:${pct}%"></i></div><p class="cs-note">${c.left ? `${c.left} place${c.left === 1 ? '' : 's'} left` : 'Full'}${x.past ? ' · day has been' : ''}</p></section>` }).join('')}
        <section class="cs-day"><p class="cs-lbl">Paid so far</p><p class="cs-big">${esc(money(taken))}</p><p class="cs-note">${paid.length} sign-up${paid.length === 1 ? '' : 's'} · ${players} player${players === 1 ? '' : 's'}${refunded ? ` · ${esc(money(refunded))} refunded` : ''}</p></section>
      </div>
      <div class="ps-seg cs-seg" role="group" aria-label="Show">${[['list', 'Sign-ups'], ['day', 'Day list'], ['unfinished', `Not finished${d.unfinished.length ? ` (${d.unfinished.length})` : ''}`], ['wait', `Waitlist${d.waitlist.length ? ` (${d.waitlist.length})` : ''}`]].map(([k, l]) => `<button type="button" data-cs-view="${k}" aria-pressed="${S.view === k}">${esc(l)}</button>`).join('')}</div>
      <div id="cs-body"></div>`
    const $ = (s) => view().querySelector(s)
    $('#cs-add').addEventListener('click', () => editBooking(null))
    $('#cs-settings').addEventListener('click', settings)
    $('#cs-csv').addEventListener('click', () => ui.saveFile(`camp-${camp.id}-signups.csv`, csv()))
    $('#cs-camp')?.addEventListener('change', async (e) => { S.campId = e.target.value; set(await need(await call('campList', { campId: S.campId }))) })
    view().querySelectorAll('[data-cs-view]').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.csView; keep(); draw() }))
    if (S.view === 'day') drawDay(); else if (S.view === 'wait') drawWait(); else if (S.view === 'unfinished') drawUnfinished(); else drawList()
  }

  function drawList(typing = false) {
    const camp = d.camp
    const body = view().querySelector('#cs-body')
    const q = S.q.trim().toLowerCase()
    const list = d.bookings.filter((b) => (!S.day || b.dayIds.includes(S.day)) && (!S.status || b.status === S.status) && (!q || `${b.id} ${b.parentName} ${b.email} ${b.mobile} ${b.players.map(fullName).join(' ')}`.toLowerCase().includes(q)))
    const table = `<div class="ps-table-wrap"><table class="ps-table ps-flat"><thead><tr><th>Player</th><th>Days</th><th>Parent</th><th>Status</th><th class="ps-end"><span class="sr-only">Open</span></th></tr></thead><tbody>
      ${list.map((b) => `<tr data-cs-open="${esc(b.id)}"><td data-col="who"><b>${esc(b.players.map(fullName).join(', '))}</b><span class="ps-sub">${esc(b.players.map((p) => `age ${p.age || '?'}${p.clubLevel ? `, ${p.clubLevel}` : ''}`).join(' · '))}${b.players.some((p) => p.medical) ? ' · <span class="cs-flag">medical note</span>' : ''}${b.attention ? ' · <span class="cs-flag">needs a look</span>' : ''}${upFlag(b)}</span></td><td data-col="group">${esc(dayShort(camp, b.dayIds))}</td><td data-col="flags">${esc(b.parentName)}<span class="ps-sub">${esc(b.mobile)}</span></td><td data-col="pay">${psBadge(...STATUS[b.status])}<span class="ps-sub">${b.status === 'paid' ? esc(`${money(b.amountPaidCents || 0)} · ${b.method || 'Stripe'}${b.refundedCents ? ` · ${money(b.refundedCents)} refunded` : ''}`) : b.status === 'held' ? 'On the Stripe page' : b.refundedCents ? esc(`${money(b.refundedCents)} refunded`) : ''}</span></td><td class="ps-end"><button type="button" class="j-btn j-btn-line j-btn-sm">Open</button></td></tr>`).join('') || `<tr><td colspan="5"><div class="ps-empty">${d.bookings.length ? 'Nothing matches those filters.' : 'No sign-ups yet. They appear here the moment a family pays.'}</div></td></tr>`}
      </tbody></table></div>`
    if (typing) { body.querySelector('.ps-table-wrap').outerHTML = table; bindRows(); return }
    body.innerHTML = `<div class="ps-tools" role="search">${psSearch('cs-q', 'Search players, parents, email, mobile…', S.q, 'Search camp sign-ups')}${psSelect('cs-day', camp.days.map((x) => ({ id: x.id, label: x.label })), S.day, 'Every day', 'Day')}${psSelect('cs-status', Object.entries(STATUS).map(([id, [, label]]) => ({ id, label })), S.status, 'Any status', 'Status')}</div>${table}`
    body.querySelector('#cs-q').addEventListener('input', (e) => { S.q = e.target.value; keep(); drawList(true) })
    body.querySelector('#cs-day').addEventListener('change', (e) => { S.day = e.target.value; keep(); drawList() })
    body.querySelector('#cs-status').addEventListener('change', (e) => { S.status = e.target.value; keep(); drawList() })
    bindRows()
  }
  // An upgrade (extra days, pay the difference) open or needing a look.
  const upsFor = (b) => (d.upgrades || []).filter((u) => u.baseBookingId === b.id)
  const upFlag = (b) => { const u = upsFor(b).find((x) => ['pending', 'creating', 'applying', 'recovery'].includes(x.state)); return !u ? '' : u.state === 'recovery' ? ' · <span class="cs-flag">upgrade paid, needs a look</span>' : ' · <span class="cs-flag">upgrade link out</span>' }
  const bindRows = () => view().querySelectorAll('[data-cs-open]').forEach((r) => r.addEventListener('click', () => openBooking(d.bookings.find((b) => b.id === r.dataset.csOpen))))

  // The day list: the register. One line per player, by age (for grouping)
  // or by name, ticked in on arrival and out when they leave.
  function drawDay() {
    const camp = d.camp
    if (!camp.days.some((x) => x.id === S.listDay)) S.listDay = (camp.days.find((x) => x.date >= new Date().toISOString().slice(0, 10)) || camp.days[0]).id
    const kids = d.bookings.filter((b) => live(b) && b.dayIds.includes(S.listDay)).flatMap((b) => b.players.map((p, i) => ({ b, p, i, c: b.checkins?.[`${S.listDay}|${i}`]?.state || '' })))
      .sort((x, y) => (S.sort === 'age' ? (Number(x.p.age) || 99) - (Number(y.p.age) || 99) : 0) || fullName(x.p).localeCompare(fullName(y.p)))
    const n = (s) => kids.filter((k) => k.c === s).length
    const ages = [...new Set(kids.map((k) => Number(k.p.age) || 0))].filter(Boolean).sort((a, b) => a - b)
    view().querySelector('#cs-body').innerHTML = `<div class="ps-tools"><div class="ps-seg" role="group" aria-label="Day">${camp.days.map((x) => `<button type="button" data-cs-ld="${esc(x.id)}" aria-pressed="${S.listDay === x.id}">${esc(x.short)}</button>`).join('')}</div><div class="ps-seg" role="group" aria-label="Sort">${[['age', 'By age'], ['name', 'By name']].map(([k, l]) => `<button type="button" data-cs-sort="${k}" aria-pressed="${S.sort === k}">${l}</button>`).join('')}</div><span class="ps-meta">${kids.length} players · ${n('in')} here · ${n('out')} gone home</span><button type="button" class="j-btn j-btn-line j-btn-sm" id="cs-print">Print</button></div>
      ${ages.length ? `<p class="ps-sub-line">Ages: ${ages.map((a) => `${a} (${kids.filter((k) => Number(k.p.age) === a).length})`).join(' · ')}</p>` : ''}
      <div class="ps-table-wrap"><table class="ps-table ps-flat cs-daylist"><thead><tr><th>Player</th><th>Parent</th><th>Notes</th><th class="ps-end">Here</th></tr></thead><tbody>
      ${kids.map((k) => `<tr><td data-col="who"><b>${esc(fullName(k.p))}</b><span class="ps-sub">Age ${esc(k.p.age || '?')}${k.p.clubLevel ? ` · ${esc(k.p.clubLevel)}` : ''}${k.b.status === 'unpaid' ? ' · <span class="cs-flag">not paid yet</span>' : ''}</span></td><td data-col="group">${esc(k.b.parentName)} <a href="tel:${esc(k.b.mobile)}">${esc(k.b.mobile)}</a>${k.b.pickup ? `<span class="ps-sub">Collecting: ${esc(k.b.pickup)}</span>` : ''}${k.b.emergencyName ? `<span class="ps-sub">Emergency: ${esc(k.b.emergencyName)} <a href="tel:${esc(k.b.emergencyMobile)}">${esc(k.b.emergencyMobile)}</a></span>` : ''}</td><td data-col="flags">${k.p.medical ? `<span class="cs-flag">${esc(k.p.medical)}</span>` : '<span class="ps-sub">None</span>'}</td><td class="ps-end ps-keep"><div class="cs-check" role="group" aria-label="${esc(fullName(k.p))}">${[['in', 'In'], ['out', 'Gone home']].map(([s, l]) => `<button type="button" class="j-btn j-btn-sm ${k.c === s ? 'j-btn-dark' : 'j-btn-line'}" data-cs-ck="${esc(k.b.id)}|${k.i}|${s}" aria-pressed="${k.c === s}">${l}</button>`).join('')}</div></td></tr>`).join('') || '<tr><td colspan="4"><div class="ps-empty">Nobody booked on this day yet.</div></td></tr>'}
      </tbody></table></div>`
    view().querySelectorAll('[data-cs-ld]').forEach((b) => b.addEventListener('click', () => { S.listDay = b.dataset.csLd; keep(); drawDay() }))
    view().querySelectorAll('[data-cs-sort]').forEach((b) => b.addEventListener('click', () => { S.sort = b.dataset.csSort; keep(); drawDay() }))
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

  // Started on the website, never paid. Reminder emails go by themselves
  // (1 hour, 24 hours, 7 days) unless switched off in Settings or stopped here.
  function drawUnfinished() {
    const camp = d.camp
    const state = (b) => { const n = Object.keys(b.reminders || {}).length; return b.noReminders ? 'Reminders stopped' : !camp.reminders ? 'Reminders are off' : n ? `${n} reminder${n === 1 ? '' : 's'} sent` : 'First reminder goes after 1 hour' }
    view().querySelector('#cs-body').innerHTML = `<p class="ps-sub-line">Families who filled in the form and did not pay. They hold no place. ${camp.reminders ? 'They get a reminder email after 1 hour, 24 hours and 7 days, and drop off this list when they book.' : 'Reminder emails are switched off in Settings.'}</p>
      <div class="ps-table-wrap"><table class="ps-table ps-flat"><thead><tr><th>Family</th><th>Wanted</th><th>Started</th><th class="ps-end"><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${d.unfinished.map((b) => `<tr><td data-col="who"><b>${esc(b.parentName)}</b><span class="ps-sub"><a href="mailto:${esc(b.email)}">${esc(b.email)}</a> · <a href="tel:${esc(b.mobile)}">${esc(b.mobile)}</a></span></td><td data-col="group">${esc(b.players.map((p) => `${fullName(p)} (${p.age || '?'})`).join(', '))}<span class="ps-sub">${esc(dayShort(camp, b.dayIds))} · ${esc(money(b.priceCents || 0))}</span></td><td data-col="flags">${esc(when(b.createdAt))}<span class="ps-sub">${esc(state(b))}</span></td><td class="ps-end ps-keep">${b.noReminders || !camp.reminders ? '' : `<button type="button" class="j-btn j-btn-line j-btn-sm" data-cs-stop="${esc(b.id)}">Stop reminders</button>`}</td></tr>`).join('') || '<tr><td colspan="4"><div class="ps-empty">Nobody has started a booking without paying.</div></td></tr>'}
      </tbody></table></div>`
    view().querySelectorAll('[data-cs-stop]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true
      const r = await call('campReminderStop', { campId: camp.id, id: btn.dataset.csStop })
      if (!r.ok) { btn.disabled = false; return toast(r.data.error || 'Could not save.') }
      toast('No more reminders for this family.'); set(r.data)
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
      ${b.players.map((p, i) => `<div class="cs-player"><p class="cs-lbl">Player ${b.players.length > 1 ? i + 1 : ''}</p>${line('Name', esc(fullName(p)))}${line('Age', esc(p.age))}${line('Plays for', esc(p.clubLevel))}${line('Camp before', esc(p.previousCamp))}${line('Medical', p.medical ? `<span class="cs-flag">${esc(p.medical)}</span>` : '')}</div>`).join('')}
      <div class="cs-player"><p class="cs-lbl">Family</p>${line('Parent', esc(b.parentName))}${line('Email', `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`)}${line('Mobile', `<a href="tel:${esc(b.mobile)}">${esc(b.mobile)}</a>`)}${line('Emergency', b.emergencyName ? `${esc(b.emergencyName)} <a href="tel:${esc(b.emergencyMobile)}">${esc(b.emergencyMobile)}</a>` : '')}${line('Collecting', esc(b.pickup))}${line('Heard about it', esc(b.heardAbout))}${line('Came from', esc(b.cameFrom))}${line('Anything else', esc(b.extraInfo))}${line('Staff note', esc(b.note))}</div>
      <div class="cs-player"><p class="cs-lbl">Payment</p>${line('Price', esc(money(b.priceCents || 0)))}${line('Paid', b.status === 'paid' ? esc(`${money(b.amountPaidCents || 0)} by ${b.method || 'Stripe'}${b.paidAt ? `, ${when(b.paidAt)}` : ''}`) : '')}${b.payments?.length ? b.payments.map((x) => line(x.kind === 'upgrade' ? 'Top-up' : 'First payment', `${esc(money(x.amountCents || 0))}${x.paidAt ? `, ${esc(when(x.paidAt))}` : ''}${x.refundedCents ? ` · ${esc(money(x.refundedCents))} refunded` : ''}${x.paymentIntent ? ` · <a href="https://dashboard.stripe.com/payments/${esc(x.paymentIntent)}" target="_blank" rel="noopener">Stripe</a>` : ''}`)).join('') : b.paymentIntent ? line('Stripe', `<a href="https://dashboard.stripe.com/payments/${esc(b.paymentIntent)}" target="_blank" rel="noopener">Open in Stripe</a>`) : ''}${line('Signed up', esc(`${when(b.createdAt)}${b.source === 'portal' ? ` (added by ${b.addedBy || 'staff'})` : ''}`))}${b.agreedAt ? line('Camp terms', esc(`Agreed ${when(b.agreedAt)}`)) : ''}${b.refundedCents ? line('Refunded', esc(`${money(b.refundedCents)} in Stripe${b.refundedAt ? `, ${when(b.refundedAt)}` : ''}`)) : ''}${b.status === 'cancelled' ? line('Cancelled', esc(`${when(b.cancelledAt)}: ${b.cancelReason || ''}`)) : ''}${line('Email', b.effects?.parentEmail === 'done' ? `Sent${b.resentAt ? ` (again ${esc(when(b.resentAt))})` : ''}` : b.effects?.parentEmail === 'failed' ? '<span class="cs-flag">Did not send</span>' : '')}</div>
      ${upgradesHtml(b)}
      <div class="cs-actions">${b.status === 'paid' && b.dayIds.length < camp.days.length ? '<button type="button" class="j-btn j-btn-dark" id="cs-up">Upgrade booking</button>' : ''}${b.status !== 'cancelled' && b.status !== 'held' ? '<button type="button" class="j-btn j-btn-line" id="cs-edit">Edit</button>' : ''}${b.status === 'unpaid' ? '<button type="button" class="j-btn j-btn-dark" id="cs-paid">Mark paid</button>' : ''}${b.status === 'paid' ? '<button type="button" class="j-btn j-btn-line" id="cs-resend">Send the email again</button>' : ''}${live(b) ? '<button type="button" class="j-btn j-btn-line cs-danger" id="cs-cancel">Cancel sign-up</button>' : ''}<button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
    const q = (s) => box.querySelector(s)
    q('#cs-up')?.addEventListener('click', () => upgradeBooking(b))
    bindUpgrades(box, b)
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
      const m = ui.modal(`<h2>Cancel ${esc(b.players.map((p) => p.firstName).join(' and '))}?</h2><p class="muted small">Their places open again straight away. Nothing is emailed to the family.</p>${b.refundDue ? `<div class="j-box j-box-grey" style="margin:0 0 12px"><b>Camp terms: refund ${esc(money(b.refundDue.amountCents))}</b> of the ${esc(money(b.refundDue.paidCents))} paid.<br><span class="small">${esc(b.refundDue.rule)}. ${b.method === 'Stripe' ? 'Refund it by hand in Stripe afterwards (we link you there).' : 'Give it back the way they paid.'}</span></div>` : ''}
        <label class="j-label" for="cs-cr">Reason</label><input class="j-input" id="cs-cr" maxlength="200" placeholder="Family asked to cancel">
        <div class="cs-actions"><button type="button" class="j-btn j-btn-line" data-close>Keep it</button><button type="button" class="j-btn j-btn-dark cs-danger" id="cs-cok">Cancel sign-up</button></div>`)
      m.querySelector('#cs-cok').addEventListener('click', async (e) => {
        e.target.disabled = true
        const r = await call('campCancel', { campId: camp.id, id: b.id, reason: m.querySelector('#cs-cr').value })
        if (!r.ok) { e.target.disabled = false; return toast(r.data.error || 'Could not cancel.') }
        ui.closeModal(); set(r.data)
        if (r.data.refund && r.data.refund.amountCents > 0 && r.data.refund.url) { const z = ui.modal(`<h2>Cancelled</h2><p>The camp terms say refund <b>${esc(r.data.refund.amount)}</b> (${esc(r.data.refund.rule)}). Open the payment in Stripe, press Refund and type that amount.</p><div class="cs-actions"><button type="button" class="j-btn j-btn-line" data-close>Close</button><a class="j-btn j-btn-dark" href="${esc(r.data.refund.url)}" target="_blank" rel="noopener">Open in Stripe</a></div>`); z.querySelector('a').addEventListener('click', () => ui.closeModal()) } else toast(r.data.refund ? `Cancelled. Refund due: ${r.data.refund.amount}.` : 'Cancelled. The places are free again.')
      })
    })
  }

  // ---------- upgrade: add days to a paid sign-up, pay only the difference ----------
  const UP_STATE = { creating: ['orange', 'Making the link'], pending: ['orange', 'Link out, not paid'], applying: ['orange', 'Paid, applying'], applied: ['green', 'Paid and added'], expired: ['grey', 'Link expired'], cancelled: ['grey', 'Cancelled'], failed: ['grey', 'Link failed'], recovery: ['red', 'Paid, needs a look'] }
  const EMAIL_STATE = { done: 'Sent', waiting: 'Not sent yet (wording needs Lee or Ligia to approve)', failed: 'Did not send', unclear: 'Not sure it sent: check the inbox before sending again' }
  function upgradesHtml(b) {
    const ups = upsFor(b)
    if (!ups.length) return ''
    return `<div class="cs-player"><p class="cs-lbl">Upgrades</p>${ups.map((u) => `<div class="cs-up" data-up="${esc(u.id)}">
      <p style="margin:0 0 6px">${psBadge(...(UP_STATE[u.state] || ['grey', u.state]))} <b>Add ${esc(u.text?.adding || '')}</b> · ${esc(u.text?.topUp || '')} <span class="muted small">(${esc(u.id)})</span></p>
      ${u.reason ? `<div class="j-box j-box-amber" style="margin:0 0 8px">${esc(u.reason)}</div>` : ''}
      ${u.state === 'pending' && u.url ? `<label class="j-label" for="up-url-${esc(u.id)}">Payment link (private: send it to this family only)</label><div class="cs-copy"><input class="j-input" id="up-url-${esc(u.id)}" readonly value="${esc(u.url)}"><button type="button" class="j-btn j-btn-dark j-btn-sm" data-up-copy="${esc(u.id)}">Copy</button></div><p class="small muted" style="margin:4px 0 0">Open until ${esc(when(new Date(u.linkExpiresMs).toISOString()))}. Their ${esc(u.text?.adding || '')} place${u.players === 1 ? ' is' : 's are'} held until then.</p>` : ''}
      ${u.state === 'applied' ? `<p class="small" style="margin:0">Paid ${esc(when(u.paidAt))}. Confirmation email: ${esc(EMAIL_STATE[u.effects?.parentEmail] || 'Not sent')}</p>` : ''}
      <div class="cs-actions" style="justify-content:flex-start;margin-top:8px">
        ${['creating', 'pending'].includes(u.state) ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-up-cancel="${esc(u.id)}">Cancel link</button>` : ''}
        ${['pending', 'recovery', 'applying'].includes(u.state) ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-up-retry="${esc(u.id)}">Check payment</button>` : ''}
        ${u.state === 'applied' ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-up-preview="${esc(u.id)}">See the email</button>` : ''}
        ${u.state === 'applied' && !['done', 'unclear'].includes(u.effects?.parentEmail) ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-up-send="${esc(u.id)}">Send the email</button>` : ''}
        ${u.paymentIntent ? `<a class="j-btn j-btn-line j-btn-sm" href="https://dashboard.stripe.com/payments/${esc(u.paymentIntent)}" target="_blank" rel="noopener">Stripe</a>` : ''}
      </div></div>`).join('')}</div>`
  }
  function bindUpgrades(box, b) {
    const camp = d.camp
    const run = async (btn, action, upgradeId, done) => {
      btn.disabled = true
      const r = await call(action, { campId: camp.id, id: b.id, upgradeId })
      btn.disabled = false
      if (!r.ok) return toast(r.data.error || 'Could not do that.')
      if (r.data.camp) set(r.data)
      ui.closeModal(); done?.(r.data)
      openBooking(d.bookings.find((x) => x.id === b.id))
    }
    box.querySelectorAll('[data-up-copy]').forEach((btn) => btn.addEventListener('click', async () => {
      const input = box.querySelector(`#up-url-${btn.dataset.upCopy}`)
      try { await navigator.clipboard.writeText(input.value); toast('Link copied.') } catch { input.select(); toast('Selected: copy it now.') }
    }))
    box.querySelectorAll('[data-up-cancel]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await ui.confirmBox('Cancel this payment link? The family will not be able to pay it, and the extra places go back on sale.', { ok: 'Cancel link' }))) return
      run(btn, 'campUpgradeCancel', btn.dataset.upCancel, () => toast('Link cancelled. The original booking is unchanged.'))
    }))
    box.querySelectorAll('[data-up-retry]').forEach((btn) => btn.addEventListener('click', () => run(btn, 'campUpgradeRetry', btn.dataset.upRetry, () => toast('Checked with Stripe.'))))
    box.querySelectorAll('[data-up-send]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await ui.confirmBox(`Send the updated confirmation to ${b.email}? Replies go to Ligia.`, { ok: 'Send' }))) return
      run(btn, 'campUpgradeEmail', btn.dataset.upSend, (x) => toast(x.sent || 'Sent.'))
    }))
    box.querySelectorAll('[data-up-preview]').forEach((btn) => btn.addEventListener('click', async () => {
      const r = await call('campUpgradePreview', { campId: camp.id, id: b.id, upgradeId: btn.dataset.upPreview })
      if (!r.ok) return toast(r.data.error || 'Could not load it.')
      const m = ui.modal(`<h2 style="margin-bottom:4px">${esc(r.data.preview.subject)}</h2><p class="muted small" style="margin:0 0 10px">To ${esc(r.data.to)} · replies to ${esc(r.data.replyTo)} · nothing is sent from here</p><iframe class="cs-preview" title="Email preview" sandbox=""></iframe><div class="cs-actions"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
      m.querySelector('iframe').srcdoc = r.data.preview.html
    }))
  }

  function upgradeBooking(b) {
    const camp = d.camp
    let quote = null
    const box = ui.modal(`<h2 style="margin-bottom:4px">Upgrade booking</h2>
      <p class="muted small" style="margin:0 0 12px">Add days for every player on this sign-up. The family pays only the difference to the package price, by a private Stripe link you send them. Nothing changes until they pay.</p>
      <div class="cs-player"><p class="cs-lbl">Players (stay the same)</p><p style="margin:0">${esc(b.players.map(fullName).join(', '))}</p></div>
      <p class="j-label">Days</p><div class="cs-daypick">${camp.days.map((x) => { const have = b.dayIds.includes(x.id); return `<label class="cs-tick"><input type="checkbox" value="${esc(x.id)}" ${have ? 'checked disabled' : ''}> ${esc(x.label)} <small>${have ? 'already paid' : `${d.counts[x.id].left} left`}</small></label>` }).join('')}</div>
      <div id="up-quote" aria-live="polite"></div>
      <div class="cs-actions"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="up-create" disabled>Create payment link</button></div>`, { wide: true })
    const q = (s) => box.querySelector(s)
    const days = () => [...box.querySelectorAll('.cs-daypick input:checked')].map((x) => x.value)
    const paint = (html) => { q('#up-quote').innerHTML = html }
    async function look() {
      quote = null
      q('#up-create').disabled = true
      if (days().length === b.dayIds.length) return paint('<p class="small muted">Tick the day or days to add.</p>')
      paint('<p class="small muted">Working out the price…</p>')
      const r = await call('campUpgradeQuote', { campId: camp.id, id: b.id, days: days() })
      if (!r.ok) return paint(`<div class="j-box ${r.data.manual ? 'j-box-amber' : 'j-box-grey'}">${esc(r.data.error || 'Cannot upgrade this one.')}</div>`)
      if (r.data.open) return paint(`<div class="j-box j-box-amber">There is already an upgrade for this sign-up (${esc(r.data.open.text?.adding || '')}, ${esc(UP_STATE[r.data.open.state]?.[1] || r.data.open.state)}). Close this and use it, or cancel it first.</div>`)
      quote = r.data.quote
      const short = quote.newDayIds.filter((x) => quote.places[x].left < quote.players)
      paint(`<div class="cs-player"><p class="cs-lbl">The money</p>
        <div class="cs-kv"><span>Booked now</span><b>${esc(quote.text.have)}</b></div>
        <div class="cs-kv"><span>Adding</span><b>${esc(quote.text.adding)}</b></div>
        <div class="cs-kv"><span>After</span><b>${esc(quote.text.target)}</b></div>
        <div class="cs-kv"><span>Package, ${quote.players} player${quote.players === 1 ? '' : 's'}</span><b>${esc(quote.text.package)}</b></div>
        <div class="cs-kv"><span>Already paid</span><b>${esc(quote.text.paid)}</b></div>
        <div class="cs-kv cs-kv-total"><span>Family pays now (AUD, one payment)</span><b>${esc(quote.text.topUp)}</b></div>
        ${quote.newDayIds.map((x) => `<div class="cs-kv"><span>Places needed on ${esc(camp.days.find((y) => y.id === x)?.short || x)}</span><b>${quote.players} of ${quote.places[x].left} left</b></div>`).join('')}</div>
        ${short.length ? '<div class="j-box j-box-amber">Not enough places on that day for every player on this sign-up.</div>' : ''}`)
      q('#up-create').disabled = Boolean(short.length)
    }
    box.querySelectorAll('.cs-daypick input:not([disabled])').forEach((x) => x.addEventListener('change', look))
    look()
    q('#up-create').addEventListener('click', async (e) => {
      if (!quote) return
      e.target.disabled = true
      const r = await call('campUpgradeCreate', { campId: camp.id, id: b.id, days: days(), quoteKey: quote.quoteKey })
      if (!r.ok) {
        e.target.disabled = false
        if (r.data.stale) { await look(); return toast(r.data.error) }
        return paint(`${q('#up-quote').innerHTML}<div class="j-box j-box-amber">${esc(r.data.error || 'Could not make the link.')}</div>`)
      }
      set(r.data)
      ui.closeModal()
      toast('Payment link ready. Copy it and send it to the family.')
      openBooking(d.bookings.find((x) => x.id === b.id))
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
      <label><span class="j-label">Who they play for</span><input class="j-input" data-f="clubLevel" value="${esc(p.clubLevel || '')}"></label>
      <label><span class="j-label">Joner camp before?</span>${sel('previousCamp', ['Yes', 'No'], p.previousCamp, 'Choose')}</label>
      <label><span class="j-label">Medical notes</span><input class="j-input" data-f="medical" value="${esc(p.medical || '')}"></label></div></fieldset>`
    const box = ui.modal(`<h2 style="margin-bottom:10px">${b ? 'Change sign-up' : 'Add a sign-up'}</h2>
      <p class="j-label">Days</p><div class="cs-daypick">${camp.days.map((x) => `<label class="cs-tick"><input type="checkbox" value="${esc(x.id)}" ${!b || b.dayIds.includes(x.id) ? 'checked' : ''}> ${esc(x.label)} <small>${d.counts[x.id].left} left</small></label>`).join('')}</div>
      <div id="cs-pls">${ps.map(playerHtml).join('')}</div>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="cs-addpl" style="margin:4px 0 12px">+ Another player</button>
      <div class="cs-grid">
        <label><span class="j-label">Parent name</span><input class="j-input" id="cs-pn" value="${esc(b?.parentName || '')}"></label>
        <label><span class="j-label">Email</span><input class="j-input" id="cs-em" type="email" value="${esc(b?.email || '')}"></label>
        <label><span class="j-label">Mobile</span><input class="j-input" id="cs-mo" inputmode="tel" value="${esc(b?.mobile || '')}"></label>
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
      const booking = { days: [...box.querySelectorAll('.cs-daypick input:checked')].map((x) => x.value), players: read(), parentName: q('#cs-pn').value, email: q('#cs-em').value, mobile: q('#cs-mo').value, heardAbout: q('#cs-hd').value, extraInfo: q('#cs-xi').value }
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
        <label><span class="j-label">Website says "Only N left" from</span><input class="j-input" id="st-low" inputmode="numeric" value="${c.lowAt}"></label>
        <label><span class="j-label">Ages</span><input class="j-input" id="st-ages" value="${esc(c.ages)}"></label>
        <label><span class="j-label">Times</span><input class="j-input" id="st-times" value="${esc(c.timesLabel)}"></label>
        <label><span class="j-label">Drop off line</span><input class="j-input" id="st-arr" value="${esc(c.arriveLabel)}"></label>
        <label><span class="j-label">Venue</span><input class="j-input" id="st-loc" value="${esc(c.location)}"></label>
        <label><span class="j-label">Address</span><input class="j-input" id="st-addr" value="${esc(c.address)}"></label>
      </div>
      ${c.days.map((x) => `<div class="cs-grid"><label><span class="j-label">Day name</span><input class="j-input" data-dl="${esc(x.id)}" value="${esc(x.label)}"></label><label><span class="j-label">Date</span><input class="j-input" type="date" data-dd="${esc(x.id)}" value="${esc(x.date)}"></label></div>`).join('')}
      <label><span class="j-label">What to bring (one per line, goes in the email)</span><textarea class="j-input" id="st-bring" rows="5">${esc(c.bring.join('\n'))}</textarea></label>
      <label><span class="j-label">Who gets the sign-up alert (emails)</span><input class="j-input" id="st-staff" value="${esc(c.staffEmails.join(', '))}"></label>
      <label class="cs-tick"><input type="checkbox" id="st-rem" ${c.reminders ? 'checked' : ''}> Email families who start a booking and do not pay (after 1 hour, 24 hours and 7 days)</label>
      <p class="small muted" style="margin-top:8px">Price changes apply to new bookings only. The website says Limited places until a day is down to the number above, then shows how many are left.</p>
      <div class="cs-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="st-save">Save</button></div>`, { wide: true })
    const v = (id) => box.querySelector(`#${id}`).value
    box.querySelector('#st-save').addEventListener('click', async (e) => {
      e.target.disabled = true
      const r = await call('campSave', { campId: c.id, settings: { status: v('st-status'), capacityPerDay: v('st-cap'), oneDay: v('st-one'), allDays: v('st-all'), lowAt: v('st-low'), ages: v('st-ages'), timesLabel: v('st-times'), arriveLabel: v('st-arr'), location: v('st-loc'), address: v('st-addr'), bring: v('st-bring'), staffEmails: v('st-staff'), reminders: box.querySelector('#st-rem').checked, days: c.days.map((x) => ({ id: x.id, label: box.querySelector(`[data-dl="${x.id}"]`).value, date: box.querySelector(`[data-dd="${x.id}"]`).value })) } })
      e.target.disabled = false
      if (!r.ok) return toast(r.data.error || 'Could not save.')
      ui.closeModal(); toast('Saved. The camp page shows it straight away.'); set(r.data)
    })
  }

  function csv() {
    const camp = d.camp
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const out = [['Booking', 'Status', ...camp.days.map((x) => x.short), 'Player first name', 'Surname', 'Age', 'Plays for', 'Camp before', 'Medical', 'Parent', 'Email', 'Mobile', 'Heard about', 'Came from', 'Anything else', 'Paid A$', 'Refunded A$', 'Method', 'Signed up'].map(cell).join(',')]
    for (const b of d.bookings.filter(live)) for (const [j, p] of b.players.entries()) out.push([b.id, STATUS[b.status][1], ...camp.days.map((x) => (b.dayIds.includes(x.id) ? 'Yes' : '')), p.firstName, p.surname, p.age, p.clubLevel, p.previousCamp, p.medical, b.parentName, b.email, b.mobile, b.heardAbout, b.cameFrom, b.extraInfo, b.status === 'paid' && !j ? dollars(b.amountPaidCents || 0) : '', b.refundedCents && !j ? dollars(b.refundedCents) : '', b.method || '', when(b.createdAt)].map(cell).join(','))
    return out.join('\r\n')
  }

  draw()
}
