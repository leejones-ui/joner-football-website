// Extra sessions in the staff portal (Lee, 14 Oct 2026). A coach opens extra
// hours: public (families book them in My account) or private (a link for a
// player who booked with the coach). The coach can put a player straight on,
// so the session shows in that family's account to pay, and marks the
// register on the day. Lee and Ligia see every coach's sessions and set the
// prices coaches pick from.
import { psHelp } from './jfp-portal-ps.js'
import { esc } from './jfp-common.js'
import { calendar } from './jfp-portal-cal.js'

const KINDS = [['private', 'Private link'], ['oneoff', 'One-off'], ['weekly', 'Weekly slot']]
const KIND_HELP = {
  private: 'Only for a player booked with you. It never shows on the public booking page or to other families. They book with the link you send.',
  oneoff: 'Public, on the dates you pick only. Families book it on the booking page and in My account. Lee and Ligia see it on the Timetable.',
  weekly: 'A permanent slot: public, the same day and time every week to the end of term. Pick the first date. Lee and Ligia see it on the Timetable.',
}

const S = { coachId: '', data: null }
const tel = (m) => { const d = String(m || '').replace(/\D/g, ''); return d.startsWith('04') ? `+61${d.slice(1)}` : d }
const smsHref = (mobile, text) => `sms:${tel(mobile)}${/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`
const first = (s) => String(s || '').trim().split(/\s+/)[0] || 'there'
// "16:30" from the time box as "4:30pm", the way groups are written.
const ampm = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); if (!Number.isInteger(h)) return ''; return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` }
// The next start time offered: an hour after the last one.
const hourAfter = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}` }
const to24 = (label) => { const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(String(label || '').trim()); if (!m) return ''; let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12; return `${String(h).padStart(2, '0')}:${m[2]}` }

// The text comes from the session's coach: "It's Coach Dean".
const coachWord = (s) => (s.coachName && !/^lee\b/i.test(s.coachName) ? `Coach ${first(s.coachName)}` : 'Lee')
export function extraText({ name, coach, slot, email }) {
  return [
    `Hi ${first(name)},`,
    `It's ${coach} from Joner Football. You're booked in for an extra session on ${slot.dateLabel.replace(/\s\d{4}$/, '')}, ${slot.time} at ${slot.location}.`,
    `To lock it in, sign in using this email (the one we have on file): ${email}, and pay here: ${slot.link}`,
    'See you there!\nJoner ⚽️',
  ].join('\n\n')
}

