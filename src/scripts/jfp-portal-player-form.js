// One player form for Add (Timetable and Players tab) and Edit (Lee, 13 Oct
// 2026: "Add a player = as detailed as Edit", so staff never add, then find,
// then edit). The player, their contact (a parent, or the player as their own
// contact), player information (club, level, positions, emergency, medical),
// and how they pay.
//
// Ids are `${px}-name`, `${px}-dob`, `${px}-own`, `${px}-parent`, `${px}-mobile`,
// `${px}-email` and so on, so the Timetable add keeps its ap-* ids.
import { esc, money } from './jfp-common.js'
import { contactWords, isAdult } from '../../api/_jfp-contact.js'

export const PROFILE_LISTS = {
  levels: ['A-League academy', 'NPL', 'Youth league (BYL or GYL)', 'JDL (was SAP)', 'Club Division 1', 'Club Division 2', 'Club Division 3 or lower', 'School or social only', 'Not playing club football'],
  playingUp: ['Own age', 'Playing up', 'Playing down'],
  positions: ['Goalkeeper', 'Centre back', 'Full back', 'Defensive midfield', 'Central midfield', 'Attacking midfield', 'Winger', 'Striker'],
  feet: ['Right', 'Left', 'Both'],
  years: ['Under 1 year', '1 to 2 years', '3 to 4 years', '5 or more years'],
}
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })

const sel = (id, list, cur, blank) => `<select class="j-select" id="${id}"><option value="">${blank}</option>${list.map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`
const txt = (id, label, val, extra = '') => `<label class="j-field"><span>${label}</span><input class="j-input" id="${id}" value="${esc(val || '')}" ${extra}></label>`
const opt = '<span class="muted">(optional)</span>'

