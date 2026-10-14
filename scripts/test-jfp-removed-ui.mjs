// Removed players in the staff portal pages (Lee, 14 Oct 2026), in jsdom
// with invented data: Players > Removed (reason, date, by, from group, the
// reasons this term, Add back and Open), a removed row is no longer mixed in
// with the players holding a place, Find an existing player on every Add
// form (removed shown with "Removed <date>: <reason>", picking fills
// everything and the add says fromRemoved), and the Remove dialog wording.
import assert from 'node:assert/strict'
import { openPortal } from './jfp-portal-dom.mjs'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

const G1 = { id: 'g1', day: 'Thursday', time: '7:30am', location: 'Belrose HQ', locationId: 'belrose', locationName: 'Belrose HQ', coachId: 'sam', coachName: 'Sam', capacity: 8, mode: 'direct', product: 'group', players: [{ rowId: 'recLIVE0000000001', name: 'Lou Live', age: 11, status: 'Confirmed', paymentStatus: 'Unpaid', waiver: true }], taken: 1, holds: 0, placesLeft: 7, confirmed: 1, sortTime: '07:30', period: 'am', pendingRequests: 0, extraCoachNames: [] }
const BOARD = { success: true, term: 'Term 4 2026', at: Date.now(), totals: { players: 1, dashboard: 1, awaiting: 0, placesLeft: 7, pendingRequests: 0, waivers: 0 }, groups: [G1], unassigned: [], coaches: [], locations: [{ id: 'belrose', name: 'Belrose HQ' }] }
const PRICING = { success: true, weeks: 10, today: '2026-10-14', prices: { group: 85000, trial: 8500 }, products: [{ key: 'group', label: 'Term, small group', type: 'JFP 10 weeks', proRata: true, perPlaces: 1, cents: 85000 }], datesByDay: { Thursday: [{ iso: '2026-10-16', label: 'Thu 16 Oct', past: false }] }, priceList: [], programmes: [], holidayPeriods: [], runs: { byGroup: {}, noGroup: { left: 9 } } }
const row = (o) => ({ dob: '', age: 11, club: '', profile: null, parent: 'Pat Parent', email: 'pat@example.com', phone: '0400 000 000', ownContact: false, pro: false, groupId: 'g1', groupLabel: 'Thursday 7:30am, Belrose HQ', day: 'Thursday', time: '7:30am', location: 'Belrose HQ', coach: 'Sam', coachId: 'sam', confirmation: 'Confirmed', paymentStatus: 'Unpaid', paymentType: 'JFP 10 weeks', feeAud: 850, paidAud: 0, balanceAud: 850, kit: '', waiver: { onFile: true }, notes: '', inGroup: true, holdsPlace: true, trial: false, ...o })
const PLAYERS = { success: true, players: [row({ rowId: 'recLIVE0000000001', name: 'Lou Live' }), row({ rowId: 'recDROP0000000002', name: 'Dot Dropped', confirmation: 'Dropped', holdsPlace: false, paymentStatus: 'Paid', paidAud: 850 })], groups: [{ id: 'g1', label: 'Thursday 7:30am, Belrose HQ', coachId: 'sam' }], coaches: [{ id: 'sam', name: 'Sam' }], locations: [] }
const REMOVED = {
  success: true, term: 'Term 4 2026', reasons: [],
  counts: [{ reason: 'Time or schedule clash', count: 2 }, { reason: 'Cost', count: 1 }],
  players: [
    { droppedId: 'recDRP00000000001', name: 'Rory Rejoin', parent: 'Ruth Rejoin', email: 'rory@example.com', phone: '0400 222 333', term: 'Term 4 2026', reason: 'Time or schedule clash', details: 'Trying another day', removedAt: '2026-10-14T01:00:00Z', removedBy: 'Lee Jones', session: 'Thursday 7:30am Belrose HQ', coach: 'Sam Yorks', groupId: 'g1', groupLabel: 'Thursday 7:30am, Belrose HQ', paymentStatus: 'Unpaid', feeCents: 85000, paidCents: 0, restored: false, ownContact: false },
    { droppedId: 'recDRP00000000002', name: 'Dot Dropped', parent: 'Dee Dropped', email: 'dot@example.com', term: 'Term 4 2026', reason: 'Cost', details: '', removedAt: '2026-10-10T01:00:00Z', removedBy: 'Lee Jones', session: 'Friday 4pm Belrose HQ', groupId: '', groupLabel: '', paymentStatus: 'Paid', feeCents: 85000, paidCents: 85000, restored: false, ownContact: false },
    { droppedId: 'recDRP00000000003', name: 'Bea Back', parent: 'Bo Back', email: 'bea@example.com', term: 'Term 4 2026', reason: 'Time or schedule clash', details: 'Added back 2026-10-12', removedAt: '2026-10-09T01:00:00Z', removedBy: 'Lee Jones', session: 'Thursday 7:30am Belrose HQ', groupId: 'g1', groupLabel: 'Thursday 7:30am, Belrose HQ', restored: true, ownContact: false },
  ],
}
const PREFILL = { success: true, player: { name: 'Rory Rejoin', parentName: 'Ruth Rejoin', email: 'rory@example.com', mobile: '0400 222 333', ownContact: false, dob: '2014-05-06', waiver: true, profile: { club: 'Rejoin Rovers', level: 'NPL', positions: ['Winger'], emergencyName: 'Gran Rejoin', parent2Name: 'Rob Rejoin' }, removed: { droppedId: 'recDRP00000000001', at: '2026-10-14T01:00:00Z', by: 'Lee Jones', reason: 'Time or schedule clash', session: 'Thursday 7:30am Belrose HQ', groupId: 'g1', groupLabel: 'Thursday 7:30am, Belrose HQ', label: 'Removed 14 Oct: Time or schedule clash' } } }
const SEARCH = { success: true, results: [{ name: 'Rory Rejoin', parentName: 'Ruth Rejoin', email: 'rory@example.com', mobile: '0400 222 333', ownContact: false, source: 'Removed, was Thursday 7:30am Belrose HQ', removed: { droppedId: 'recDRP00000000001', rowId: '', label: 'Removed 14 Oct: Time or schedule clash', reason: 'Time or schedule clash', groupId: 'g1', session: 'Thursday 7:30am Belrose HQ' } }, { name: 'Rory Other', parentName: 'Ola Other', email: 'ola@example.com', source: 'Term 3, Monday 4pm', waiver: true }] }
const answers = (b) => {
  if (b.action === 'playersList') return structuredClone(PLAYERS)
  if (b.action === 'removed') return structuredClone(REMOVED)
  if (b.action === 'board') return structuredClone(BOARD)
  if (b.action === 'pricing') return PRICING
  if (b.action === 'searchPlayers') return SEARCH
  if (b.action === 'removedPlayer') return structuredClone(PREFILL)
  if (b.action === 'addFamily') return { success: true, rows: b.children.map((c, i) => ({ rowId: `recFAM0000000000${i}`, name: c.player.name, where: 'Thursday 7:30am, Belrose HQ' })), payreq: null, emailed: false }
  if (b.action === 'addPlayer' || b.action === 'addPlayerNoGroup') return { success: true, rowId: 'recNEW00000000009', payreq: null, emailed: false, words: { self: false, contact: 'Ruth' } }
  return null
}
const typeIn = async (p, sel, v) => { const el = p.$(sel); el.value = v; el.dispatchEvent(new p.w.Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); await p.settle() }

