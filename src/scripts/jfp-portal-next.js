// Next term page (Lee and Ligia). Term 1 2027 offer (Lee, 16 Nov 2026):
// every current player's early price, who has paid, and the settings.
import { $, esc, money } from './jfp-common.js'

const WORD = { invited: ['blue', 'Not paid yet'], held: ['violet', 'Held (deposit)'], paid: ['green', 'Paid in full'], no: ['grey', 'Not returning'] }
const TIER = { loyal: ['red', 'Loyal 24'], current: ['blue', 'A$50 off'] }
const dayLabel = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '') : '')
const ACCOUNT_LINK = 'https://jonerfootball.com/jfp-account/#keep'
const S = { filter: 'all', q: '', view: 'timetable', day: '', loc: '' }

export async function renderNext(ui) {
  const { view, post, need, toast, confirmBox, modal, closeModal, copy } = ui
  const d = await need(await post('nextTerm'))
  const nt = d.nextTerm
  const o = d.offerTotals || {}
  const t = d.totals
  const fams = new Map()
  for (const p of d.players) { const k = (p.email || p.parent || p.name).toLowerCase(); fams.set(k, [...(fams.get(k) || []), p]) }
  const famOf = (p) => fams.get((p.email || p.parent || p.name).toLowerCase()) || [p]
  const match = (p) => {
    if (S.q && !`${p.name} ${p.parent} ${p.email}`.toLowerCase().includes(S.q)) return false
    if (S.filter === 'loyal') return p.offer?.tier === 'loyal'
    if (S.filter === 'current') return p.offer?.tier === 'current'
    if (S.filter === 'paid') return p.status === 'paid'
    if (S.filter === 'unpaid') return p.offer && !['paid', 'no'].includes(p.status)
    if (S.filter === 'none') return !p.offer
    return true
  }
  const chips = [['all', 'Everyone', d.players.length], ['loyal', 'Loyal 24', o.loyal], ['current', 'A$50 off', o.current], ['unpaid', 'Not paid yet', d.players.filter((p) => p.offer && !['paid', 'no'].includes(p.status)).length], ['paid', 'Paid in full', d.players.filter((p) => p.status === 'paid').length], ['none', 'No offer price', d.players.filter((p) => !p.offer).length]]
  const famTotal = (p) => {
    const f = famOf(p).filter((x) => x.offer)
    if (f.length < 2) return ''
    return `<br><span class="muted small">Family: ${esc(money(f.reduce((s, x) => s + x.offer.offerCents, 0)))} instead of ${esc(money(f.reduce((s, x) => s + x.offer.normalCents, 0)))}</span>`
  }
  const priceCell = (p) => !p.offer ? '<span class="muted small">No offer price</span>'
    : `<b>${esc(money(p.offer.offerCents))}</b> <span class="muted small">instead of ${esc(money(p.offer.normalCents))}</span><br><span class="muted small">${esc(p.offer.kind)}${p.offer.note ? ` · ${esc(p.offer.note)}` : ''}</span>${famTotal(p)}`
  const rows = d.players.filter(match)
  const listHtml = () => `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 10px">
      <input class="j-input" id="nx-q" placeholder="Find a player or parent" value="${esc(S.q)}" style="max-width:260px">
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="nx-link">Copy the family link</button>
    </div>
    <div class="ps-chips">${chips.map(([k, l, n]) => `<button type="button" class="ps-chip" data-nxf="${k}" aria-pressed="${S.filter === k}">${esc(l)} <b>${n || 0}</b></button>`).join('')}</div>
    <div class="jp-scroll"><table class="jp-table"><thead><tr><th></th><th>Player</th><th>Group now</th><th>Offer</th><th>${esc(nt.name)} price</th><th>Paid?</th><th></th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td><input type="checkbox" data-nt="${esc(p.rowId)}" ${p.status ? 'disabled' : ''} aria-label="Select ${esc(p.name)}"></td>
        <td><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.parent)} · ${esc(p.email || 'no email')}</span></td>
        <td>${esc(p.group)}${p.coach ? `<br><span class="muted small">Coach ${esc(p.coach)}</span>` : ''}</td>
        <td>${p.offer ? `<span class="j-pill j-pill-${TIER[p.offer.tier]?.[0] || 'grey'}">${esc(TIER[p.offer.tier]?.[1] || p.offer.tier)}</span>` : '<span class="muted small">None</span>'}</td>
        <td>${priceCell(p)}</td>
        <td>${p.status ? `<span class="j-pill j-pill-${WORD[p.status][0]}">${WORD[p.status][1]}</span>${p.paidCents ? `<br><span class="muted small">${esc(money(p.paidCents))}</span>` : ''}` : p.interested ? '<span class="j-pill j-pill-amber">Wants to keep it</span>' : '<span class="muted small">Not paid yet</span>'}</td>
        <td><button type="button" class="j-btn j-btn-line j-btn-sm" data-nxedit="${esc(p.rowId)}">${p.offer ? 'Change price' : 'Add a price'}</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nobody here.</td></tr>'}
    </tbody></table></div>
`
  view().innerHTML = `<div class="jp-head"><div><h1>${esc(nt.name)}</h1><details class="ps-help"><summary aria-label="About this page" title="About this page">?</summary><div class="ps-help-body">Every current player's ${esc(nt.name)} price and whether they have paid. Families pay in My account (${esc(ACCOUNT_LINK)}), on the Keep my spot page. A paid place shows here straight away and is saved in Airtable under "Next term holds". Nothing on this page messages a family unless you press Invite with "Email the families" ticked.</div></details></div></div>
    <div class="j-box ${o.live ? 'j-box-green' : 'j-box-amber'}" style="margin-bottom:14px;max-width:900px">
      ${o.live ? `<b>Early offer is on until ${esc(dayLabel(nt.offerUntil))}, 11:59pm.</b> Loyal 24: first week free (A$765 one player, A$1,350 two, A$405 Pathway). Everyone else: A$50 off per player (A$800, A$1,400 for two, A$425 Pathway). Paid in full only${nt.fullOnly ? ': no deposit, no Afterpay, no instalments' : ''}. Places held until ${esc(dayLabel(nt.holdUntil) || 'bookings open')}. From the day after, the same players pay the normal price.`
        : nt.offerUntil ? `<b>The early offer ended ${esc(dayLabel(nt.offerUntil))}.</b> Families now pay the normal price shown.` : '<b>No early offer is set.</b>'}
      ${nt.open ? '' : ' <b>Families cannot see or pay it yet:</b> turn on "Open to every current family" below.'}
    </div>
    <div class="jp-kpis"><div class="jp-kpi"><span>Players with a price</span><b>${o.places || 0}</b></div><div class="jp-kpi"><span>Families</span><b>${o.families || 0}</b></div><div class="jp-kpi"><span>Paid in full</span><b>${o.paid || 0}</b></div><div class="jp-kpi"><span>Paid so far</span><b>${esc(money(o.paidCents || 0))}</b></div><div class="jp-kpi"><span>Still to come</span><b>${esc(money(o.toComeCents || 0))}</b></div><div class="jp-kpi"><span>Not returning</span><b>${t.no}</b></div></div>
    <div class="nt-tabs" role="tablist"><button type="button" class="ps-chip" data-nxv="timetable" aria-pressed="${S.view === 'timetable'}">Timetable</button><button type="button" class="ps-chip" data-nxv="list" aria-pressed="${S.view === 'list'}">List and prices</button></div>
    ${S.view === 'timetable' ? timetableHtml(d) : listHtml()}
    <section class="j-card" style="padding:16px;margin-top:18px;max-width:820px"><h2 style="font-size:17px">New families for ${esc(nt.name)}</h2><p class="muted small" style="margin:4px 0 10px">${nt.newBookings ? `Open on the booking page: new families apply for ${esc(nt.name)}${nt.termStart ? ` (from ${esc(dayLabel(nt.termStart))}, ${esc(nt.weeks || 10)} weeks)` : ''}. Their requests show in Requests with a ${esc(nt.name)} tag; Offer a place sends them a link to pay.` : 'Not open to new families yet.'}</p>
      ${(d.newFamilies || []).length ? `<ul style="display:grid;gap:8px;list-style:none;padding:0;margin:0">${d.newFamilies.map((x) => `<li><b>${esc(x.player)}</b> <span class="muted small">· ${esc(x.parent || '')}</span> <span class="j-pill j-pill-${x.status === 'paid' ? 'green' : 'amber'}">${x.status === 'paid' ? `Paid ${esc(money(x.cents))}` : `Offered ${esc(money(x.cents))}, not paid`}</span><br><span class="small">${esc(x.group)}</span></li>`).join('')}</ul>` : '<p class="muted small">None yet.</p>'}</section>
    ${(d.waitlist || []).length ? `<section class="j-card" style="padding:16px;margin-top:18px;max-width:820px"><h2 style="font-size:17px">Waitlist for ${esc(nt.name)}</h2><p class="muted small" style="margin:4px 0 10px">Trials waiting for a place in a full group. Set from Trials (Followed up, then Waitlist next term). Nothing is sent to these families.</p>
      <ul class="nx-wait" style="display:grid;gap:8px;list-style:none;padding:0;margin:0">${d.waitlist.map((w) => `<li><b>${esc(w.name)}</b> <span class="muted small">· ${esc(w.parent || '')}</span><br><span class="small">Waiting for ${esc(w.group)}</span>${w.note ? `<br><span class="muted small">${esc(w.note)}</span>` : ''}</li>`).join('')}</ul></section>` : ''}
    <details class="j-card" style="padding:16px;margin-top:18px;max-width:820px">
      <summary><b>Settings and invites</b></summary>
      <div class="j-two" style="margin-top:12px"><label class="j-field"><span>Next term</span><input class="j-input" id="nt-name" value="${esc(nt.name)}"></label><label class="j-field"><span>Deposit (A$, only when deposits are allowed)</span><input class="j-input" id="nt-hold" inputmode="decimal" value="${nt.holdCents / 100}"></label></div>
      <div class="j-two"><label class="j-field"><span>Early price lasts until (the whole day)</span><input class="j-input" id="nt-offer" type="date" value="${esc(nt.offerUntil || '')}"></label><label class="j-field"><span>Places held for current players until</span><input class="j-input" id="nt-until" type="date" value="${esc(nt.holdUntil || '')}"></label></div>
      <label class="j-check"><input type="checkbox" id="nt-full" ${nt.fullOnly ? 'checked' : ''}> <span><b>Pay in full only</b>: no deposit, no Afterpay.</span></label>
      <label class="j-check"><input type="checkbox" id="nt-only" ${nt.offerOnly ? 'checked' : ''}> <span><b>Only players with a price above</b> see it in My account.</span></label>
      <label class="j-check"><input type="checkbox" id="nt-open" ${nt.open ? 'checked' : ''}> <span><b>Open to every current family</b> in My account (Home, Fees and Keep my spot).</span></label>
      <button type="button" class="j-btn j-btn-dark j-btn-sm" id="nt-save" style="margin-top:8px">Save settings</button>
      <hr style="margin:16px 0;border:0;border-top:1px solid var(--j-line)">
      <p class="small muted">Invite ticked players by email (the old "Keep your place" email, not the offer text). Leave it unticked unless Lee has approved the email.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px"><button type="button" class="j-btn j-btn-line j-btn-sm" id="nt-all">Select everyone not paid</button><label class="j-check" style="padding:0"><input type="checkbox" id="nt-email"> <span>Email the families</span></label><button type="button" class="j-btn j-btn-dark j-btn-sm" id="nt-invite">Invite selected</button></div>
    </details>`
  const again = () => renderNext(ui)
  view().querySelectorAll('[data-nxf]').forEach((b) => b.addEventListener('click', () => { S.filter = b.dataset.nxf; again() }))
  $('nx-q')?.addEventListener('change', (e) => { S.q = e.target.value.trim().toLowerCase(); again() })
  $('nx-link')?.addEventListener('click', async () => { await copy(ACCOUNT_LINK); toast('Copied. Families sign in with their email and see their price under Keep my spot.') })
  view().querySelectorAll('[data-nxday]').forEach((b) => b.addEventListener('click', () => { S.day = b.dataset.nxday; again() }))
  view().querySelectorAll('[data-nxloc]').forEach((b) => b.addEventListener('click', () => { S.loc = b.dataset.nxloc; again() }))
  view().querySelectorAll('[data-nxv]').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.nxv; again() }))
  view().querySelectorAll('[data-nxmove]').forEach((b) => b.addEventListener('click', () => moveBox(ui, d, d.players.find((p) => p.rowId === b.dataset.nxmove), again)))
  view().querySelectorAll('[data-nxoffer]').forEach((b) => b.addEventListener('click', () => offerBox(ui, d, d.waitlist.find((w) => w.rowId === b.dataset.nxoffer), again)))
  view().querySelectorAll('[data-nxcopy]').forEach((b) => b.addEventListener('click', async () => { await copy(b.dataset.nxcopy); toast('Payment link copied.') }))
  view().querySelectorAll('[data-nxedit]').forEach((b) => b.addEventListener('click', () => editPrice(ui, d.players.find((p) => p.rowId === b.dataset.nxedit), again)))
  $('nt-save').addEventListener('click', async () => {
    if ($('nt-open').checked && !nt.open && !(await confirmBox(`Show ${esc(nt.name)} in every current family's My account now? Families with a price can pay straight away.`, { ok: 'Turn it on' }))) return
    const r = await post('saveNextTerm', { nextTerm: { name: $('nt-name').value.trim(), holdCents: Math.round(Number($('nt-hold').value) * 100), open: $('nt-open').checked, holdUntil: $('nt-until').value, offerUntil: $('nt-offer').value, fullOnly: $('nt-full').checked, offerOnly: $('nt-only').checked } })
    toast(r.ok ? 'Saved' : r.data.error); if (r.ok) again()
  })
  $('nt-all').addEventListener('click', () => view().querySelectorAll('[data-nt]:not(:disabled)').forEach((c) => { c.checked = true }))
  $('nt-invite').addEventListener('click', async (e) => {
    const rowIds = [...view().querySelectorAll('[data-nt]:checked')].map((c) => c.dataset.nt)
    if (!rowIds.length) return toast('Tick the players to invite.')
    if (!(await confirmBox(`Invite ${rowIds.length} player${rowIds.length === 1 ? '' : 's'}?${$('nt-email').checked ? ' Their families are emailed.' : ' No email is sent.'}`, { ok: 'Invite' }))) return
    e.target.disabled = true
    const r = await post('nextTermInvite', { rowIds, sendEmail: $('nt-email').checked })
    e.target.disabled = false
    toast(r.ok ? `${r.data.invited} invited${r.data.emailed ? `, ${r.data.emailed} emailed` : ''}` : r.data.error); again()
  })
  void modal; void closeModal
}

