// A big month calendar for picking dates (Lee, 19 Oct 2026: the phone's own
// date box was too small to pick from). Tap a day to pick it; with multi, tap
// several. Dates are YYYY-MM-DD in Sydney.
import { esc } from './jfp-common.js'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const label = (v) => new Date(`${v}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

// mount: an element. Returns { get: () => [dates] }.
export function calendar(mount, { multi = false, selected = [], min = '', max = '', onChange = () => {} } = {}) {
  const picked = new Set(selected.filter(Boolean))
  const start = [...picked].sort()[0] || min || new Date().toISOString().slice(0, 10)
  let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)) - 1
  const draw = () => {
    const firstDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7 // Monday first
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const prevOk = !min || iso(y, m, 1) > min
    const nextOk = !max || iso(y, m, days) < max
    const cells = []
    for (let i = 0; i < firstDow; i++) cells.push('<span class="jcal-pad"></span>')
    for (let d = 1; d <= days; d++) {
      const v = iso(y, m, d)
      const off = (min && v < min) || (max && v > max)
      cells.push(`<button type="button" class="jcal-day" data-cal="${v}" aria-pressed="${picked.has(v)}" ${off ? 'disabled' : ''} aria-label="${esc(label(v))}">${d}</button>`)
    }
    const list = [...picked].sort()
    mount.innerHTML = `<div class="jcal">
      <div class="jcal-head"><button type="button" class="jcal-nav" data-cal-step="-1" ${prevOk ? '' : 'disabled'} aria-label="Previous month">‹</button><b>${MONTHS[m]} ${y}</b><button type="button" class="jcal-nav" data-cal-step="1" ${nextOk ? '' : 'disabled'} aria-label="Next month">›</button></div>
      <div class="jcal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="jcal-grid">${cells.join('')}</div>
      <p class="jcal-picked small">${list.length ? `${multi ? `${list.length} date${list.length === 1 ? '' : 's'}: ` : ''}${list.map(label).map(esc).join(', ')}` : multi ? 'Tap the dates you want. You can pick several.' : 'Tap a date.'}</p>
    </div>`
  }
  mount.addEventListener('click', (e) => {
    const step = e.target.closest('[data-cal-step]')
    if (step) { m += Number(step.dataset.calStep); if (m < 0) { m = 11; y -= 1 } if (m > 11) { m = 0; y += 1 } draw(); return }
    const b = e.target.closest('[data-cal]')
    if (!b || b.disabled) return
    const v = b.dataset.cal
    if (multi) { if (picked.has(v)) picked.delete(v); else picked.add(v) } else { picked.clear(); picked.add(v) }
    draw()
    onChange([...picked].sort())
  })
  draw()
  return { get: () => [...picked].sort() }
}
