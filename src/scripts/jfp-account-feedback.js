// The end of term question in My account (Lee, 30 Oct 2026): 0 to 10, an
// optional comment, and whether we may share it. Shown on Home while staff
// have it open (D.feedback); answering again changes the answer.
import { esc, api, toast } from './jfp-common.js'

const S = { edit: false, score: null }

export function feedbackHomeBlock(D) {
  const f = D?.feedback
  if (!f) return ''
  if (f.mine && !S.edit) {
    return `<div class="ja-card ja-fb" id="feedback"><p class="ja-label" style="margin:0 0 6px">${esc(f.term)}</p><h3 class="ja-h3">Thanks for telling us</h3>
      <p class="ja-muted" style="margin-top:6px">You gave us <b class="ja-ink">${esc(f.mine.score)} out of 10</b>.${f.mine.comment ? ' We read every comment.' : ''}</p>
      <p style="margin-top:10px"><button type="button" class="ja-link" data-fb-edit>Change my answer</button></p></div>`
  }
  const pick = S.score ?? f.mine?.score ?? null
  return `<div class="ja-card ja-fb" id="feedback"><p class="ja-label" style="margin:0 0 6px">One quick question</p><h3 class="ja-h3">${esc(f.question)}</h3>
    <div class="ja-fb-scale" role="radiogroup" aria-label="0 is not at all likely, 10 is extremely likely">${Array.from({ length: 11 }, (_, n) => `<button type="button" role="radio" class="ja-fb-n" data-fb-score="${n}" aria-checked="${pick === n}">${n}</button>`).join('')}</div>
    <div class="ja-fb-ends ja-small ja-muted"><span>Not at all likely</span><span>Extremely likely</span></div>
    <label class="ja-small ja-muted" for="fb-comment" style="display:block;margin-top:14px">Anything you want to tell us? (optional)</label>
    <textarea class="j-textarea" id="fb-comment" rows="3" maxlength="1000" style="width:100%;margin-top:6px">${esc(f.mine?.comment || '')}</textarea>
    <label class="ja-small" style="display:flex;gap:8px;align-items:flex-start;margin-top:10px"><input type="checkbox" id="fb-share" ${f.mine?.share ? 'checked' : ''} style="margin-top:3px"> <span>Happy for us to share my comment, with my first name only</span></label>
    <p style="margin-top:14px"><button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-fb-save ${pick == null ? 'disabled' : ''}>Send</button></p></div>`
}

// From the page's click handler. redraw(): draw Home again.
export async function feedbackClick(t, D, redraw) {
  const n = t.closest('[data-fb-score]')
  if (n) {
    S.score = Number(n.dataset.fbScore)
    const card = n.closest('.ja-fb')
    card.querySelectorAll('[data-fb-score]').forEach((b) => b.setAttribute('aria-checked', String(b === n)))
    card.querySelector('[data-fb-save]').disabled = false
    return true
  }
  if (t.closest('[data-fb-edit]')) { S.edit = true; S.score = D.feedback.mine?.score ?? null; redraw(); return true }
  const save = t.closest('[data-fb-save]')
  if (!save) return false
  const card = save.closest('.ja-fb')
  save.disabled = true
  const r = await api('/api/jfp-account', { action: 'feedbackSave', score: S.score ?? D.feedback.mine?.score, comment: card.querySelector('#fb-comment').value, share: card.querySelector('#fb-share').checked })
  if (!r.ok) { save.disabled = false; toast(r.data.error || 'Could not send it. Try again in a moment.'); return true }
  D.feedback.mine = r.data.mine
  S.edit = false; S.score = null
  toast('Thank you')
  redraw()
  return true
}