export async function renderExtra(ui) {
  const { view, post, need, confirmBox, toast, copy } = ui
  const d = S.data = await need(await post('extraList', { coachId: S.coachId }))
  const admin = d.admin
  const hours = d.weekMinutes != null ? `${Math.round((d.weekMinutes / 60) * 10) / 10} h booked this week` : ''
  const pill = (b) => (b.paid ? '<span class="j-pill j-pill-green">Paid</span>' : b.payStatus === 'cancelled' ? '<span class="j-pill j-pill-grey">Charge cancelled</span>' : b.payreqId ? '<span class="j-pill j-pill-amber">Not paid yet</span>' : '<span class="j-pill j-pill-red">No payment yet</span>')
  const card = (s) => `<div class="j-card" style="padding:14px 16px;margin-bottom:12px" data-xs="${esc(s.id)}">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div><b>${esc(s.dateLabel.replace(/\s\d{4}$/, ''))}, ${esc(s.time)}</b> <span class="muted small">${esc(s.durationMin)} min</span><br>
        <span class="small">${esc(s.location)}${admin ? ` · ${esc(s.coachName)}` : ''} · ${esc(s.title)}${admin && s.priceLabel && !s.whole ? ` · ${esc(s.priceLabel)} each` : ''}</span><br>
        ${s.whole ? `<span class="small">Whole session, first come first served: ${s.options.map((o) => `${esc(o.label)}${admin && o.priceLabel ? ` ${esc(o.priceLabel)}${o.type === 'one' ? '' : ' a player'}` : ''}`).join(' · ')}</span><br>` : ''}
        <span class="j-pill j-pill-${s.kind === 'private' ? 'violet' : s.kind === 'weekly' ? 'green' : 'blue'}">${s.kind === 'private' ? 'Private link: never public' : s.kind === 'weekly' ? 'Weekly slot: public' : 'One-off: public'}</span>
        <span class="j-pill j-pill-grey">${s.whole ? (s.bookings.length ? `Booked: ${s.bookings.length} player${s.bookings.length === 1 ? '' : 's'}` : 'Free') : `${s.capacity - s.placesLeft} of ${s.capacity} booked`}</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="j-btn j-btn-line j-btn-sm" data-x-copy="${esc(s.id)}">Copy link</button>
        ${s.placesLeft && !s.whole ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-x-add="${esc(s.id)}">Add a player</button>` : ''}
        <button type="button" class="j-btn j-btn-line j-btn-sm" data-x-edit="${esc(s.id)}">Edit</button>
        <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-x-cancel="${esc(s.id)}">Cancel</button>
      </div>
    </div>
    ${s.bookings.length ? `<ul class="jm-hist" style="margin-top:10px">${s.bookings.map((b) => `<li><span><b>${esc(b.name)}</b><small>${b.guest ? `friend of ${esc(b.inGroupOf || 'the family')} · no JFP waiver, check on the day` : `${esc(b.email || 'no email')}${b.from === 'family' ? ' · booked themselves' : ''}`}</small></span><span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${b.inGroupOf ? '' : pill(b)}
      ${s.date <= todayIso() ? ['Present', 'Absent'].map((st) => `<button type="button" class="j-btn j-btn-sm ${s.marks?.[b.id] === st ? 'j-btn-dark' : 'j-btn-line'}" data-x-mark="${esc(s.id)}|${esc(b.id)}|${st}">${st}</button>`).join('') : ''}
      ${b.mobile ? `<a class="j-btn j-btn-line j-btn-sm" href="${esc(smsHref(b.mobile, extraText({ name: b.name, coach: coachWord(s), slot: s, email: b.email })))}">Text</a>` : ''}
      ${b.inGroupOf ? '' : `<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-x-rm="${esc(s.id)}|${esc(b.id)}">${b.groupId ? 'Remove the group' : 'Remove'}</button>`}</span></li>`).join('')}</ul>` : '<p class="muted small" style="margin-top:8px">No one booked yet.</p>'}
  </div>`
  view().innerHTML = `<div class="jp-head"><div><h1>Extra sessions</h1>${psHelp('Open extra hours. Public ones show in families\' accounts to book. Private ones have their own link for a player you have booked yourself. Every payment lands against the player and you.', 'About this page')}${hours ? `<p class="muted small"><b>${esc(hours)}</b></p>` : ''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${admin ? `<select class="j-select" id="xs-coach" style="width:auto"><option value="">Every coach</option>${d.coaches.map((c) => `<option value="${esc(c.id)}" ${S.coachId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}<button type="button" class="j-btn j-btn-dark" id="xs-new">+ New extra session</button></div></div>
    ${admin ? '' : '<div id="xs-asks"></div>'}
    ${admin ? pricesCard(d) : ''}
    ${admin ? '<div id="xs-announce"></div>' : ''}
    ${d.prices.length ? '' : `<p class="j-box j-box-amber small" style="margin-bottom:12px">${admin ? 'Add a price below first: coaches pick from your prices.' : 'Lee and Ligia have not set extra session prices yet. Ask them, then you can open sessions.'}</p>`}
    ${d.slots.length ? d.slots.map(card).join('') : '<p class="muted">No extra sessions coming up.</p>'}`

  const again = () => renderExtra(ui)
  const slotOf = (id) => d.slots.find((s) => s.id === id)
  view().querySelector('#xs-coach')?.addEventListener('change', (e) => { S.coachId = e.target.value; again() })
  view().querySelector('#xs-new').addEventListener('click', () => slotForm(ui, d, null, again))
  view().querySelectorAll('[data-x-edit]').forEach((b) => b.addEventListener('click', () => slotForm(ui, d, slotOf(b.dataset.xEdit), again)))
  view().querySelectorAll('[data-x-copy]').forEach((b) => b.addEventListener('click', () => { copy(slotOf(b.dataset.xCopy).link) }))
  view().querySelectorAll('[data-x-add]').forEach((b) => b.addEventListener('click', () => addPlayer(ui, slotOf(b.dataset.xAdd), again)))
  view().querySelectorAll('[data-x-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Cancel this extra session? It comes off families\' accounts.', { ok: 'Cancel it', danger: true }))) return
    const r = await post('extraCancel', { id: b.dataset.xCancel }); toast(r.ok ? (r.data.paid?.length ? `Cancelled. ${r.data.paid.join(', ')} had paid: refund in Stripe.` : 'Cancelled. Unpaid payments are off their accounts.') : r.data.error, 8000); if (r.ok) again()
  }))
  view().querySelectorAll('[data-x-rm]').forEach((b) => b.addEventListener('click', async () => {
    const [slotId, bookingId] = b.dataset.xRm.split('|')
    if (!(await confirmBox('Take this player off the session?', { ok: 'Remove', danger: true }))) return
    const r = await post('extraRemove', { slotId, bookingId })
    toast(r.ok ? (r.data.charged ? 'Removed. They had paid: Lee or Ligia sort the refund.' : 'Removed, and the payment is off their account.') : r.data.error, 8000); if (r.ok) again()
  }))
  view().querySelectorAll('[data-x-mark]').forEach((b) => b.addEventListener('click', async () => {
    const [slotId, bookingId, st] = b.dataset.xMark.split('|')
    const cur = slotOf(slotId).marks?.[bookingId]
    const r = await post('extraMark', { slotId, bookingId, status: cur === st ? '' : st }); if (!r.ok) return toast(r.data.error); again()
  }))
  if (admin) { bindPrices(ui, again); announceCard(ui) } else asksCard(ui)
}

// Families asking for an extra session (Lee, 19 Oct 2026): every coach sees
// them. Take it, or not for me. The first coach to take it has it, and Lee
// and Ligia hear straight away. No family contact details here: Ligia books it in.
async function asksCard(ui) {
  const { view, post, toast } = ui
  const el = view().querySelector('#xs-asks')
  if (!el) return
  const r = await post('extraAsks')
  if (!r.ok) return
  const asks = r.data.asks || []
  const open = asks.filter((a) => !a.takenBy || a.takenByMe)
  if (!open.length) { el.innerHTML = ''; return }
  const when = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const row = (a) => `<li data-ask="${esc(a.id)}"><span><b>${esc(a.player)}</b> <span class="muted small">asked ${esc(when(a.createdAt))}</span>
      <small>${esc(a.type || 'Either')} · ${esc(a.days.join(', ') || 'any day')} · ${esc(a.times.join(', ') || 'any time')}${a.coach ? ` · wants ${esc(a.coach)}` : ''}</small>${a.notes ? `<small>${esc(a.notes)}</small>` : ''}</span>
    <span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${a.takenByMe ? '<span class="j-pill j-pill-green">You are taking it</span><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-ask-go="">Let it go</button>'
      : a.mine === 'pass' ? '<span class="j-pill j-pill-grey">Not for you</span><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-ask-go="">Undo</button>'
      : '<button type="button" class="j-btn j-btn-dark j-btn-sm" data-ask-go="take">Take it</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-ask-go="pass">Not for me</button>'}</span></li>`
  el.innerHTML = `<div class="j-card" style="padding:14px 16px;margin-bottom:14px"><h3 style="margin-bottom:4px">Requests from families</h3>
    <p class="muted small" style="margin-bottom:6px">Families asking for an extra session. Take it if you can coach it: Lee and Ligia hear straight away and book it in with you.</p>
    <ul class="jm-hist">${open.map(row).join('')}</ul></div>`
  el.querySelectorAll('[data-ask-go]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true
    const id = b.closest('[data-ask]').dataset.ask
    const res = await post('extraAskReply', { id, answer: b.dataset.askGo })
    if (!res.ok) { toast(res.data.error); b.disabled = false; return asksCard(ui) }
    toast(b.dataset.askGo === 'take' ? 'Taken. Lee and Ligia have been told.' : b.dataset.askGo === 'pass' ? 'Noted' : 'Done')
    asksCard(ui)
    ui.refreshAsks?.()
  }))
}

// The email to JFP families when a public session opens (Lee, 19 Oct 2026).
// Off until Lee says yes to the wording; then Lee or Ligia switch it on here.
async function announceCard(ui, change) {
  const { view, post, toast, modal, confirmBox } = ui
  const el = view().querySelector('#xs-announce')
  if (!el) return
  const r = await post('extraAnnounce', change || {})
  if (!r.ok) { el.innerHTML = ''; return toast(r.data.error) }
  const a = r.data
  const held = a.history.filter((h) => h.status === 'held')
  el.innerHTML = `<div class="j-card" style="padding:14px 16px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><div><h3 style="margin-bottom:4px">Email JFP families about new public sessions</h3>
      <p class="muted small">${a.on ? 'On.' : 'Off.'} When a public extra session opens, every family with a Term 4 JFP place gets one email${a.families != null ? ` (${a.families} families now)` : ''}. Never Do Not Contact, never a price or a coach's name, at most one every ${a.cooldownHours} hours.</p></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line j-btn-sm" id="xa-preview">See the email</button><button type="button" class="j-btn ${a.on ? 'j-btn-line' : 'j-btn-dark'} j-btn-sm" id="xa-switch">${a.on ? 'Switch off' : 'Switch on'}</button></div></div>
    ${held.length && !a.on ? `<p class="small" style="margin-top:8px">While it is off, ${held.length} new public session${held.length === 1 ? ' was' : 's were'} not emailed: ${held.slice(0, 5).map((h) => h.slots.map((x) => `${esc(x.date.slice(5).split('-').reverse().join('/'))} ${esc(x.time)}`).join(', ')).join('; ')}.</p>` : ''}
  </div>`
  el.querySelector('#xa-preview').addEventListener('click', () => {
    const box = modal(`<h2 style="margin-bottom:6px">${esc(a.preview.subject)}</h2><p class="muted small" style="margin-bottom:10px">An example. The real one lists the new sessions and the family's first name.</p><iframe title="The email" style="width:100%;height:520px;border:1px solid var(--j-line);border-radius:12px;background:#fff" sandbox></iframe><div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
    box.querySelector('iframe').srcdoc = a.preview.html
  })
  el.querySelector('#xa-switch').addEventListener('click', async () => {
    if (!a.on && !(await confirmBox(`Switch on? From now on each new public extra session emails ${a.families ?? 'every'} JFP families.`, { ok: 'Switch on' }))) return
    announceCard(ui, { on: !a.on })
  })
}
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())

