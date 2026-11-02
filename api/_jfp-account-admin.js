// Admin-only account lifecycle operations. These deliberately operate on the
// account index and profile links only: Term 4 rows, payments, waivers and
// session records are never edited or deleted by this module.
import { ACCOUNTS, allAccounts, accountOf } from './_jfp-account-open.js'
import { kvCommand, audit, clean, validEmail, normName } from './_jfp-store.js'
import { profileKey, saveProfile, sameChild, PROFILE_KEYS, PROFILES_TABLE } from './_jfp-profiles.js'
import { airtable } from './_jfp-airtable.js'

export const ACCOUNT_STATES = new Set(['active', 'reviewed', 'archived'])
const emailOf = (v) => validEmail(v)
const keyOf = (a) => String(a?.email || '').toLowerCase()

export function accountState(a) { return a?.archivedAt ? 'archived' : (a?.reviewedAt ? 'reviewed' : 'active') }
export function playerKeys(a) { return new Set((a?.players || []).map((p) => p.key || normName(p.name)).filter(Boolean)) }
export function archiveRecord(account, by, at = new Date().toISOString()) { return { ...account, archivedAt: at, archivedBy: clean(by, 120) } }
export function restoreRecord(account) { return { ...account, archivedAt: '', archivedBy: '' } }

// References are intentionally conservative. A false positive archives instead
// of deletes, which is safer than losing history.
export function accountReferences(account, { profiles = [], roster = {}, payments = [], waivers = [], sessions = [] } = {}) {
  const email = keyOf(account)
  const rows = roster.players || roster.rows || []
  const refs = {
    profiles: profiles.filter((p) => (p.emails || []).map((e) => e.toLowerCase()).includes(email)),
    term4Rows: rows.filter((r) => (r.emails || [r.email]).some((e) => String(e || '').toLowerCase().includes(email))),
    payments: payments.filter((p) => JSON.stringify(p).toLowerCase().includes(email)),
    waivers: waivers.filter((w) => JSON.stringify(w).toLowerCase().includes(email)),
    sessions: sessions.filter((s) => JSON.stringify(s).toLowerCase().includes(email)),
  }
  // A row with a linked session/payment/waiver is also a reference even when
  // its email cell was normalised differently.
  for (const r of refs.term4Rows) {
    if (r.holdsPlace || r.groupId || r.sessionId || r.paymentStatus || r.paymentType) refs.sessions.push(r)
    if (r.waiver || r.waiverId) refs.waivers.push(r)
    if (r.paidAud != null || r.feeAud != null || r.paymentStatus) refs.payments.push(r)
  }
  return refs
}
export function hasReferences(refs) { return Object.values(refs).some((x) => Array.isArray(x) && x.length > 0) }
export function canDeleteEmpty(account, refs) { return Boolean(account && !(account.players || []).length && !hasReferences(refs)) }

export function mergePreview(source, target, { profiles = [], roster = {}, payments = [], waivers = [], sessions = [] } = {}) {
  if (!source || !target) return { ok: false, error: 'Both accounts are required.' }
  if (keyOf(source) === keyOf(target)) return { ok: false, error: 'Choose two different accounts.' }
  if (accountState(source) === 'archived' || accountState(target) === 'archived') return { ok: false, error: 'Archived accounts must be restored before merging.' }
  const sourcePlayers = [...(source.players || [])]
  const targetKeys = playerKeys(target)
  const duplicates = sourcePlayers.filter((p) => targetKeys.has(p.key || normName(p.name)))
  const refs = accountReferences(source, { profiles, roster, payments, waivers, sessions })
  return { ok: true, source: keyOf(source), target: keyOf(target), duplicatePlayers: duplicates.map((p) => p.name || p.key), sourceReferences: Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.length])), preview: { playersAdded: sourcePlayers.length - duplicates.length, profilesLinked: refs.profiles.length, historyPreserved: hasReferences(refs) } }
}

