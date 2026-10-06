// Dark-mode contrast for the portal's components, measured in a real browser.
// Catches the class of bug where a rule like `a.j-btn { color: inherit }` wins
// on specificity and paints a button's label the same colour as its background.
//
//   node scripts/test-portal-contrast.mjs
//
// Needs the fleet Chrome on CDP 18894. Skips (exit 0) if it is not running, so
// it never blocks a build on a machine without it. Opens a tab, reads computed
// styles, closes the tab. Loads only local files; no network, no site data.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const CDP = process.env.JFP_CDP || 'http://127.0.0.1:18894'
const root = path.join(import.meta.dirname, '..')

let version
try { version = await (await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(2500) })).json() } catch {
  console.log(`skipped: no CDP browser on ${CDP} (start the fleet Chrome to run this)`)
  process.exit(0)
}

const PILLS = ['green', 'amber', 'red', 'blue', 'violet', 'grey']
const BOXES = ['green', 'amber', 'red', 'blue', 'grey']
const BTNS = ['dark', 'line', 'soft', 'ghost', 'danger']
const samples = [
  ...PILLS.map((p) => `<span class="j-pill j-pill-${p}">Pill ${p}</span>`),
  ...BOXES.map((b) => `<div class="j-box j-box-${b}">Box ${b}</div>`),
  // Both tags matter: the bug only hit anchors, buttons were fine.
  ...BTNS.flatMap((b) => [`<a class="j-btn j-btn-${b}" href="#">Link ${b}</a>`, `<button type="button" class="j-btn j-btn-${b}">Button ${b}</button>`]),
  '<span class="j-chip">Chip</span>', '<span class="j-chip" aria-pressed="true">Chip on</span>',
  '<p class="muted">Muted</p>', '<p class="muted small">Muted small</p>', '<p class="sub">Sub</p>',
  '<input class="j-input" value="Input">', '<select class="j-select"><option>Select</option></select>', '<textarea class="j-textarea">Textarea</textarea>',
  '<div class="jp-seg"><button aria-pressed="true">Seg on</button><button aria-pressed="false">Seg off</button></div>',
  '<div class="jp-att"><button>Att</button></div>', '<div class="jp-kpi"><b>12</b><span>KPI</span></div>',
  '<table class="jp-table"><thead><tr><th>Head</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>',
  '<table class="jm-table"><thead><tr><th>Head</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>',
  '<div class="j-empty">Empty</div>', '<div class="j-err">Error</div>', '<div class="jm-status">Status</div>',
  '<div class="jd-key">Key</div>', '<div class="jd-tile"><b>9</b><span>Tile</span></div>', '<div class="jm-alert">Alert</div>',
]
// Root classes exactly as src/pages/jfp-portal.astro sets them.
const page = (theme) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/jfp.css"><link rel="stylesheet" href="/jfp-portal.css"></head><body>
<div class="jfp jp-theme" data-theme="${theme}">${samples.map((s) => `<section class="jd-card" style="margin:6px;padding:10px">${s}</section>`).join('')}</div></body></html>`

const files = {
  '/jfp.css': fs.readFileSync(path.join(root, 'src/styles/jfp.css')),
  '/jfp-portal.css': fs.readFileSync(path.join(root, 'src/styles/jfp-portal.css')),
}
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0]
  if (files[url]) { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(files[url]) }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(page(url === '/light' ? 'light' : 'dark'))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

// Page background per theme, so translucent layers composite onto the truth.
const PAGE = { dark: [14, 14, 13], light: [255, 255, 255] }

async function measure(theme) {
  const tab = await (await fetch(`${CDP}/json/new?http://127.0.0.1:${port}/${theme}`, { method: 'PUT' })).json()
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let id = 0; const waiting = new Map()
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id) } }
  await new Promise((r) => setTimeout(r, 700))
  const expression = `(() => {
    const PAGE = ${JSON.stringify(PAGE[theme])}
    const parse = (c) => { const p = (c.match(/[\\d.]+/g) || []).map(Number); return p.length ? { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } : null }
    const over = (c, bg) => [c.r * c.a + bg[0] * (1 - c.a), c.g * c.a + bg[1] * (1 - c.a), c.b * c.a + bg[2] * (1 - c.a)]
    const solidBg = (el) => { const stack = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) stack.push(c); if (c && c.a === 1) break } return stack.reverse().reduce((bg, c) => over(c, bg), PAGE) }
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
    const out = []
    document.querySelectorAll('*').forEach((el) => {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (!hasText && !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return
      const s = getComputedStyle(el)
      const fg = parse(s.color); if (!fg || fg.a === 0) return
      const bg = solidBg(el)
      const a = lum(over(fg, bg)), b = lum(bg)
      const px = parseFloat(s.fontSize), bold = (parseInt(s.fontWeight) || 400) >= 700
      out.push({ what: el.getAttribute('class') || el.tagName, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), need: (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5, color: s.color })
    })
    return out
  })()`
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  ws.close()
  await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {})
  if (!r?.result?.value) throw new Error(`could not read styles in ${theme} mode`)
  return r.result.value
}

let failures = 0, checked = 0
for (const theme of ['dark', 'light']) {
  let bad = 0
  for (const x of await measure(theme)) {
    checked += 1
    if (x.ratio >= x.need) continue
    bad += 1
    console.log(`FAIL ${theme}: ${x.what} is ${x.ratio.toFixed(2)}:1, needs ${x.need}:1 (${x.color})`)
  }
  failures += bad
  if (!bad) console.log(`ok - every ${theme} component meets WCAG AA`)
}
server.close()
console.log(`\n${checked} contrast checks in ${version.Browser}`)
if (failures) { console.error(`${failures} contrast failure(s)`); process.exit(1) }