await test('Players: Removed has its own list with reason, date, by and group; the removed row is out of the main list', async () => {
  const p = await openPortal({ hash: '#families', onPost: answers })
  assert.ok(p.$('tr[data-pl="recLIVE0000000001"]'))
  assert.equal(p.$('tr[data-pl="recDROP0000000002"]'), null, 'a Dropped row is not mixed in with players holding a place')
  const chip = p.$('[data-chip="place:removed"]')
  assert.match(chip.textContent, /Removed\s*2/, 'two not back yet')
  await p.click(chip)
  assert.match(p.text('.ps-count'), /2 removed/)
  const t = p.text('#pl-removed')
  assert.match(t, /Rory Rejoin.*14 Oct 2026.*by Lee Jones.*Time or schedule clash.*Trying another day.*Thursday 7:30am, Belrose HQ.*Sam Yorks/)
  assert.match(t, /Bea Back ?Back/, 'players since added back stay in the history, marked Back')
  assert.match(p.text('.ps-chips[aria-label^="Why players left"]'), /Why they left Term 4 2026:.*Time or schedule clash · 2.*Cost · 1/)
  await typeIn(p, '#pl-q', 'cost')
  assert.equal(p.d.querySelectorAll('#pl-removed tbody tr[data-rm-row]').length, 1, 'search covers the reason')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Removed > Open shows the full record; Add back picks the group they were in, then the add form, prefilled', async () => {
  const p = await openPortal({ hash: '#families', onPost: answers })
  await p.click('[data-chip="place:removed"]')
  await p.click('[data-rm-detail="recDRP00000000001"]')
  assert.match(p.text('#jp-modal'), /Rory Rejoin.*Removed 14 Oct 2026 by Lee Jones, Term 4 2026.*Time or schedule clash.*Trying another day.*Was in.*Thursday 7:30am, Belrose HQ/)
  await p.click('#rmd-back')
  assert.match(p.text('#jp-modal h2'), /Add Rory Rejoin back/)
  assert.equal(p.$('#ab-g').value, 'g1', 'the group defaults to where they were')
  assert.ok([...p.$('#ab-g').options].some((o) => o.value === '' && /No group yet/.test(o.textContent)))
  await p.click('#ab-go')
  assert.equal(p.$('#ap-name').value, 'Rory Rejoin'); assert.equal(p.$('#ap-email').value, 'rory@example.com'); assert.equal(p.$('#ap-parent').value, 'Ruth Rejoin')
  assert.equal(p.$('#ap-dob').value, '2014-05-06'); assert.equal(p.$('#ap-club').value, 'Rejoin Rovers'); assert.equal(p.$('#ap-level').value, 'NPL'); assert.equal(p.$('#ap-ename').value, 'Gran Rejoin'); assert.equal(p.$('#ap-p2name').value, 'Rob Rejoin')
  assert.equal(p.$('#ap-pos [data-pos="Winger"]').getAttribute('aria-pressed'), 'true')
  assert.match(p.text('#ap-results'), /Adding Rory Rejoin back\. Removed 14 Oct: Time or schedule clash, was in Thursday 7:30am Belrose HQ\..*player information and waiver are on file and carried over/)
  await p.pick('#ap-pay', 'sessions')
  p.$('#ap-per').value = '42'
  await p.click('#ap-go')
  const add = p.posts.find((b) => b.action === 'addPlayer')
  assert.ok(add, 'sent')
  assert.equal(add.groupId, 'g1'); assert.equal(add.fromRemoved, 'recDRP00000000001')
  assert.deepEqual([add.payment, add.perSessionCents], ['sessions', 4200], 'a new price and payment option')
  assert.equal(add.profile.club, 'Rejoin Rovers'); assert.equal(add.parent.email, 'rory@example.com')
  p.close()
})

