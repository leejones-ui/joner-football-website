// Player reports in My account (Lee, 18 Oct 2026): every report a coach has
// sent this family, newest first, to read and save as a PDF. A player with
// their own login sees only their own. Opening the tab marks them as read.
// Progress over the terms (Lee, 20 Oct 2026) sits on top: one card a player.
import { esc, api, toast } from './jfp-common.js'
import { ic } from './jfp-account-icons.js'
import { first, pageHead } from './jfp-account-ui.js'
import { reportCardHtml, reportDate, savePdfOnDevice } from './jfp-report-view.js'
import { progressHtml } from './jfp-account-progress.js'

export const unreadReports = (D) => (D?.reports || []).filter((r) => r.unread).length

export function reportsHomeBlock(D) {
  const list = (D?.reports || []).filter((r) => r.unread)
  if (!list.length) return ''
  const r = list[0]
  return `<p class="ja-label">New player report</p><button type="button" class="ja-strip" data-go="reports">${ic('spark')}<span class="ja-mr-tx"><b>${esc(list.length > 1 ? `${list.length} new player reports` : `${first(r.player)}'s Term ${r.termNo} ${r.year} report`)}</b><small>From the coach. Tap to read it and save the PDF.</small></span>${ic('chevron')}</button>`
}

export async function renderReports(el, D, after) {
  const head = pageHead('From the coach', 'Player reports', '')
  el.innerHTML = `${head}<div class="ja-card ja-muted">Loading your reports</div>`
  const r = await api('/api/jfp-account', { action: 'reports' })
  if (!r.ok) { el.innerHTML = `${head}<div class="ja-card">${esc(r.data.error || 'Could not load your reports. Try again in a moment.')}</div>`; return }
  const list = r.data.reports || []
  const form = r.data.form
  const many = new Set(list.map((x) => x.player)).size > 1
  el.innerHTML = `${head}<div class="ja-stack">${list.length ? progressHtml(r.data.progress) : ''}${list.length ? list.map((x) => `<article class="ja-card ja-report${x.read ? '' : ' is-unread'}" data-rid="${esc(x.id)}">
      <p class="ja-news-meta">${x.read ? '' : '<span class="ja-tag red">New</span>'}${many ? `<span class="ja-tag">${esc(first(x.player))}</span>` : ''}<span>${esc(x.title)} · sent ${esc(reportDate(x.sentAt))}</span></p>
      ${reportCardHtml(x, form)}
      <div class="ja-report-actions"><button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-rpdf="${esc(x.id)}">Save the PDF</button><span data-rtap></span></div>
    </article>`).join('') : `<div class="ja-card"><p class="ja-muted">No player reports yet. When a coach sends one, it lands here and you get an email${D?.playerLogin ? '' : ' with the PDF'}.</p></div>`}</div>`
  el.onclick = async (e) => {
    const b = e.target.closest('[data-rpdf]'); if (!b) return
    const card = b.closest('[data-rid]')
    b.disabled = true; const label = b.textContent; b.textContent = 'Making the PDF...'
    try {
      const out = await api('/api/jfp-account', { action: 'reportPdf', id: b.dataset.rpdf })
      if (!out.ok) return toast(out.data.error || 'The PDF could not be made. Try again in a moment.')
      const how = await savePdfOnDevice(out.data, {
        onNeedTap: (go) => {
          const tap = card.querySelector('[data-rtap]')
          tap.innerHTML = '<button type="button" class="ja-btn ja-btn-red ja-btn-sm">Ready: tap to save it</button>'
          tap.querySelector('button').addEventListener('click', () => { go(); tap.innerHTML = '' }, { once: true })
        },
      })
      if (how === 'saved') toast('Saved. Look in your Downloads.')
    } finally { b.disabled = false; b.textContent = label }
  }
  const ids = list.filter((x) => !x.read).map((x) => x.id)
  if (!ids.length) return
  api('/api/jfp-account', { action: 'reportRead', ids }).then((res) => {
    if (!res.ok) return
    for (const x of D?.reports || []) if (ids.includes(x.id)) x.unread = false
    after?.()
  })
}
