// The staff portal in jsdom, fed a money payload: for the Money page checks
// (scripts/test-jfp-money-ui.mjs with invented data, and the flow test with
// the harness's own payload). Not a real browser: no layout and no CSS, so
// phone widths are checked by eye, not here.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = fileURLToPath(new URL('../', import.meta.url))
let bundled = null
async function bundle() {
  if (!bundled) bundled = (await build({ entryPoints: [path.join(root, 'src/scripts/jfp-portal.js')], bundle: true, write: false, format: 'iife', target: 'es2022', logLevel: 'silent' })).outputFiles[0].text
  return bundled
}
// The portal's markup, straight from the page, so the ids stay in step.
function markup() {
  const astro = fs.readFileSync(path.join(root, 'src/pages/jfp-portal.astro'), 'utf8')
  return astro.slice(astro.indexOf('<div class="jfp jp-theme"'), astro.indexOf('</BaseLayout>'))
}

// onPost(body) may answer an action itself (return the JSON), else the defaults below.
export async function openPortal({ money, hash = '#money', player = null, onPost = null } = {}) {
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => { if (!/Not implemented: navigation/.test(e.message)) errors.push(e) })
  const dom = new JSDOM(`<!doctype html><html><body>${markup()}</body></html>`, { url: `http://localhost/jfp-portal/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  const w = dom.window
  const posts = [], downloads = []
  w.setInterval = () => 0
  w.scrollTo = () => {}
  w.CSS = w.CSS || { escape: (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) }
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  w.URL.createObjectURL = (blob) => { downloads.push({ blob, name: '' }); return `blob:jfp-${downloads.length}` }
  w.URL.revokeObjectURL = () => {}
  w.HTMLAnchorElement.prototype.click = function () { const d = downloads.at(-1); if (d && this.href.startsWith('blob:')) d.name = this.download }
  w.addEventListener('unhandledrejection', (e) => errors.push(e.reason))
  const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data })
  w.fetch = async (url, init = {}) => {
    if (String(url).startsWith('/api/jfp-auth')) return reply({ success: true, user: { name: 'Coach Test', role: 'admin', email: 'staff@example.com' } })
    const body = init.body ? JSON.parse(init.body) : {}
    posts.push(body)
    const custom = onPost?.(body)
    // { status, ...json } answers with that HTTP status.
    if (custom) { const { status, ...json } = custom; return reply(typeof status === 'number' ? json : custom, typeof status === 'number' ? status : 200) }
    if (body.action === 'money') return reply({ success: true, money })
    if (body.action === 'requests') return reply({ success: true, requests: [] })
    if (body.action === 'juniorsMoney') return reply({ success: false, error: 'Not in this test.' }, 503)
    if (body.action === 'playerPayments') return reply({ success: true, player: player || { player: 'Test', parent: '', email: '', feeCents: 0, paidCents: 0, stripe: [], ledger: [], links: [], history: [] } })
    return reply({ success: true })
  }
  w.eval(await bundle())
  const d = w.document
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 4)) }
  await settle()
  const $ = (sel) => d.querySelector(sel)
  const text = (sel) => ($(sel)?.textContent || '').replace(/\s+/g, ' ').trim()
  const click = async (sel) => {
    const el = typeof sel === 'string' ? $(sel) : sel
    if (!el) throw new Error(`Nothing to click: ${sel}`)
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    await settle()
  }
  const csv = async (i = -1) => { const x = downloads.at(i); return { name: x.name, text: (await x.blob.text()).replace(/^﻿/, '') } }
  return { dom, w, d, $, text, click, settle, posts, downloads, csv, errors, close: () => w.close() }
}

// A CSV line back into cells (quotes and doubled quotes only; enough for these checks).
export function csvRows(text) {
  return text.split('\r\n').map((line) => {
    const out = []
    let cur = '', q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
      else if (c === '"') q = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur)
    return out
  })
}
