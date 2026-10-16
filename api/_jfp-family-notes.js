// Coach notes for families (Lee, 17 Oct 2026: "goes straight to the family").
// A coach writes a short note about one player; the family sees it at once in
// My account, from "Coach" (never a coach's name). Lee and Ligia can edit or
// delete any note; a coach can edit or delete their own. KV only:
//   jfp:family-notes       hash id -> JSON {id,rowId,groupId,player,text,by,byName,at,editedAt,editedBy}
//   jfp:family-note-read   hash email -> JSON list of note ids read
// Separate from jfp:coach-notes, which is coaches-only and never shown to families.
import { kvCommand, clean, newId, dateLabel, audit } from './_jfp-store.js'

const KEY = 'jfp:family-notes'
const READ = 'jfp:family-note-read'
export const NOTE_TEXT_MAX = 1000
export const FAMILY_NOTE_ACTIONS = new Set(['familyNotes', 'familyNoteSave', 'familyNoteDelete', 'familyNotesAll'])

// The Sydney calendar day a note was written (the stored time is UTC).
const sydDay = (at) => { const d = new Date(at || 0); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d) }
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

export async function allFamilyNotes() {
  const raw = (await kvCommand(['HGETALL', KEY])) || []
  const out = []
  if (Array.isArray(raw)) { for (let i = 1; i < raw.length; i += 2) { const n = parse(raw[i]); if (n) out.push(n) } }
  else for (const v of Object.values(raw)) { const n = parse(v); if (n) out.push(n) }
  return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
}

export function cleanNoteText(v) { return String(v || '').replace(/\r\n/g, '\n').slice(0, NOTE_TEXT_MAX).trim() }

async function readIds(email) {
  const v = parse(await kvCommand(['HGET', READ, String(email).toLowerCase()]))
  return Array.isArray(v) ? v : []
}

// What one family sees for its own rows: newest first, no author.
export async function familyNotesFor(rowIds = [], email = '') {
  const want = new Set(rowIds.filter(Boolean))
  if (!want.size) return []
  let all = []
  try { all = await allFamilyNotes() } catch (error) { console.error('jfp family notes read failed', error); return [] }
  let read = new Set()
  if (email) try { read = new Set(await readIds(email)) } catch {}
  return all.filter((n) => want.has(n.rowId)).map((n) => ({ id: n.id, rowId: n.rowId, player: n.player, text: n.text, at: n.at, dateLabel: dateLabel(sydDay(n.at)), edited: Boolean(n.editedAt), read: read.has(n.id) }))
}

export async function markFamilyNotesRead(email, ids = [], allowed = null) {
  const want = new Set((Array.isArray(ids) ? ids : []).map((x) => clean(x, 40)).filter(Boolean))
  if (!email || !want.size) return readIds(email)
  const live = new Set((await allFamilyNotes()).filter((n) => !allowed || allowed.has(n.rowId)).map((n) => n.id))
  const next = [...new Set([...(await readIds(email)), ...[...want].filter((x) => live.has(x))])].slice(-300)
  await kvCommand(['HSET', READ, String(email).toLowerCase(), JSON.stringify(next)])
  return next
}

// Staff actions. `access(rowId)` is the caller's check that this person may
// see the player (their own group, covering it, or Lee and Ligia): it returns
// { row, group } or null.
export async function familyNoteAction(res, principal, body, action, { isAdmin, access, onNew }) {
  const ok = (x) => res.status(200).json({ success: true, ...x })
  const no = (status, error) => res.status(status).json({ success: false, error })
  const view = (n) => ({ id: n.id, rowId: n.rowId, player: n.player, group: n.groupLabel || '', text: n.text, at: n.at, dateLabel: dateLabel(sydDay(n.at)), byName: n.byName || '', edited: Boolean(n.editedAt), mine: n.by === principal.email, canEdit: isAdmin || n.by === principal.email })
  if (action === 'familyNotesAll') {
    if (!isAdmin) return no(403, 'Not allowed.')
    return ok({ notes: (await allFamilyNotes()).map(view) })
  }
  if (action === 'familyNotes') {
    const a = await access(clean(body.rowId, 30))
    if (!a) return no(404, 'That player is not in your sessions.')
    return ok({ notes: (await allFamilyNotes()).filter((n) => n.rowId === a.row.id).map(view) })
  }
  if (action === 'familyNoteDelete') {
    const id = clean(body.id, 40)
    const was = parse(await kvCommand(['HGET', KEY, id]))
    if (!was) return no(404, 'That note is already gone.')
    if (!isAdmin && was.by !== principal.email) return no(403, 'Only Lee, Ligia or the coach who wrote it can delete it.')
    await kvCommand(['HDEL', KEY, id])
    await audit({ by: principal.email, action: 'familyNote.delete', target: was.rowId, before: { id, text: was.text } })
    return ok({ deleted: id })
  }
  if (action === 'familyNoteSave') {
    const text = cleanNoteText(body.text)
    if (text.length < 2) return no(400, 'Write the note first.')
    const id = clean(body.id, 40)
    if (id) {
      const was = parse(await kvCommand(['HGET', KEY, id]))
      if (!was) return no(404, 'That note is gone. Refresh the page.')
      if (!isAdmin && was.by !== principal.email) return no(403, 'Only Lee, Ligia or the coach who wrote it can edit it.')
      const rec = { ...was, text, editedAt: new Date().toISOString(), editedBy: principal.email }
      await kvCommand(['HSET', KEY, id, JSON.stringify(rec)])
      await audit({ by: principal.email, action: 'familyNote.edit', target: was.rowId, before: { id, text: was.text }, after: { text } })
      return ok({ note: view(rec) })
    }
    const a = await access(clean(body.rowId, 30))
    if (!a) return no(404, 'That player is not in your sessions.')
    const rec = { id: newId('FN'), rowId: a.row.id, groupId: a.group?.id || a.row.groupId || '', groupLabel: a.group ? `${a.group.day} ${a.group.time}` : '', player: a.row.player, text, by: principal.email, byName: principal.name || '', at: new Date().toISOString() }
    await kvCommand(['HSET', KEY, rec.id, JSON.stringify(rec)])
    await audit({ by: principal.email, action: 'familyNote.add', target: rec.rowId, after: { id: rec.id, text } })
    // Push to the family's phones when they have it on (never blocks the save).
    if (onNew) try { await onNew(rec, a.row) } catch (error) { console.error('jfp family note push failed', error) }
    return ok({ note: view(rec) })
  }
  return no(400, 'Unknown action.')
}
