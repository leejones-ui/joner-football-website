// Regression checks for the usability pass (Lee, 15 Oct 2026). These read the
// shared stylesheets and fail if a rule that caused real bugs comes back:
// - button text that cannot wrap (it spilled out of "Can't make it" on a phone)
// - single-column grids sized 'auto' (one wide row pushed every card past 320px)
// - controls under 44px on touch screens
import fs from 'node:fs'
import assert from 'node:assert/strict'

const css = (f) => fs.readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8')
const account = css('jfp-account.css')
const shared = css('jfp.css')
const portal = css('jfp-portal.css')
// The declarations of the first rule whose selector is exactly `sel`.
const rule = (text, sel) => {
  const i = text.indexOf(`${sel} {`)
  assert.ok(i >= 0, `rule ${sel} is missing`)
  return text.slice(i + sel.length + 2, text.indexOf('}', i))
}
const px = (decls, prop) => Number((decls.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*(\\d+(?:\\.\\d+)?)px`)) || [])[1])
let n = 0
const check = (name, fn) => { fn(); n += 1; console.log(`ok ${n} ${name}`) }

check('account button text wraps inside the button', () => {
  const b = rule(account, '.ja .ja-btn')
  assert.doesNotMatch(b, /white-space:\s*nowrap/)
  assert.match(b, /max-width:\s*100%/)
  assert.ok(px(b, 'min-height') >= 44)
})
check('account small buttons are 44px tall', () => assert.ok(px(rule(account, '.ja .ja-btn-sm'), 'min-height') >= 44))
check('account header badge is 44px', () => { const m = rule(account, '.ja .ja-me'); assert.ok(px(m, 'width') >= 44 && px(m, 'height') >= 44) })
check('ticket buttons are not squeezed into fixed columns', () => {
  assert.doesNotMatch(account, /\.ja-ticket \.ja-actions \{ display: grid/)
  assert.doesNotMatch(account, /\.ja-ticket \.ja-actions \.ja-btn \{[^}]*min-width:\s*0/)
})
check('single-column account grids are capped at the screen width', () => {
  const capped = account.match(/([^}]*)\{ grid-template-columns: minmax\(0, 1fr\); \}/)
  assert.ok(capped, 'no capped grid rule')
  for (const c of ['.ja-stack', '.ja-grid', '.ja-home', '.ja-form', '.ja-pay-grid']) assert.ok(capped[1].includes(c), `${c} not capped`)
  // and the cap comes before the wider layouts, so those still win
  assert.ok(account.indexOf(capped[0]) < account.indexOf('.ja-grid-2 { grid-template-columns'))
})
check('status dots can wrap', () => assert.doesNotMatch(rule(account, '.ja .ja-dot'), /white-space:\s*nowrap/))
check('shared buttons wrap and close buttons are 44px', () => {
  assert.doesNotMatch(rule(shared, '.j-btn'), /white-space:\s*nowrap/)
  const c = rule(shared, '.j-close'); assert.ok(px(c, 'width') >= 44 && px(c, 'height') >= 44)
  assert.match(shared, /@media \(pointer: coarse\) \{ \.j-btn, \.j-btn-sm, \.j-btn-ghost \{ min-height: 44px; \} \}/)
})
check('chips wrap except in a sideways chip row', () => {
  assert.doesNotMatch(rule(shared, '.j-chip'), /white-space:\s*nowrap/)
  assert.match(shared, /\.j-chips > \.j-chip \{ white-space: nowrap;/)
})
check('staff segmented filters wrap instead of squeezing their words', () => assert.match(portal, /\.ps-seg \{ flex-wrap: wrap; height: auto;/))
check('staff portal: 44px controls on touch screens', () => {
  const coarse = portal.split('@media (pointer: coarse) {').slice(1).join('')
  assert.match(coarse, /--ps-control: 44px/)
  assert.match(coarse, /\.jp-iconbtn \{ width: 44px; height: 44px; \}/)
  assert.match(coarse, /\.jp-att button[^{]*\{ min-height: 44px; \}/)
})
check('staff phone menu is hidden from the keyboard when closed', () => assert.match(portal, /\.jp-sidebar \{ visibility: hidden;/))
check('contact buttons (Call / Text / Email) wrap instead of squeezing', () => assert.match(account, /\.ja-quick \{ display: flex; flex-wrap: wrap;/))
check('timetable rows keep the whole name (pills and badges wrap)', () => {
  assert.match(shared, /\.jp-player \{ flex-wrap: wrap;/)
  assert.match(shared, /\.jp-nm \{ flex-wrap: wrap; \}/)
})
check('staff skip link shows when it has focus', () => assert.match(portal, /a\.sr-only\[href="#main-content"\]:focus \{ position: fixed !important;/))
check('sheets keep keyboard focus inside and give it back on close', () => {
  const common = fs.readFileSync(new URL('../src/scripts/jfp-common.js', import.meta.url), 'utf8')
  assert.match(common, /sheet\._opener = opener/)
  assert.match(common, /e\.key !== 'Tab'/)
  assert.match(common, /opener\.focus\(\{ preventScroll: true \}\)/)
})
check('session date tags never run under the Can\'t make it button', () => {
  assert.match(account, /\.ja-date \.w b \{ display: flex; flex-wrap: wrap;/)
  assert.match(account, /\.ja-date > \.ja-btn, \.ja-date > \.ja-muted \{ grid-column: 2;/)
})
check('footer sign-up boxes have labels and Book now is 44px', () => {
  const foot = fs.readFileSync(new URL('../src/components/Footer.astro', import.meta.url), 'utf8')
  for (const l of ['First name', 'Email address', 'What updates you want']) assert.ok(foot.includes(`aria-label="${l}"`), `${l} label missing`)
  const book = fs.readFileSync(new URL('../src/components/BookNowButton.astro', import.meta.url), 'utf8')
  assert.match(book, /\.book-now-btn--sm \{ min-height: 44px;/)
})
check('account tabs keep a tap width at heavy zoom, staff icons are 44px', () => {
  assert.match(account, /\.ja-tabs \{ grid-template-columns: repeat\(5, minmax\(52px, 1fr\)\); overflow-x: auto;/)
  assert.match(portal, /\.jp-iconbtn \{ width: 44px; height: 44px;/)
})
console.log(`${n} UI consistency checks passed`)
