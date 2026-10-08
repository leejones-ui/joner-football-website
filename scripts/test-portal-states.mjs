// A pressed or selected control must LOOK different from an unpressed one.
// Contrast alone never catches this: grey-on-dark reads fine, it just looks
// identical to the unmarked state, so a coach marks a register and sees
// nothing change. That is exactly what happened in dark mode on 8 Oct 2026,
// where an over-broad dark rule repainted the Here/Away marks back to plain.
//
//   node scripts/test-portal-states.mjs
//
// Needs the fleet Chrome on CDP 18894; skips (exit 0) if it is not running.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const CDP = process.env.JFP_CDP || 'http://127.0.0.1:18894'
const root = path.join(import.meta.dirname, '..')
let version
try { version = await (await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(2500) })).json() } catch {
  console.log(`skipped: no CDP browser on ${CDP}`); process.exit(0)
}

// Each pair renders the same control off and on. They must not look the same.
const PAIRS = [
  ['register Here', '<div class="jp-att"><button class="p" aria-pressed="false">Here</button></div>', '<div class="jp-att"><button class="p" aria-pressed="true">Here</button></div>', 'button'],
  ['register Away', '<div class="jp-att"><button class="a" aria-pressed="false">Away</button></div>', '<div class="jp-att"><button class="a" aria-pressed="true">Away</button></div>', 'button'],
  ['day bar', '<div class="j-daybar"><button aria-selected="false">Monday</button></div>', '<div class="j-daybar"><button aria-selected="true">Monday</button></div>', 'button'],
  ['portal segment', '<div class="jp-seg"><button aria-pressed="false">One</button></div>', '<div class="jp-seg"><button aria-pressed="true">One</button></div>', 'button'],
  ['segment', '<div class="j-seg"><button aria-pressed="false">One</button></div>', '<div class="j-seg"><button aria-pressed="true">One</button></div>', 'button'],
  ['chip', '<span class="j-chip" aria-pressed="false">Chip</span>', '<span class="j-chip" aria-pressed="true">Chip</span>', '.j-chip'],
  ['player row', '<button class="j-player">Row</button>', '<button class="j-player on">Row</button>', '.j-player'],
]

const files = {
  '/jfp.css': fs.readFileSync(path.join(root, 'src/styles/jfp.css')),
  '/jfp-portal.css': fs.readFileSync(path.join(root, 'src/styles/jfp-portal.css')),
}
const page = (theme) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/jfp.css"><link rel="stylesheet" href="/jfp-portal.css"></head><body>
<div class="jfp jp-theme" data-theme="${theme}">${PAIRS.map(([n, off, on], i) =>
  `<div id="off-${i}">${off}</div><div id="on-${i}">${on}</div>`).join('')}</div></body></html>`

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0]
  if (files[url]) { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(files[url]) }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(page(url === '/light' ? 'light' : 'dark'))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

async function look(theme) {
  const tab = await (await fetch(`${CDP}/json/new?http://127.0.0.1:${port}/${theme}`, { method: 'PUT' })).json()
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let id = 0; const waiting = new Map()
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id) } }
  await new Promise((r) => setTimeout(r, 700))
  const expression = `(() => {
    const sel = ${JSON.stringify(PAIRS.map((p) => p[3]))}
    const read = (el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.color, s.borderColor, s.fontWeight, s.textDecorationLine, s.boxShadow].join('|') }
    return sel.map((q, i) => ({
      off: read(document.querySelector('#off-' + i + ' ' + q)),
      on: read(document.querySelector('#on-' + i + ' ' + q)),
    }))
  })()`
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  ws.close(); await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {})
  if (!r?.result?.value) throw new Error(`could not read styles in ${theme}`)
  return r.result.value
}

let failures = 0, checked = 0
for (const theme of ['dark', 'light']) {
  const seen = await look(theme)
  let bad = 0
  seen.forEach((x, i) => {
    checked += 1
    if (x.off !== x.on) return
    bad += 1; failures += 1
    console.log(`FAIL ${theme}: "${PAIRS[i][0]}" looks identical pressed and unpressed (${x.on})`)
  })
  if (!bad) console.log(`ok - every ${theme} control changes when it is pressed`)
}
server.close()
console.log(`\n${checked} state checks in ${version.Browser}`)
if (failures) { console.error(`${failures} control(s) give no feedback`); process.exit(1) }
