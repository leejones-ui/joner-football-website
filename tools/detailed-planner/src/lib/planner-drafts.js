// What a planner link asks for, and how an unsaved device draft is kept safe
// when the coach moves on to something else.
//
// Three intents, never mixed up again:
//   ?plan=<id>  open exactly that saved plan
//   ?new=1      start a blank session
//   neither     carry on with the device draft, as the planner always did
//
// "Create session" used to land on whatever was edited last, because the
// planner only ever knew how to resume. A fresh start now moves the old draft
// aside into a small list on the device instead of writing over it, and the
// planner offers it back ("Resume your unsaved draft"). Nothing here touches
// the network; it is plain data plus a Storage-like object, so it is tested
// directly. public/on-the-go/draft-stash.js mirrors the pure helpers for the
// static on the go pages, and the tests hold both to the same vectors.

// Same shape the session plan routes accept.
export const PLAN_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/

function readParam(params, name) {
  if (!params) return ""
  const value = typeof params.get === "function" ? params.get(name) : params[name]
  const first = Array.isArray(value) ? value[0] : value
  return first == null ? "" : String(first).trim()
}

// Accepts URLSearchParams, a Next.js searchParams object or a plain object.
// A malformed plan id is ignored rather than trusted, so a bad link resumes
// the draft instead of fetching something odd.
export function plannerIntent(params) {
  const planId = readParam(params, "plan")
  if (planId && PLAN_ID_PATTERN.test(planId)) return { mode: "open", planId }
  const fresh = readParam(params, "new").toLowerCase()
  if (fresh === "1" || fresh === "true" || fresh === "yes") return { mode: "new" }
  return { mode: "resume" }
}

// The query string once the intent has been acted on. Keeping ?new=1 in the
// address bar would start another blank session on every reload.
export function withoutIntent(search, names = ["new", "plan"]) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""))
  for (const name of names) params.delete(name)
  const rest = params.toString()
  return rest ? `?${rest}` : ""
}

const ON_THE_GO_FILE = /^[a-z0-9-]+\.html$/i

// The links My sessions uses. Create always carries ?new=1 and Open always
// carries the plan id, so neither can land on whatever was edited last.
// Templates keep their own page (the Coaching Pros sessions).
export function sessionLibraryLinks(teamId) {
  const team = encodeURIComponent(teamId || "")
  return {
    create: (kind) => kind === "on-the-go"
      ? `/on-the-go/blank.html?team=${team}&new=1`
      : `/coach/session-plan?team=${team}&new=1`,
    templates: `/coach/session-plan/on-the-go?team=${team}`,
    open: (plan) => plan?.kind === "on-the-go"
      ? `/on-the-go/${ON_THE_GO_FILE.test(String(plan.template || "")) ? plan.template : "blank.html"}?team=${team}&plan=${encodeURIComponent(plan.id)}`
      : `/coach/session-plan?team=${team}&plan=${encodeURIComponent(plan?.id || "")}`,
  }
}

// Two independent 32-bit hashes plus the length. Only ever compared with
// another fingerprint of a draft on the same device.
export function draftFingerprint(text) {
  const value = String(text ?? "")
  let a = 0x811c9dc5
  let b = 5381
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = (Math.imul(b, 33) + code) >>> 0
  }
  return `${value.length.toString(36)}-${a.toString(36)}-${b.toString(36)}`
}

export function readDraftStash(raw) {
  try {
    const list = JSON.parse(raw || "[]")
    return Array.isArray(list)
      ? list.filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.fingerprint === "string")
      : []
  } catch {
    return []
  }
}

// Newest first. The same content is only ever kept once, so pressing Create
// three times in a row does not pile up three copies of one draft. There is
// no size cap: dropping the oldest draft would be losing a coach's work.
export function addToDraftStash(entries, entry) {
  const list = Array.isArray(entries) ? entries : []
  if (list.some((item) => item.fingerprint === entry.fingerprint)) return { entries: list, added: false }
  return { entries: [entry, ...list], added: true }
}

export function removeFromDraftStash(entries, id) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => entry.id !== id)
}

// A draft needs rescuing unless it is exactly what the device last knew to be
// safe: a blank session nobody has touched, or the version just saved to or
// opened from the library.
export function draftNeedsRescue(text, cleanFingerprint) {
  return typeof text === "string" && text.length > 0 && draftFingerprint(text) !== cleanFingerprint
}

// The detailed planner's device keys. draft and planId are the keys the
// planner has always used, so existing drafts are found where they are.
export function plannerDraftKeys(teamId) {
  const scope = teamId || "solo"
  return {
    draft: `jf-session-planner-draft-${scope}`,
    planId: `jf-session-planner-planid-${scope}`,
    stash: `jf-session-planner-previous-drafts-${scope}`,
    clean: `jf-session-planner-clean-${scope}`,
  }
}

function safeGet(storage, key) {
  try { return storage.getItem(key) } catch { return null }
}

export function listStashedDrafts(storage, keys) {
  return readDraftStash(safeGet(storage, keys.stash))
}

export function writeDraftStash(storage, keys, entries) {
  try {
    if (entries.length) storage.setItem(keys.stash, JSON.stringify(entries))
    else storage.removeItem(keys.stash)
    return true
  } catch {
    return false
  }
}

// Move the plan that is about to be replaced into the list of previous
// drafts. ok:false means it could not be kept (storage full or blocked) and
// the caller must NOT replace the plan without asking the coach first.
export function rescuePlannerDraft(storage, keys, { plan, planId = null, incoming = null, id, now = new Date().toISOString() }) {
  if (!plan || typeof plan !== "object") return { ok: true, stashed: false }
  const text = JSON.stringify(plan)
  // Re-opening the very plan that is already on screen replaces nothing.
  if (incoming && draftFingerprint(JSON.stringify(incoming)) === draftFingerprint(text)) return { ok: true, stashed: false }
  if (!draftNeedsRescue(text, safeGet(storage, keys.clean))) return { ok: true, stashed: false }
  let current
  try { current = readDraftStash(storage.getItem(keys.stash)) } catch { return { ok: false, stashed: false } }
  const entry = {
    id: String(id || `draft-${Date.now().toString(36)}`),
    savedAt: now,
    title: String(plan.title || "").slice(0, 140),
    planId: typeof planId === "string" && PLAN_ID_PATTERN.test(planId) ? planId : null,
    fingerprint: draftFingerprint(text),
    plan,
  }
  const { entries, added } = addToDraftStash(current, entry)
  if (!added) return { ok: true, stashed: false, entries }
  try { storage.setItem(keys.stash, JSON.stringify(entries)) } catch { return { ok: false, stashed: false, entries: current } }
  return { ok: true, stashed: true, entries }
}

// Remember the plan on screen as safe (blank, saved or freshly opened), so a
// later fresh start does not keep a needless copy of it.
export function markPlannerClean(storage, keys, plan) {
  try { storage.setItem(keys.clean, draftFingerprint(JSON.stringify(plan))) } catch { /* private mode */ }
}

export function forgetPlannerClean(storage, keys) {
  try { storage.removeItem(keys.clean) } catch { /* private mode */ }
}
