// Add a family in one go (round 2, Lee 14 Oct 2026): "a brother and sister,
// one invite to the parent". Used two ways:
//   Timetable > Add a player > "+ Add another child (same family)": more
//     children in the same form, each with their own group, name, date of
//     birth and price; the parent contact is the one already typed.
//   Players tab > "Add a family": the same, with the parent first and no
//     group needed (a child can wait for a group).
// One request (addFamily) adds every row, makes ONE payment for every child
// with a price to pay, and sends ONE email to the parent.
//
// ui: { post, modal, closeModal, toast, copy, confirmBox, textComposer,
//       priceBlock, dateOptions, nextDate, customPrices, board(), pricing(), after() }
import { esc, money } from './jfp-common.js'
import { quoteHtml, wireQuote } from './jfp-portal-quote.js'
import { findExisting } from './jfp-portal-removed.js'

const PAYS = [
  ['link', 'A price: on the one family payment (pick it below)'],
  ['sessions', 'Session by session: their own price a session'],
  ['pro', 'Pro session: Pro sessions price a session'],
  ['trial', 'Free trial, no payment'],
  ['offline', 'Already paid offline'],
  ['none', 'Decide later'],
]
const dollars = (c) => (c / 100).toFixed(2).replace(/\.00$/, '')
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || ''
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const both = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] || '')

// Every JFP group (hidden ones too: staff add to those); never Joners Juniors.
export const familyGroups = (board, isJJ = () => false) => (board?.groups || []).filter((g) => !isJJ(g) && !/joners juniors/i.test(g.label || ''))
const groupLabel = (g) => `${g.day} ${g.time} · ${g.locationName || g.location}`
function groupOptions(groups, selected, noGroup) {
  return `${noGroup ? `<option value=""${selected ? '' : ' selected'}>No group yet</option>` : ''}${groups.map((g) => `<option value="${esc(g.id)}"${g.id === selected ? ' selected' : ''}>${esc(groupLabel(g))}${g.capacity ? ` (${Math.max(0, g.capacity - (g.players?.length || 0))} left)` : ''}</option>`).join('')}`
}

