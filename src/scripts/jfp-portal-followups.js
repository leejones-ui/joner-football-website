// Follow ups and Feedback (Lee, 30 Oct 2026). Lee and Ligia only.
// Follow ups: the daily Telegram brief (today's, word for word), offer
// reminders and the finish setting up email, each with its switch and its
// words. Feedback: the end of term question, its email, and every answer.
// The server does the work (api/_jfp-admin-brief.js, api/_jfp-feedback.js).
import { esc } from './jfp-common.js'
import { psHead, psBadge } from './jfp-portal-ps.js'

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }) : '')
const help = (t) => `<details class="ps-help"><summary aria-label="About this page" title="About this page">?</summary><div class="ps-help-body">${t}</div></details>`

function mailHtml(w, note = '') {
  return `<div class="abs-mail">
    <p class="small muted" style="margin:0 0 4px">Subject: <b>${esc(w.subject)}</b></p>
    <p style="margin:0 0 6px"><b>${esc(w.heading)}</b></p>
    ${w.paras.map((x) => `<p class="small" style="margin:0 0 6px">${esc(x)}</p>`).join('')}
    <p class="small" style="margin:0"><span class="ps-tag">${esc(w.cta.label)}</span> (a button${note ? `, ${esc(note)}` : ''})</p>
  </div>`
}

function switchCard({ id, on, title, text, words }) {
  return `<div class="j-card abs-digest" style="margin-top:12px">
    <label class="j-check small"><input type="checkbox" data-fu-switch="${id}" ${on ? 'checked' : ''}> <span><b>${esc(title)} ${on ? 'on' : 'off'}.</b> ${esc(text)}</span></label>
    ${words.map(([label, w, note]) => `<details class="abs-words" ${on ? '' : 'open'}><summary>${esc(label)}</summary>${mailHtml(w, note)}</details>`).join('')}
  </div>`
}