function pricesCard(d) {
  return `<div class="j-card" style="padding:14px 16px;margin-bottom:14px"><h3 style="margin-bottom:6px">Prices coaches can use</h3>
    <ul class="jm-hist">${(d.allPrices || []).map((p) => `<li><span><b>${esc(p.label)}</b><small>${esc(p.priceLabel)} · ${esc(p.durationMin)} min</small></span><button type="button" class="j-btn j-btn-line j-btn-sm" data-xp-arch="${esc(p.id)}" data-on="${p.archived ? 'false' : 'true'}">${p.archived ? 'Use again' : 'Stop using'}</button></li>`).join('') || '<li class="muted small">None yet.</li>'}</ul>
    <div class="j-two" style="margin-top:10px"><label class="j-field"><span>Name</span><input class="j-input" id="xp-label" placeholder="For example, Extra session 1 hour"></label>
    <div class="j-two"><label class="j-field"><span>A$ per player</span><input class="j-input" id="xp-cents" inputmode="decimal" placeholder="e.g. 120"></label><label class="j-field"><span>Minutes</span><input class="j-input" id="xp-min" inputmode="numeric" value="60"></label></div></div>
    <button type="button" class="j-btn j-btn-dark j-btn-sm" id="xp-add">Add price</button></div>`
}
function bindPrices(ui, again) {
  const { view, post, toast } = ui
  view().querySelector('#xp-add')?.addEventListener('click', async () => {
    const r = await post('extraPrices', { add: { label: view().querySelector('#xp-label').value, dollars: view().querySelector('#xp-cents').value, durationMin: view().querySelector('#xp-min').value } })
    toast(r.ok ? 'Price added' : r.data.error); if (r.ok) again()
  })
  view().querySelectorAll('[data-xp-arch]').forEach((b) => b.addEventListener('click', async () => {
    const r = await post('extraPrices', { archive: b.dataset.xpArch, on: b.dataset.on === 'true' }); toast(r.ok ? 'Saved' : r.data.error); if (r.ok) again()
  }))
}

