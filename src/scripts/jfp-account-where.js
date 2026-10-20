// Where are you based (Lee, 20 Oct 2026). Someone new to us answers once,
// right after making their account: where they are, who the account is for
// and how they heard of us (api/_jfp-account-where.js). Too far from Sydney
// for weekly sessions: a screen pointing them to the Joner Football app.
// Closing it without answering asks again next time.
import { esc, api, openSheet, closeSheet, toast } from './jfp-common.js'

const APP_PAGE = 'https://jonerfootball.com/app/'
const IOS = 'https://apps.apple.com/au/app/joner-football-app/id6737069275'
const ANDROID = 'https://play.google.com/store/apps/details?id=tv.uscreen.jonerfootball'
const countryName = (c) => { try { return c ? new Intl.DisplayNames(['en'], { type: 'region' }).of(c) || '' : '' } catch { return '' } }

export function askWhere(D, { book } = {}) {
  const q = D?.askWhere
  if (!q) return
  const st = { place: '', forWho: '' }
  const guess = q.country && q.country !== 'AU' ? countryName(q.country) : ''
  const chips = (key, map) => `<div class="ja-seg" data-wh="${key}">${Object.entries(map).map(([k, l]) => `<button type="button" class="j-chip" data-val="${esc(k)}" aria-pressed="false">${esc(l)}</button>`).join('')}</div>`
  const sheet = openSheet({ title: 'Welcome to Joner Football', subtitle: 'Three quick questions so we can point you to the right training.' })
  sheet.body.innerHTML = `
    <div class="j-field full"><span>Where are you based?</span>${chips('place', q.places)}</div>
    <label class="j-field full" data-wh-show="sydney nsw" hidden><span>Suburb <span class="muted">(optional)</span></span><input class="j-input" data-wh-in="area" maxlength="60" autocomplete="address-level2" placeholder="For example Belrose"></label>
    <label class="j-field full" data-wh-show="australia" hidden><span>Which state?</span><select class="j-select" data-wh-in="state"><option value="">Choose</option>${q.states.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
    <label class="j-field full" data-wh-show="overseas" hidden><span>Which country?</span><input class="j-input" data-wh-in="country" maxlength="60" autocomplete="country-name" value="${esc(guess)}"></label>
    <div class="j-field full"><span>Who is the account for?</span>${chips('forWho', q.forWho)}</div>
    <label class="j-field full"><span>How did you hear about Joner Football? <span class="muted">(optional)</span></span><select class="j-select" data-wh-in="heard"><option value="">Choose</option>${Object.entries(q.heard).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select></label>
    <p class="ja-small ja-muted" data-wh-err role="alert" hidden></p>`
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-red" data-wh-go>Continue</button>'
  const $ = (sel) => sheet.body.querySelector(sel)
  sheet.body.querySelectorAll('[data-wh]').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]')
    if (!b) return
    seg.querySelectorAll('[data-val]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    st[seg.dataset.wh] = b.dataset.val
    if (seg.dataset.wh === 'place') sheet.body.querySelectorAll('[data-wh-show]').forEach((el) => { el.hidden = !el.dataset.whShow.split(' ').includes(st.place) })
  }))
  const go = sheet.foot.querySelector('[data-wh-go]')
  go.addEventListener('click', async () => {
    const err = $('[data-wh-err]')
    const val = (k) => $(`[data-wh-in="${k}"]`).value.trim()
    const miss = !st.place ? 'Pick where you are based.' : st.place === 'overseas' && !val('country') ? 'Which country are you in?' : !st.forWho ? 'Pick who the account is for.' : ''
    if (miss) { err.textContent = miss; err.hidden = false; return }
    go.disabled = true
    const r = await api('/api/jfp-account', { action: 'saveWhere', place: st.place, forWho: st.forWho, area: val('area'), state: val('state'), country: val('country'), heard: val('heard') })
    go.disabled = false
    if (!r.ok) { err.textContent = r.data?.error || 'Could not save that. Try again.'; err.hidden = false; return }
    D.askWhere = null
    D.where = { place: st.place, away: Boolean(r.data.away) }
    if (r.data.away) return awayScreen(sheet, st.place === 'overseas' ? val('country') : '')
    if (st.place === 'nsw') return nswScreen(sheet, D, book)
    closeSheet()
    toast('Thanks. You are all set.')
  })
}

// Too far for weekly sessions in Sydney.
function awayScreen(sheet, country) {
  sheet.setTitle('The next best thing: the Joner Football app', '')
  sheet.body.innerHTML = `
    <p>Joner Football Performance is in person training at our venues in Sydney, so it will be hard to join ${country ? `from ${esc(country)}` : 'from where you are'}.</p>
    <p style="margin-top:10px">The next best thing is the <b>Joner Football app</b>: Lee's drills and full training sessions, so you can train anywhere, any time.</p>
    <p class="ja-small ja-muted" style="margin-top:10px">Download it on <a class="ja-link" href="${IOS}" target="_blank" rel="noopener noreferrer">iPhone</a> or <a class="ja-link" href="${ANDROID}" target="_blank" rel="noopener noreferrer">Android</a>. Your account here stays open, and if you are ever in Sydney you can book a session.</p>`
  sheet.foot.innerHTML = `<button type="button" class="ja-btn ja-btn-line" data-wh-close>Keep my account</button><a class="ja-btn ja-btn-red" href="${APP_PAGE}" target="_blank" rel="noopener noreferrer">Get the Joner Football app</a>`
  sheet.foot.querySelector('[data-wh-close]').addEventListener('click', () => closeSheet())
}

// NSW but outside Sydney: they may be able to travel.
function nswScreen(sheet, D, book) {
  const venues = (D.venues || []).map((v) => v.name).filter(Boolean)
  sheet.setTitle('Our sessions are in Sydney', '')
  sheet.body.innerHTML = `
    <p>Joner Football Performance runs in person${venues.length ? ` at ${esc(venues.join(', ').replace(/, ([^,]*)$/, ' and $1'))}` : ' in Sydney'}. If you can get there, you can book a session from your account.</p>
    <p style="margin-top:10px">If that is too far, the <b>Joner Football app</b> has Lee's drills and full training sessions to follow at home.</p>`
  sheet.foot.innerHTML = `<a class="ja-btn ja-btn-line" href="${APP_PAGE}" target="_blank" rel="noopener noreferrer">See the app</a><button type="button" class="ja-btn ja-btn-red" data-wh-book>Book a session</button>`
  sheet.foot.querySelector('[data-wh-book]').addEventListener('click', () => { closeSheet(); if (book) book(); else location.href = D.bookUrl || '/jfp-booking/' })
}
