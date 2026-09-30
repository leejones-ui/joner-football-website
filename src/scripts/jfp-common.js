// Shared browser helpers for the JFP booking page, family account and staff
// portal. No framework: small functions over plain DOM.

export const $ = (id) => document.getElementById(id)

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export async function api(path, body, { method = 'POST' } = {}) {
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: 'No connection. Check your internet and try again.' } }
  }
}

export function recaptcha(action) {
  try { return window.JonerRecaptcha?.getToken ? window.JonerRecaptcha.getToken(action) : Promise.resolve('') } catch { return Promise.resolve('') }
}

let toastTimer
export function toast(message, ms = 3600) {
  let el = document.querySelector('.j-toast')
  if (!el) { el = document.createElement('div'); el.className = 'j-toast'; el.setAttribute('role', 'status'); document.querySelector('.jfp')?.appendChild(el) }
  el.textContent = message
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, ms)
}

export const money = (cents) => `A$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

// ---------- sheet ----------

// One sheet at a time: a bottom sheet on phones, a side panel on desktop.
export function openSheet({ title, subtitle = '', steps = 0, step = 0, onClose }) {
  closeSheet(true)
  const scrim = document.createElement('div')
  scrim.className = 'j-scrim'
  const sheet = document.createElement('div')
  sheet.className = 'j-sheet'
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.innerHTML = `
    <div class="j-sheet-head"><div style="min-width:0"><h2 id="j-sheet-title">${esc(title)}</h2><p class="muted small" id="j-sheet-sub">${esc(subtitle)}</p><div class="j-steps" id="j-sheet-steps"></div><p class="j-timer" id="j-sheet-timer" hidden></p></div>
    <button type="button" class="j-close" aria-label="Close">&times;</button></div>
    <div class="j-sheet-body" id="j-sheet-body"></div>
    <div class="j-sheet-foot" id="j-sheet-foot"></div>`
  sheet.setAttribute('aria-labelledby', 'j-sheet-title')
  const root = document.querySelector('.jfp')
  root.appendChild(scrim)
  root.appendChild(sheet)
  document.body.style.overflow = 'hidden'
  const api = {
    sheet,
    body: sheet.querySelector('#j-sheet-body'),
    foot: sheet.querySelector('#j-sheet-foot'),
    setTitle(t, s) { sheet.querySelector('#j-sheet-title').textContent = t; if (s != null) sheet.querySelector('#j-sheet-sub').textContent = s },
    setSteps(n, at) { sheet.querySelector('#j-sheet-steps').innerHTML = n ? Array.from({ length: n }, (_, i) => `<i class="${i <= at ? 'on' : ''}"></i>`).join('') : '' },
    timer: sheet.querySelector('#j-sheet-timer'),
    close: () => closeSheet(),
  }
  api.setSteps(steps, step)
  const close = () => closeSheet()
  scrim.addEventListener('click', close)
  sheet.querySelector('.j-close').addEventListener('click', close)
  sheet._onClose = onClose
  sheet._esc = (e) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', sheet._esc)
  setTimeout(() => sheet.querySelector('.j-close').focus(), 30)
  return api
}

export function closeSheet(silent) {
  const sheet = document.querySelector('.j-sheet')
  document.querySelector('.j-scrim')?.remove()
  if (!sheet) return
  document.removeEventListener('keydown', sheet._esc)
  const cb = sheet._onClose
  sheet.remove()
  document.body.style.overflow = ''
  if (!silent && typeof cb === 'function') cb()
}

// ---------- email code sign-in ----------

// Renders the two steps (email, then code) into `mount` and resolves once
// signed in. `foot` holds the action button.
export function signIn({ mount, foot, audience = 'parent', intro = '', email: preset = '' }) {
  return new Promise((resolve) => {
    let challenge = ''
    let email = preset
    const stepEmail = () => {
      mount.innerHTML = `
        ${intro ? `<p class="muted" style="margin-bottom:14px">${intro}</p>` : ''}
        <label class="j-field"><span>Email address</span><input class="j-input" id="si-email" type="email" autocomplete="email" inputmode="email" value="${esc(email)}" required></label>
        <p class="muted small">We will email you a 6 digit code. No password needed.</p>
        <p class="j-err" id="si-err" hidden></p>`
      foot.innerHTML = `<button type="button" class="j-btn j-btn-dark j-btn-block j-btn-lg" id="si-send">Email me a code</button>`
      const input = mount.querySelector('#si-email')
      input.focus()
      const send = async () => {
        const err = mount.querySelector('#si-err')
        email = input.value.trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter a valid email address.'; err.hidden = false; return }
        const guard = window.JonerEmailGuard?.validateEmail?.(email)
        if (guard && guard.ok === false && guard.error) { err.textContent = guard.error; err.hidden = false; return }
        const btn = foot.querySelector('#si-send')
        btn.disabled = true; btn.textContent = 'Sending'
        const r = await api('/api/jfp-auth', { action: 'start', email, audience, recaptchaToken: await recaptcha('jfp_signin') })
        btn.disabled = false; btn.textContent = 'Email me a code'
        if (!r.ok) { err.textContent = r.data.error || 'Could not send the code. Try again.'; err.hidden = false; return }
        challenge = r.data.challenge
        stepCode(r.data.hint)
      }
      foot.querySelector('#si-send').addEventListener('click', send)
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send() } })
    }
    const stepCode = (hint) => {
      mount.innerHTML = `
        <p style="margin-bottom:14px">We sent a code to <b>${esc(email)}</b>. It can take a minute to arrive. Check your junk folder too.</p>
        <label class="j-field"><span>6 digit code</span><input class="j-input j-code" id="si-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></label>
        <p class="j-err" id="si-err" hidden></p>
        <button type="button" class="j-btn j-btn-ghost j-btn-sm" id="si-back">Use a different email</button>`
      foot.innerHTML = `<button type="button" class="j-btn j-btn-dark j-btn-block j-btn-lg" id="si-verify">Sign in</button>`
      const input = mount.querySelector('#si-code')
      input.focus()
      const verify = async () => {
        const err = mount.querySelector('#si-err')
        const code = input.value.replace(/\D/g, '')
        if (code.length !== 6) { err.textContent = 'Enter the 6 digit code from the email.'; err.hidden = false; return }
        const btn = foot.querySelector('#si-verify')
        btn.disabled = true; btn.textContent = 'Checking'
        const r = await api('/api/jfp-auth', { action: 'verify', challenge, code })
        btn.disabled = false; btn.textContent = 'Sign in'
        if (!r.ok) { err.textContent = r.data.error || 'That code did not work.'; err.hidden = false; return }
        resolve({ email: r.data.email, role: r.data.role })
      }
      foot.querySelector('#si-verify').addEventListener('click', verify)
      input.addEventListener('input', () => { if (input.value.replace(/\D/g, '').length === 6) verify() })
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verify() } })
      mount.querySelector('#si-back').addEventListener('click', stepEmail)
    }
    stepEmail()
  })
}

export async function whoAmI(audience) {
  const r = await api(`/api/jfp-auth?audience=${audience}`, null, { method: 'GET' })
  return r.ok ? r.data.user || null : null
}

export async function signOut(audience) {
  await api('/api/jfp-auth', { action: 'logout', audience })
}

// The JFP waiver, word for word from the Airtable form, then the four
// agreements and a typed signature. Returns { el, read() }.
export const WAIVER_TEXT = 'Participation in sports and field-related activities comes with inherent risks. By completing this form, the participant acknowledges these risks and assumes responsibility for any injuries sustained by themselves or their children/wards while participating in the Joner Football Performance Program, whether at the facility or during any program activities. Permission is granted to Joner Football trainers, coaches, or contracted health care professionals to provide preliminary treatment and arrange transportation to a local Emergency Room if the participant or their child becomes ill or injured. By completing this form, the participant gives permission, either for themselves or as a legal guardian of a minor, for Joner Football to use images and video footage taken during the program for social media and advertising purposes. Full payment for the Joner Football Performance Program must be made before the start of the term. If a participant has confirmed their spot for the term, they are liable to pay for that term unless a medical certificate is provided for illness or injury. Joner Football Performance does not offer make-up sessions for missed sessions, and missed sessions are not credited. A 3-strike rule applies: three no-shows without explanation may result in losing your spot in the program. By signing below, the parent/guardian acknowledges that they have read, fully understand, and agree to all terms and conditions, including permission to treat agreement. The waiver and liability agreement is completed voluntarily and with full knowledge of its significance, and it will be binding on themselves, their heirs, executors, administrators, and assigns.'

export function waiverBlock(term) {
  const el = document.createElement('div')
  el.innerHTML = `
    <h3 style="margin-bottom:8px">JFP waiver and agreement, ${esc(term)}</h3>
    <div class="j-waiver-text">${esc(WAIVER_TEXT)}</div>
    <label class="j-check"><input type="checkbox" data-w="terms"> <span>I have read and accept the JFP waiver and full terms.</span></label>
    <label class="j-check"><input type="checkbox" data-w="makeups"> <span>I understand no make-up sessions are offered for missed sessions, late arrival or non-attendance.</span></label>
    <label class="j-check"><input type="checkbox" data-w="payment"> <span>I understand the player is locked in for the full term and payment is required before the term starts.</span></label>
    <label class="j-check"><input type="checkbox" data-w="emergency"> <span>I authorise Joner Football staff to seek urgent medical help or emergency treatment for the player if needed.</span></label>
    <label class="j-check"><input type="checkbox" data-w="media"> <span>Optional: I give permission for appropriate training photos or videos. Leave unticked if not.</span></label>
    <label class="j-field" style="margin-top:8px"><span>Parent or guardian signature (type your full name)</span><input class="j-input" data-w="signature" autocomplete="name"></label>`
  return {
    el,
    read() {
      const box = (k) => el.querySelector(`[data-w="${k}"]`).checked
      return { accepted: { terms: box('terms'), makeups: box('makeups'), payment: box('payment'), emergency: box('emergency') }, media: box('media'), signature: el.querySelector('[data-w="signature"]').value.trim() }
    },
    complete() {
      const w = this.read()
      return w.accepted.terms && w.accepted.makeups && w.accepted.payment && w.accepted.emergency && w.signature.length >= 3
    },
  }
}