await test('Add back with no group yet opens the Players tab add, prefilled', async () => {
  const p = await openPortal({ hash: '#families', onPost: answers })
  await p.click('[data-chip="place:removed"]')
  await p.click('[data-rm-back="recDRP00000000001"]')
  await p.pick('#ab-g', '')
  await p.click('#ab-go')
  assert.equal(p.$('#pa-name').value, 'Rory Rejoin')
  await p.click('#pa-go')
  const add = p.posts.find((b) => b.action === 'addPlayerNoGroup')
  assert.equal(add.fromRemoved, 'recDRP00000000001'); assert.equal(add.parent.name, 'Ruth Rejoin')
  p.close()
})

await test('Find an existing player on the Players tab add shows removed players with when and why; a changed name drops the link', async () => {
  const p = await openPortal({ hash: '#families', onPost: answers })
  await p.click('#pl-add')
  await typeIn(p, '#pa-search', 'rory')
  assert.match(p.text('#pa-results'), /Rory Rejoin.*Removed 14 Oct: Time or schedule clash · was Thursday 7:30am Belrose HQ.*Removed.*Rory Other.*Term 3, Monday 4pm.*Waiver/)
  await p.click('#pa-results [data-pick="0"]')
  assert.ok(p.posts.some((b) => b.action === 'removedPlayer' && b.droppedId === 'recDRP00000000001'))
  assert.equal(p.$('#pa-club').value, 'Rejoin Rovers')
  p.$('#pa-name').value = 'Someone Else'
  await p.click('#pa-go')
  assert.equal(p.posts.find((b) => b.action === 'addPlayerNoGroup').fromRemoved, undefined, 'not marked back under another name')
  p.close()
})

await test('Add a family: Find an existing player fills the parent and a child, and that child is marked back', async () => {
  const p = await openPortal({ hash: '#families', onPost: answers })
  await p.click('#ps-more')
  await p.click('#jp-menu [data-i="family"]')
  await typeIn(p, '#fa-search', 'rory')
  await p.click('#fa-results [data-pick="0"]')
  assert.equal(p.$('#fa-pname').value, 'Ruth Rejoin'); assert.equal(p.$('#fa-pemail').value, 'rory@example.com')
  const names = [...p.d.querySelectorAll('[data-child-block] input[id$="-name"]')]
  assert.equal(names[0].value, 'Rory Rejoin')
  const gsel = p.d.querySelector('[data-child-block] select[id$="-group"]')
  assert.equal(gsel.value, 'g1', 'their group')
  names[1].value = 'Remy Rejoin'; names[1].dispatchEvent(new p.w.Event('input', { bubbles: true }))
  await p.click('#fa-go')
  const fam = p.posts.find((b) => b.action === 'addFamily')
  assert.equal(fam.children[0].fromRemoved, 'recDRP00000000001'); assert.equal(fam.children[1].fromRemoved, undefined)
  p.close()
})

await test('Remove: the dialog says they stay on file and can be added back any time', async () => {
  const p = await openPortal({ hash: '#board', onPost: answers })
  await p.click('[data-row="recLIVE0000000001"]')
  await p.click('#jp-menu [data-i="remove"]')
  assert.match(p.text('#jp-modal'), /they stay on file: contact details, player information, waiver and history are kept, with the reason below\. Find them any time under Players > Removed, or search their name in Add a player to add them back to any group, with a new price\./)
  assert.deepEqual(p.errors, [])
  p.close()
})

console.log(`\n${passed} removed player page checks passed`)