async function saveAccount(rec) { await kvCommand(['HSET', ACCOUNTS, keyOf(rec), JSON.stringify(rec)]); return rec }
async function lock(id) {
  const key = `jfp:account-admin-lock:${id}`
  const got = await kvCommand(['SET', key, '1', 'NX', 'EX', '30'])
  if (got !== 'OK') throw Object.assign(new Error('That account is being changed by someone else. Refresh and try again.'), { status: 409 })
  return key
}
async function unlock(key) { if (key) await kvCommand(['DEL', key]).catch(() => {}) }

export async function viewAccount(email, deps = {}) {
  const account = await accountOf(email)
  if (!account) return null
  const refs = accountReferences(account, deps)
  return { ...account, state: accountState(account), references: Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.length])) }
}

export async function markReviewed(email, by) {
  const account = await accountOf(email); if (!account) return { ok: false, status: 404, error: 'Account not found.' }
  const next = { ...account, reviewedAt: new Date().toISOString(), reviewedBy: clean(by, 120) }
  await saveAccount(next); await audit({ by, action: 'account.review', target: email, after: { reviewedAt: next.reviewedAt } }); return { ok: true, account: next }
}
export async function archiveAccount(email, by) { return setArchived(email, by, true) }
export async function restoreAccount(email, by) { return setArchived(email, by, false) }
async function setArchived(email, by, archived) {
  const account = await accountOf(email); if (!account) return { ok: false, status: 404, error: 'Account not found.' }
  const next = archived ? archiveRecord(account, by) : restoreRecord(account)
  await saveAccount(next); await audit({ by, action: archived ? 'account.archive' : 'account.restore', target: email }); return { ok: true, account: next }
}

export async function deleteEmptyAccount(email, by, deps = {}) {
  const account = await accountOf(email); if (!account) return { ok: false, status: 404, error: 'Account not found.' }
  const refs = accountReferences(account, deps)
  if (!canDeleteEmpty(account, refs)) return { ok: false, status: 409, error: 'This account has linked history. Archive it instead.', references: Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.length])) }
  const lk = await lock(email)
  try {
    const again = await accountOf(email)
    if (!again || (again.players || []).length) return { ok: false, status: 409, error: 'Account changed; refresh and try again.' }
    await kvCommand(['HDEL', ACCOUNTS, keyOf(again)])
    await audit({ by, action: 'account.delete', target: email, after: { emptyOnly: true } })
    return { ok: true, deleted: email }
  } finally { await unlock(lk) }
}

export async function changeContactEmail(oldEmail, newEmail, by, { profiles = [] } = {}) {
  const old = await accountOf(oldEmail); const nextEmail = emailOf(newEmail)
  if (!old) return { ok: false, status: 404, error: 'Account not found.' }
  if (!nextEmail) return { ok: false, status: 400, error: 'Enter a valid contact email.' }
  if (keyOf(old) === nextEmail) return { ok: false, status: 400, error: 'That is already the contact email.' }
  if (await accountOf(nextEmail)) return { ok: false, status: 409, error: 'That email already has an account. Merge the accounts instead.' }
  const lk = await lock(oldEmail)
  try {
    const moved = { ...old, email: nextEmail, emailChangedFrom: keyOf(old), emailChangedAt: new Date().toISOString(), emailChangedBy: clean(by, 120) }
    await saveAccount(moved)
    await kvCommand(['HSET', ACCOUNTS, keyOf(old), JSON.stringify({ ...old, archivedAt: moved.emailChangedAt, archivedBy: clean(by, 120), redirectTo: nextEmail })])
    for (const p of profiles.filter((p) => (p.emails || []).map((e) => e.toLowerCase()).includes(keyOf(old)))) {
      // Keep the old address as historical evidence, while adding the new
      // contact so the family can still see every existing profile.
      await saveProfile({ existing: p, name: p.name, key: p.key || profileKey(p.name, nextEmail), emails: [nextEmail], rowIds: [], values: {}, by, from: 'Account email change' })
    }
    await audit({ by, action: 'account.changeEmail', target: nextEmail, before: { email: keyOf(old) }, after: { email: nextEmail } })
    return { ok: true, account: moved }
  } finally { await unlock(lk) }
}