// One child: group, name, date of birth, how they pay.
export function childBlockHtml(px, n, { groups, groupId = '', noGroup = false, removable = true }) {
  return `<section class="jpf-child" data-child-block="${esc(px)}" style="border:1px solid var(--j-line,#e5e7eb);border-radius:12px;padding:12px 14px;margin:12px 0">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0" data-child-title>Child ${n}</h3>${removable ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-child-rm="${esc(px)}">Remove</button>` : ''}</div>
    <div class="j-two"><label class="j-field"><span>Full name</span><input class="j-input" id="${px}-name" autocomplete="off"></label>
    <label class="j-field"><span>Date of birth <span class="muted">(optional)</span></span><input class="j-input" id="${px}-dob" type="date"></label></div>
    <label class="j-field"><span>Group</span><select class="j-select" id="${px}-group">${groupOptions(groups, groupId, noGroup)}</select></label>
    <label class="j-field"><span>Payment</span><select class="j-select" id="${px}-pay">${PAYS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
    <div id="${px}-price"></div>
    <label class="j-field" id="${px}-trial-wrap" hidden><span>Trial date</span><select class="j-select" id="${px}-trial"></select></label>
    <label class="j-field" id="${px}-per-wrap" hidden><span>Price per session (A$) <span class="muted">(optional, or set it when you bill)</span></span><input class="j-input" id="${px}-per" inputmode="decimal" placeholder="e.g. 80"></label>
    <div id="${px}-qwrap"></div>
    <p class="muted small" id="${px}-hint" style="margin:4px 0 0"></p>
  </section>`
}

// Wires one child block. read() gives the child's part of addFamily, or { error }.
export function wireChild(box, px, ui, pr, { groups, onChange = () => {} }) {
  const $ = (id) => box.querySelector(`#${px}-${id}`)
  const group = () => groups.find((g) => g.id === $('group').value) || null
  $('qwrap').innerHTML = quoteHtml(px, { defaultQuote: pr.defaultQuote, run: pr.runs?.noGroup })
  const quote = wireQuote(box, px, { perInput: $('per'), defaultQuote: pr.defaultQuote, run: pr.runs?.noGroup })
  let readPrice = () => ({})
  let prefilled = false
  const drawPrice = () => {
    const g = group()
    readPrice = ui.priceBlock(box, pr, { day: g?.day, product: g?.product || 'group', prefix: `${px}-price`, custom: true })
    // One payment for the family: its Afterpay box is the family's, below.
    $('price-afterpay')?.closest('label')?.setAttribute('hidden', '')
    $('price-prod').addEventListener('change', (e) => {
      const p = ui.customPrices(pr).find((x) => `price:${x.id}` === e.target.value)
      if (p?.perSession) { $('pay').value = p.programme === 'pro' ? 'pro' : 'sessions'; $('per').value = dollars(p.cents); watch() }
    })
    $('trial').innerHTML = g ? ui.dateOptions(pr, g.day, ui.nextDate(pr, g.day)) : ''
    quote.setRun(g ? pr.runs?.byGroup?.[g.id] : pr.runs?.noGroup)
  }
  const watch = () => {
    const v = $('pay').value
    const g = group()
    const trialOpt = $('pay').querySelector('option[value="trial"]')
    trialOpt.disabled = !g
    if (v === 'trial' && !g) $('pay').value = 'none'
    const pay = $('pay').value
    $('price').hidden = !['link', 'offline'].includes(pay)
    $('per-wrap').hidden = !['sessions', 'pro'].includes(pay)
    quote.show(['sessions', 'pro'].includes(pay))
    $('trial-wrap').hidden = pay !== 'trial'
    if (pay === 'pro' && pr.defaultQuote && !prefilled && !$('per').value.trim()) { prefilled = true; $('per').value = dollars(pr.defaultQuote.perCents); quote.set(pr.defaultQuote.tiers) }
    $('hint').textContent = pay === 'link' ? 'Goes on the one family payment, at this price.' : ['sessions', 'pro'].includes(pay) ? 'Pays from the family account: the next session, more ahead, or the rest of the term.' : pay === 'trial' ? 'No payment. The coach sees it as a trial.' : pay === 'none' ? 'Nothing to pay until you set a price.' : ''
    onChange()
  }
  $('group').addEventListener('change', () => { drawPrice(); watch() })
  $('pay').addEventListener('change', watch)
  $('name').addEventListener('input', () => onChange())
  drawPrice()
  watch()
  const read = () => {
    const name = $('name').value.trim()
    if (name.length < 3) return { error: "Enter each child's full name." }
    const payment = $('pay').value
    const g = group()
    const out = { groupId: g?.id || '', player: { name, dob: $('dob').value }, payment }
    // Picked from Find an existing player as a removed player: they are back.
    if ($('name').dataset.fromRemoved && norm(name) === norm($('name').dataset.removedName)) out.fromRemoved = $('name').dataset.fromRemoved
    if (['link', 'offline'].includes(payment)) {
      const pv = readPrice()
      if (!(pv.amountCents > 0)) return { error: `Enter ${firstName(name)}'s price.` }
      Object.assign(out, pv)
      delete out.afterpay
      // A later start (the start date chosen for the price) counts for the dates too.
      if (pv.startDate) out.startsFrom = pv.startDate
      if (payment === 'offline') out.method = 'Offline'
    }
    if (payment === 'trial') out.startDate = $('trial').value
    if (['sessions', 'pro'].includes(payment)) {
      const per = $('per').value.trim()
      if (per) {
        out.perSessionCents = Math.round(Number(per) * 100)
        if (!(out.perSessionCents >= 100)) return { error: `Enter ${firstName(name)}'s price per session in dollars, for example 80.` }
      }
      const qt = quote.read()
      if (qt.error) return { error: `${firstName(name)}: ${qt.error}` }
      if (qt.tiers.length) out.quote = { tiers: qt.tiers }
    }
    return out
  }
  return { read, name: () => $('name').value.trim(), payment: () => $('pay').value }
}

// The children list inside a form: add, remove, renumber, read all.
export function childList(box, ui, pr, { mount, groups, groupId = '', noGroup = false, start = 0, firstNumber = 1, onChange = () => {} }) {
  const kids = []
  let seq = 0
  const renumber = () => { mount.querySelectorAll('[data-child-title]').forEach((h, i) => { h.textContent = `Child ${i + firstNumber}` }); onChange() }
  const add = () => {
    seq += 1
    const px = `${mount.id}-k${seq}`
    mount.insertAdjacentHTML('beforeend', childBlockHtml(px, kids.length + firstNumber, { groups, groupId, noGroup }))
    kids.push({ px, ...wireChild(box, px, ui, pr, { groups, onChange }) })
    renumber()
    box.querySelector(`#${px}-name`)?.focus()
  }
  mount.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-child-rm]')
    if (!rm) return
    const i = kids.findIndex((k) => k.px === rm.dataset.childRm)
    if (i >= 0) kids.splice(i, 1)
    rm.closest('[data-child-block]').remove()
    renumber()
  })
  for (let i = 0; i < start; i += 1) add()
  return { add, kids, count: () => kids.length, read: () => kids.map((k) => k.read()) }
}