export async function renderFollowUps({ view, post, need, toast, confirmBox }) {
  const d = await need(await post('followUps'))
  const S = d.switches, T = d.timing
  const due = d.accounts.filter((a) => a.due).length
  view().innerHTML = `${psHead({ title: 'Follow ups' }).replace('</h1>', `</h1>${help('What the portal does on its own each day. The brief goes to the JFP Telegram (Lee and Ligia) every morning. The two emails go to families only while their switch is on, and each family gets each email once.')}`)}
    <div class="j-card abs-digest">
      <label class="j-check small"><input type="checkbox" data-fu-switch="dailyBrief" ${S.dailyBrief ? 'checked' : ''}> <span><b>Daily brief ${S.dailyBrief ? 'on' : 'off'}.</b> Every morning from ${T.briefHour}am, one Telegram message to the JFP admin chat. Staff only, never families.</span></label>
      <details class="abs-words"><summary>Today's brief, as it would read now</summary><pre class="small" style="white-space:pre-wrap;margin:8px 0 0;font:inherit">${esc(d.brief)}</pre></details>
    </div>

    <h2 style="font-size:18px;margin:24px 0 0">Offers not paid yet <span class="muted small">${d.offers.length}</span></h2>
    ${switchCard({ id: 'offerReminders', on: S.offerReminders, title: 'Offer reminders', text: `One email to the family ${T.remindHours / 24} days before the place we offered them runs out. Replies go to Ligia.`, words: [['The email, word for word (this is the first offer below)', d.words.offer, 'to pay for the place']] })}
    <div class="ps-table-wrap" style="margin-top:10px"><table class="ps-table"><thead><tr><th>Family</th><th>Place</th><th>Runs out</th><th>Reminder</th><th class="ps-end"><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${d.offers.map((o, i) => `<tr>
      <td>${esc(o.players.join(', '))}<span class="ps-sub">${esc(o.parentName || o.email)}</span></td>
      <td>${esc(o.group)}<span class="ps-sub">${esc(o.amountLabel)}${o.kind === 'trial' ? ', trial' : o.kind === 'waitlist' ? ', from the waitlist' : ''}</span></td>
      <td>${esc(day(o.expiresAt))}${o.due ? ` ${psBadge('orange', 'Soon')}` : ''}</td>
      <td>${o.remindedAt ? psBadge('green', `Sent ${day(o.remindedAt)}`) : '<span class="muted small">Not sent</span>'}</td>
      <td class="ps-end ps-keep">${o.remindedAt ? '' : `<button type="button" class="j-btn j-btn-line j-btn-sm" data-fu-remind="${i}">Send reminder now</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="5"><div class="ps-empty">No offers waiting to be paid.</div></td></tr>'}
    </tbody></table></div>

    <h2 style="font-size:18px;margin:24px 0 0">New accounts with nobody added <span class="muted small">${d.accounts.length}</span></h2>
    ${switchCard({ id: 'accountFollowUps', on: S.accountFollowUps, title: 'Finish setting up email', text: `One email ${T.followAfterDays} days after someone makes an account and adds nobody. Not sent to anyone who sent a request, or to accounts older than ${T.followMaxDays} days. Outside Sydney they get the JF App email instead. Replies go to Ligia.${S.accountFollowUps ? '' : ` Switching it on sends to the ${due} below marked Due straight away.`}`, words: [['Sydney, word for word', d.words.sydney, 'to My account'], ['Outside Sydney, word for word', d.words.away, 'to the JF App page']] })}
    <div class="ps-table-wrap" style="margin-top:10px"><table class="ps-table"><thead><tr><th>Account</th><th>Made</th><th>Email</th></tr></thead><tbody>
    ${d.accounts.map((a) => `<tr><td>${esc(a.email)}<span class="ps-sub">${a.away ? `Outside Sydney${a.country ? `, ${esc(a.country)}` : ''}${a.coach ? ', a coach' : ''}` : 'Sydney'}</span></td><td>${esc(day(a.createdAt))}</td><td>${a.sentAt ? psBadge('green', `Sent ${day(a.sentAt)}`) : a.due ? psBadge('orange', 'Due') : '<span class="muted small">Not yet</span>'}</td></tr>`).join('') || '<tr><td colspan="3"><div class="ps-empty">Nobody to follow up.</div></td></tr>'}
    </tbody></table></div>`
  const again = () => renderFollowUps({ view, post, need, toast, confirmBox })
  view().querySelectorAll('[data-fu-switch]').forEach((cb) => cb.addEventListener('change', async (e) => {
    const r = await post('followUpsSwitch', { which: cb.dataset.fuSwitch, on: e.target.checked })
    if (!r.ok) { e.target.checked = !e.target.checked; return toast(r.data.error || 'Could not change it.') }
    toast(r.data.on ? 'Switched on' : 'Switched off'); again()
  }))
  view().querySelectorAll('[data-fu-remind]').forEach((b) => b.addEventListener('click', async () => {
    const o = d.offers[Number(b.dataset.fuRemind)]
    if (!(await confirmBox(`<b>${esc(`Email ${o.parentName || o.email} now?`)}</b><br>${esc(`The offer reminder above goes to ${o.email} now, for ${o.players.join(', ')}.`)}`, { ok: 'Send it' }))) return
    b.disabled = true
    const r = await post('remindOffer', { id: o.id })
    if (!r.ok) { b.disabled = false; return toast(r.data.error || 'Could not send it.') }
    toast(r.data.held ? 'Held for Lee to release' : `Reminder sent to ${r.data.to}`); again()
  }))
}

const BAND = { promoter: ['green', 'Would recommend'], passive: ['orange', 'Passive'], detractor: ['red', 'Unhappy'] }

export async function renderFeedback({ view, post, need, toast, confirmBox }, term = '') {
  const d = await need(await post('feedbackPage', { term }))
  const f = d.feedback, T = d.totals
  const sentThis = f.sentAt && f.term === f.currentTerm
  const nps = d.nps == null ? '' : `${d.nps > 0 ? '+' : ''}${d.nps}`
  view().innerHTML = `${psHead({ title: 'Feedback', count: T.answers }).replace('</h1>', `</h1>${help(`One question to families at the end of term: ${esc(d.question)} 0 to 10, with an optional comment. The score is the share who answered 9 or 10 less the share who answered 0 to 6, from -100 to +100. Every answer also comes to the JFP Telegram, low scores marked.`)}`)}
    ${d.terms.length > 1 ? `<div class="j-chips" style="margin:0 0 12px">${d.terms.map((t) => `<button type="button" class="j-chip" data-fb-term="${esc(t)}" aria-pressed="${t === d.term}">${esc(t)}</button>`).join('')}</div>` : ''}
    <div class="j-card abs-digest">
      <p class="small" style="margin:0 0 8px"><b>${f.open ? 'The question is open' : 'The question is closed'}.</b> ${f.open ? 'Families training this term see it at the top of My account.' : 'Families do not see it.'} ${sentThis ? `The email went to ${esc(f.sentCount)} families on ${esc(day(f.sentAt))}.` : `The email has not gone for ${esc(f.currentTerm)}.`}</p>
      <details class="abs-words" ${sentThis ? '' : 'open'}><summary>The email, word for word</summary>${mailHtml(d.words, 'to My account, where they answer')}</details>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${sentThis ? '' : '<button type="button" class="j-btn j-btn-dark j-btn-sm" id="fb-send">Send to this term\'s families</button>'}
        <button type="button" class="j-btn j-btn-line j-btn-sm" id="fb-open">${f.open ? 'Close the question' : 'Open the question (no email)'}</button>
      </div>
    </div>
    <div class="j-card" style="margin-top:12px;padding:16px 18px;display:flex;gap:10px 22px;flex-wrap:wrap;align-items:baseline">
      <div><p class="small muted" style="margin:0">Score, ${esc(d.term)}</p><p style="margin:0;font-size:2rem;font-weight:700">${nps || '<span class="muted">None yet</span>'}</p></div>
      <p class="small" style="margin:0">${psBadge('green', `${T.promoter} said 9 or 10`)} ${psBadge('orange', `${T.passive} said 7 or 8`)} ${psBadge('red', `${T.detractor} said 0 to 6`)}</p>
    </div>
    <div class="ps-table-wrap" style="margin-top:12px"><table class="ps-table"><thead><tr><th>Family</th><th>Score</th><th>Comment</th><th>When</th></tr></thead><tbody>
    ${d.answers.map((a) => `<tr><td>${esc(a.parent || a.email)}<span class="ps-sub">${esc(a.players.join(', '))}</span></td><td style="white-space:nowrap"><b>${esc(a.score)}</b> ${psBadge(...BAND[a.band])}</td><td class="small">${a.comment ? esc(a.comment) : '<span class="muted">No comment</span>'}${a.share ? `<span class="ps-sub">${psBadge('violet', 'OK to share')}</span>` : ''}</td><td class="small" style="white-space:nowrap">${esc(day(a.at))}${a.changed ? '<span class="ps-sub">Changed</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="4"><div class="ps-empty">No answers yet.</div></td></tr>'}
    </tbody></table></div>`
  const again = (t = d.term) => renderFeedback({ view, post, need, toast, confirmBox }, t)
  view().querySelectorAll('[data-fb-term]').forEach((b) => b.addEventListener('click', () => again(b.dataset.fbTerm)))
  view().querySelector('#fb-open')?.addEventListener('click', async () => {
    const r = await post('feedbackOpen', { open: !f.open })
    if (!r.ok) return toast(r.data.error || 'Could not change it.')
    toast(r.data.open ? 'Question open in My account' : 'Question closed'); again()
  })
  view().querySelector('#fb-send')?.addEventListener('click', async (e) => {
    // Ask the server for the count first, so the confirm says the real number.
    const probe = await post('feedbackSend', { confirm: -1 })
    const n = probe.data?.count
    if (!Number.isInteger(n)) return toast(probe.data?.error || 'Could not count the families.')
    if (!(await confirmBox(`<b>Email ${esc(n)} families?</b><br>${esc(`The email above goes to every family training in ${f.currentTerm}, one each, and the question opens in My account.`)}`, { ok: `Send to ${n} families` }))) return
    e.target.disabled = true
    toast('Sending, this takes a minute')
    const r = await post('feedbackSend', { confirm: n })
    if (!r.ok) { e.target.disabled = false; return toast(r.data.error || 'Could not send it.') }
    toast(`Sent to ${r.data.sent} families${r.data.failed.length ? `, ${r.data.failed.length} did not go` : ''}`); again()
  })
}