export async function mergeAccounts(sourceEmail, targetEmail, by, deps = {}) {
  const source = await accountOf(sourceEmail); const target = await accountOf(targetEmail)
  const preview = mergePreview(source, target, deps)
  if (!preview.ok) return { ...preview, status: 409 }
  const lk = await lock(`${keyOf(source)}:${keyOf(target)}`)
  try {
    const freshSource = await accountOf(sourceEmail); const freshTarget = await accountOf(targetEmail)
    const check = mergePreview(freshSource, freshTarget, deps)
    if (!check.ok) return { ...check, status: 409 }
    const keys = playerKeys(freshTarget); const players = [...(freshTarget.players || [])]
    for (const p of freshSource.players || []) { const k = p.key || normName(p.name); if (!keys.has(k)) { players.push(p); keys.add(k) } }
    const now = new Date().toISOString()
    await saveAccount({ ...freshTarget, players, mergedFrom: [...new Set([...(freshTarget.mergedFrom || []), keyOf(freshSource)])], mergedAt: now, mergedBy: clean(by, 120) })
    await saveAccount({ ...freshSource, archivedAt: now, archivedBy: clean(by, 120), mergedInto: keyOf(freshTarget) })
    for (const p of (deps.profiles || []).filter((p) => (p.emails || []).map((e) => e.toLowerCase()).includes(keyOf(freshSource)))) {
      await saveProfile({ existing: p, name: p.name, key: p.key || profileKey(p.name, targetEmail), emails: [targetEmail], rowIds: [], values: {}, by, from: 'Account merge' })
    }
    await audit({ by, action: 'account.merge', target: keyOf(freshTarget), before: { source: keyOf(freshSource), target: keyOf(freshTarget), preview: check.preview }, after: { sourceArchived: true, players: players.length, historyPreserved: true } })
    return { ok: true, account: { ...freshTarget, players, state: 'active' }, preview: check.preview }
  } finally { await unlock(lk) }
}

export async function linkExistingPlayer(accountEmail, player, by) {
  const account = await accountOf(accountEmail)
  if (!account) return { ok: false, status: 404, error: 'Account not found.' }
  const key = player.key || profileKey(player.name, accountEmail)
  if (!key || !player.name) return { ok: false, status: 400, error: 'Choose an existing player.' }
  if (player.accountEmails?.some((e) => e !== accountEmail)) return { ok: false, status: 409, error: 'That player is linked to another account. Merge accounts instead.' }
  if (playerKeys(account).has(key)) return { ok: false, status: 409, error: 'That player is already linked to this account.' }
  const next = { ...account, players: [...(account.players || []), { key, name: player.name, linkedAt: new Date().toISOString(), linkedBy: clean(by, 120) }] }
  await saveAccount(next)
  await audit({ by, action: 'account.linkPlayer', target: accountEmail, after: { player: key } })
  return { ok: true, account: next }
}