function editPrice(ui, p, done) {
  const { modal, closeModal, post, toast, confirmBox } = ui
  if (!p) return
  const o = p.offer || { tier: 'current', normalCents: 85000, offerCents: 80000, kind: 'One player', note: '' }
  const box = modal(`<h2 style="margin-bottom:6px">${esc(p.name)}</h2><p class="muted small" style="margin-bottom:12px">${esc(p.group)}. Two players or two sessions a week: enter each place's half (A$700 each = A$1,400).</p>
    <label class="j-field"><span>Offer</span><select class="j-select" id="op-tier"><option value="loyal" ${o.tier === 'loyal' ? 'selected' : ''}>Loyal 24: first week free</option><option value="current" ${o.tier === 'current' ? 'selected' : ''}>A$50 off per player</option></select></label>
    <div class="j-two"><label class="j-field"><span>Offer price A$</span><input class="j-input" id="op-offer" inputmode="decimal" value="${o.offerCents / 100}"></label><label class="j-field"><span>Normal price A$</span><input class="j-input" id="op-normal" inputmode="decimal" value="${o.normalCents / 100}"></label></div>
    <label class="j-field"><span>What it is</span><input class="j-input" id="op-kind" value="${esc(o.kind || '')}"></label>
    <label class="j-field"><span>Note for staff <span class="muted">(optional)</span></span><input class="j-input" id="op-note" value="${esc(o.note || '')}"></label>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:10px;flex-wrap:wrap">${p.offer && p.status !== 'paid' ? '<button type="button" class="j-btn j-btn-line" id="op-del">Remove the offer</button>' : '<span></span>'}<span style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="op-save">Save</button></span></div>`)
  const cents = (id) => Math.round(Number(box.querySelector(id).value) * 100)
  box.querySelector('#op-save').addEventListener('click', async () => {
    const r = await post('saveNextOffer', { rowId: p.rowId, tier: box.querySelector('#op-tier').value, offerCents: cents('#op-offer'), normalCents: cents('#op-normal'), kind: box.querySelector('#op-kind').value, note: box.querySelector('#op-note').value })
    if (!r.ok) return toast(r.data.error)
    closeModal(); toast('Saved'); done()
  })
  box.querySelector('#op-del')?.addEventListener('click', async () => {
    if (!(await confirmBox(`Remove ${esc(p.name)}'s offer price? They will not see ${esc('the offer')} in My account.`, { ok: 'Remove', danger: true, over: true }))) return
    const r = await post('saveNextOffer', { rowId: p.rowId, remove: true })
    if (!r.ok) return toast(r.data.error)
    closeModal(); toast('Removed'); done()
  })
}

