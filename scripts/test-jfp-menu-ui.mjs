// The calmer menu (Lee, 15 Nov 2026), in jsdom: 13 links for Lee and Ligia,
// related pages as tabs, the To do page, Find, and Back. Coaches keep theirs.
//   node scripts/test-jfp-menu-ui.mjs
// Every name here is invented.
import assert from 'node:assert/strict'
import { openPortal } from './jfp-portal-dom.mjs'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
const answers = (b) => {
  if (b.action === 'requests') return { success: true, requests: [], extraRequests: [], count: 3 }
  if (b.action === 'playersList') return { success: true, players: [{ rowId: 'recA', name: 'Ivy Test', parent: 'Pat Example', email: 'pat@example.com', phone: '', groupLabel: 'Mon 5pm', holdsPlace: true }, { rowId: 'recB', name: 'Jax Sample', parent: 'Sam Sample', email: 'sam@example.com', phone: '', groupLabel: 'Tue 4pm', holdsPlace: true }] }
  return null
}

await test('Lee and Ligia: 13 links, no folded groups, Register, Camps and Shop on their own', async () => {
  const p = await openPortal({ hash: '#todo', onPost: answers })
  assert.deepEqual([...p.d.querySelectorAll('#nav [data-tab]')].map((b) => b.dataset.label), ['Home', 'To do', 'Register', 'Players', 'Timetable', 'Joining', 'Messages', 'Money', 'Coaches', 'Joners Juniors', 'Camps', 'Shop', 'Settings'])
  assert.equal(p.d.querySelectorAll('#nav .jp-navgrp').length, 0)
  assert.equal(p.$('#nav [aria-current="page"]').dataset.tab, 'todo')
  assert.equal(p.$('#hubtabs').hidden, true, 'To do is one page: no tabs')
  p.close()
})

await test('a hub link opens its first page and shows the rest as tabs; every old address still opens', async () => {
  const p = await openPortal({ hash: '#todo', onPost: answers })
  await p.click('#nav [data-hub="coaches"]')
  assert.deepEqual([...p.d.querySelectorAll('#hubtabs [data-tab]')].map((b) => b.textContent.trim()), ['Our coaches', 'Coach hours', 'Coach invoices', 'Cover and time off', 'Player reports', 'Extra sessions', 'Session ideas', 'Session plans'])
  assert.equal(p.$('#hubtabs [aria-selected="true"]').dataset.tab, 'team')
  assert.equal(p.$('#nav [data-hub="coaches"]').getAttribute('aria-current'), 'page')
  await p.click('#hubtabs [data-tab="hours"]')
  assert.equal(p.w.location.hash, '#hours')
  assert.equal(p.$('#hubtabs [aria-selected="true"]').dataset.tab, 'hours')
  p.close()
  const old = await openPortal({ hash: '#audit', onPost: answers })
  assert.equal(old.$('#nav [data-hub="admin"]').getAttribute('aria-current'), 'page')
  assert.equal(old.$('#hubtabs [aria-selected="true"]').dataset.tab, 'audit')
  old.close()
})

await test('To do: what is waiting, counted once, on the menu and in the list', async () => {
  const p = await openPortal({ hash: '#todo', onPost: (b) => (b.action === 'requestCount' || b.action === 'requests' ? { success: true, requests: [], extraRequests: [], count: 3, pending: 3 } : answers(b)) })
  assert.match(p.text('#view h1'), /^To do$/)
  assert.ok(p.$('#todo-list'))
  const n = Number(p.text('#nav [data-tab="todo"] .count') || 0)
  const rows = [...p.d.querySelectorAll('#todo-list .jt-list:not(.jt-done) .jt-n')].reduce((t, x) => t + Number(x.textContent), 0)
  assert.equal(rows, n, 'the list adds up to the badge')
  p.close()
})

await test('Find: a page by name, a player by name or parent, opened with Enter', async () => {
  const p = await openPortal({ hash: '#todo', onPost: answers })
  await p.click('#find-open')
  const q = p.$('#jp-find-q')
  assert.ok(q, 'the box opens')
  const type = async (v) => { q.value = v; q.dispatchEvent(new p.w.Event('input', { bubbles: true })); await p.settle() }
  await type('invoices')
  assert.deepEqual([...p.d.querySelectorAll('.jp-find-hit b')].map((b) => b.textContent), ['Coach invoices'])
  await type('pat exa')
  assert.deepEqual([...p.d.querySelectorAll('.jp-find-hit')].map((b) => `${b.querySelector('.k').textContent}:${b.querySelector('b').textContent}`), ['Player:Ivy Test'])
  await type('prices')
  q.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await p.settle()
  assert.equal(p.$('#jp-find'), null, 'it closes')
  assert.equal(p.w.location.hash, '#prices')
  p.close()
})

await test('coaches keep their own three groups, with no To do and no hub tabs', async () => {
  const p = await openPortal({ hash: '#program', role: 'coach', onPost: answers })
  assert.deepEqual([...p.d.querySelectorAll('#nav [data-navsec]')].map((b) => b.dataset.navsec), ['My coaching', 'Time and pay', 'Ideas and plans'])
  assert.equal(p.$('#nav [data-tab="todo"]'), null)
  assert.equal(p.$('#hubtabs').hidden, true)
  p.close()
})

console.log(`\n${passed} menu checks passed`)