// Second parent (Lee, 29 Oct 2026): "paul casella is the dad of Nicholas
// Casella, i just tried adding the dad to the casella family". Adding a parent
// to a family puts their email on every player of that family, so both
// parents see the same children. Neither account is archived. A same-named
// player the new parent made themselves (no Term 4 place) is folded into the
// family's player: their answers fill only the blanks, then the copy is
// unlinked (emails emptied, marked "Joined into <key>"). Nothing is deleted.
export const JOINED = 'Joined into '
const sameName = (a, b) => normName(a) === normName(b)
export function joinPlan(parentEmail, familyEmail, profiles = []) {
  const pe = String(parentEmail || '').toLowerCase(), fe = String(familyEmail || '').toLowerCase()
  if (!pe || !fe) return { ok: false, error: 'Both emails are required.' }
  if (pe === fe) return { ok: false, error: 'That is the same account.' }
  const family = profiles.filter((p) => p.emails.includes(fe))
  if (!family.length) return { ok: false, error: 'That family has no players yet.' }
  const mine = profiles.filter((p) => p.emails.includes(pe) && !p.emails.includes(fe))
  const folds = [], clashes = []
  for (const m of mine) {
    const f = family.find((x) => sameName(x.name, m.name))
    if (!f) continue
    if (m.rowIds.length && f.rowIds.length) clashes.push(m.name)
    else folds.push({ from: m, into: f })
  }
  if (clashes.length) return { ok: false, error: `${clashes.join(', ')} has a place on both accounts. Ask Claude to check these by hand.` }
  return { ok: true, family, folds, add: family.filter((f) => !f.emails.includes(pe)) }
}
// The copy fills the blanks. When the family typed into the copy after the kept
// profile was last saved, the copy's answers win too (Lee, 2 Nov 2026: parents
// filled the hidden copy and the fold kept their older answers).
export function foldValues(from, into) {
  const v = {}
  const newer = /^Family account/.test(from.updatedFrom || '') && Date.parse(from.updatedAt || 0) > Date.parse(into.updatedAt || 0)
  for (const k of PROFILE_KEYS) {
    const empty = (x) => x == null || x === '' || (Array.isArray(x) && !x.length)
    if (!empty(from[k]) && (empty(into[k]) || (newer && JSON.stringify(from[k]) !== JSON.stringify(into[k])))) v[k] = from[k]
  }
  return v
}
export async function joinFamily(parentEmail, familyEmail, by, { profiles = [] } = {}) {
  const pe = String(parentEmail || '').toLowerCase(), fe = String(familyEmail || '').toLowerCase()
  const plan = joinPlan(pe, fe, profiles)
  if (!plan.ok) return { ...plan, status: 409 }
  const account = await accountOf(pe)
  if (!account) return { ok: false, status: 404, error: 'Account not found.' }
  const lk = await lock(`join:${pe}`)
  try {
    for (const { from, into } of plan.folds) {
      // The family's player keeps its key and Term 4 place; the copy's Term 4 ids (if any) move across.
      await saveProfile({ existing: into, name: into.name, key: into.key, emails: [pe], rowIds: from.rowIds, values: foldValues(from, into), by, from: 'Second parent added' })
      await airtable(PROFILES_TABLE, { method: 'PATCH', body: { typecast: true, records: [{ id: from.id, fields: { 'Family Emails': '', 'Term 4 Record IDs': '', 'Updated At': new Date().toISOString(), 'Updated By': clean(by, 100), 'Updated From': `${JOINED}${into.key}`.slice(0, 200) } }] } })
    }
    for (const f of plan.add) if (!plan.folds.some((x) => x.into.id === f.id)) await saveProfile({ existing: f, name: f.name, key: f.key, emails: [pe], rowIds: [], values: {}, by, from: 'Second parent added' })
    const gone = new Set(plan.folds.map((x) => x.from.key))
    const players = (account.players || []).filter((p) => !gone.has(p.key))
    for (const f of plan.family) if (!players.some((p) => p.key === f.key)) players.push({ key: f.key, name: f.name, linkedAt: new Date().toISOString(), linkedBy: clean(by, 120) })
    const next = { ...account, players, familyWith: [...new Set([...(account.familyWith || []), fe])], archivedAt: '', archivedBy: '', mergedInto: '' }
    await saveAccount(next)
    await audit({ by, action: 'account.joinFamily', target: pe, after: { family: fe, players: plan.family.map((p) => p.key), folded: plan.folds.map((x) => `${x.from.key} -> ${x.into.key}`) } })
    return { ok: true, account: next, players: plan.family.map((p) => p.name), folded: plan.folds.map((x) => x.from.name) }
  } finally { await unlock(lk) }
}

