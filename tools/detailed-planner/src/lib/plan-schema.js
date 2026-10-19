// Server-side shape and size rules for a visual session plan.
//
// The planner is the only client today, but anything reaching /api/session-plans
// gets stored and then rendered for every coach on the team, so the server must
// not trust it. Rather than reject a coach's save over one odd field, this
// sanitises: unknown keys are dropped, numbers are clamped, strings are cut to
// length, unsafe URLs are removed. Only structural nonsense (no scenes, absurd
// counts) is refused outright.

export const LIMITS = {
  title: 140,
  text: 140,
  notes: 4000,
  stepNote: 400,
  sceneName: 120,
  scenes: 60,
  objects: 300,
  drawings: 300,
  waypoints: 30,
  links: 40,
  url: 2000,
  label: 120,
  bytes: 2_000_000,
}

// Must stay in step with NOTE_FIELDS in SessionPlanner.jsx, or a coach writes
// into a box and the server quietly drops it on save. "organisation" is a
// retired key kept so older saved plans still round-trip; the planner folds it
// into setup when it loads them.
const NOTE_KEYS = [
  "setup",
  "workRest",
  "coachingPoints",
  "commonMistakes",
  "progressions",
  "easier",
  "develops",
  "note",
  "organisation",
]

const str = (value, max) => (typeof value === "string" ? value.slice(0, max) : "")

function num(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// Only http(s) survives. javascript:, data:, vbscript: and friends are dropped
// rather than escaped, because a stored link is rendered as a real anchor.
export function safeUrl(value) {
  const raw = String(value ?? "").trim()
  if (!raw || raw.length > LIMITS.url) return ""
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let url
  try { url = new URL(withScheme) } catch { return "" }
  return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : ""
}

function cleanObject(object) {
  const out = {
    id: str(object?.id, 64) || null,
    kind: str(object?.kind, 40) || "player",
    x: num(object?.x, -400, 1400, 500),
    y: num(object?.y, -400, 1040, 320),
    size: num(object?.size, 4, 400, 40),
    rotation: num(object?.rotation, -720, 720, 0),
    color: str(object?.color, 32),
    label: str(object?.label, LIMITS.label),
    number: str(object?.number, LIMITS.label),
    locked: Boolean(object?.locked),
  }
  if (!out.id) out.id = `o${Math.random().toString(36).slice(2, 10)}`
  // Older plans used the figure label as the numbered-disc value. Keep that
  // display intact after a save while new plans can give a player a name too.
  if (out.kind === "player" && object?.number == null) out.number = out.label
  if (object?.pose) out.pose = str(object.pose, 60)
  if (object?.flipped) out.flipped = true
  const linkUrl = safeUrl(object?.linkUrl)
  if (linkUrl) {
    out.linkUrl = linkUrl
    out.linkLabel = str(object?.linkLabel, LIMITS.label)
  }
  return out
}

function cleanDrawing(drawing) {
  const out = {
    id: str(drawing?.id, 64) || `d${Math.random().toString(36).slice(2, 10)}`,
    kind: str(drawing?.kind, 40) || "movement",
    x1: num(drawing?.x1, -400, 1400, 0),
    y1: num(drawing?.y1, -400, 1040, 0),
    x2: num(drawing?.x2, -400, 1400, 0),
    y2: num(drawing?.y2, -400, 1040, 0),
    color: str(drawing?.color, 32) || "#f4f7fb",
    width: num(drawing?.width, 0.5, 30, 4),
    curve: num(drawing?.curve, -600, 600, 0),
  }
  if (drawing?.targetId) out.targetId = str(drawing.targetId, 64)
  if (drawing?.duration != null) out.duration = num(drawing.duration, 100, 20_000, 1200)
  if (drawing?.step != null) out.step = Math.round(num(drawing.step, 1, 99, 1))
  if (Array.isArray(drawing?.waypoints) && drawing.waypoints.length) {
    out.waypoints = drawing.waypoints.slice(0, LIMITS.waypoints).map((point) => ({
      x: num(point?.x, -400, 1400, 0),
      y: num(point?.y, -400, 1040, 0),
    }))
  }
  return out
}

// A line of coaching script per numbered step, keyed by the step number, so a
// printed sheet reads "1. Third man runs off the striker" rather than leaving
// the coach to remember what each arrow meant.
function cleanStepNotes(value) {
  if (!value || typeof value !== "object") return undefined
  const out = {}
  for (const [key, text] of Object.entries(value)) {
    const step = Math.round(Number(key))
    if (!Number.isFinite(step) || step < 1 || step > 99) continue
    const line = str(text, LIMITS.stepNote)
    if (line.trim()) out[String(step)] = line
  }
  return Object.keys(out).length ? out : undefined
}

function cleanScene(scene, index) {
  const cleaned = {
    id: str(scene?.id, 64) || `s${index}${Math.random().toString(36).slice(2, 8)}`,
    name: str(scene?.name, LIMITS.sceneName) || `Scene ${index + 1}`,
    objects: (Array.isArray(scene?.objects) ? scene.objects : []).slice(0, LIMITS.objects).map(cleanObject),
    drawings: (Array.isArray(scene?.drawings) ? scene.drawings : []).slice(0, LIMITS.drawings).map(cleanDrawing),
    disc: Boolean(scene?.disc),
  }
  const stepNotes = cleanStepNotes(scene?.stepNotes)
  if (stepNotes) cleaned.stepNotes = stepNotes
  return cleaned
}

// Returns { ok: true, plan } or { ok: false, error } with a message safe to
// show a coach.
export function sanitizePlan(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "That does not look like a session plan." }
  if (typeof input.title !== "string") return { ok: false, error: "That does not look like a session plan." }
  if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
    return { ok: false, error: "A session plan needs at least one scene." }
  }
  if (input.scenes.length > LIMITS.scenes) {
    return { ok: false, error: `A session plan can hold ${LIMITS.scenes} scenes.` }
  }

  const notesSections = {}
  for (const key of NOTE_KEYS) notesSections[key] = str(input.notesSections?.[key], LIMITS.notes)

  const plan = {
    title: str(input.title, LIMITS.title),
    team: str(input.team, LIMITS.text),
    focus: str(input.focus, LIMITS.text),
    duration: Math.round(num(input.duration, 1, 600, 60)),
    players: Math.round(num(input.players, 1, 100, 12)),
    pitch: str(input.pitch, 40) || "full",
    pitchStyle: str(input.pitchStyle, 40) || "classic",
    artwork: input.artwork === "illustrated" ? "illustrated" : "classic",
    notes: str(input.notes, LIMITS.notes),
    notesSections,
    scenes: input.scenes.map(cleanScene),
    links: (Array.isArray(input.links) ? input.links : [])
      .slice(0, LIMITS.links)
      .map((link) => ({
        id: str(link?.id, 64) || `l${Math.random().toString(36).slice(2, 10)}`,
        label: str(link?.label, LIMITS.label),
        url: safeUrl(link?.url),
      }))
      .filter((link) => link.url),
  }

  const videoUrl = safeUrl(input.videoUrl)
  if (videoUrl) plan.videoUrl = videoUrl

  if (JSON.stringify(plan).length > LIMITS.bytes) {
    return { ok: false, error: "That plan is too large to save. Try splitting it into fewer scenes." }
  }
  return { ok: true, plan }
}
