// Money > Credits owed (Lee, 20 Oct 2026): how much credit is owed to
// families in total, and to whom. A credit comes off the family's next
// payment by itself (api/_jfp-credits.js): a payment link, a family invoice,
// sessions billed, My account, or an auto charge. Lee or Ligia can give one
// here. Nothing here charges, refunds or emails anyone.
import { esc } from './jfp-common.js'
import { psHelp } from './jfp-portal-ps.js'

const CHEV = '<svg class="jm-sec-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const money = (cents) => `A$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`

const line = (c) => `<li><span><b>${esc(c.player)}</b><small>${esc(c.reason)}${c.dateLabel ? ` · ${esc(c.dateLabel)}` : ''}${c.used.length ? ` · ${c.used.map((u) => `${esc(u.amountLabel)} off ${esc(u.what)}`).join(', ')}` : ''}</small></span><b>${esc(c.amountLabel)}</b></li>`

// el: an empty box in Money. players: [{ rowId, player }] for Give credit.
export async function mountCredits(el, { post, modal, closeModal, toast, players, open }) {
  if (!el) return
  // Never in the way of Money: anything odd and the box stays empty.
  const r = await post('creditsList').catch(() => null)
  if (!el.isConnected || !r?.ok || !Array.isArray(r.data?.owed)) return
  const d = { unvalued: [], used: [], totalCents: 0, ...r.data }
  const id = 'm-credits-sec'
  el.innerHTML = `<details class="jm-sec" id="${id}" ${open?.has(id) ? 'open' : ''}><summary><span class="jm-sec-t">Credits owed</span> <span class="jm-sec-m"><b>${esc(money(d.totalCents))}</b> · ${d.owed.length} player${d.owed.length === 1 ? '' : 's'}</span>${psHelp('Credit we owe families, from a cancelled session or given by hand. It comes off their next payment by itself, and their account shows it.')}${CHEV}</summary>
    <div class="jm-sec-body">
      ${d.owed.length ? `<ul class="jm-hist">${d.owed.map(line).join('')}</ul>` : '<p class="muted small">No credit owed right now.</p>'}
      ${d.unvalued.length ? `<p class="small" style="margin-top:8px"><b>${d.unvalued.length}</b> credit${d.unvalued.length === 1 ? '' : 's'} with no value yet: set it in Make-ups and credits, or they cannot come off.</p>` : ''}
      ${d.used.length ? `<details style="margin-top:10px"><summary class="small">Used lately</summary><ul class="jm-hist">${d.used.map(line).join('')}</ul></details>` : ''}
      <button type="button" class="j-btn j-btn-dark j-btn-sm" id="cr-give" style="margin-top:10px">Give credit</button>
    </div></details>`
  el.querySelector('details').addEventListener('toggle', (e) => { if (!open) return; if (e.target.open) open.add(id); else open.delete(id) })
  el.querySelector('#cr-give').addEventListener('click', () => {
    const list = [...players].sort((a, b) => a.player.localeCompare(b.player))
    const box = modal(`<h2 style="margin-bottom:4px">Give credit</h2>
      <p class="muted small" style="margin-bottom:12px">It comes off the family's next payment by itself, and shows in their account.</p>
      <label class="j-field"><span>Player</span><select class="j-select" id="cr-p">${list.map((p) => `<option value="${esc(p.rowId)}">${esc(p.player)}</option>`).join('')}</select></label>
      <label class="j-field"><span>Credit (A$)</span><input class="j-input" id="cr-v" inputmode="decimal" placeholder="e.g. 50"></label>
      <label class="j-field"><span>What for</span><input class="j-input" id="cr-r" maxlength="160" placeholder="e.g. Session cancelled, wet weather"></label>
      <p class="j-err" id="cr-err" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="cr-go">Give credit</button></div>`)
    box.querySelector('#cr-go').addEventListener('click', async (e) => {
      const err = (t) => { const x = box.querySelector('#cr-err'); x.textContent = t; x.hidden = false }
      const dollars = Number(String(box.querySelector('#cr-v').value).replace(/[^0-9.]/g, ''))
      if (!(dollars >= 1)) return err('Enter the credit in dollars, from A$1.')
      e.currentTarget.disabled = true
      const x = await post('creditGive', { rowId: box.querySelector('#cr-p').value, cents: Math.round(dollars * 100), reason: box.querySelector('#cr-r').value })
      if (!x.ok) { e.currentTarget.disabled = false; return err(x.data.error || 'Could not give the credit.') }
      closeModal(); toast('Credit given. It comes off their next payment.')
      mountCredits(el, { post, modal, closeModal, toast, players, open })
    })
  })
}
