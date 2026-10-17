// Player reports on screen (Lee, 18 Oct 2026), shared by the staff portal and
// My account: the report card, and saving its PDF on a phone, tablet or computer.
import { esc, savePdf } from './jfp-common.js'

export const reportDate = (iso) => { if (!iso) return ''; const d = new Date(String(iso).length <= 10 ? `${iso}T12:00:00` : iso); return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }) }
// form: { attrs: [{ k, l }], scale: [5 words] } from the server.
export function reportCardHtml(r, form) {
  const scale = form.scale
  return `<div class="rp-card">
    <div class="rp-strip"><div><b>${esc(r.player)}</b><span>${esc(r.program)} · Term ${esc(r.termNo)} ${esc(r.year)}${r.location ? ` · ${esc(r.location)}` : ''}</span></div>${r.overall != null ? `<div class="rp-overall"><small>Overall</small>${esc(r.overall)}</div>` : ''}</div>
    <div class="rp-grid">${form.attrs.map((a) => { const v = r.ratings?.[a.k] || 0; return `<div class="rp-rate"><span>${esc(a.l)}</span><span class="rp-bar"><i style="width:${v * 20}%"></i></span><b>${v ? `${v} <small>${esc(scale[v - 1])}</small>` : '<small>Not rated</small>'}</b></div>` }).join('')}</div>
    ${r.feedback ? `<div class="rp-fb"><b>Coach feedback</b><p>${esc(r.feedback)}</p></div>` : ''}
    ${r.reminder ? `<div class="rp-next"><b>Next term</b><p>${esc(r.reminder)}</p></div>` : ''}
    <p class="rp-foot">${r.coachName ? `Coach: ${esc(r.coachName)} · ` : ''}Report date: ${esc(reportDate(r.reportDate))}</p>
  </div>`
}

function pdfFile({ filename, pdf }) {
  const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))
  return new File([bytes], filename, { type: 'application/pdf' })
}
const touchDevice = () => matchMedia('(pointer: coarse)').matches || /iPhone|iPad|Android/i.test(navigator.userAgent)
// On a phone the share sheet saves to Files or Photos cleanly; on a computer
// it downloads. If the phone says the tap is too old (the PDF took a moment to
// make), the caller shows a "Tap to save" button that shares straight away.
export async function savePdfOnDevice(out, { onNeedTap } = {}) {
  const file = pdfFile(out)
  if (touchDevice() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: out.filename }); return 'shared' } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
      if (error?.name === 'NotAllowedError' && onNeedTap) { onNeedTap(() => navigator.share({ files: [file], title: out.filename }).catch((e) => { if (e?.name !== 'AbortError') savePdf(out) })); return 'tap' }
    }
  }
  savePdf(out)
  return 'saved'
}