// Send it. children already read. Returns true when done (the form closes).
export async function submitFamily(ui, body, { onBusy = () => {} } = {}) {
  let r = await ui.post('addFamily', body)
  if (r.status === 409 && r.data.code === 'full') {
    // The confirm replaces the form: after it, anything wrong is a toast.
    if (!(await ui.confirmBox(esc(r.data.error), { ok: 'Add anyway' }))) return { ok: false, closed: true }
    r = await ui.post('addFamily', { ...body, force: true })
    if (!r.ok) { ui.toast(r.data.error || 'Could not add the family.'); return { ok: false, closed: true } }
  }
  onBusy(false)
  if (!r.ok) return { ok: false, error: r.data.error || 'Could not add the family.', rowId: r.data.code === 'duplicate' ? r.data.rowId : '' }
  ui.closeModal()
  familyDone(ui, r.data, body)
  ui.after?.()
  return { ok: true }
}

function familyText({ parent, names, url, amountLabel }) {
  return `Hi ${firstName(parent)}, it's Lee from Joner Football. ${both(names.map(firstName))} ${names.length > 1 ? 'are' : 'is'} booked in. Sign in at ${url} with your email to sign the ${names.length > 1 ? 'waivers' : 'waiver'}${amountLabel ? ` and pay ${amountLabel} in one payment` : ''}. We send you a 6 digit code, no password needed. See you on the pitch!`
}

// What staff see after: every child, the one payment link, Copy and Text.
export function familyDone(ui, d, body) {
  const names = d.rows.map((x) => x.name)
  const url = d.payreq?.url || ''
  const sent = d.emailed ? `One email sent to ${esc(d.emailTo)}.` : d.emailError ? `<b>The email did not send:</b> ${esc(d.emailError)}` : 'No email sent.'
  const box = ui.modal(`<h2 style="margin-bottom:6px">${names.length > 1 ? `${names.length} children added` : 'Child added'}</h2>
    <p class="muted small" style="margin-bottom:10px">One family account for ${esc(body.parent.email)}. ${sent}${d.profileError ? ` <b>${esc(d.profileError)}</b>` : ''}</p>
    <ul class="jm-hist" style="margin-bottom:12px">${d.rows.map((x) => `<li><span><b>${esc(x.name)}</b><small>${esc(x.where)}${x.amountLabel ? ` · ${esc(x.amountLabel)} on the family payment` : ''}</small></span></li>`).join('')}</ul>
    ${url ? `<label class="j-field"><span>Family payment link, ${esc(d.payreq.amountLabel)} for everyone</span><input class="j-input" value="${esc(url)}" readonly></label>` : ''}
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button>${url ? '<button type="button" class="j-btn j-btn-line" id="fd-copy">Copy link</button>' : ''}<button type="button" class="j-btn j-btn-dark" id="fd-text" ${body.parent.mobile ? '' : 'disabled title="No mobile entered"'}>Text the parent</button></div>`)
  box.querySelector('#fd-copy')?.addEventListener('click', () => ui.copy(url))
  box.querySelector('#fd-text').addEventListener('click', () => {
    ui.closeModal()
    ui.textComposer({ modal: ui.modal, toast: ui.toast, rowIds: d.rows.map((x) => x.rowId), parent: body.parent.name, mobile: body.parent.mobile, text: familyText({ parent: body.parent.name, names, url: url || 'jonerfootball.com/jfp-account', amountLabel: d.payreq?.amountLabel || '' }), title: 'Text the parent' })
  })
}