// Duplicate player profiles (Lee, 1 Nov 2026, Cara McNeilly: "there are three
// profiles for Lucianna. Please could you delete the two empty ones"). Pairs
// on the same family email that are the same child (sameChild). The one with
// a Term 4 place is kept; between two without, the most filled in.
const filled = (p) => PROFILE_KEYS.filter((k) => (Array.isArray(p[k]) ? p[k].length : p[k])).length + (p.photo ? 2 : 0)
export function duplicateProfiles(profiles = []) {
  const out = [], seen = new Set()
  for (const a of profiles) for (const b of profiles) {
    if (a.id >= b.id || !a.emails.some((e) => b.emails.includes(e)) || !sameChild(a, b)) continue
    if (a.rowIds.length && b.rowIds.length && !a.rowIds.some((id) => b.rowIds.includes(id))) continue
    const [into, from] = (b.rowIds.length - a.rowIds.length || filled(b) - filled(a)) > 0 ? [b, a] : [a, b]
    const k = `${from.id}>${into.id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ from: { id: from.id, name: from.name, place: from.rowIds.length > 0, filled: filled(from), photo: !!from.photo, updatedAt: from.updatedAt, updatedFrom: from.updatedFrom }, into: { id: into.id, name: into.name, place: into.rowIds.length > 0, filled: filled(into), photo: !!into.photo, updatedAt: into.updatedAt, updatedFrom: into.updatedFrom }, fills: Object.keys(foldValues(from, into)), email: a.emails.find((e) => b.emails.includes(e)) })
  }
  return out
}
// Fold one profile into another: its answers fill only the blanks, then it is
// unlinked like a second parent's copy. Nothing is deleted.
export async function foldProfile(fromId, intoId, by, { profiles = [] } = {}) {
  const from = profiles.find((p) => p.id === fromId), into = profiles.find((p) => p.id === intoId)
  if (!from || !into || from.id === into.id) return { ok: false, status: 404, error: 'Choose two different player profiles.' }
  if (!from.emails.some((e) => into.emails.includes(e))) return { ok: false, status: 409, error: 'Those players are on different families.' }
  if (from.rowIds.length && into.rowIds.length && !from.rowIds.some((id) => into.rowIds.includes(id))) return { ok: false, status: 409, error: 'Both have their own place this term. Check them by hand.' }
  const values = foldValues(from, into)
  await saveProfile({ existing: into, name: into.name, key: into.key, emails: from.emails, rowIds: from.rowIds, values, by, from: 'Duplicate folded in' })
  // A photo only on the copy moves across (Airtable copies the file from its link).
  const photo = !!from.photo && !into.photo
  if (photo) await airtable(PROFILES_TABLE, { method: 'PATCH', body: { records: [{ id: into.id, fields: { Photo: [{ url: from.photo }] } }] } })
  await airtable(PROFILES_TABLE, { method: 'PATCH', body: { typecast: true, records: [{ id: from.id, fields: { 'Family Emails': '', 'Term 4 Record IDs': '', 'Updated At': new Date().toISOString(), 'Updated By': clean(by, 100), 'Updated From': `${JOINED}${into.key}`.slice(0, 200) } }] } })
  await audit({ by, action: 'profile.fold', target: into.key, after: { from: from.key, fields: Object.keys(values) } })
  return { ok: true, kept: into.name, folded: from.name, filled: Object.keys(values), photoMoved: photo }
}

export async function allAccountView(deps = {}) { const all = await allAccounts(); return Object.values(all).map((a) => ({ ...a, state: accountState(a), references: Object.fromEntries(Object.entries(accountReferences(a, deps)).map(([k, v]) => [k, v.length])) })) }