// One option of a whole session: on or off, its price per player and, for a
// group, the fewest and most players. Lee and Ligia can also type an amount.
function optRow(type, s, d, priceText) {
  const o = s?.options?.find((x) => x.type === type)
  const on = s?.whole ? Boolean(o) : true
  const priceOpts = `${o ? `<option value="__keep" selected>${d.admin ? `Keep ${esc(o.priceLabel || 'the price')}` : 'Keep it as it is'}</option>` : ''}${d.prices.map((p) => `<option value="${esc(p.id)}">${esc(priceText(p))}</option>`).join('')}${d.admin ? '<option value="__aud">Type an amount</option>' : ''}`
  return `<div class="j-card" style="padding:10px 12px;margin-bottom:8px">
    <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" data-xo-on="${type}" ${on ? 'checked' : ''}> ${type === 'one' ? '1 on 1' : 'Group'}</label>
    <div class="j-two" style="margin-top:6px"><label class="j-field"><span>${d.admin ? 'Price per player' : 'Session'}</span><select class="j-select" data-xo-price="${type}">${priceOpts}</select></label>
    ${d.admin ? `<label class="j-field"><span>A$ per player <span class="muted">(if typed)</span></span><input class="j-input" data-xo-aud="${type}" inputmode="decimal" placeholder="e.g. ${type === 'one' ? '150' : '60'}"></label>` : ''}</div>
    ${type === 'group' ? `<div class="j-two"><label class="j-field"><span>Fewest players</span><input class="j-input" data-xo-min inputmode="numeric" value="${esc(o?.minPlayers || 2)}"></label><label class="j-field"><span>Most players</span><input class="j-input" data-xo-max inputmode="numeric" value="${esc(o?.maxPlayers || 4)}"></label></div>` : ''}
  </div>`
}