// Players tab > Add a family: the parent first, then two children (more if
// needed), no group required.
export async function familyModal(ui) {
  const pr = await ui.pricing()
  const groups = familyGroups(await ui.board(), ui.isJJ)
  const box = ui.modal(`<h2 style="margin-bottom:4px">Add a family</h2>
    <p class="muted small" style="margin-bottom:12px">Brothers and sisters in one go: one parent, one account, one email and one payment for every child with a price. Each child keeps their own group and price. A child with no group yet takes no place until you put them in one.</p>
    <label class="j-field"><span>Find an existing player <span class="muted">(Term 4, removed players, Term 3 or waivers)</span></span><input class="j-input" id="fa-search" placeholder="Start typing a name" autocomplete="off"></label>
    <div id="fa-results"></div>
    <h3>Parent</h3>
    <div class="j-two"><label class="j-field"><span>Parent name</span><input class="j-input" id="fa-pname" autocomplete="off"></label>
    <label class="j-field"><span>Parent mobile</span><input class="j-input" id="fa-pmobile" type="tel" inputmode="tel" autocomplete="off"></label></div>
    <label class="j-field"><span>Parent email <span class="muted">(the family signs in with it)</span></span><input class="j-input" id="fa-pemail" type="email" inputmode="email" autocomplete="off"></label>
    <h3 style="margin-top:12px">Children</h3>
    <div id="fa-kids"></div>
    <button type="button" class="j-btn j-btn-line j-btn-sm" id="fa-more">+ Add another child</button>
    <label class="j-check" style="margin-top:10px"><input type="checkbox" id="fa-afterpay" checked> <span>Afterpay allowed on the family payment</span></label>
    <label class="j-check"><input type="checkbox" id="fa-send" checked> <span>Email the parent now: every child, the waivers to sign, one payment</span></label>
    <p class="j-err" id="fa-err" hidden></p>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="fa-go">Add the family</button></div>`, { wide: true })
  const $ = (id) => box.querySelector(`#${id}`)
  let list = null
  const relabel = () => { const n = list ? list.count() : 0; const go = $('fa-go'); if (!go.disabled) go.textContent = `Add ${n} ${n === 1 ? 'child' : 'children'}${$('fa-send').checked ? ' and email the parent' : ''}` }
  list = childList(box, ui, pr, { mount: $('fa-kids'), groups, noGroup: true, start: 2, onChange: () => relabel() })
  $('fa-more').addEventListener('click', () => list.add())
  // A picked player (removed ones too) fills the parent and the next empty child.
  findExisting(box, { post: ui.post, toast: ui.toast, input: $('fa-search'), results: $('fa-results'), form: { fill: (x) => {
    if (x.ownContact) return ui.toast(`${x.name} is their own contact, with no parent. Add them with Add a player instead.`)
    for (const [id, v] of [['fa-pname', x.parentName], ['fa-pemail', x.email], ['fa-pmobile', x.mobile]]) if (v) $(id).value = v
    let k = list.kids.find((c) => !box.querySelector(`#${c.px}-name`).value.trim())
    if (!k) { list.add(); k = list.kids.at(-1) }
    const name = box.querySelector(`#${k.px}-name`)
    name.value = x.name || ''
    name.dataset.fromRemoved = x.fromRemoved || ''
    name.dataset.removedName = x.name || ''
    if (x.dob) box.querySelector(`#${k.px}-dob`).value = x.dob
    const gsel = box.querySelector(`#${k.px}-group`)
    if (x.removed?.groupId && [...gsel.options].some((o) => o.value === x.removed.groupId)) { gsel.value = x.removed.groupId; gsel.dispatchEvent(new Event('change')) }
    relabel()
  } } })
  $('fa-send').addEventListener('change', relabel)
  relabel()
  let busy = false
  $('fa-go').addEventListener('click', async () => {
    if (busy) return
    const err = $('fa-err'); err.hidden = true
    const parent = { name: $('fa-pname').value.trim(), email: $('fa-pemail').value.trim(), mobile: $('fa-pmobile').value.trim() }
    if (parent.name.length < 2) { err.textContent = "Enter the parent's name."; err.hidden = false; return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parent.email)) { err.textContent = 'Enter the parent email. The whole family signs in with it.'; err.hidden = false; return }
    const children = list.read()
    const bad = children.find((c) => c.error)
    if (bad) { err.textContent = bad.error; err.hidden = false; return }
    if (!children.length) { err.textContent = 'Add at least one child.'; err.hidden = false; return }
    busy = true; $('fa-go').disabled = true; $('fa-go').textContent = 'Adding'
    const out = await submitFamily(ui, { parent, children, sendEmail: $('fa-send').checked, afterpay: $('fa-afterpay').checked })
    busy = false
    if (out.ok || out.closed) return
    $('fa-go').disabled = false; relabel()
    err.textContent = out.error; err.hidden = false
  })
}

export { money }