// row: { name, parent, email, phone, ownContact } (Edit) or {} (Add).
// v: profile values (with any waiver prefill). add: true on the Add forms.
export function playerFormHtml(px, { row = {}, v = {}, opts = {}, add = false } = {}) {
  const o = { ...PROFILE_LISTS, ...opts }
  const own = row.ownContact === true
  const w = contactWords({ self: own, players: [row.name || ''], parent: row.parent || '' })
  const fold = (title, inner, open) => `<details class="jq-fold jpf-fold" ${open ? 'open' : ''}><summary>${title}</summary>${inner}</details>`
  return `<div class="jpf" id="${px}-form">
    <h3>Player</h3>
    <div class="j-two">${txt(`${px}-name`, "Player's full name", row.name, 'autocomplete="off"')}${txt(`${px}-dob`, `Date of birth ${add ? opt : ''}`, v.dob, 'type="date"')}</div>
    <label class="j-check"><input type="checkbox" id="${px}-own" ${own ? 'checked' : ''}> <span><b>Player is their own contact</b><br><span class="muted small">No parent. Their own email and mobile, and every email and text goes to them. Adults (18 or over) are ticked for you.</span></span></label>
    <p class="muted small" id="${px}-own-hint" hidden></p>
    <h3 id="${px}-contact-h">${own ? 'Contact' : 'Parent and contact'}</h3>
    <div class="j-two"><span id="${px}-parent-wrap" ${own ? 'hidden' : ''}>${txt(`${px}-parent`, `Parent name ${add ? opt : ''}`, own ? '' : row.parent, 'autocomplete="off"')}</span>${txt(`${px}-mobile`, `<span id="${px}-mobile-l">${esc(w.mobileLabel)}</span> ${add ? opt : ''}`, row.phone, 'type="tel" inputmode="tel"')}</div>
    ${txt(`${px}-email`, `<span id="${px}-email-l">${esc(w.emailLabel)}</span>`, row.email, 'type="email" inputmode="email" autocomplete="off"')}
    <div id="${px}-p2" ${own ? 'hidden' : ''}>
      <div class="j-two">${txt(`${px}-p2name`, `Second parent ${opt}`, v.parent2Name)}${txt(`${px}-p2mob`, 'Second parent mobile', v.parent2Mobile, 'type="tel" inputmode="tel"')}</div>
      ${txt(`${px}-p2email`, `Second parent email ${opt}`, v.parent2Email, 'type="email" inputmode="email"')}
    </div>
    ${fold(`Football${add ? ': club, level, positions (optional)' : ''}`, `
      <div class="j-two">${txt(`${px}-club`, 'Club', v.club, `placeholder="For example, Manly United" list="${px}-clubs" autocomplete="off"`)}${txt(`${px}-team`, 'Team and age group', v.team, 'placeholder="For example, U13 Div 1"')}</div>
      <datalist id="${px}-clubs">${(o.clubs || []).map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="j-two">${txt(`${px}-assoc`, `Association ${opt}`, v.association, 'placeholder="For example, MWFA or NWSF"')}${txt(`${px}-prev`, `Previous clubs ${opt}`, v.previousClubs)}</div>
      <div class="j-two"><label class="j-field"><span>Years playing</span>${sel(`${px}-years`, o.years, v.yearsPlaying, 'Not known')}</label>${txt(`${px}-rep`, `Rep, academy or squads ${opt}`, v.repTeam, 'placeholder="For example, Manly United academy"')}</div>
      ${txt(`${px}-other`, `Other training each week ${opt}`, v.otherTraining, 'placeholder="For example, futsal on Mondays"')}
      <div class="j-two"><label class="j-field"><span>Level</span>${sel(`${px}-level`, o.levels, v.level, 'Not known')}</label><label class="j-field"><span>Plays</span>${sel(`${px}-up`, o.playingUp, v.playingUp, 'Not known')}</label></div>
      <div class="j-field"><span>Positions</span><div class="j-chips jpf-pos" style="flex-wrap:wrap" id="${px}-pos">${o.positions.map((x) => `<button type="button" class="j-chip" data-pos="${esc(x)}" aria-pressed="${(v.positions || []).includes(x)}">${esc(x)}</button>`).join('')}</div></div>
      <label class="j-field"><span>Stronger foot</span>${sel(`${px}-foot`, o.feet, v.foot, 'Not known')}</label>
      <label class="j-field"><span>What they want to work on ${opt}</span><textarea class="j-textarea" id="${px}-goals" rows="2">${esc(v.goals || '')}</textarea></label>`, !add)}
    ${fold(`Emergency and medical${add ? ' (optional)' : ''}`, `
      <div class="j-two">${txt(`${px}-ename`, 'Emergency contact', v.emergencyName)}${txt(`${px}-ephone`, 'Their phone', v.emergencyPhone, 'type="tel" inputmode="tel"')}</div>
      ${txt(`${px}-erel`, `Relationship ${opt}`, v.emergencyRelation, 'placeholder="For example, grandparent"')}
      <label class="j-field"><span>Medical notes ${opt}</span><textarea class="j-textarea" id="${px}-med" rows="2">${esc(v.medical || '')}</textarea></label>`, !add)}
    ${add ? `<label class="j-field"><span>Note for Airtable ${opt}</span><input class="j-input" id="${px}-note" maxlength="300" placeholder="For example, agreed with Lee on the phone"></label>` : ''}
  </div>`
}

// Profile values and the form field each one fills.
const PROFILE_IDS = { club: 'club', team: 'team', association: 'assoc', previousClubs: 'prev', yearsPlaying: 'years', repTeam: 'rep', otherTraining: 'other', level: 'level', playingUp: 'up', foot: 'foot', goals: 'goals', emergencyName: 'ename', emergencyPhone: 'ephone', emergencyRelation: 'erel', medical: 'med', parent2Name: 'p2name', parent2Mobile: 'p2mob', parent2Email: 'p2email' }

// Wires the own-contact switch (labels, hidden parent fields, the adult
// suggestion from the date of birth). onChange(words) lets the caller relabel
// its buttons ("Add and email Kai"). Returns read(): { row, values, ownContact, note }.
export function wirePlayerForm(box, px, { onChange = () => {}, today = todayIso() } = {}) {
  const $ = (id) => box.querySelector(`#${px}-${id}`)
  let touched = false
  const words = () => contactWords({ self: $('own').checked, players: [$('name').value.trim()], parent: $('parent').value.trim() })
  const apply = () => {
    const w = words()
    $('parent-wrap').hidden = w.self
    $('p2').hidden = w.self
    $('contact-h').textContent = w.self ? 'Contact' : 'Parent and contact'
    $('email-l').textContent = w.emailLabel
    $('mobile-l').textContent = w.mobileLabel
    onChange(w)
  }
  const suggest = () => {
    const dob = $('dob').value
    const hint = $('own-hint')
    if (isAdult(dob, today)) {
      if (!touched && !$('own').checked) { $('own').checked = true; apply() }
      hint.hidden = false
      hint.textContent = $('own').checked ? '18 or over, so they are set as their own contact. Untick if a parent looks after it.' : '18 or over. Tick "Player is their own contact" if there is no parent.'
    } else hint.hidden = true
  }
  $('own').addEventListener('change', () => { touched = true; apply(); suggest() })
  $('dob').addEventListener('change', suggest)
  $('dob').addEventListener('input', suggest)
  for (const id of ['name', 'parent']) $(id).addEventListener('input', () => onChange(words()))
  $('pos').addEventListener('click', (e) => { const b = e.target.closest('[data-pos]'); if (b) b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')) })
  apply(); suggest()
  const val = (id) => ($(id)?.value || '').trim()
  return {
    words,
    // A picked existing player fills the contact fields.
    // A removed player added back (Lee, 14 Oct 2026) also brings their own
    // contact flag and player information (x.ownContact, x.profile).
    fill(x) {
      $('name').value = x.name || ''
      $('dob').value = x.dob || x.profile?.dob || ''
      $('parent').value = x.parentName || ''
      $('mobile').value = x.mobile || ''
      $('email').value = x.email || ''
      if (typeof x.ownContact === 'boolean') { $('own').checked = x.ownContact; touched = true }
      if (x.profile) {
        const v = x.profile
        for (const [k, id] of Object.entries(PROFILE_IDS)) if (v[k] && $(id)) $(id).value = v[k]
        box.querySelectorAll(`#${px}-pos [data-pos]`).forEach((b) => b.setAttribute('aria-pressed', String((v.positions || []).includes(b.dataset.pos))))
      }
      suggest(); apply()
    },
    read() {
      const own = $('own').checked
      const row = { name: val('name'), parent: own ? '' : val('parent'), email: val('email'), phone: val('mobile') }
      const values = {
        dob: val('dob'), club: val('club'), team: val('team'), level: val('level'), playingUp: val('up'), foot: val('foot'),
        association: val('assoc'), previousClubs: val('prev'), yearsPlaying: val('years'), repTeam: val('rep'), otherTraining: val('other'),
        positions: [...box.querySelectorAll(`#${px}-pos [data-pos][aria-pressed="true"]`)].map((b) => b.dataset.pos),
        emergencyName: val('ename'), emergencyPhone: val('ephone'), emergencyRelation: val('erel'), medical: val('med'), goals: val('goals'),
        ...(own ? {} : { parent2Name: val('p2name'), parent2Mobile: val('p2mob'), parent2Email: val('p2email'), parentName: row.parent, parentMobile: row.phone }),
      }
      return { row, values, ownContact: own, note: val('note') }
    },
  }
}

// Only the profile values someone typed (an Add form sends no empty fields).
export function filledValues(values) {
  return Object.fromEntries(Object.entries(values).filter(([, x]) => (Array.isArray(x) ? x.length : x !== '' && x != null)))
}

// ---------- how they pay ----------

const centsOf = (t) => { const x = String(t ?? '').replace(/[a$,\s]/gi, ''); return x === '' ? null : Math.round(Number(x) * 100) }
// Lee's own prices from Money > Prices (not archived, not the JFP list).
export const customPrices = (pr) => (pr?.priceList || []).filter((p) => !p.builtin && !p.archived)
export function customOptions(pr, selected = '') {
  const list = customPrices(pr)
  if (!list.length) return ''
  const groups = (pr.programmes || []).map((g) => ({ ...g, list: list.filter((p) => p.programme === g.id) })).filter((g) => g.list.length)
  return groups.map((g) => `<optgroup label="${esc(g.label)}">${g.list.map((p) => `<option value="price:${esc(p.id)}" ${selected === `price:${p.id}` ? 'selected' : ''}>${esc(p.name)} · ${esc(p.amountLabel || money(p.cents))}${p.perSession ? ' a session' : ''}</option>`).join('')}</optgroup>`).join('')
}

// The payment block for the Players tab add (no group): what they pay and how.
// Returns read(): the body fields for addPlayerNoGroup, or { error }.
export function noGroupPaymentHtml(px, pr) {
  return `<h3>Payment</h3>
    <label class="j-field"><span>How they pay</span><select class="j-select" id="${px}-pay">
      <option value="none" selected>Decide later (or type the term fee)</option>
      <option value="link">Payment link: they sign in, sign the waiver and pay</option>
      <option value="offline">Already paid offline</option>
      <option value="sessions">Session by session: their own price, billed from Money</option>
      <option value="pro">Pro session: Pro sessions price, billed from Money</option></select></label>
    <p class="muted small" id="${px}-pay-hint" style="margin-top:-6px"></p>
    <div id="${px}-paywhat" hidden><div class="j-two"><label class="j-field"><span>Paying for</span><select class="j-select" id="${px}-prod"><option value="">Type an amount</option><optgroup label="JFP price list">${(pr.products || []).filter((x) => x.key !== 'trial').map((x) => `<option value="${esc(x.key)}">${esc(x.label)} · ${esc(money(x.cents))}${x.perPlaces > 1 ? ' for two' : ''}</option>`).join('')}</optgroup>${customOptions(pr)}</select></label>
      <label class="j-field"><span>Amount (A$)</span><input class="j-input" id="${px}-amt" inputmode="decimal" placeholder="e.g. 850"></label></div>
      <label class="j-check" id="${px}-ap-wrap"><input type="checkbox" id="${px}-afterpay" checked> <span>Afterpay allowed</span></label></div>
    <label class="j-field" id="${px}-fee-wrap"><span>Term 4 fee A$ ${opt}</span><input class="j-input" id="${px}-fee" inputmode="decimal"></label>
    <label class="j-field" id="${px}-per-wrap" hidden><span>Price per session (A$) ${opt.replace(')', ', or set it when you bill)')}</span><input class="j-input" id="${px}-per" inputmode="decimal" placeholder="e.g. 80"></label>`
}
export function wireNoGroupPayment(box, px, pr, { onChange = () => {} } = {}) {
  const $ = (id) => box.querySelector(`#${px}-${id}`)
  let typed = false
  const fill = () => {
    const v = $('prod').value
    if (typed) return
    if (v.startsWith('price:')) { const p = customPrices(pr).find((x) => `price:${x.id}` === v); $('amt').value = p ? (p.cents / 100).toFixed(2).replace(/\.00$/, '') : '' }
    else if (v) { const x = (pr.products || []).find((y) => y.key === v); $('amt').value = x ? (x.cents / 100).toFixed(2).replace(/\.00$/, '') : '' }
  }
  const watch = () => {
    const pay = $('pay').value
    $('paywhat').hidden = !['link', 'offline'].includes(pay)
    $('ap-wrap').hidden = pay !== 'link'
    $('fee-wrap').hidden = pay !== 'none'
    $('per-wrap').hidden = !['sessions', 'pro'].includes(pay)
    // What they find in My account (Lee, 13 Oct 2026).
    $('pay-hint').textContent = ['sessions', 'pro'].includes(pay) ? 'They can pay for sessions from their account.' : pay === 'none' ? 'They can pay from their account once a term fee is set.' : pay === 'link' ? 'They get a Pay step in their account for this price.' : ''
    // A per-session price picked from the list fills the per-session box.
    onChange(pay)
  }
  $('pay').addEventListener('change', watch)
  $('prod').addEventListener('change', () => { typed = false; fill() })
  $('amt').addEventListener('input', () => { typed = true })
  watch()
  return () => {
    const pay = $('pay').value
    const out = { payment: pay }
    if (pay === 'none') { const f = $('fee').value.trim(); if (f) { const n = Number(f.replace(/[a$,\s]/gi, '')); if (!Number.isFinite(n) || n < 0) return { error: 'Enter the fee in dollars, for example 850.' }; out.feeAud = n } }
    if (['sessions', 'pro'].includes(pay)) { const c = centsOf($('per').value); if (c != null) { if (!(c >= 100)) return { error: 'Enter the price per session in dollars, for example 80.' }; out.perSessionCents = c } }
    if (['link', 'offline'].includes(pay)) {
      const v = $('prod').value
      if (v.startsWith('price:')) out.priceId = v.slice(6); else if (v) out.product = v
      const c = centsOf($('amt').value)
      if (c == null || !(c >= 100)) return { error: 'Choose what they are paying for, or type the amount.' }
      out.amountCents = c
      if (pay === 'link') out.afterpay = $('afterpay').checked
      if (pay === 'offline') out.method = 'Offline'
    }
    return out
  }
}