// The Term 1 timetable (Ligia, 25 Nov 2026), drawn like the Term 4 one: days
// across, morning and afternoon down, a block per group with a coloured dot
// per player. Moves are for next term only.
const T1 = {
  paid: ['i-paid', 'Paid'], held: ['i-trial', 'Deposit paid'], keen: ['i-part', 'Wants to keep it'],
  unpaid: ['i-link', 'Not paid yet'], no: ['i-off', 'Not returning'],
}
const t1State = (p) => p.status === 'paid' ? 'paid' : p.status === 'held' ? 'held' : p.status === 'no' ? 'no' : p.interested && !p.status ? 'keen' : 'unpaid'
const T1DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const T1PERIODS = [['am', 'Morning'], ['pm', 'Afternoon']]
const T1ORDER = ['paid', 'held', 'keen', 'unpaid', 'no']
const nameRow = (p) => {
  const [dot, word] = T1[t1State(p)]
  return `<button type="button" class="jp-nm nt-nm${p.status === 'no' ? ' nt-out' : ''}" data-nxmove="${esc(p.rowId)}" title="${esc(`${p.name}: ${word}${p.status === 'paid' && p.paidCents ? ` ${money(p.paidCents)}` : ''}. Tap to move for next term.`)}"><i class="${dot}"></i><span class="nmx">${esc(p.name)}</span>${p.moved && p.t1GroupId ? '<span class="w nt-tag">moved</span>' : ''}</button>`
}
function t1Block(g, by, wait) {
  const ps = g.players.map((id) => by[id]).filter(Boolean).sort((a, b) => T1ORDER.indexOf(t1State(a)) - T1ORDER.indexOf(t1State(b)) || a.name.localeCompare(b.name))
  const left = g.capacity - g.taken
  const waiting = g.waiting.map((id) => wait[id]).filter(Boolean)
  return `<section class="jp-blk" style="--lc:var(--j-loc-${esc(g.locationId || 'belrose')})">
    <div class="jp-blk-head"><b>${esc(g.time)}</b><span class="n">${g.taken}/${g.capacity}</span></div>
    <div class="sub">${esc(g.coach || 'No coach')} · ${esc(g.location)}${g.paid ? ` · <b style="color:var(--j-green)">${g.paid} paid</b>` : ''}</div>
    ${ps.map(nameRow).join('')}
    ${g.news.map((x) => `<div class="jp-nm"><i class="${x.status === 'paid' ? 'i-paid' : 'i-part'}"></i><span class="nmx">${esc(x.player)}</span><span class="w nt-tag" title="${esc(x.status === 'paid' ? `New family, paid ${money(x.cents)}` : `New family, offered ${money(x.cents)}, not paid`)}">${x.status === 'paid' ? 'new' : 'offered'}</span>${x.url ? `<button type="button" class="nt-mini" data-nxcopy="${esc(x.url)}" title="Copy the payment link">link</button>` : ''}</div>`).join('')}
    ${left > 0 ? `<div class="jp-open">+ ${left} open</div>` : left < 0 ? `<div class="jp-open" style="color:var(--j-red)">${-left} over capacity</div>` : '<div class="jp-open" style="color:var(--j-red)">Full</div>'}
    ${waiting.length ? `<div class="jp-wait small">Waitlist: ${waiting.map((w) => `<span class="nt-w">${esc(w.name)} <button type="button" class="nt-mini" data-nxoffer="${esc(w.rowId)}">Offer</button></span>`).join(' ')}</div>` : ''}
  </section>`
}
function timetableHtml(d) {
  const by = Object.fromEntries(d.players.map((p) => [p.rowId, p]))
  const wait = Object.fromEntries((d.waitlist || []).map((w) => [w.rowId, w]))
  const all = d.timetable || []
  const locs = [...new Map(all.map((g) => [g.locationId, g.location])).entries()]
  const groups = all.filter((g) => (!S.day || g.day === S.day) && (!S.loc || g.locationId === S.loc))
  const noDay = (d.noDay || []).map((id) => by[id]).filter(Boolean)
  const cols = T1DAYS.filter((x) => groups.some((g) => g.day === x))
  const periods = T1PERIODS.filter(([p]) => groups.some((g) => g.period === p))
  const cell = (day, p) => groups.filter((g) => g.day === day && g.period === p).sort((a, b) => String(a.sortTime).localeCompare(String(b.sortTime))).map((g) => t1Block(g, by, wait)).join('')
  const grid = !cols.length ? '<div class="j-empty">No groups match.</div>'
    : S.day ? periods.map(([p, label]) => `<div class="j-tt-row" style="margin:6px 0 8px">${esc(S.day)} ${esc(label.toLowerCase())}</div><div class="jp-board" style="margin-bottom:14px">${cell(S.day, p)}</div>`).join('')
    : `<div class="jp-tt" style="--cols:${cols.length}">${cols.map((x) => `<div class="j-tt-day">${esc(x)}</div>`).join('')}${periods.map(([p, label]) => `<div class="j-tt-row">${esc(label)}</div>${cols.map((x) => `<div class="j-tt-cell">${cell(x, p)}</div>`).join('')}`).join('')}</div>`
  const tot = all.reduce((s, g) => ({ paid: s.paid + g.paid, taken: s.taken + g.taken }), { paid: 0, taken: 0 })
  return `<p class="muted small" style="margin:6px 0 10px">${tot.paid} paid of ${tot.taken} places taken for ${esc(d.nextTerm.name)}. Tap a name to move them for ${esc(d.nextTerm.name)} only; their current term stays as it is.</p>
    <div class="j-daybar" style="margin-bottom:10px">${[['', 'Whole week'], ...T1DAYS.filter((x) => all.some((g) => g.day === x)).map((x) => [x, x])].map(([v, l]) => `<button type="button" data-nxday="${esc(v)}" aria-selected="${(S.day || '') === v}">${esc(l)}</button>`).join('')}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <div class="jp-seg">${[['', 'All locations'], ...locs].map(([v, l]) => `<button type="button" data-nxloc="${esc(v)}" aria-pressed="${(S.loc || '') === v}">${esc(l)}</button>`).join('')}</div>
      <div class="jp-legend" style="margin-left:auto">${Object.values(T1).map(([dot, word]) => `<span><i class="${dot}"></i>${word}</span>`).join('')}</div>
    </div>
    ${noDay.length ? `<div class="j-box j-box-amber nt-noday" style="margin-bottom:12px"><b>Day not picked yet</b> <span class="small">No place held in any group. Tap a name to put them in a group once the family picks a day.</span><div class="nt-nodaylist">${noDay.map(nameRow).join('')}</div></div>` : ''}
    <div class="jp-tt-wrap">${grid}</div>`
}
function moveBox(ui, d, p, done) {
  if (!p) return
  const { modal, closeModal, post, toast } = ui
  const opts = d.groupChoices.map((g) => `<option value="${esc(g.id)}" ${g.id === p.t1GroupId ? 'selected' : ''}>${esc(g.label)}${g.id === p.groupId ? ' (their group now)' : ''}</option>`).join('')
  const box = modal(`<h2 style="margin-bottom:6px">${esc(p.name)} in ${esc(d.nextTerm.name)}</h2><p class="muted small" style="margin-bottom:12px">Now: ${esc(p.group)}. This changes ${esc(d.nextTerm.name)} only.</p>
    <label class="j-field"><span>Group for ${esc(d.nextTerm.name)}</span><select class="j-input" id="mv-g"><option value="nogroup" ${p.moved && !p.t1GroupId ? 'selected' : ''}>Day not picked yet (holds no place)</option>${opts}</select></label>
    <div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="j-btn j-btn-dark j-btn-sm" id="mv-save">Save</button><button type="button" class="j-btn j-btn-line j-btn-sm" id="mv-x">Cancel</button></div>`)
  box.querySelector('#mv-x').addEventListener('click', closeModal)
  box.querySelector('#mv-save').addEventListener('click', async (e) => {
    e.target.disabled = true
    const v = box.querySelector('#mv-g').value
    const r = await post('moveNextTerm', { rowId: p.rowId, groupId: v === p.groupId ? '' : v })
    e.target.disabled = false
    if (!r.ok) return toast(r.data.error)
    closeModal(); toast('Moved for ' + d.nextTerm.name); done()
  })
}
async function offerBox(ui, d, w, done) {
  if (!w) return
  const { modal, closeModal, post, toast, confirmBox } = ui
  const pv = await post('offerWaitlist', { rowId: w.rowId, groupId: w.groupId, amountCents: d.newPriceCents })
  if (!pv.ok) return toast(pv.data.error)
  const v = pv.data.preview
  const box = modal(`<h2 style="margin-bottom:6px">Offer ${esc(w.name)} a place</h2><p class="muted small" style="margin-bottom:10px">${esc(v.group)}, ${esc(d.nextTerm.name)}. The family gets this email with a link to pay (no sign in). The place is held for 7 days. Replies go to Ligia.</p>
    <label class="j-field"><span>Price (A$)</span><input class="j-input" id="ow-a" inputmode="decimal" value="${(v.amountCents / 100).toFixed(0)}" style="max-width:140px"></label>
    <div class="nt-email"><div class="small muted">To ${esc(v.to)} (${esc(v.emailMasked)})</div><div><b>${esc(v.subject)}</b></div>${v.paras.map((x) => `<p>${esc(x)}</p>`).join('')}<p><span class="j-btn j-btn-dark j-btn-sm" aria-hidden="true">Pay ${esc(v.amountLabel)}</span></p></div>
    <p class="muted small">The email and link use the price above.</p>
    <div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="j-btn j-btn-dark j-btn-sm" id="ow-send">Send the offer</button><button type="button" class="j-btn j-btn-line j-btn-sm" id="ow-x">Cancel</button></div>`)
  box.querySelector('#ow-x').addEventListener('click', closeModal)
  box.querySelector('#ow-send').addEventListener('click', async (e) => {
    const cents = Math.round(Number(box.querySelector('#ow-a').value) * 100)
    if (!(cents >= 100)) return toast('Enter the price in dollars.')
    e.target.disabled = true
    let r = await post('offerWaitlist', { rowId: w.rowId, groupId: w.groupId, amountCents: cents, send: true })
    if (!r.ok && r.data.code === 'full' && (await confirmBox(r.data.error, { ok: 'Offer anyway' }))) r = await post('offerWaitlist', { rowId: w.rowId, groupId: w.groupId, amountCents: cents, send: true, force: true })
    e.target.disabled = false
    if (!r.ok) return toast(r.data.error)
    closeModal(); toast(r.data.emailed ? `Offer emailed: ${r.data.payreq.amountLabel}` : (r.data.emailError || 'Offer made')); done()
  })
}