function slotForm(ui, d, s, done) {
  const { modal, closeModal, post, toast } = ui
  const venues = d.venues || []
  // Coaches pick the kind of session, never see what it costs (Lee, 19 Oct 2026).
  const priceText = (p) => (d.admin ? `${p.label} · ${p.priceLabel} · ${p.durationMin} min` : `${p.label} · ${p.durationMin} min`)
  const maxIso = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10)
  const timeBox = (v) => `<span class="xf-time"><input class="j-input" type="time" data-xf-time value="${esc(v)}" step="300">${s ? '' : '<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-xf-time-rm aria-label="Remove this time">Remove</button>'}</span>`
  // The kind (Lee, 19 Oct 2026): one-off, private link, or a permanent weekly slot.
  const kind0 = s ? (s.kind || (s.visibility === 'public' ? 'oneoff' : 'private')) : 'private'
  const box = modal(`<h2 style="margin-bottom:10px">${s ? 'Edit extra session' : 'New extra sessions'}</h2>
    ${d.admin ? `<label class="j-field"><span>Coach</span><select class="j-select" id="xf-coach">${d.coaches.map((c) => `<option value="${esc(c.id)}" ${(s?.coachId || S.coachId) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
    <div class="j-field"><span>${s ? 'Date' : 'Dates <span class="muted">(tap as many as you like)</span>'}</span><div id="xf-cal"></div></div>
    <div class="j-field"><span>${s ? 'Start' : 'Start times <span class="muted">(each date gets each time)</span>'}</span><div class="xf-times" id="xf-times">${timeBox(to24(s?.time) || '16:30')}${s ? '' : '<button type="button" class="j-btn j-btn-line j-btn-sm" id="xf-time-add">Add another time</button>'}</div></div>
    <div class="j-field"><span>How families book</span><div class="jp-seg" id="xf-as"><button type="button" data-as="places" aria-pressed="${!s?.whole}">Each player books a place</button><button type="button" data-as="whole" aria-pressed="${Boolean(s?.whole)}">One family books the whole session</button></div>
      <p class="muted small" id="xf-as-help" style="margin-top:6px"></p></div>
    <div id="xf-whole" hidden>${optRow('one', s, d, priceText)}${optRow('group', s, d, priceText)}</div>
    <label class="j-field" id="xf-price-wrap"><span>${d.admin ? 'Price' : 'Session'}</span><select class="j-select" id="xf-price">${s ? `<option value="">${d.admin ? `Keep the price, ${esc(s.priceLabel)}` : 'Keep it as it is'}</option>` : ''}${d.prices.map((p) => `<option value="${esc(p.id)}" data-min="${esc(p.durationMin)}" ${s?.priceId === p.id ? 'selected' : ''}>${esc(priceText(p))}</option>`).join('')}</select></label>
    <div class="j-two"><label class="j-field"><span>Minutes</span><input class="j-input" id="xf-min" inputmode="numeric" value="${esc(s?.durationMin || d.prices[0]?.durationMin || 60)}"></label>
    <label class="j-field" id="xf-cap-wrap"><span>Places</span><input class="j-input" id="xf-cap" inputmode="numeric" value="${esc(s?.capacity || 1)}"></label></div>
    <label class="j-field"><span>Where</span><select class="j-select" id="xf-loc">${venues.map((v) => `<option ${s?.location === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}<option value="__other" ${s && !venues.includes(s.location) ? 'selected' : ''}>Somewhere else</option></select></label>
    <label class="j-field" id="xf-other-wrap" ${s && !venues.includes(s.location) ? '' : 'hidden'}><span>Place</span><input class="j-input" id="xf-other" value="${esc(s && !venues.includes(s.location) ? s.location : '')}"></label>
    <div class="j-field"><span>What kind of session</span><div class="jp-seg xf-kinds" id="xf-vis">${KINDS.filter(([v]) => !s || v !== 'weekly' || kind0 === 'weekly').map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${kind0 === v}">${esc(l)}</button>`).join('')}</div><p class="muted small" id="xf-kind-help" style="margin-top:6px">${esc(KIND_HELP[kind0])}</p></div>
    ${s ? '' : `<div class="j-field" id="xf-who"><span>Who is it for? <span class="muted">(private, booked with you)</span></span>
      <input class="j-input" id="xf-q" placeholder="Type the player's name" autocomplete="off">
      <div id="xf-res"></div>
      <details class="xf-new"><summary class="small">Not on the list? Add their details</summary>
        <div class="j-two"><label class="j-field"><span>Player name</span><input class="j-input" id="xf-name"></label><label class="j-field"><span>Email (they sign in with this)</span><input class="j-input" id="xf-email" type="email" inputmode="email"></label></div>
        <label class="j-field"><span>Mobile <span class="muted">(optional)</span></span><input class="j-input" id="xf-mobile" type="tel" inputmode="tel"></label>
      </details></div>`}
    <label class="j-field"><span>Name families see <span class="muted">(optional)</span></span><input class="j-input" id="xf-title" value="${esc(s?.title || '')}" placeholder="For example, Finishing session"></label>
    <p class="j-err" id="xf-err" hidden></p>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="xf-go">${s ? 'Save' : 'Open the session'}</button></div>`, { wide: true })
  const go = box.querySelector('#xf-go')
  const times = () => [...box.querySelectorAll('[data-xf-time]')].map((x) => x.value).filter(Boolean)
  // A private session for a player booked with the coach (Lee, 19 Oct 2026):
  // pick them here and it is made, put in their account to pay and emailed.
  let who = null
  const whoName = () => who?.name || (box.querySelector('#xf-name')?.value || '').trim()
  const count = () => {
    if (s) return
    const n = cal.get().length * new Set(times()).size
    const nm = vis === 'private' ? whoName() : ''
    go.textContent = vis === 'weekly' ? 'Open the weekly slot' : nm ? `Create and send to ${nm.split(' ')[0]}` : n > 1 ? `Open ${n} sessions` : 'Open the session'
  }
  const cal = calendar(box.querySelector('#xf-cal'), { multi: !s, selected: [s?.date || ''], min: todayIso(), max: maxIso, onChange: count })
  box.querySelector('#xf-times').addEventListener('click', (e) => {
    if (e.target.closest('#xf-time-add')) { e.target.closest('#xf-time-add').insertAdjacentHTML('beforebegin', timeBox(hourAfter(times().at(-1) || '15:30'))); count(); return }
    const rm = e.target.closest('[data-xf-time-rm]')
    if (rm && box.querySelectorAll('[data-xf-time]').length > 1) { rm.closest('.xf-time').remove(); count() }
  })
  box.querySelector('#xf-times').addEventListener('change', count)
  // Each player books a place, or one family books the whole session (Lee, 27 Oct 2026).
  let as = s?.whole ? 'whole' : 'places'
  const AS_HELP = { places: 'Each player books their own place, until the places are gone.', whole: 'First come, first served: the first family to book takes the whole session, as 1 on 1 or a group (they name the friends coming). Tick one or both.' }
  const showAs = () => {
    box.querySelectorAll('#xf-as [data-as]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.as === as)))
    box.querySelector('#xf-as-help').textContent = AS_HELP[as]
    box.querySelector('#xf-whole').hidden = as !== 'whole'
    box.querySelector('#xf-price-wrap').hidden = as === 'whole'
    box.querySelector('#xf-cap-wrap').hidden = as === 'whole'
  }
  box.querySelector('#xf-as').addEventListener('click', (e) => { const b = e.target.closest('[data-as]'); if (b) { as = b.dataset.as; showAs() } })
  showAs()
  let vis = kind0
  const whoBox = box.querySelector('#xf-who')
  const showWho = () => { if (whoBox) whoBox.hidden = vis !== 'private'; count() }
  box.querySelector('#xf-vis').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; vis = b.dataset.v; box.querySelectorAll('#xf-vis [data-v]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); box.querySelector('#xf-kind-help').textContent = KIND_HELP[vis]; showWho() })
  if (whoBox) {
    let t
    const pickHtml = () => (who ? `<div class="xf-picked"><span><b>${esc(who.name)}</b><br><span class="muted small">${esc(who.group)}${who.hasEmail ? '' : ' · no email on file, add it below'}</span></span><button type="button" class="j-btn j-btn-line j-btn-sm" id="xf-unpick">Change</button></div>` : '')
    const drawPick = () => {
      box.querySelector('#xf-res').innerHTML = pickHtml()
      box.querySelector('#xf-q').hidden = Boolean(who)
      box.querySelector('#xf-unpick')?.addEventListener('click', () => { who = null; drawPick(); box.querySelector('#xf-q').value = ''; box.querySelector('#xf-q').focus(); count() })
      if (who && !who.hasEmail) { box.querySelector('.xf-new').open = true; box.querySelector('#xf-name').value = who.name }
      count()
    }
    box.querySelector('#xf-q').addEventListener('input', (e) => {
      clearTimeout(t)
      t = setTimeout(async () => {
        const r = await post('extraSearch', { q: e.target.value })
        const list = r.ok ? r.data.results : []
        box.querySelector('#xf-res').innerHTML = list.length ? list.map((x, i) => `<button type="button" class="j-player" data-i="${i}"><span><b>${esc(x.name)}</b><br><span class="muted small">${esc(x.group)}${x.hasEmail ? '' : ' · no email on file'}</span></span></button>`).join('') : e.target.value.trim().length > 1 ? '<p class="muted small">No one by that name. Add their details below.</p>' : ''
        box.querySelectorAll('#xf-res [data-i]').forEach((b) => b.addEventListener('click', () => { who = list[Number(b.dataset.i)]; drawPick() }))
      }, 250)
    })
    box.querySelector('#xf-name').addEventListener('input', count)
    showWho()
  }
  box.querySelector('#xf-loc').addEventListener('change', (e) => { box.querySelector('#xf-other-wrap').hidden = e.target.value !== '__other' })
  box.querySelector('#xf-price').addEventListener('change', (e) => { const m = e.target.selectedOptions[0]?.dataset.min; if (m) box.querySelector('#xf-min').value = m })
  go.addEventListener('click', async () => {
    const err = box.querySelector('#xf-err')
    err.hidden = true
    const loc = box.querySelector('#xf-loc').value
    const dates = cal.get()
    const ts = [...new Set(times())].map(ampm)
    if (!dates.length) { err.textContent = s ? 'Tap a date.' : 'Tap at least one date.'; err.hidden = false; return }
    if (!ts.length) { err.textContent = 'Add a start time.'; err.hidden = false; return }
    if (whoBox && vis === 'private' && as === 'whole' && whoName()) { err.textContent = 'A whole session is booked by the family from the link. Clear the player, then copy the link to send them.'; err.hidden = false; return }
    if (whoBox && vis === 'private') {
      const typed = (box.querySelector('#xf-q').value || '').trim()
      const email = (box.querySelector('#xf-email').value || '').trim()
      if (!who && typed && !whoName()) { err.textContent = `Tap ${typed}'s name in the list, or add their details.`; err.hidden = false; return }
      if (whoName() && !who?.hasEmail && !/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Add their email so they can pay in their account.'; err.hidden = false; return }
    }
    let options
    if (as === 'whole') {
      options = ['one', 'group'].filter((ty) => box.querySelector(`[data-xo-on="${ty}"]`).checked).map((ty) => {
        const pick = box.querySelector(`[data-xo-price="${ty}"]`).value
        const typed = box.querySelector(`[data-xo-aud="${ty}"]`)?.value.trim()
        // An amount Lee or Ligia typed wins; "keep" sends nothing, so the price stays.
        return { type: ty, priceId: typed || pick === '__aud' || pick === '__keep' ? '' : pick, ...(typed || pick === '__aud' ? { priceCents: Math.round(Number(typed) * 100) } : {}), ...(ty === 'group' ? { minPlayers: Number(box.querySelector('[data-xo-min]').value), maxPlayers: Number(box.querySelector('[data-xo-max]').value) } : {}) }
      })
      if (!options.length) { err.textContent = 'Tick 1 on 1, a group, or both.'; err.hidden = false; return }
    }
    const slot = {
      ...(as === 'whole' ? { bookAs: 'whole', options } : {}),
      id: s?.id || '', coachId: box.querySelector('#xf-coach')?.value || '', date: dates[0], time: ts[0],
      priceId: box.querySelector('#xf-price').value, durationMin: Number(box.querySelector('#xf-min').value), capacity: Number(box.querySelector('#xf-cap').value),
      location: loc === '__other' ? box.querySelector('#xf-other').value : loc, kind: vis, visibility: vis === 'private' ? 'private' : 'public', title: box.querySelector('#xf-title').value,
    }
    go.disabled = true
    const many = !s && (vis === 'weekly' || dates.length * ts.length > 1)
    const r = many ? await post('extraSaveMany', { slot, dates: vis === 'weekly' ? [dates[0]] : dates, times: ts }) : await post('extraSave', { slot })
    if (!r.ok) { go.disabled = false; err.textContent = r.data.error; err.hidden = false; if (many && /were made/.test(r.data.error || '')) done(); return }
    const made = many ? r.data.slots : [r.data.slot]
    const n = made.length
    const nm = !s && vis === 'private' ? whoName() : ''
    if (nm) {
      // Put the player on every session just made: each goes in their account to pay, and they get the email.
      const pick = { pick: who?.pick || '', rowId: who?.rowId || '', name: nm, email: box.querySelector('#xf-email')?.value || '', mobile: box.querySelector('#xf-mobile')?.value || '' }
      const results = []
      for (const sl of made) results.push(await post('extraAttach', { slotId: sl.id, ...pick }))
      const bad = results.find((x) => !x.ok || x.data.chargeError)
      const first = results.find((x) => x.ok)?.data
      closeModal()
      if (!first) { toast(`Session${n > 1 ? 's' : ''} made, but ${nm} was not added: ${bad?.data?.error || 'try Add a player on the session'}`, 9000); return done() }
      sentBox(ui, first.booking, first.slot, n, bad ? (bad.data.error || bad.data.chargeError) : '')
      return done()
    }
    closeModal(); toast(s ? 'Saved' : vis === 'weekly' ? `Weekly slot open: ${n} weeks, on the booking page and in My account` : `${n > 1 ? `${n} sessions open` : 'Open'}: ${vis === 'private' ? 'private, copy the link or add a player' : 'families can book on the booking page and in My account'}`); done()
  })
}

// After a private session is made and sent: what happened, and the text to send.
function sentBox(ui, b, slot, n, problem) {
  const { modal, copy } = ui
  const text = extraText({ name: b.name, coach: coachWord(slot), slot, email: b.email })
  const box = modal(`<h2 style="margin-bottom:6px">Sent to ${esc(b.name)}</h2>
    <p class="muted small" style="margin-bottom:12px">${problem ? `<b>Check this:</b> ${esc(problem)}<br>` : ''}${n > 1 ? `${n} sessions are` : 'The session is'} in their account to pay, and they have an email with a Pay button${b.email ? ` (${esc(b.email)})` : ''}. You can also text them:</p>
    <label class="j-field"><span>The text</span><textarea class="j-textarea" id="xd-text" rows="8">${esc(text)}</textarea></label>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Done</button><button type="button" class="j-btn j-btn-line" id="xd-copy">Copy link</button>${b.mobile ? `<a class="j-btn j-btn-dark" id="xd-sms" href="${esc(smsHref(b.mobile, text))}">Text from my phone</a>` : ''}</div>`)
  box.querySelector('#xd-copy').addEventListener('click', () => copy(slot.link))
  box.querySelector('#xd-text').addEventListener('input', (ev) => { const a = box.querySelector('#xd-sms'); if (a) a.href = smsHref(b.mobile, ev.target.value) })

}

function addPlayer(ui, s, done) {
  const { modal, closeModal, post, toast, copy } = ui
  const box = modal(`<h2 style="margin-bottom:4px">Add a player</h2><p class="muted small" style="margin-bottom:12px">${esc(s.dateLabel.replace(/\s\d{4}$/, ''))}, ${esc(s.time)} at ${esc(s.location)}. It shows in their account to pay, ${esc(s.priceLabel)}.</p>
    <label class="j-field"><span>Find a JFP player</span><input class="j-input" id="xa-q" placeholder="Start typing a name" autocomplete="off"></label>
    <div id="xa-res"></div>
    <p class="muted small" style="margin:6px 0 8px">Not a JFP player? Fill in their details.</p>
    <div class="j-two"><label class="j-field"><span>Player name</span><input class="j-input" id="xa-name"></label><label class="j-field"><span>Email (they sign in with this)</span><input class="j-input" id="xa-email" type="email" inputmode="email"></label></div>
    <label class="j-field"><span>Mobile <span class="muted">(to text them the link)</span></span><input class="j-input" id="xa-mobile" type="tel" inputmode="tel"></label>
    <p class="j-err" id="xa-err" hidden></p>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="xa-go">Add to the session</button></div>`, { wide: true })
  let rowId = '', pick = ''
  let t
  box.querySelector('#xa-q').addEventListener('input', (e) => {
    clearTimeout(t)
    t = setTimeout(async () => {
      const r = await post('extraSearch', { q: e.target.value })
      const list = r.ok ? r.data.results : []
      box.querySelector('#xa-res').innerHTML = list.map((x, i) => `<button type="button" class="j-player" data-i="${i}"><span><b>${esc(x.name)}</b><br><span class="muted small">${esc(x.group)}${x.hasEmail ? '' : ' · no email on file'}</span></span></button>`).join('')
      box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
        const x = list[Number(b.dataset.i)]; rowId = x.rowId; pick = x.pick || ''
        box.querySelector('#xa-name').value = x.name; box.querySelector('#xa-res').innerHTML = `<p class="j-box j-box-grey small">Using ${esc(x.name)} (${esc(x.group)}). Their email and mobile are on file${x.hasEmail ? '' : ': none yet, add the email below'}.</p>`
      }))
    }, 250)
  })
  box.querySelector('#xa-name').addEventListener('input', () => { rowId = ''; pick = '' })
  box.querySelector('#xa-go').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const r = await post('extraAttach', { slotId: s.id, rowId, pick, name: box.querySelector('#xa-name').value, email: box.querySelector('#xa-email').value, mobile: box.querySelector('#xa-mobile').value })
    if (!r.ok) { box.querySelector('#xa-go').disabled = false; const err = box.querySelector('#xa-err'); err.textContent = r.data.error; err.hidden = false; return }
    const b = r.data.booking
    const slot = r.data.slot
    const text = extraText({ name: b.name, coach: coachWord(slot), slot, email: b.email })
    closeModal()
    const doneBox = modal(`<h2 style="margin-bottom:6px">${esc(b.name)} is booked in</h2><p class="muted small" style="margin-bottom:12px">${r.data.chargeError ? `<b>The payment did not go into their account:</b> ${esc(r.data.chargeError)}` : `It is in their account (${esc(b.email)}) to pay, ${esc(slot.priceLabel)}.`} Send them the link:</p>
      <label class="j-field"><span>The text</span><textarea class="j-textarea" id="xd-text" rows="9">${esc(text)}</textarea></label>
      <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-line" id="xd-copy">Copy link</button>${b.mobile ? `<a class="j-btn j-btn-dark" id="xd-sms" href="${esc(smsHref(b.mobile, text))}">Text from my phone</a>` : ''}</div>`)
    doneBox.querySelector('#xd-copy').addEventListener('click', () => copy(slot.link))
    doneBox.querySelector('#xd-text').addEventListener('input', (ev) => { const a = doneBox.querySelector('#xd-sms'); if (a) a.href = smsHref(b.mobile, ev.target.value) })
    toast(r.data.chargeError ? `Added, but the payment did not go into their account: ${r.data.chargeError}` : r.data.already ? 'Already on this session' : 'Added. It is in their account to pay.', 8000)
    done()
  })
}
