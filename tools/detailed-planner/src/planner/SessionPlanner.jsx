"use client";
import { readImportedPlan } from "../lib/planner-import.js";
import {
  forgetPlannerClean,
  listStashedDrafts,
  markPlannerClean,
  removeFromDraftStash,
  rescuePlannerDraft,
  plannerDraftKeys,
  withoutIntent,
  writeDraftStash
} from "../lib/planner-drafts.js";
import { DrillBank, ShareSession } from "./PlannerResources.jsx";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowLeft,
  ArrowUpRight,
  ArrowsClockwise,
  BoundingBox,
  CaretDown,
  CaretUp,
  Check,
  Clock,
  Copy,
  Cursor,
  CubeTransparent,
  DownloadSimple,
  FloppyDisk,
  FolderOpen,
  ImageSquare,
  LinkSimple,
  NotePencil,
  Path,
  Pause,
  Play,
  ListNumbers,
  FilmStrip,
  VideoCamera,
  Plus,
  Printer,
  TextT,
  Trash,
  UploadSimple,
  X
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";
import { PITCH_OPTIONS, PitchSvg, STYLE_PRESETS, viewTransform } from "./pitches";
import {
  EquipmentArt,
  KEEPER_POSES,
  OUTFIELD_POSES,
  PlayerFigure
} from "./figures";
import {
  SceneSvg,
  drawingPath,
  renderedDrawingPath,
  sampleDrawing,
  svgNodeToPngBlob
} from "./exporter";
import {
  buildSceneTimeline,
  buildSessionTimeline,
  sampleAt,
  sampleSessionAt,
  activeStepAt,
  samplePath,
  pathPoints,
  stepOf,
  durationOf,
  DEFAULT_DURATION,
  SCENE_TWEEN_MS
} from "./timeline";
import { recordDrill, videoSupported } from "./recorder";
import LibraryOverlay from "./LibraryOverlay.jsx";
import PlanSheetEditor from "./PlanSheetEditor.jsx";
const PITCH_WIDTH = 1e3;
const PITCH_HEIGHT = 640;
const VIEW_ROTATIONS = [0, 90, 180, 270];
const uid = () => crypto.randomUUID();
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const equipment = [
  { kind: "flag", name: "Flag" },
  { kind: "ball", name: "Football" },
  { kind: "cone", name: "Large cone" },
  { kind: "net", name: "Head tennis net" },
  { kind: "goal", name: "Goal" },
  { kind: "minigoal", name: "Mini-goal" },
  { kind: "hurdle", name: "Hurdle" },
  { kind: "pole", name: "Pole" },
  { kind: "mannequin", name: "Mannequin" },
  { kind: "dummy", name: "Air dummy" },
  { kind: "saucer", name: "Small cone" },
  { kind: "arc", name: "Passing arc" },
  { kind: "bosu", name: "Balance ball" },
  { kind: "minihurdle", name: "Low hurdle" },
  { kind: "rebound-single", name: "Rebound box" },
  { kind: "rebound-double", name: "Double rebound" },
  { kind: "ladder", name: "Ladder" },
  { kind: "agility-cones", name: "Agility cones" },
  { kind: "disc-marker", name: "Disc marker", color: "#ff4f46" },
  { kind: "rings", name: "Speed rings" }
];
const OFFICIAL_POSES = [
  { id: "stand", name: "Standing" },
  { id: "run", name: "Running" }
];
const KIT_TABS = [
  { id: "kit1", name: "Kit 1", color: "#e8000d", poses: OUTFIELD_POSES, numbered: true },
  { id: "kit2", name: "Kit 2", color: "#45a8ff", poses: OUTFIELD_POSES, numbered: true },
  { id: "gk", name: "Keepers", color: "#19b562", poses: KEEPER_POSES, numbered: false },
  { id: "officials", name: "Officials", color: "#20242b", poses: OFFICIAL_POSES, numbered: false }
];
const DRAG_MIME = "application/x-planner-item";

// ---- Animation model (rebuilt 2026-07-26, Lee: "free reign") ----------------
// Every path a coach draws can animate, not just the Movement tool:
//   movement -> the player or ball the line was dragged from
//   pass/shoot -> the ball travels the line
//   dribble  -> the player travels and the ball travels with them
// The target is resolved from where the line STARTS, so a coach just grabs a
// figure and drags. No pre-selection step, no forced curve.
const ANIMATED_KINDS = new Set(["movement", "pass", "dribble", "shoot"]);
const GRAB_RADIUS = 70; // pitch units: how close a line start counts as "on" an object

function nearestObject(objects, point, kinds, radius = GRAB_RADIUS) {
  let best = null;
  let bestDistance = radius;
  for (const object of objects || []) {
    if (!kinds.includes(object.kind)) continue;
    const distance = Math.hypot(object.x - point.x, object.y - point.y);
    if (distance <= bestDistance) { best = object; bestDistance = distance; }
  }
  return best;
}

// Which object (and optional companion) a drawing animates. Pure, so the
// playback engine and the on-pitch hints agree.
export function resolveAnimation(drawing, objects) {
  if (!drawing || !ANIMATED_KINDS.has(drawing.kind)) return null;
  const start = { x: drawing.x1, y: drawing.y1 };
  if (drawing.kind === "pass" || drawing.kind === "shoot") {
    const ball = (objects || []).find((object) => object.id === drawing.targetId && object.kind === "ball")
      || nearestObject(objects, start, ["ball"], 1e4);
    return ball ? { targetId: ball.id, companionId: null } : null;
  }
  if (drawing.kind === "dribble") {
    const player = (objects || []).find((object) => object.id === drawing.targetId && object.kind === "player")
      || nearestObject(objects, start, ["player"]);
    if (!player) return null;
    // The ball rides along with whoever is dribbling.
    const ball = nearestObject(objects, start, ["ball"], 1e4);
    return { targetId: player.id, companionId: ball && ball.id !== player.id ? ball.id : null };
  }
  const explicit = (objects || []).find((object) => object.id === drawing.targetId);
  const grabbed = explicit || nearestObject(objects, start, ["player", "ball"]);
  return grabbed ? { targetId: grabbed.id, companionId: null } : null;
}

const tools = [
  { id: "select", label: "Select", shortcut: "V", icon: Cursor },
  { id: "movement", label: "Movement", shortcut: "M", icon: Path },
  { id: "pass", label: "Pass", shortcut: "P", icon: ArrowUpRight },
  { id: "dribble", label: "Dribble", shortcut: "D", icon: Path },
  { id: "shoot", label: "Shoot", shortcut: "S", icon: ArrowUpRight },
  { id: "zone", label: "Zone", shortcut: "Z", icon: BoundingBox },
  { id: "text", label: "Text", shortcut: "T", icon: TextT },
  { id: "erase", label: "Erase", shortcut: "E", icon: Trash }
];
const LINE_TOOLS = [
  { id: "movement", label: "Movement", description: "Drag from a player or the ball. It runs your line on play.", color: "#ff3d42", style: "solid" },
  { id: "pass", label: "Pass", description: "Drag player to player. The ball travels on play.", color: "#11151a", style: "dashed" },
  { id: "dribble", label: "Dribble", description: "Drag from a player. Player and ball travel together.", color: "#f4f7fb", style: "wavy" },
  { id: "shoot", label: "Shoot", description: "Drag to goal. The ball strikes on play.", color: "#ffe329", style: "dashed" },
  { id: "pitch-line", label: "Pitch line \u2014 white", description: "Solid pitch marking", color: "#f4f7fb", style: "solid" },
  { id: "pitch-line", label: "Pitch line \u2014 red", description: "Solid pitch marking", color: "#ff3d42", style: "solid" },
  { id: "pitch-line", label: "Pitch line \u2014 green", description: "Solid pitch marking", color: "#3de06f", style: "solid" },
  { id: "pitch-line", label: "Pitch line \u2014 blue", description: "Solid pitch marking", color: "#3f72ff", style: "solid" },
  { id: "zone", label: "Shaded pitch area", description: "Mark a coaching zone", color: "#cbd4dd", style: "area" }
];
const LIBRARY_TABS = [
  { id: "players", label: "Players" },
  { id: "equipment", label: "Equipment" },
  { id: "lines", label: "Lines" },
  { id: "text", label: "Text" },
  { id: "drills", label: "Drills" }
];
// Session notes follow Lee's printed session-sheet structure (the CP drill
// pack): setup, coaching points, common mistakes, harder, easier, plus the
// develops-tags and a coach's note for the sheet footer.
const NOTE_FIELDS = [
  ["setup", "Setup & equipment"],
  ["workRest", "Work to rest ratio"],
  ["coachingPoints", "Coaching points"],
  ["commonMistakes", "Common mistakes"],
  ["progressions", "Progressions (make it harder)"],
  ["easier", "Make it easier"],
  ["develops", "This drill develops"],
  ["note", "Coach's note"]
];
const NOTE_HINTS = {
  setup: "• Passing box with a pole and disc obstacle\n• Two players opposite each other\n• One ball, three-pass pattern",
  workRest: "• 4 sets of 5 minutes\n• 90 seconds rest between sets",
  coachingPoints: "• Scan before the ball travels\n• First touch clears the obstacle",
  commonMistakes: "• Touch bobbles and gets stuck\n• No shoulder check before receiving",
  progressions: "• Only two touches\n• Increase pass speed",
  easier: "• Remove the pole first\n• Slow the pass speed",
  develops: "Scanning · First touch · Passing · Football IQ",
  note: "The one thing this session must deliver."
};
function makeObject(kind, x, y, index = 0) {
  const defaults = {
    player: { size: 58, color: "#e8000d", label: "", number: String(index % 23 + 1) },
    ball: { size: 26, color: "#f4f7fb", label: "" },
    cone: { size: 30, color: "#ff9f43", label: "" },
    saucer: { size: 26, color: "#ffd23c", label: "" },
    "disc-marker": { size: 26, color: "#ff4f46", label: "" },
    flag: { size: 40, color: "#ffe100", label: "" },
    pole: { size: 46, color: "#ffd23c", label: "" },
    mannequin: { size: 52, color: "#2749d6", label: "" },
    goal: { size: 104, color: "#f4f7fb", label: "" },
    minigoal: { size: 60, color: "#f4f7fb", label: "" },
    net: { size: 96, color: "#f4f7fb", label: "" },
    hurdle: { size: 40, color: "#d8412f", label: "" },
    minihurdle: { size: 32, color: "#ffd23c", label: "" },
    bosu: { size: 34, color: "#2a9fd8", label: "" },
    ladder: { size: 62, color: "#d8412f", label: "" },
    box: { size: 44, color: "#ffd23c", label: "" },
    "rebound-single": { size: 58, color: "#ffd23c", label: "" },
    "rebound-double": { size: 72, color: "#ffd23c", label: "" },
    dummy: { size: 58, color: "#f4f7fb", label: "" },
    arc: { size: 44, color: "#ff3d42", label: "" },
    tyre: { size: 38, color: "#20242b", label: "" },
    "footprint-left": { size: 30, color: "#f4f7fb", label: "" },
    "footprint-right": { size: 30, color: "#f4f7fb", label: "" },
    rings: { size: 62, color: "#ffe329", label: "" },
    "agility-cones": { size: 62, color: "#ff7a33", label: "" },
    bib: { size: 34, color: "#ff6b67", label: "" },
    coach: { size: 54, color: "#20242b", label: "" },
    text: { size: 34, color: "#f4f7fb", label: "Coaching point" }
  };
  return {
    id: uid(),
    kind,
    x,
    y,
    rotation: 0,
    locked: false,
    ...defaults[kind]
  };
}
// Only ever produce an http(s) link. Plans travel between coaches and get
// published club-wide, so a stored "javascript:" or "data:" URL would fire for
// everyone who opens the plan. Applied on render as well as on entry, because
// plans can arrive from the API or an imported file.
function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return /^https?:\/\//i.test(trimmed) ? trimmed : "";
  }
  return `https://${trimmed}`;
}
function starterPlan() {
  const players = [
    { ...makeObject("player", 235, 165, 0), pose: "run" },
    { ...makeObject("player", 235, 320, 1), pose: "stand" },
    { ...makeObject("player", 235, 475, 2), pose: "pass" },
    { ...makeObject("player", 430, 245, 3), pose: "sprint" },
    { ...makeObject("player", 430, 395, 4), pose: "run" }
  ];
  const opponents = [
    { ...makeObject("player", 640, 195, 0), pose: "jockey" },
    { ...makeObject("player", 640, 320, 1), pose: "run" },
    { ...makeObject("player", 640, 445, 2), pose: "stand" }
  ].map((player) => ({ ...player, color: "#45a8ff" }));
  const keeper = { ...makeObject("player", 895, 320, 0), pose: "gk-ready", color: "#19b562", label: "" };
  const ball = makeObject("ball", 470, 320);
  const cones = [
    makeObject("cone", 92, 105),
    makeObject("cone", 92, 535),
    makeObject("cone", 905, 105),
    makeObject("cone", 905, 535)
  ];
  const allObjects = [...players, ...opponents, keeper, ball, ...cones];
  const movements = [
    {
      id: uid(),
      kind: "movement",
      x1: players[3].x,
      y1: players[3].y,
      x2: 565,
      y2: 185,
      color: "#ff3d42",
      width: 4,
      curve: -70,
      targetId: players[3].id,
      duration: 1250
    },
    {
      id: uid(),
      kind: "movement",
      x1: players[4].x,
      y1: players[4].y,
      x2: 565,
      y2: 455,
      color: "#ff3d42",
      width: 4,
      curve: 70,
      targetId: players[4].id,
      duration: 1250
    },
    {
      id: uid(),
      kind: "pass",
      x1: ball.x,
      y1: ball.y,
      x2: 600,
      y2: 320,
      color: "#11151a",
      width: 4,
      curve: 0
    }
  ];
  return {
    title: "Build-up and counter press",
    team: "First Team",
    focus: "Playing through midfield",
    duration: 75,
    players: 16,
    pitch: "full",
    pitchStyle: "classic",
    notes: "",
    notesSections: {
      ...EMPTY_NOTES,
      coachingPoints: "• Create a free player behind the first line\n• Play forward when possible\n• Counter press for five seconds after losing the ball"
    },
    videoUrl: "",
    scenes: [
      {
        id: uid(),
        name: "Starting shape",
        objects: allObjects,
        drawings: movements
      }
    ],
    links: [
      {
        id: uid(),
        label: "Joner Football APP",
        url: "https://jonerfootball.com"
      }
    ]
  };
}
function isSessionPlan(value) {
  if (!value || typeof value !== "object") return false;
  const plan = value;
  return typeof plan.title === "string" && Array.isArray(plan.scenes) && plan.scenes.length > 0;
}
const EMPTY_NOTES = { setup: "", workRest: "", coachingPoints: "", commonMistakes: "", progressions: "", easier: "", develops: "", note: "" };
function migratePlan(plan) {
  const validPitch = PITCH_OPTIONS.some((option) => option.id === plan.pitch);
  const sections = { ...EMPTY_NOTES, ...(plan.notesSections || {}) };
  // Older plans kept one free-text notes field; fold it into coaching points.
  if (plan.notes && !plan.notesSections) sections.coachingPoints = plan.notes;
  // The old Organisation section merged into Setup & equipment.
  if (sections.organisation) {
    sections.setup = [sections.setup, sections.organisation].filter(Boolean).join("\n");
    delete sections.organisation;
  }
  return {
    ...plan,
    pitch: validPitch ? plan.pitch : "full",
    pitchStyle: STYLE_PRESETS.some((s) => s.id === plan.pitchStyle) ? plan.pitchStyle : "classic",
    notesSections: sections,
    videoUrl: typeof plan.videoUrl === "string" ? plan.videoUrl : "",
    links: Array.isArray(plan.links) ? plan.links : [],
    scenes: plan.scenes.map((scene) => ({
      ...scene,
      drawings: scene.drawings.map(
        (drawing) => drawing.kind === "arrow" ? { ...drawing, kind: "pass", color: "#11151a" } : drawing
      )
    }))
  };
}
function draftKey(teamId) {
  return `jf-session-planner-draft-${teamId || "solo"}`;
}
// The saved-plan id lives beside the draft. Without it a reload forgot which
// library entry the draft belonged to, so every later Save created another copy
// and coaches ended up with five plans all called the same thing.
function draftPlanIdKey(teamId) {
  return `jf-session-planner-planid-${teamId || "solo"}`;
}
function loadDraftPlanId(teamId) {
  try {
    const saved = localStorage.getItem(draftPlanIdKey(teamId));
    return saved && /^[a-zA-Z0-9-]+$/.test(saved) ? saved : null;
  } catch {
    return null;
  }
}
function withClubDefaults(plan, defaults) {
  if (!defaults) return plan;
  return {...plan, team: defaults.ageGroup || plan.team, duration: defaults.sessionMinutes, notesSections: {...plan.notesSections, coachingPoints: defaults.principles || plan.notesSections.coachingPoints}};
}
function loadPlan(teamId, defaults) {
  try {
    const saved = localStorage.getItem(draftKey(teamId));
    if (!saved) return withClubDefaults(starterPlan(), defaults);
    const parsed = JSON.parse(saved);
    return isSessionPlan(parsed) ? migratePlan(parsed) : withClubDefaults(starterPlan(), defaults);
  } catch {
    return withClubDefaults(starterPlan(), defaults);
  }
}
// True when the device holds a draft a coach could have worked on.
function storedDraftExists(teamId) {
  try {
    const saved = localStorage.getItem(draftKey(teamId));
    return Boolean(saved) && isSessionPlan(JSON.parse(saved));
  } catch {
    return false;
  }
}
// The blank session every "new" path starts from: Create session in My
// sessions, Start blank session, and New session in the library.
function freshPlan(defaults) {
  return { ...withClubDefaults(starterPlan(), defaults), title: "New session", scenes: [{ id: uid(), name: "Scene 1", objects: [], drawings: [] }] };
}
// Storage that is blocked (private mode, a locked down browser) behaves as
// empty and refuses writes, so a draft is never assumed to be kept.
const NO_STORAGE = { getItem: () => null, setItem: () => { throw new Error("Device storage unavailable"); }, removeItem: () => {} };
function deviceStorage() {
  try {
    return window.localStorage || NO_STORAGE;
  } catch {
    return NO_STORAGE;
  }
}
// A saved on the go session opens in its own page, never as empty scenes here.
function onTheGoTemplate(plan) {
  const template = plan?.onTheGo?.template;
  return typeof template === "string" && /^[a-z0-9-]+\.html$/i.test(template) ? template : null;
}
function formatDraftTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
// Quick-start drill templates. SSP makes every coach start from a blank
// screen; these give a one-tap head start and are fully editable after.
function templateScene(kind) {
  const objects = [];
  const drawings = [];
  const P = (x, y, pose, color, label) => objects.push({ ...makeObject("player", x, y), pose, color, label: label ?? "" });
  const C = (x, y) => objects.push(makeObject("cone", x, y));
  if (kind === "rondo") {
    const cx2 = 500, cy2 = 320, r = 170;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
      P(cx2 + Math.cos(a) * r, cy2 + Math.sin(a) * r, "pass", "#e8000d", String(i + 1));
      C(cx2 + Math.cos(a + 0.26) * (r + 55), cy2 + Math.sin(a + 0.26) * (r + 55));
    }
    P(cx2 - 40, cy2, "run", "#45a8ff", "1");
    P(cx2 + 40, cy2, "jockey", "#45a8ff", "2");
    objects.push(makeObject("ball", cx2 + Math.cos(-Math.PI / 2) * r + 30, cy2 + Math.sin(-Math.PI / 2) * r + 18));
    return { id: uid(), name: "Rondo 6v2", objects, drawings };
  }
  if (kind === "ssg") {
    objects.push({ ...makeObject("minigoal", 110, 320), rotation: -90 });
    objects.push({ ...makeObject("minigoal", 890, 320), rotation: 90 });
    [[260, 200], [260, 440], [420, 320], [330, 320]].forEach(([x, y], i) => P(x, y, i % 2 ? "run" : "stand", "#e8000d", String(i + 1)));
    [[740, 200], [740, 440], [580, 320], [670, 320]].forEach(([x, y], i) => P(x, y, i % 2 ? "jockey" : "run", "#45a8ff", String(i + 1)));
    objects.push(makeObject("ball", 470, 320));
    C(180, 120); C(180, 520); C(820, 120); C(820, 520);
    return { id: uid(), name: "4v4 two goals", objects, drawings };
  }
  // 1v1 to finish
  objects.push({ ...makeObject("goal", 900, 320), rotation: 90 });
  P(770, 320, "gk-ready", "#19b562", "");
  P(320, 250, "run", "#e8000d", "9");
  P(390, 400, "jockey", "#45a8ff", "4");
  objects.push(makeObject("ball", 355, 275));
  C(250, 180); C(250, 460);
  drawings.push({ id: uid(), kind: "movement", x1: 320, y1: 250, x2: 640, y2: 290, color: "#ff3d42", width: 4, curve: -50, targetId: objects.find((o) => o.label === "9")?.id, duration: 1400 });
  drawings.push({ id: uid(), kind: "shoot", x1: 660, y1: 300, x2: 880, y2: 320, color: "#ffe329", width: 5, curve: 0 });
  return { id: uid(), name: "1v1 to finish", objects, drawings };
}
const TEMPLATES = [
  { id: "rondo", name: "Rondo 6v2", blurb: "Keep-ball circle with two defenders" },
  { id: "ssg", name: "4v4 two goals", blurb: "Small sided game, mini goals" },
  { id: "finish", name: "1v1 to finish", blurb: "Drive at the defender and shoot" },
];
function editorReducer(state, action) {
  if (action.type === "edit") {
    const next = action.updater(state.present);
    if (next === state.present) return state;
    return { past: [...state.past, state.present], present: next, future: [] };
  }
  if (action.type === "undo") {
    if (!state.past.length) return state;
    const previous = state.past[state.past.length - 1];
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future]
    };
  }
  if (action.type === "redo") {
    if (!state.future.length) return state;
    const next = state.future[0];
    return {
      past: [...state.past, state.present],
      present: next,
      future: state.future.slice(1)
    };
  }
  return { past: [], present: action.plan, future: [] };
}
const isFigureObject = (object) => object.kind === "player" || object.kind === "coach";
const usesCircleMarker = (object, disc, artwork) =>
  isFigureObject(object) && (artwork === "classic" || (disc && object.kind === "player"));
const circleMarkerText = (object) =>
  object.kind === "coach" ? "C" : (object.number ?? object.label ?? "");

function PlayerCircle({ color, value, size, className = "" }) {
  return <div className={`marker marker-disc ${className}`.trim()} style={{
    background: color,
    width: size * 0.6,
    height: size * 0.6,
    fontSize: size * 0.315
  }}><span>{value}</span></div>;
}

function ObjectVisual({ object, disc = false, artwork = "classic" }) {
  if (object.kind === "player" || object.kind === "coach") {
    // Classic is deliberately a tactics-board: player and coach poses remain
    // in saved plans, but render as circles. Realistic can opt into figures.
    if (usesCircleMarker(object, disc, artwork)) return <PlayerCircle color={object.color} value={circleMarkerText(object)} size={object.size} />;
    return <div className={`marker marker-figure ${object.flipped ? "is-flipped" : ""}`}><PlayerFigure
      artwork={artwork}
      pose={object.pose ?? (object.kind === "coach" ? "stand" : "stand")}
      color={object.color}
      official={object.kind === "coach"}
    />{object.label && <span className="figure-badge">{object.label}</span>}</div>;
  }
  if (object.kind === "text") {
    return <div className="marker marker-text" style={{ color: object.color }}>{object.label}</div>;
  }
  return <div className={`marker marker-figure ${object.flipped ? "is-flipped" : ""}`}><EquipmentArt kind={object.kind} color={object.color} artwork={artwork} />{object.label && <span className="figure-badge">{object.label}</span>}</div>;
}
function SessionPlanner({ teamId = "", teamName = "", roster = [], clubDefaults = null, intent = null }) {
  const [editor, dispatch] = useReducer(editorReducer, void 0, () => ({
    past: [],
    present: loadPlan(teamId, clubDefaults),
    future: []
  }));
  const plan = editor.present;
  // Latest plan for handlers that finish after an await, so the draft that is
  // moved aside is the one on screen, not the one from when the click began.
  const planRef = useRef(plan);
  planRef.current = plan;
  const storageKeys = useMemo(() => plannerDraftKeys(teamId), [teamId]);
  // Unsaved drafts moved aside on this device, newest first.
  const [previousDrafts, setPreviousDrafts] = useState([]);
  const [draftsHidden, setDraftsHidden] = useState(false);
  const [draftNotice, setDraftNotice] = useState(null);
  // ?plan=<id> shows nothing until that plan has loaded, so the old draft
  // never flashes up (or takes edits) in its place.
  const [intentPending, setIntentPending] = useState(intent?.mode === "open" && Boolean(intent?.planId));
  const intentHandled = useRef(false);
  const [activeSceneId, setActiveSceneId] = useState(plan.scenes[0]?.id ?? "");
  const [tool, setTool] = useState("select");
  const [placement,setPlacement]=useState(null);
  const [tabletPanel,setTabletPanel]=useState(null);
  const paletteTouch=useRef(false);
  const [libraryTab, setLibraryTab] = useState("players");
  const [lineColor, setLineColor] = useState("#f4f7fb");
  const [textDraft, setTextDraft] = useState("Coaching point");
  const [selected, setSelected] = useState(null);
  const [kitTab, setKitTab] = useState("kit1");
  const activeKit = KIT_TABS.find((tab) => tab.id === kitTab) ?? KIT_TABS[0];
  const [linkDraft, setLinkDraft] = useState({ label: "", url: "" });
  // Double-click a pitch text label to retype it where it sits. The inspector
  // can already edit the label, but on the go you want the words under your
  // finger, not across the screen.
  const [editingTextId, setEditingTextId] = useState(null);
  const [movementTarget, setMovementTarget] = useState(null);
  const [draft, setDraft] = useState(null);
  const [pitchSize, setPitchSize] = useState({ width: 1e3, height: 640 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  // Which numbered step is on screen, so the coach can follow the sequence.
  const [activeStep, setActiveStep] = useState(null);
  const [recording, setRecording] = useState(null); // null | { progress }
  const stepTicker = useRef(0);
  const [saveState, setSaveState] = useState("saved");
  const [toast, setToast] = useState("");
  // The plan hydrates from localStorage, so skip SSR markup entirely to keep
  // the server and client trees identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Camera controls: rotate the board in 90 degree steps (view the session
  // from any touchline or behind either goal) plus a 3D tilt presentation.
  const [viewRot, setViewRot] = useState(0);
  const [tilt, setTilt] = useState(false);
  // Cloud plans saved to the team via /api/session-plans.
  const [planId, setPlanId] = useState(null);
  useEffect(() => { setPlanId(loadDraftPlanId(teamId)); }, [teamId]);
  const planIdRef = useRef(planId);
  planIdRef.current = planId;
  useEffect(() => { setPreviousDrafts(listStashedDrafts(deviceStorage(), storageKeys)); }, [storageKeys]);
  const [savedPlans, setSavedPlans] = useState([]);
  const [plansOpen, setPlansOpen] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const pendingSave = useRef(null);
  const savingCloud = useRef(false);
  const [notesOpen, setNotesOpen] = useState(false);
  // Our own "are you sure" rather than window.confirm: some browsers suppress
  // the native dialog, and a Delete button that silently does nothing is worse
  // than no Delete button at all.
  const [confirmAsk, setConfirmAsk] = useState(null);
  const [renamingScene, setRenamingScene] = useState(null); // scene id being renamed inline
  const stageRotate = useRef(null); // mouse-driven view rotation state
  const pitchRef = useRef(null);
  const importRef = useRef(null);
  const exportSvgRef = useRef(null);
  const activeAnimations = useRef([]);
  const playbackRun = useRef(0);
  const portraitView = viewRot % 180 !== 0;
  const dispW = portraitView ? PITCH_HEIGHT : PITCH_WIDTH;
  const dispH = portraitView ? PITCH_WIDTH : PITCH_HEIGHT;
  // Model space (1000x640) to display space and back, for any view rotation.
  const toDisp = useCallback((x, y) => {
    if (viewRot === 90) return { x: PITCH_HEIGHT - y, y: x };
    if (viewRot === 180) return { x: PITCH_WIDTH - x, y: PITCH_HEIGHT - y };
    if (viewRot === 270) return { x: y, y: PITCH_WIDTH - x };
    return { x, y };
  }, [viewRot]);
  const fromDisp = useCallback((dx, dy) => {
    if (viewRot === 90) return { x: dy, y: PITCH_HEIGHT - dx };
    if (viewRot === 180) return { x: PITCH_WIDTH - dx, y: PITCH_HEIGHT - dy };
    if (viewRot === 270) return { x: PITCH_WIDTH - dy, y: dx };
    return { x: dx, y: dy };
  }, [viewRot]);
  const refreshPlans = useCallback(async () => {
    if (!teamId) return;
    try {
      const res = await fetch(`/api/session-plans?team=${teamId}`);
      if (!res.ok) return;
      const data = await res.json();
      setSavedPlans(Array.isArray(data.plans) ? data.plans : []);
    } catch {
      /* offline is fine, local draft still works */
    }
  }, [teamId]);
  useEffect(() => {
    refreshPlans();
  }, [refreshPlans]);
  // Act once on the link that opened the planner (lib/planner-drafts.js):
  // ?new=1 starts blank, ?plan=<id> opens that saved plan, anything else
  // resumes the device draft. Declared after the planId load above so a
  // fresh start's planId wins. The ref keeps a Strict Mode re-run from
  // starting a second blank session.
  useEffect(() => {
    if (intentHandled.current) return;
    intentHandled.current = true;
    const mode = intent?.mode;
    if (mode === "new") {
      if (storedDraftExists(teamId)) replaceCurrentPlan(startFresh, { proceedLabel: "Start blank anyway", planId: loadDraftPlanId(teamId) });
      else startFresh();
    } else if (mode === "open" && intent.planId) {
      void openCloudPlan({ id: intent.planId }, { fromLink: true }).finally(() => setIntentPending(false));
    } else if (!storedDraftExists(teamId)) {
      // First visit on this device: the starter plan is nobody's work yet.
      markPlannerClean(deviceStorage(), storageKeys, planRef.current);
    }
    if (mode === "new" || mode === "open") {
      // Done with the intent. Left in the address bar, a reload would start
      // another blank session or reopen the saved copy over new edits.
      try {
        window.history.replaceState(null, "", `${window.location.pathname}${withoutIntent(window.location.search)}${window.location.hash}`);
      } catch { /* the address bar is cosmetic */ }
    }
  }, []);
  const currentScene = plan.scenes.find((scene) => scene.id === activeSceneId) ?? plan.scenes[0];
  useEffect(() => {
    if (!currentScene && plan.scenes[0]) setActiveSceneId(plan.scenes[0].id);
  }, [currentScene, plan.scenes]);
  // Depends on `mounted` (and intentPending, which holds the same gate while a
  // ?plan= link loads): before the gate opens, pitchRef is null,
  // so an empty-deps effect would never observe the real element and every
  // object would render at raw model coordinates (the round-1 drag bug).
  useEffect(() => {
    const element = pitchRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0) setPitchSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted, viewRot, intentPending]);
  useEffect(() => {
    if (!mounted) return;
    try {
      if (planId) localStorage.setItem(draftPlanIdKey(teamId), planId);
      else localStorage.removeItem(draftPlanIdKey(teamId));
    } catch { /* private mode */ }
  }, [planId, teamId, mounted]);
  useEffect(() => {
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey(teamId), JSON.stringify(plan));
        setSaveState("saved");
      } catch { setSaveState("unavailable"); }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [plan, teamId]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  const selectedObject = useMemo(
    () => selected?.entity === "object" ? currentScene?.objects.find((object) => object.id === selected.id) : void 0,
    [currentScene, selected]
  );
  const selectedDrawing = useMemo(
    () => selected?.entity === "drawing" ? currentScene?.drawings.find((drawing) => drawing.id === selected.id) : void 0,
    [currentScene, selected]
  );
  const editPlan = (updater) => dispatch({ type: "edit", updater });
  const editScene = (updater) => {
    if (!currentScene) return;
    editPlan((value) => ({
      ...value,
      scenes: value.scenes.map(
        (scene) => scene.id === currentScene.id ? updater(scene) : scene
      )
    }));
  };
  const updateObject = (id, patch) => editScene((scene) => ({
    ...scene,
    objects: scene.objects.map(
      (object) => object.id === id ? { ...object, ...patch } : object
    )
  }));
  const updateDrawing = (id, patch) => editScene((scene) => ({
    ...scene,
    drawings: scene.drawings.map(
      (drawing) => drawing.id === id ? { ...drawing, ...patch } : drawing
    )
  }));
  const getPitchPoint = (clientX, clientY) => {
    const rect = pitchRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const dx = (clientX - rect.left) / rect.width * dispW;
    const dy = (clientY - rect.top) / rect.height * dispH;
    const point = fromDisp(dx, dy);
    return {
      x: clamp(point.x, 0, PITCH_WIDTH),
      y: clamp(point.y, 0, PITCH_HEIGHT)
    };
  };
  const renderedTransform = (x, y) => {
    const disp = toDisp(x, y);
    return `translate(${disp.x / dispW * pitchSize.width}px, ${disp.y / dispH * pitchSize.height}px) translate(-50%, -50%)`;
  };
  const addObject = (item, point) => {
    if (!currentScene) return;
    const numberedCount = currentScene.objects.filter(
      (object2) => object2.kind === item.kind && (!item.color || object2.color === item.color)
    ).length;
    const base = makeObject(item.kind, point.x, point.y, numberedCount);
    const object = {
      ...base,
      pose: item.pose ?? base.pose,
      color: item.color ?? base.color,
      label: item.kind === "player" ? "" : base.label,
      number: item.kind === "player" ? String(numberedCount % 23 + 1) : base.number
    };
    editScene((scene) => ({ ...scene, objects: [...scene.objects, object] }));
    setSelected({ entity: "object", id: object.id });
    setTool("select");
  };
  const chooseAsset = item => {
    if(paletteTouch.current)return;
    setPlacement(item);setTool("select");setTabletPanel(null);
    setToast("Tap the pitch to place it, or drag from the library.");
  };
  const palettePointerDown = (event,item) => {
    if(event.pointerType==="mouse")return;
    const element=event.currentTarget,start={x:event.clientX,y:event.clientY};
    let moved=false,ghost=null;
    element.setPointerCapture(event.pointerId);
    const move=e=>{if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>10){moved=true;element.classList.add("is-dragging-asset");if(!ghost){ghost=document.createElement("div");ghost.className="palette-drag-preview";ghost.innerHTML=element.querySelector("svg")?.outerHTML||"";document.body.append(ghost);}ghost.style.transform=`translate(${e.clientX+14}px,${e.clientY-72}px)`;}};
    const finish=e=>{
      cleanup();paletteTouch.current=true;setTimeout(()=>{paletteTouch.current=false},400);
      const rect=pitchRef.current?.getBoundingClientRect();
      if(moved && rect && e.clientX>=rect.left && e.clientX<=rect.right && e.clientY>=rect.top && e.clientY<=rect.bottom){setPlacement(null);addObject(item,getPitchPoint(e.clientX,e.clientY));}
      else if(!moved){setPlacement(item);setTool("select");setToast("Tap the pitch to place it.");}
    };
    const cancel=()=>cleanup();
    const cleanup=()=>{ghost?.remove();element.classList.remove("is-dragging-asset");element.removeEventListener("pointermove",move);element.removeEventListener("pointerup",finish);element.removeEventListener("pointercancel",cancel);};
    element.addEventListener("pointermove",move);element.addEventListener("pointerup",finish);element.addEventListener("pointercancel",cancel);
  };
  const deleteSelection = () => {
    if (!selected) return;
    editScene((scene) => ({
      ...scene,
      objects: selected.entity === "object" ? scene.objects.filter((object) => object.id !== selected.id) : scene.objects,
      drawings: scene.drawings.filter(
        (drawing) => drawing.id !== selected.id && (selected.entity !== "object" || drawing.targetId !== selected.id)
      )
    }));
    if (movementTarget === selected.id) setMovementTarget(null);
    setSelected(null);
  };
  const duplicateSelection = () => {
    if (!selected || !currentScene) return;
    if (selected.entity === "object") {
      const source2 = currentScene.objects.find((object) => object.id === selected.id);
      if (!source2) return;
      const copy2 = {
        ...source2,
        id: uid(),
        x: clamp(source2.x + 28, 0, PITCH_WIDTH),
        y: clamp(source2.y + 28, 0, PITCH_HEIGHT),
        locked: false
      };
      editScene((scene) => ({ ...scene, objects: [...scene.objects, copy2] }));
      setSelected({ entity: "object", id: copy2.id });
      return;
    }
    const source = currentScene.drawings.find((drawing) => drawing.id === selected.id);
    if (!source) return;
    const copy = {
      ...source,
      id: uid(),
      x1: source.x1 + 20,
      y1: source.y1 + 20,
      x2: source.x2 + 20,
      y2: source.y2 + 20
    };
    editScene((scene) => ({ ...scene, drawings: [...scene.drawings, copy] }));
    setSelected({ entity: "drawing", id: copy.id });
  };
  const handleObjectPointerDown = (event, object) => {
    event.stopPropagation();
    if (tilt) return; // presentation view is read-only
    if(placement){event.preventDefault();addObject(placement,getPitchPoint(event.clientX,event.clientY));setPlacement(null);return;}
    if (tool === "erase") {
      setSelected({ entity: "object", id: object.id });
      editScene((scene) => ({
        ...scene,
        objects: scene.objects.filter((item) => item.id !== object.id),
        drawings: scene.drawings.filter((drawing) => drawing.targetId !== object.id)
      }));
      setSelected(null);
      return;
    }
    // Free reign (Lee): with any line tool active, pressing a figure starts the
    // line ON that figure and drags out from it. The figure itself is what
    // animates, so a coach never has to pre-select a target.
    if (["movement", "pass", "dribble", "shoot"].includes(tool)) {
      const element = event.currentTarget;
      const startDraft = { kind: tool, start: { x: object.x, y: object.y }, end: getPitchPoint(event.clientX, event.clientY), anchorId: object.id };
      setDraft(startDraft);
      setMovementTarget(null);
      element.setPointerCapture(event.pointerId);
      let live = startDraft;
      const move = (pointerEvent) => {
        live = { ...live, end: getPitchPoint(pointerEvent.clientX, pointerEvent.clientY) };
        setDraft(live);
      };
      const finish = (pointerEvent) => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", finish);
        element.removeEventListener("pointercancel", cancel);
        commitDraft(live, getPitchPoint(pointerEvent.clientX, pointerEvent.clientY));
      };
      const cancel = () => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", finish);
        element.removeEventListener("pointercancel", cancel);
        setDraft(null);
      };
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", finish);
      element.addEventListener("pointercancel", cancel);
      return;
    }
    if (tool !== "select") return;
    setSelected({ entity: "object", id: object.id });
    if (object.locked) return;
    const element = event.currentTarget;
    const start = getPitchPoint(event.clientX, event.clientY);
    const startObject = { x: object.x, y: object.y };
    element.style.willChange = "transform";
    element.setPointerCapture(event.pointerId);
    const move = (pointerEvent) => {
      const point = getPitchPoint(pointerEvent.clientX, pointerEvent.clientY);
      const x = clamp(startObject.x + point.x - start.x, 0, PITCH_WIDTH);
      const y = clamp(startObject.y + point.y - start.y, 0, PITCH_HEIGHT);
      element.style.transform = renderedTransform(x, y);
      element.dataset.dragX = String(x);
      element.dataset.dragY = String(y);
    };
    const up = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      const x = Number(element.dataset.dragX ?? object.x);
      const y = Number(element.dataset.dragY ?? object.y);
      delete element.dataset.dragX;
      delete element.dataset.dragY;
      element.style.willChange = "";
      if (x !== object.x || y !== object.y) updateObject(object.id, { x, y });
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  };
  const handlePitchPointerDown = (event) => {
    if (event.button !== 0) return;
    if (tilt) return; // presentation view is read-only
    const point = getPitchPoint(event.clientX, event.clientY);
    if(placement){event.preventDefault();addObject(placement,point);setPlacement(null);return;}
    if (tool === "select") {
      setSelected(null);
      return;
    }
    if (tool === "text") {
      // No browser prompt (it gets blocked): drop the text straight on the
      // pitch, keep it selected so the label field is ready to edit.
      const object = { ...makeObject("text", point.x, point.y), label: textDraft.trim() || "Coaching point" };
      editScene((scene) => ({ ...scene, objects: [...scene.objects, object] }));
      setSelected({ entity: "object", id: object.id });
      setTool("select");
      setToast("Text added. Edit the wording in the panel on the right.");
      return;
    }
    // Movement with a target already picked from the panel keeps the old
    // click-to-extend behaviour (chained runs). Otherwise the coach just drags
    // from the figure, handled by the shared drag path below.
    if (tool === "movement" && movementTarget && currentScene) {
      const target = currentScene.objects.find((object) => object.id === movementTarget);
      if (target) {
        const previous = [...currentScene.drawings].reverse().find((drawing) => drawing.kind === "movement" && drawing.targetId === target.id);
        const movement = {
          id: uid(),
          kind: "movement",
          x1: previous?.x2 ?? target.x,
          y1: previous?.y2 ?? target.y,
          x2: point.x,
          y2: point.y,
          color: "#ff3d42",
          width: 4,
          curve: 0,
          targetId: target.id,
          duration: 1200
        };
        editScene((scene) => ({ ...scene, drawings: [...scene.drawings, movement] }));
        setSelected({ entity: "drawing", id: movement.id });
        setMovementTarget(null);
        setTool("select");
        return;
      }
    }
    if (["movement", "pass", "dribble", "shoot", "pitch-line", "zone"].includes(tool)) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraft({ kind: tool, start: point, end: point });
    }
  };
  const handlePitchPointerMove = (event) => {
    if (!draft) return;
    const end = getPitchPoint(event.clientX, event.clientY);
    setDraft({ ...draft, end });
  };
  // SSP-style mouse camera: grab the dark area around the pitch and drag
  // sideways; every 110px of travel snaps the view another 90 degrees.
  const handleStagePointerDown = (event) => {
    if (event.button !== 0) return;
    // any grab on the dark backdrop (stage or frame) spins the camera; grabs
    // on the pitch itself, the meta row or the floating controls do not
    if (event.target.closest(".pitch-surface, .view-fab, .canvas-meta, .movement-prompt, .player-display-choice")) return;
    const element = event.currentTarget;
    stageRotate.current = { startX: event.clientX, applied: 0 };
    element.setPointerCapture(event.pointerId);
    const move = (pointerEvent) => {
      const state = stageRotate.current;
      if (!state) return;
      const steps = Math.trunc((pointerEvent.clientX - state.startX) / 110);
      if (steps !== state.applied) {
        const delta = steps - state.applied;
        state.applied = steps;
        stopPlayback();
        setViewRot((rot) => (((rot + delta * 90) % 360) + 360) % 360);
      }
    };
    const up = () => {
      stageRotate.current = null;
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  };
  // Shared by the pitch surface and by lines dragged straight off a figure.
  const commitDraft = (activeDraft, end) => {
    const draft = activeDraft;
    const distance = Math.hypot(end.x - draft.start.x, end.y - draft.start.y);
    if (distance > 10) {
      const drawing = {
        id: uid(),
        kind: draft.kind,
        x1: draft.start.x,
        y1: draft.start.y,
        x2: end.x,
        y2: end.y,
        color: draft.kind === "movement" ? "#ff3d42" : draft.kind === "pass" ? "#11151a" : draft.kind === "shoot" ? "#ffe329" : draft.kind === "zone" ? "#cbd4dd" : lineColor,
        width: draft.kind === "zone" ? 3 : draft.kind === "pitch-line" ? 4 : draft.kind === "movement" ? 4 : 5,
        curve: 0
      };
      // Free reign: whatever the line was dragged from is what moves. Lock it
      // in now so later edits to the line cannot silently retarget it.
      if (ANIMATED_KINDS.has(drawing.kind)) {
        drawing.duration = DEFAULT_DURATION;
        // Join the step the coach is currently building, so drawing three
        // paths for one moment keeps them together. "Number steps" turns a
        // whole scene into 1, 2, 3 in one click.
        const lastAnimated = [...(currentScene?.drawings || [])].reverse()
          .find((item) => ANIMATED_KINDS.has(item.kind));
        drawing.step = lastAnimated ? stepOf(lastAnimated) : 1;
        // A line dragged straight off a figure animates that exact figure.
        const anchored = draft.anchorId && currentScene?.objects?.find((object) => object.id === draft.anchorId);
        const resolved = resolveAnimation(
          anchored && drawing.kind !== "pass" && drawing.kind !== "shoot" ? { ...drawing, targetId: anchored.id } : drawing,
          currentScene?.objects
        );
        if (resolved) drawing.targetId = resolved.targetId;
        else if (drawing.kind === "movement") {
          setToast("Start the run on a player or the ball so it can animate");
        }
      }
      editScene((scene) => ({ ...scene, drawings: [...scene.drawings, drawing] }));
      setSelected({ entity: "drawing", id: drawing.id });
    }
    setDraft(null);
    setTool("select");
  };
  const handlePitchPointerUp = (event) => {
    if (!draft) return;
    commitDraft(draft, getPitchPoint(event.clientX, event.clientY));
  };
  const handleDrawingPointerDown = (event, drawing) => {
    event.stopPropagation();
    if (tool === "erase") {
      editScene((scene) => ({
        ...scene,
        drawings: scene.drawings.filter((item) => item.id !== drawing.id)
      }));
      setSelected(null);
      return;
    }
    if (tool === "select") setSelected({ entity: "drawing", id: drawing.id });
  };
  // ---- waypoints: bend a run around a mannequin ----
  // Double-click the line to drop a waypoint where you clicked, drag the
  // handles to shape it, alt-click a waypoint to take it out again.
  const addWaypoint = (drawing, point) => {
    const points = pathPoints(drawing);
    // Insert into the segment the click landed nearest to, so a new waypoint
    // never jumps the run back on itself.
    let bestIndex = 1;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (length * length)));
      const distance = Math.hypot(point.x - (a.x + (b.x - a.x) * t), point.y - (a.y + (b.y - a.y) * t));
      if (distance < bestDistance) { bestDistance = distance; bestIndex = i + 1; }
    }
    const waypoints = [...(drawing.waypoints || [])];
    waypoints.splice(bestIndex - 1, 0, { x: point.x, y: point.y });
    updateDrawing(drawing.id, { waypoints });
    setToast("Waypoint added. Drag it to shape the run.");
  };
  const removeWaypoint = (drawing, index) => {
    const waypoints = (drawing.waypoints || []).filter((_, i) => i !== index);
    updateDrawing(drawing.id, { waypoints: waypoints.length ? waypoints : undefined });
  };
  // Drag a path handle: end points move the line, middle ones bend it.
  const handlePointDrag = (event, drawing, which, index) => {
    event.stopPropagation();
    if (tilt) return;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const move = (pointerEvent) => {
      const point = getPitchPoint(pointerEvent.clientX, pointerEvent.clientY);
      if (which === "start") updateDrawing(drawing.id, { x1: point.x, y1: point.y });
      else if (which === "end") updateDrawing(drawing.id, { x2: point.x, y2: point.y });
      else {
        const waypoints = [...(drawing.waypoints || [])];
        waypoints[index] = { x: point.x, y: point.y };
        updateDrawing(drawing.id, { waypoints });
      }
    };
    const up = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  };
  const handleDrop = (event) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    try {
      const item = JSON.parse(raw);
      if (!item?.kind) return;
      addObject(item, getPitchPoint(event.clientX, event.clientY));
    } catch {
    }
  };
  const stopPlayback = () => {
    playbackRun.current += 1;
    cancelAnimationFrame(stepTicker.current);
    activeAnimations.current.forEach((animation) => animation.cancel());
    activeAnimations.current = [];
    pitchRef.current?.querySelectorAll(".pitch-object").forEach((element) => {
      element.style.willChange = "";
      element.classList.remove("is-animating");
    });
    setActiveStep(null);
    setIsPlaying(false);
  };
  // The scene's motion plan: which object moves, along which path, in which
  // numbered step. Shared with the recorder and the tests.
  const sceneTimeline = useMemo(
    () => (currentScene ? buildSceneTimeline(currentScene, resolveAnimation) : null),
    [currentScene],
  );
  const stepNumbers = useMemo(
    () => (sceneTimeline ? sceneTimeline.steps.map((range) => range.step) : []),
    [sceneTimeline],
  );
  // How much of the written plan exists, so the button says something useful
  // rather than just "notes".
  const notesWritten = useMemo(
    () => NOTE_FIELDS.filter(([key]) => (plan.notesSections?.[key] || "").trim()).length,
    [plan.notesSections],
  );
  const sequenceWritten = useMemo(
    () => stepNumbers.filter((step) => (currentScene?.stepNotes?.[String(step)] || "").trim()).length,
    [stepNumbers, currentScene],
  );

  // Play one track: a WAAPI animation whose delay places it in its step.
  const runTrack = (track, run) => {
    const element = document.querySelector(`[data-object-id="${CSS.escape(track.objectId)}"]`);
    if (!element) return null;
    element.style.willChange = "transform";
    element.classList.add("is-animating");
    const keyframes = samplePath(track.drawing, 32).map((point) => ({
      transform: renderedTransform(point.x + (track.offset?.x || 0), point.y + (track.offset?.y || 0)),
    }));
    const animation = element.animate(keyframes, {
      delay: (track.startMs - (track.timelineStart || 0)) / playbackSpeed,
      duration: Math.max(1, track.endMs - track.startMs) / playbackSpeed,
      easing: track.drawing.kind === "pass" || track.drawing.kind === "shoot" ? "ease-out" : "linear",
      fill: "forwards",
    });
    if (playbackRun.current !== run) {
      animation.cancel();
      return null;
    }
    activeAnimations.current.push(animation);
    return { element, animation };
  };

  // Follow the clock so the step badge on screen matches what is moving.
  const followSteps = (timeline, run, startedAt) => {
    cancelAnimationFrame(stepTicker.current);
    const tick = () => {
      if (playbackRun.current !== run) return;
      const ms = (performance.now() - startedAt) * playbackSpeed;
      setActiveStep(activeStepAt(timeline, ms + timeline.startAt));
      if (ms <= timeline.duration + 200) stepTicker.current = requestAnimationFrame(tick);
    };
    stepTicker.current = requestAnimationFrame(tick);
  };

  const playTimeline = async (timeline, run) => {
    const touched = [];
    for (const track of timeline.tracks) {
      const started = runTrack({ ...track, timelineStart: timeline.startAt }, run);
      if (started) touched.push(started.element);
    }
    followSteps(timeline, run, performance.now());
    await new Promise((resolve) => window.setTimeout(resolve, timeline.duration / playbackSpeed));
    return touched;
  };

  const clearAnimating = (elements) => {
    for (const element of elements) {
      element.style.willChange = "";
      element.classList.remove("is-animating");
    }
  };

  const playSession = async () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    if (!currentScene || !sceneTimeline) return;
    if (!sceneTimeline.tracks.length) {
      setToast("Draw a run, pass, dribble or shot first, then press play");
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setToast("Playback is disabled by your reduced motion setting");
      return;
    }
    const run = playbackRun.current + 1;
    playbackRun.current = run;
    setIsPlaying(true);
    const touched = await playTimeline(sceneTimeline, run);
    if (playbackRun.current !== run) return;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    clearAnimating(touched);
    if (playbackRun.current === run) stopPlayback();
  };

  // The whole session: every scene's steps, then a tween that carries shared
  // objects into the next scene's shape. Two frames become a drill.
  const playWholeSession = async () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    if (plan.scenes.length < 2) {
      void playSession();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setToast("Playback is disabled by your reduced motion setting");
      return;
    }
    const run = playbackRun.current + 1;
    playbackRun.current = run;
    setIsPlaying(true);
    const session = buildSessionTimeline(plan, resolveAnimation);
    const touched = [];
    for (const segment of session.segments) {
      if (playbackRun.current !== run) break;
      if (segment.kind === "scene") {
        setActiveSceneId(segment.sceneId);
        setSelected(null);
        // Let React paint the scene before animating the objects in it. A
        // background tab stops firing rAF, so fall back on a timer rather than
        // leaving the session stuck half way through.
        await new Promise((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          requestAnimationFrame(() => requestAnimationFrame(finish));
          setTimeout(finish, 120);
        });
        if (playbackRun.current !== run) break;
        if (segment.timeline.tracks.length) {
          touched.push(...(await playTimeline(segment.timeline, run)));
        }
      } else {
        setActiveStep(null);
        const moving = [];
        for (const move of segment.moves) {
          const element = document.querySelector(`[data-object-id="${CSS.escape(move.objectId)}"]`);
          if (!element) continue;
          element.style.willChange = "transform";
          element.classList.add("is-animating");
          const animation = element.animate(
            [
              { transform: renderedTransform(move.from.x, move.from.y) },
              { transform: renderedTransform(move.to.x, move.to.y) },
            ],
            { duration: SCENE_TWEEN_MS / playbackSpeed, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
          );
          activeAnimations.current.push(animation);
          moving.push(element);
        }
        touched.push(...moving);
        await new Promise((resolve) => window.setTimeout(resolve, SCENE_TWEEN_MS / playbackSpeed));
      }
    }
    if (playbackRun.current !== run) return;
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    clearAnimating(touched);
    if (playbackRun.current === run) stopPlayback();
  };

  // Record the drill to a video file for the team chat. The canvas is driven
  // by the same timeline, so the export matches what was just on screen.
  const exportVideo = async () => {
    const surface = pitchRef.current;
    if (!surface || !sceneTimeline) return;
    if (!videoSupported()) {
      setToast("This browser cannot record video. Try Chrome, or export a PNG.");
      return;
    }
    if (!sceneTimeline.tracks.length) {
      setToast("Draw a run, pass, dribble or shot first, then record");
      return;
    }
    stopPlayback();
    setRecording({ progress: 0 });
    try {
      const base = new Map();
      for (const object of currentScene.objects) {
        const disp = toDisp(object.x, object.y);
        base.set(object.id, {
          x: (disp.x / dispW) * surface.clientWidth,
          y: (disp.y / dispH) * surface.clientHeight,
        });
      }
      const { blob, extension } = await recordDrill({
        surface,
        duration: sceneTimeline.duration,
        basePositions: base,
        positionsAt: (ms) => {
          const model = sampleAt(sceneTimeline, ms + sceneTimeline.startAt);
          const out = new Map();
          for (const [id, point] of model) {
            const disp = toDisp(point.x, point.y);
            out.set(id, {
              x: (disp.x / dispW) * surface.clientWidth,
              y: (disp.y / dispH) * surface.clientHeight,
            });
          }
          return out;
        },
        onProgress: (progress) => setRecording({ progress }),
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const slug = (plan.title || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      anchor.download = `${slug}-${currentScene.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${extension}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 8e3);
      setToast(`Drill video saved (${Math.round(blob.size / 1024)}KB)`);
    } catch (error) {
      setToast("Could not record the drill video");
    } finally {
      setRecording(null);
    }
  };
  // Number every animated path in the order it was drawn: the fastest route
  // from a diagram to a rehearsed pattern.
  const numberSteps = () => {
    if (!currentScene) return;
    const total = currentScene.drawings.filter((drawing) => ANIMATED_KINDS.has(drawing.kind)).length;
    // The updater must be pure: React can run it more than once, and a counter
    // captured from outside would then number the paths 4, 5, 6.
    editScene((scene) => {
      const order = new Map();
      scene.drawings.forEach((drawing) => {
        if (ANIMATED_KINDS.has(drawing.kind)) order.set(drawing.id, order.size + 1);
      });
      return {
        ...scene,
        drawings: scene.drawings.map((drawing) =>
          order.has(drawing.id) ? { ...drawing, step: order.get(drawing.id) } : drawing,
        ),
      };
    });
    setToast(total ? `Numbered ${total} steps in draw order` : "Nothing to number yet");
  };
  const mergeSteps = () => {
    if (!currentScene) return;
    editScene((scene) => ({
      ...scene,
      drawings: scene.drawings.map((drawing) =>
        ANIMATED_KINDS.has(drawing.kind) ? { ...drawing, step: 1 } : drawing,
      ),
    }));
    setToast("Everything now plays together");
  };
  // Shared by the inspector and the plan sheet editor, so a link added in
  // either place behaves identically.
  const addLinkFromDraft = () => {
    const url = normalizeUrl(linkDraft.url);
    if (!url) return;
    editPlan((value) => ({
      ...value,
      links: [...value.links, { id: uid(), label: linkDraft.label.trim(), url }],
    }));
    setLinkDraft({ label: "", url: "" });
  };
  const setDrawingStep = (drawingId, step) => {
    updateDrawing(drawingId, { step: Math.max(1, Math.min(99, Math.round(step))) });
  };
  const addScene = (blank = false) => {
    if (!currentScene) return;
    const scene = {
      id: uid(),
      name: `Scene ${plan.scenes.length + 1}`,
      objects: blank ? [] : currentScene.objects.map((object) => ({ ...object })),
      drawings: blank ? [] : currentScene.drawings.map((drawing) => ({ ...drawing }))
    };
    editPlan((value) => ({ ...value, scenes: [...value.scenes, scene] }));
    setActiveSceneId(scene.id);
    setSelected(null);
  };
  const commitSceneName = (sceneId, name) => {
    setRenamingScene(null);
    if (!name?.trim()) return;
    editPlan((value) => ({
      ...value,
      scenes: value.scenes.map(
        (item) => item.id === sceneId ? { ...item, name: name.trim() } : item
      )
    }));
  };
  const deleteScene = (sceneId) => {
    if (plan.scenes.length === 1) {
      setToast("A session needs at least one scene");
      return;
    }
    const nextScenes = plan.scenes.filter((scene) => scene.id !== sceneId);
    editPlan((value) => ({ ...value, scenes: nextScenes }));
    setActiveSceneId(nextScenes[0].id);
    setSelected(null);
  };
  const askConfirm = (message, confirmLabel, action) => setConfirmAsk({ message, confirmLabel, action });
  const clearScene = () => {
    askConfirm("Clear every object and drawing from this scene?", "Clear the scene", () => {
      editScene((scene) => ({ ...scene, objects: [], drawings: [] }));
      setSelected(null);
    });
  };
  const downloadPlan = () => {
    const blob = new Blob([JSON.stringify(plan, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "session-plan"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("Session file exported");
  };
  // Every path that swaps the plan on screen for another one comes through
  // here. An unsaved draft is moved aside on the device (and offered back in
  // the banner) instead of being overwritten by the autosave. If the device
  // cannot keep it, nothing is replaced until the coach says so.
  const replaceCurrentPlan = (apply, { proceedLabel = "Carry on anyway", incoming = null, planId: draftPlanId = planIdRef.current } = {}) => {
    const rescue = rescuePlannerDraft(deviceStorage(), storageKeys, { plan: planRef.current, planId: draftPlanId, incoming, id: uid() });
    if (rescue.entries) setPreviousDrafts(rescue.entries);
    if (rescue.stashed) setDraftsHidden(false);
    if (rescue.ok) {
      setDraftNotice(null);
      apply();
      return true;
    }
    setDraftNotice({
      message: "This device could not keep a copy of your unsaved session, so it is still open. Download it first, or carry on and replace it.",
      proceedLabel,
      proceed: apply
    });
    return false;
  };
  const startFresh = () => {
    stopPlayback();
    const fresh = freshPlan(clubDefaults);
    dispatch({ type: "load", plan: fresh });
    setActiveSceneId(fresh.scenes[0].id);
    setPlanId(null);
    setSelected(null);
    pendingSave.current = null;
    setCloudError("");
    markPlannerClean(deviceStorage(), storageKeys, fresh);
  };
  const resumeDraft = (entry) => {
    if (!isSessionPlan(entry?.plan)) {
      setToast("That draft could not be opened");
      return;
    }
    const resumed = migratePlan(entry.plan);
    replaceCurrentPlan(() => {
      const storage = deviceStorage();
      // The draft only leaves the list once the device holds it as the
      // working draft, so a full device can never lose it in between.
      let written = false;
      try {
        storage.setItem(storageKeys.draft, JSON.stringify(resumed));
        written = true;
      } catch { /* stays in the list */ }
      stopPlayback();
      dispatch({ type: "load", plan: resumed });
      setActiveSceneId(resumed.scenes[0]?.id ?? "");
      setPlanId(entry.planId || null);
      pendingSave.current = null;
      setCloudError("");
      setSelected(null);
      forgetPlannerClean(storage, storageKeys);
      if (written) {
        const remaining = removeFromDraftStash(listStashedDrafts(storage, storageKeys), entry.id);
        if (writeDraftStash(storage, storageKeys, remaining)) setPreviousDrafts(remaining);
      }
      setToast(`Resumed "${resumed.title || "Untitled session"}"`);
    }, { incoming: resumed, proceedLabel: "Resume anyway" });
  };
  const deleteDraft = (entry) => {
    askConfirm(`Delete the unsaved draft "${entry.title || "Untitled session"}" from this device? It is not in your library, so it cannot be brought back.`, "Delete draft", () => {
      const storage = deviceStorage();
      const remaining = removeFromDraftStash(listStashedDrafts(storage, storageKeys), entry.id);
      if (writeDraftStash(storage, storageKeys, remaining)) {
        setPreviousDrafts(remaining);
        setToast("Draft deleted");
      } else {
        setToast("Could not delete that draft");
      }
    });
  };
  const saveToTeam = async (asNew = false) => {
    if (savingCloud.current) return;
    let locallySaved = false;
    try {
      localStorage.setItem(draftKey(teamId), JSON.stringify(plan));
      locallySaved = true;
      setSaveState("saved");
    } catch { setSaveState("unavailable"); }
    if (!teamId) {
      setToast(locallySaved ? "Saved on this device" : "Device storage unavailable. Download your session file to keep it.");
      return;
    }
    // Keep the same operation across uncertain responses. A content change
    // gets a new operation so a retry can never overwrite another version.
    const payload = JSON.stringify({ teamId, id: asNew ? null : planId, plan });
    if (pendingSave.current?.payload !== payload) {
      pendingSave.current = { payload, asNew, operationId: crypto.randomUUID() };
    }
    savingCloud.current = true;
    setCloudBusy(true);
    setCloudError("");
    try {
      const res = await fetch("/api/session-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...JSON.parse(payload), operationId: pendingSave.current.operationId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the session.");
      if (data.id) setPlanId(data.id);
      pendingSave.current = null;
      // This exact content is in the library now, so a later fresh start
      // does not need to keep a device copy of it.
      markPlannerClean(deviceStorage(), storageKeys, plan);
      setToast("Saved. Find it in Session plans in the coach portal.");
      refreshPlans();
    } catch (error) {
      setCloudError(`${error.message || "Cloud save failed."} ${locallySaved ? "Your device copy is saved." : "Device storage is unavailable. Download your session file to keep your work."}`);
    } finally {
      savingCloud.current = false;
      setCloudBusy(false);
    }
  };
  // Opens exactly one saved plan through the team-checked route. Used by the
  // library overlay and by ?plan=<id> links (fromLink), where the device's own
  // planId has not reached state yet and a failure must say so plainly.
  const openCloudPlan = async (entry, { fromLink = false } = {}) => {
    setCloudBusy(true);
    try {
      const res = await fetch(`/api/session-plans/${encodeURIComponent(entry.id)}?team=${encodeURIComponent(teamId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (!isSessionPlan(data.plan)) throw new Error("bad plan");
      const onTheGo = onTheGoTemplate(data.plan);
      if (onTheGo) {
        try { deviceStorage().setItem(draftKey(teamId), JSON.stringify(planRef.current)); } catch { /* autosave already has it */ }
        window.location.assign(`/on-the-go/${onTheGo}?team=${encodeURIComponent(teamId)}&plan=${encodeURIComponent(entry.id)}`);
        return;
      }
      const opened = migratePlan(data.plan);
      replaceCurrentPlan(() => {
        stopPlayback();
        dispatch({ type: "load", plan: opened });
        setActiveSceneId(opened.scenes[0]?.id ?? "");
        setPlanId(entry.id);
        setCloudError("");
        pendingSave.current = null;
        setSelected(null);
        setNotesOpen(false);
        setPlansOpen(false);
        markPlannerClean(deviceStorage(), storageKeys, opened);
        setToast(`Opened "${opened.title || "Untitled session"}"`);
      }, { incoming: opened, proceedLabel: "Open the saved session anyway", planId: fromLink ? loadDraftPlanId(teamId) : planIdRef.current });
    } catch {
      if (fromLink) setDraftNotice({ message: "Could not open that saved session. Your device draft is shown instead and nothing has been changed." });
      else setToast("Could not open that plan");
    } finally {
      setCloudBusy(false);
    }
  };
  const deleteCloudPlan = (entry) => {
    askConfirm(`Delete "${entry.title || "Untitled session"}"? It cannot be brought back.`, "Delete it", async () => {
      try {
        const res = await fetch(`/api/session-plans/${entry.id}?team=${teamId}`, { method: "DELETE" });
        if (!res.ok) throw new Error(String(res.status));
        if (planId === entry.id) {
          setPlanId(null);
          // The copy on screen is no longer in the library: treat it as unsaved.
          forgetPlannerClean(deviceStorage(), storageKeys);
        }
        // Drop it from the shelf here and now. Storage listings are eventually
        // consistent, so an immediate refresh can still hand back the plan we
        // just deleted, and the coach sees the card sitting there after being
        // told it was deleted.
        setSavedPlans((plans) => plans.filter((item) => item.id !== entry.id));
        setToast("Plan deleted");
        setTimeout(refreshPlans, 1200);
      } catch {
        setToast("Could not delete that plan");
      }
    });
  };
  const newSession = () => {
    askConfirm("Start a fresh session plan? Your current one stays in the library if you have saved it, and unsaved changes stay on this device so you can resume them.", "Start fresh", () => {
      replaceCurrentPlan(startFresh, { proceedLabel: "Start fresh anyway" });
    });
  };
  const exportScenePng = async () => {
    const node = exportSvgRef.current?.querySelector("svg.scene-export-svg");
    if (!node) {
      setToast("Nothing to export yet");
      return;
    }
    try {
      const blob = await svgNodeToPngBlob(node, 2);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const slug = (plan.title || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      anchor.download = `${slug}-${currentScene.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4e3);
      setToast("Scene image downloaded");
    } catch {
      setToast("PNG export failed in this browser");
    }
  };
  const printSession = () => {
    window.print();
  };
  const importPlan = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if(file.size > 2000000){setToast("This session file is too large. Your current session has been kept.");event.target.value="";return;}
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = migratePlan(readImportedPlan(JSON.parse(String(reader.result))));
        replaceCurrentPlan(() => {
          stopPlayback();
          dispatch({ type: "load", plan: parsed });
          setPlanId(null);
          pendingSave.current=null;
          setCloudError("");
          setActiveSceneId(parsed.scenes[0]?.id ?? "");
          setSelected(null);
          forgetPlannerClean(deviceStorage(), storageKeys);
          setToast("Session imported");
        }, { incoming: parsed, proceedLabel: "Import anyway" });
      } catch (error) {
        setToast(error.message || "That file is not a valid session plan. Your current session has been kept.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };
  useEffect(() => {
    const onKeyDown = (event) => {
      // Nothing on screen yet while a ?plan= link loads: no shortcut may edit
      // or save the draft that is about to be moved aside.
      if (intentPending) return;
      const target = event.target;
      if (target.isContentEditable || target.closest?.("[contenteditable=true]") || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if(key==="escape"){setPlacement(null);setTabletPanel(null);return;}
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
        setSelected(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "s") {
        event.preventDefault();
        void saveToTeam(false);
        return;
      }
      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (key === " ") {
        event.preventDefault();
        void playSession();
        return;
      }
      const matching = tools.find((item) => item.shortcut.toLowerCase() === key);
      if (matching) {
        setTool(matching.id);
        if (matching.id === "pass") setLineColor("#11151a");
        if (matching.id === "dribble") setLineColor("#f4f7fb");
        if (matching.id === "shoot") setLineColor("#ffe329");
        setMovementTarget(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  if (!mounted || !currentScene || intentPending) {
    return <div className="jf-planner is-fullscreen"><main className="planner-shell planner-loading" aria-busy="true" /></div>;
  }
  const latestDraft = previousDrafts[0];
  const olderDrafts = previousDrafts.length - 1;
  return <div className="jf-planner is-fullscreen"><main className="planner-shell">{cloudError && <div className="planner-save-recovery" role="alert"><span>{cloudError}</span><button className="secondary-button" onClick={() => void saveToTeam(pendingSave.current?.asNew ?? false)} disabled={cloudBusy}>Retry save</button><button className="secondary-button" onClick={downloadPlan}>Download session file</button></div>}{draftNotice && <div className="planner-save-recovery" role="alert"><span>{draftNotice.message}</span>{draftNotice.proceed && <button className="secondary-button" onClick={downloadPlan}>Download session file</button>}{draftNotice.proceed && <button className="secondary-button" onClick={() => {
      const run = draftNotice.proceed;
      setDraftNotice(null);
      run();
    }}>{draftNotice.proceedLabel}</button>}<button className="secondary-button" onClick={() => setDraftNotice(null)}>{draftNotice.proceed ? "Keep editing" : "Dismiss"}</button></div>}{latestDraft && !draftsHidden && <div className="planner-save-recovery planner-draft-recovery" role="status"><span>Unsaved draft kept on this device: "{latestDraft.title || "Untitled session"}"{formatDraftTime(latestDraft.savedAt) ? `, put aside ${formatDraftTime(latestDraft.savedAt)}` : ""}.{olderDrafts > 0 ? ` ${olderDrafts} older ${olderDrafts === 1 ? "draft is" : "drafts are"} kept too.` : ""}</span><button className="secondary-button" onClick={() => resumeDraft(latestDraft)}>Resume your unsaved draft</button><button className="secondary-button" onClick={() => deleteDraft(latestDraft)}>Delete draft</button><button className="secondary-button" onClick={() => setDraftsHidden(true)}>Hide</button></div>}<header className="topbar"><a className="secondary-button back-to-dashboard" href="/jfp-portal/#plans"><ArrowLeft /> Session plans</a><div className="session-title-wrap"><input
    className="session-title"
    aria-label="Session title"
    value={plan.title}
    placeholder="Session title..."
    onChange={(event) => editPlan((value) => ({ ...value, title: event.target.value }))}
  /><span className="save-indicator" title={planId ? "Saving keeps a new version in your library" : "Not in your library yet"}>{saveState === "saved" ? <Check weight="bold" /> : <Clock />}{saveState === "unavailable" ? "Device storage unavailable" : saveState !== "saved" ? "Saving draft" : "Device draft saved"}</span></div><div className="topbar-actions"><button
    className="secondary-button"
    aria-haspopup="dialog"
    onClick={() => {
      setPlansOpen(true);
      refreshPlans();
    }}
  ><FolderOpen /> Library <CaretDown /></button><button
    className="icon-button"
    onClick={() => importRef.current?.click()}
    title="Import session file"
    aria-label="Import session file"
  ><UploadSimple /></button><input
    ref={importRef}
    hidden
    type="file"
    accept="application/json,.json"
    onChange={importPlan}
  /><button className="icon-button" onClick={downloadPlan} title="Download session file" aria-label="Download session file"><DownloadSimple /></button><button className="secondary-button" onClick={exportScenePng} title="Download this scene as an image"><ImageSquare /> PNG</button><ShareSession teamId={teamId} teamName={teamName} plan={plan} /><button className="secondary-button" onClick={printSession} title="Print the full session sheet"><Printer /> Print</button><button className="primary-button" disabled={cloudBusy} title="Save this session to the JFP coach portal" onClick={() => void saveToTeam(false)}><FloppyDisk weight="fill" />
            {cloudBusy ? "Saving..." : "Save"}
          </button></div></header><div className="tablet-controls" role="group" aria-label="Planner panels"><span>{placement ? "Tap the pitch to place your selection" : "Drag an asset, or tap then place"}</span>{placement && <button onClick={()=>setPlacement(null)}>Cancel placement</button>}<button aria-pressed={tabletPanel==="details"} onClick={()=>setTabletPanel(tabletPanel==="details"?null:"details")}>Session details</button><button aria-pressed={tabletPanel==="pitches"} onClick={()=>setTabletPanel(tabletPanel==="pitches"?null:"pitches")}>Pitch & style</button></div><section className="workspace" data-tablet-panel={tabletPanel || ""}><aside className="asset-panel"><div className="panel-heading"><div><span className="panel-kicker">Library</span><h2>{LIBRARY_TABS.find((item) => item.id === libraryTab)?.label}</h2></div><span className="drag-hint">Drag or click</span></div><button
    className="new-session-button"
    onClick={newSession}
    title="Clear the pitch and start a fresh session plan"
  ><Plus weight="bold" /> Start blank session</button><label className="artwork-picker"><span>Artwork</span><select aria-label="Artwork" value={plan.artwork || "classic"} onChange={e=>editPlan(v=>({...v,artwork:e.target.value}))}><option value="classic">Classic</option><option value="illustrated">Realistic</option></select></label>{plan.artwork==="illustrated" && <p className="artwork-note">Realistic player figures retain each selected pose.</p>}<nav className="library-tabs" aria-label="Planner library">{LIBRARY_TABS.map((item) => <button
    key={item.id}
    className={libraryTab === item.id ? "is-active" : ""}
    aria-pressed={libraryTab === item.id}
    onClick={() => setLibraryTab(item.id)}
  >{item.label}</button>)}</nav>{libraryTab === "players" && <><div className="kit-tabs" role="tablist" aria-label="Player kits">{KIT_TABS.map((tab) => <button
    key={tab.id}
    role="tab"
    aria-selected={kitTab === tab.id}
    className={`kit-tab ${kitTab === tab.id ? "is-active" : ""}`}
    onClick={() => setKitTab(tab.id)}
  ><span className="kit-dot" style={{ background: tab.color }} />{tab.name}</button>)}</div><div className="pose-grid">{(plan.artwork === "classic" ? [{ id: activeKit.id === "gk" ? "gk-ready" : "stand", name: activeKit.id === "officials" ? "Coach" : "Numbered player" }] : activeKit.poses).map((pose) => {
    const item = {
      kind: activeKit.id === "officials" ? "coach" : "player",
      pose: pose.id,
      color: activeKit.color,
      numbered: activeKit.numbered
    };
    return <button
      key={pose.id}
      className="pose-tile"
      title={pose.name}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
        event.dataTransfer.effectAllowed = "copy";
      }}
      onPointerDown={event=>palettePointerDown(event,item)}
      onClick={() => chooseAsset(item)}
    >{plan.artwork === "classic" ? <PlayerCircle color={activeKit.color} value={item.kind === "coach" ? "C" : "1"} size={72} className="palette-player-circle" /> : <PlayerFigure
      artwork={plan.artwork}
      pose={pose.id}
      color={activeKit.color}
      official={activeKit.id === "officials"}
    />}<span>{pose.name}</span></button>;
  })}</div></>}{libraryTab === "equipment" && <div className="equipment-grid equipment-grid-full">{equipment.map((item) => {
    const paletteItem = { kind: item.kind, color: item.color };
    const color = item.color ?? makeObject(item.kind, 0, 0).color;
    return <button
      className="equipment-item"
      draggable
      key={`${item.kind}-${item.name}`}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify(paletteItem));
        event.dataTransfer.effectAllowed = "copy";
      }}
      onPointerDown={event=>palettePointerDown(event,paletteItem)}
      onClick={() => chooseAsset(paletteItem)}
    ><span className="equipment-art"><EquipmentArt kind={item.kind} color={color} artwork={plan.artwork} /></span><span>{item.name}</span></button>;
  })}</div>}{libraryTab === "lines" && <div className="line-library">{LINE_TOOLS.map((item) => <button
    key={`${item.id}-${item.color}`}
    className={`${tool === item.id && lineColor === item.color ? "is-active" : ""}`}
    onClick={() => {
      setTool(item.id);
      setLineColor(item.color);
      setMovementTarget(null);
    }}
  ><span><strong>{item.label}</strong><small>{item.description}</small></span><i
    className={`line-sample is-${item.style}`}
    style={{ color: item.color, borderColor: item.color }}
  /></button>)}</div>}{libraryTab === "text" && <div className="text-library"><label><span>Custom pitch text</span><input value={textDraft} onChange={(event) => setTextDraft(event.target.value)} /></label><button
    className="primary-button"
    onClick={() => {
      const object = { ...makeObject("text", 500, 320), label: textDraft.trim() || "Coaching point" };
      editScene((scene) => ({ ...scene, objects: [...scene.objects, object] }));
      setSelected({ entity: "object", id: object.id });
    }}
  ><TextT /> Add custom text
              </button><div className="quick-text-grid">{[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", ...Array.from({ length: 11 }, (_, index) => String(index + 1))].map((label) => <button
    key={label}
    onClick={() => {
      const object = { ...makeObject("text", 500, 320), label };
      editScene((scene) => ({ ...scene, objects: [...scene.objects, object] }));
      setSelected({ entity: "object", id: object.id });
    }}
  >{label}</button>)}</div></div>}{libraryTab === "drills" && <div className="drill-library"><DrillBank teamId={teamId} plan={plan} scene={currentScene} onInsert={(savedScene) => { const scene = { ...savedScene, id: crypto.randomUUID() }; editPlan(value => ({ ...value, scenes: [...value.scenes, scene] })); setActiveSceneId(scene.id); setSelected(null); }} /><div className="panel-note">One tap adds the drill as a new scene, then shape it to your session.</div>{TEMPLATES.map((template) => <button
    key={template.id}
    className="drill-card"
    onClick={() => {
      const scene = templateScene(template.id);
      editPlan((value) => ({ ...value, scenes: [...value.scenes, scene] }));
      setActiveSceneId(scene.id);
      setSelected(null);
      setToast(`Added "${scene.name}" as a new scene`);
    }}
  ><span className="drill-thumb"><SceneSvg plan={{ ...plan, pitch: "blank" }} scene={templateScene(template.id)} idPrefix={`tpl-${template.id}`} /></span><span><strong>{template.name}</strong><small>{template.blurb}</small></span></button>)}</div>}<div className="shortcuts-card"><span>Shortcuts</span><div><kbd>V</kbd> Select</div><div><kbd>M</kbd> Movement</div><div><kbd>Space</kbd> Play</div><div><kbd>⌘ Z</kbd> Undo</div></div></aside><section className="canvas-column"><div className="toolstrip" role="toolbar" aria-label="Pitch tools"><div className="tool-group">{tools.map((item) => {
    const Icon = item.icon;
    return <button
      key={item.id}
      className={`tool-button ${tool === item.id ? "is-active" : ""}`}
      aria-pressed={tool === item.id}
      title={`${item.label} (${item.shortcut})`}
      onClick={() => {
        setTool(item.id);
        if (item.id === "pass") setLineColor("#11151a");
        if (item.id === "dribble") setLineColor("#f4f7fb");
        if (item.id === "shoot") setLineColor("#ffe329");
        if (item.id !== "movement") setMovementTarget(null);
      }}
    ><Icon weight={tool === item.id ? "fill" : "regular"} /><span>{item.label}</span><kbd>{item.shortcut}</kbd></button>;
  })}</div><div className="tool-group history-tools"><button
    className="icon-button"
    disabled={!editor.past.length}
    onClick={() => {
      dispatch({ type: "undo" });
      setSelected(null);
    }}
    title="Undo"
    aria-label="Undo"
  ><ArrowCounterClockwise /></button><button
    className="icon-button"
    disabled={!editor.future.length}
    onClick={() => {
      dispatch({ type: "redo" });
      setSelected(null);
    }}
    title="Redo"
    aria-label="Redo"
  ><ArrowClockwise /></button></div></div><div className="canvas-stage" onPointerDown={handleStagePointerDown} title="Drag the dark area sideways to spin the pitch view"><div className="canvas-meta"><div><span>{currentScene.name}</span><strong>{currentScene.objects.length} objects</strong></div>{movementTarget && <div className="movement-prompt"><Path weight="bold" />
                  Click a destination
                  <button
    aria-label="Cancel movement"
    onClick={() => {
      setMovementTarget(null);
      setTool("select");
    }}
  ><X /></button></div>}{tilt && <div className="movement-prompt tilt-prompt"><CubeTransparent weight="bold" />
                  Presentation view. Turn tilt off to edit.
                </div>}</div><div className={`pitch-frame ${tilt ? "is-tilted" : ""} ${portraitView ? "is-portrait" : ""}`}><div
    ref={pitchRef}
    className={`pitch-surface pitch-${plan.pitch} tool-${tool}`}
    style={{
      aspectRatio: `${dispW} / ${dispH}`,
      width: `min(100cqw, ${(100 * dispW / dispH).toFixed(2)}cqh)`,
      height: "auto"
    }}
    onPointerDown={handlePitchPointerDown}
    onPointerMove={handlePitchPointerMove}
    onPointerUp={handlePitchPointerUp}
    onDragOver={(event) => event.preventDefault()}
    onDrop={handleDrop}
  ><PitchSvg id={plan.pitch} rot={viewRot} styleId={plan.pitchStyle || "classic"} /><svg
    className="drawing-layer"
    viewBox={`0 0 ${dispW} ${dispH}`}
    preserveAspectRatio="none"
    aria-label="Session drawings"
  ><defs>{[
    ["arrow-red", "#ff3d42"],
    ["arrow-dark", "#11151a"],
    ["arrow-white", "#f4f7fb"],
    ["arrow-yellow", "#ffe329"]
  ].map(([id, fill]) => <marker
    key={id}
    id={id}
    viewBox="0 0 10 10"
    refX="8"
    refY="5"
    markerWidth="7"
    markerHeight="7"
    orient="auto-start-reverse"
  ><path d="M 0 0 L 10 5 L 0 10 z" fill={fill} /></marker>)}</defs><g transform={viewTransform(viewRot)}>{currentScene.drawings.map((drawing) => {
    const isSelected = selected?.entity === "drawing" && selected.id === drawing.id;
    if (drawing.kind === "zone") {
      const x = Math.min(drawing.x1, drawing.x2);
      const y = Math.min(drawing.y1, drawing.y2);
      const width = Math.abs(drawing.x2 - drawing.x1);
      const height = Math.abs(drawing.y2 - drawing.y1);
      return <g key={drawing.id}><rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="12"
        fill={`${drawing.color}22`}
        stroke={drawing.color}
        strokeWidth={isSelected ? drawing.width + 3 : drawing.width}
        strokeDasharray="14 9"
      /><rect
        className="drawing-hit"
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        stroke="transparent"
        strokeWidth="20"
        onPointerDown={(event) => handleDrawingPointerDown(event, drawing)}
      /></g>;
    }
    const path = renderedDrawingPath(drawing);
    return <g key={drawing.id}><path
      d={path}
      fill="none"
      stroke="rgba(6, 16, 12, .28)"
      strokeWidth={drawing.width + 5}
      strokeLinecap="round"
    /><path
      d={path}
      fill="none"
      stroke={drawing.color}
      strokeWidth={isSelected ? drawing.width + 2 : drawing.width}
      strokeDasharray={drawing.kind === "pass" || drawing.kind === "shoot" ? "16 10" : void 0}
      strokeLinecap="round"
      markerEnd={drawing.kind === "movement" ? "url(#arrow-red)" : drawing.kind === "pass" ? "url(#arrow-dark)" : drawing.kind === "dribble" ? "url(#arrow-white)" : drawing.kind === "shoot" ? "url(#arrow-yellow)" : void 0}
    /><path
      className="drawing-hit"
      d={path}
      fill="none"
      stroke="transparent"
      strokeWidth="24"
      onPointerDown={(event) => handleDrawingPointerDown(event, drawing)}
      onDoubleClick={(event) => {
        if (tilt || !ANIMATED_KINDS.has(drawing.kind)) return;
        event.stopPropagation();
        addWaypoint(drawing, getPitchPoint(event.clientX, event.clientY));
      }}
    />{/* step number, so a diagram reads as a rehearsed pattern */}
    {ANIMATED_KINDS.has(drawing.kind) && stepNumbers.length > 1 && <g className="step-badge" style={{ pointerEvents: "none" }}><circle
      cx={drawing.x1}
      cy={drawing.y1}
      r={12}
      fill={activeStep === stepOf(drawing) ? drawing.color : "rgba(9, 14, 20, 0.86)"}
      stroke={drawing.color}
      strokeWidth={2}
    /><text
      x={drawing.x1}
      y={drawing.y1 + 4.5}
      textAnchor="middle"
      fontSize={12.5}
      fontWeight={800}
      fill={activeStep === stepOf(drawing) ? "#0b1016" : "#f4f7fb"}
    >{stepOf(drawing)}</text></g>}
    {/* handles for shaping a selected run */}
    {isSelected && !tilt && ANIMATED_KINDS.has(drawing.kind) && <g className="path-handles">{[
      { point: { x: drawing.x1, y: drawing.y1 }, which: "start", index: -1 },
      ...(drawing.waypoints || []).map((point, index) => ({ point, which: "waypoint", index })),
      { point: { x: drawing.x2, y: drawing.y2 }, which: "end", index: -1 },
    ].map((handle, i) => <circle
      key={`${handle.which}-${i}`}
      className={`path-handle ${handle.which === "waypoint" ? "is-waypoint" : ""}`}
      cx={handle.point.x}
      cy={handle.point.y}
      r={handle.which === "waypoint" ? 7 : 8}
      onPointerDown={(event) => {
        if (handle.which === "waypoint" && (event.altKey || event.metaKey)) {
          event.stopPropagation();
          removeWaypoint(drawing, handle.index);
          return;
        }
        handlePointDrag(event, drawing, handle.which, handle.index);
      }}
    />)}</g>}</g>;
  })}{draft && draft.kind !== "zone" && (() => {
    const preview = {
      id: "draft",
      kind: draft.kind,
      x1: draft.start.x,
      y1: draft.start.y,
      x2: draft.end.x,
      y2: draft.end.y,
      color: draft.kind === "pass" ? "#11151a" : draft.kind === "shoot" ? "#ffe329" : lineColor,
      width: 5,
      curve: 0
    };
    return <path
      d={renderedDrawingPath(preview)}
      fill="none"
      stroke={preview.color}
      strokeWidth={preview.width}
      strokeDasharray={draft.kind === "pass" || draft.kind === "shoot" ? "16 10" : void 0}
      strokeLinecap="round"
      markerEnd={draft.kind === "pass" ? "url(#arrow-dark)" : draft.kind === "dribble" ? "url(#arrow-white)" : draft.kind === "shoot" ? "url(#arrow-yellow)" : void 0}
    />;
  })()}{draft?.kind === "zone" && <rect
    x={Math.min(draft.start.x, draft.end.x)}
    y={Math.min(draft.start.y, draft.end.y)}
    width={Math.abs(draft.end.x - draft.start.x)}
    height={Math.abs(draft.end.y - draft.start.y)}
    rx="12"
    fill="rgba(69, 168, 255, .14)"
    stroke="#45a8ff"
    strokeWidth="3"
    strokeDasharray="14 9"
  />}</g></svg>{currentScene.objects.map((object) => {
    const isSelected = selected?.entity === "object" && selected.id === object.id;
    const isMovementTarget = movementTarget === object.id;
    // Retyping happens in place of the label, so the words stay where the
    // coach is looking.
    if (object.kind === "text" && editingTextId === object.id) {
      const finish = () => setEditingTextId(null);
      return <input
        key={object.id}
        className="pitch-text-edit"
        autoFocus
        value={object.label}
        aria-label="Edit pitch text"
        style={{ transform: renderedTransform(object.x, object.y), zIndex: 6 }}
        onChange={(event) => updateObject(object.id, { label: event.target.value })}
        onBlur={finish}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            finish();
          }
        }}
      />;
    }
    return <button
      key={object.id}
      data-object-id={object.id}
      data-object-kind={object.kind}
      className={`pitch-object ${isSelected ? "is-selected" : ""} ${isMovementTarget ? "is-movement-target" : ""} ${object.locked ? "is-locked" : ""}`}
      style={{
        width: object.kind === "text" ? "auto" : object.size,
        height: object.kind === "text" ? "auto" : object.size,
        transform: renderedTransform(object.x, object.y),
        zIndex: object.kind === "text" ? 5 : 4
      }}
      onPointerDown={(event) => handleObjectPointerDown(event, object)}
      onDoubleClick={object.kind === "text" && !object.locked ? (event) => {
        event.stopPropagation();
        setEditingTextId(object.id);
      } : void 0}
      aria-label={`${object.kind}${object.label ? ` ${object.label}` : ""}`}
      aria-pressed={isSelected}
    ><span
      className="object-rotation"
      style={{ transform: `rotate(${object.rotation}deg)` }}
    ><ObjectVisual artwork={plan.artwork} object={object} disc={Boolean(currentScene.disc)} /></span>{object.linkUrl && <span className="object-link-badge" title={object.linkLabel || "Linked Joner drill"}><LinkSimple weight="bold" /></span>}</button>;
  })}</div></div><div className="canvas-view-controls"><div className="view-fab" role="group" aria-label="Camera view"><button
    className="icon-button"
    title="Rotate the view (or drag the dark area sideways)"
    aria-label="Rotate the pitch view 90 degrees"
    onClick={() => {
      stopPlayback();
      setViewRot((rot) => (rot + 90) % 360);
    }}
  ><ArrowsClockwise /></button><span className="view-angle">{viewRot}°</span><button
    className={`icon-button ${tilt ? "is-active-view" : ""}`}
    title={tilt ? "Back to flat editing view" : "3D tilt presentation view"}
    aria-pressed={tilt}
    aria-label="Toggle 3D tilt view"
    onClick={() => setTilt((value) => !value)}
  ><CubeTransparent /></button></div>{plan.artwork === "classic" ? <div className="player-display-choice is-classic" aria-label="Classic player display"><span>Classic: numbered circles</span></div> : <div className="player-display-choice" role="group" aria-label="Player display for this scene"><span>Players</span><button type="button" aria-pressed={!currentScene.disc} onClick={() => editScene((scene) => ({ ...scene, disc: false }))}>Figures</button><button type="button" aria-pressed={Boolean(currentScene.disc)} onClick={() => editScene((scene) => ({ ...scene, disc: true }))}>Numbered circles</button></div>}</div></div><div className="notes-bar"><button className="notes-open-button" onClick={() => setNotesOpen(true)}><NotePencil weight="bold" /> Write the session plan{notesWritten > 0 ? <span className="notes-count">{notesWritten} filled in</span> : <span className="notes-count is-empty">notes, coaching points, links</span>}</button>{stepNumbers.length > 1 && <span className="notes-bar-hint">{sequenceWritten} of {stepNumbers.length} steps described</span>}</div><div className="timeline-panel"><div className="timeline-scenes">{plan.scenes.map((scene, index) => <button
    key={scene.id}
    className={`scene-card ${scene.id === currentScene.id ? "is-active" : ""}`}
    onClick={() => {
      stopPlayback();
      setActiveSceneId(scene.id);
      setSelected(null);
    }}
    onDoubleClick={() => setRenamingScene(scene.id)}
  ><span className="scene-number">{index + 1}</span><span className="scene-thumbnail"><span className="mini-halfway" />{scene.objects.slice(0, 8).map((object) => <i
    key={object.id}
    style={{
      left: `${object.x / PITCH_WIDTH * 100}%`,
      top: `${object.y / PITCH_HEIGHT * 100}%`,
      background: object.kind === "ball" ? "#f4f7fb" : object.color
    }}
  />)}</span>{renamingScene === scene.id ? <input
    className="scene-rename"
    autoFocus
    defaultValue={scene.name}
    onFocus={(event) => event.currentTarget.select()}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if (event.key === "Enter") commitSceneName(scene.id, event.currentTarget.value);
      if (event.key === "Escape") setRenamingScene(null);
    }}
    onBlur={(event) => commitSceneName(scene.id, event.currentTarget.value)}
  /> : <span className="scene-name">{scene.name}</span>}{plan.scenes.length > 1 && <span
    className="scene-delete"
    role="button"
    aria-label={`Delete ${scene.name}`}
    onClick={(event) => {
      event.stopPropagation();
      deleteScene(scene.id);
    }}
  ><X /></span>}</button>)}<button className="add-scene" onClick={() => addScene(true)}><Plus />
                New scene
              </button><button className="add-scene add-blank" title="Copy this scene as the next step" onClick={() => addScene(false)}><Copy />
                Duplicate
              </button></div><div className="playback-controls"><button
    className={`play-button ${isPlaying ? "is-playing" : ""}`}
    onClick={() => void playSession()}
    aria-label={isPlaying ? "Stop animation" : "Play this scene"}
    title="Play this scene"
  >{isPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}</button><div className="playback-readout"><span>{isPlaying
    ? (activeStep ? `Playing step ${activeStep} of ${stepNumbers.length}` : "Playing")
    : "Preview animation"}</span><strong>{sceneTimeline?.tracks.length || 0} moving · {stepNumbers.length || 0} {stepNumbers.length === 1 ? "step" : "steps"}</strong></div><div className="playback-buttons"><button
    className="secondary-button"
    disabled={isPlaying || Boolean(recording)}
    title="Number the paths 1, 2, 3 in the order you drew them"
    onClick={numberSteps}
  ><ListNumbers /> Number steps</button>{stepNumbers.length > 1 && <button
    className="secondary-button"
    disabled={isPlaying || Boolean(recording)}
    title="Play everything at the same time again"
    onClick={mergeSteps}
  >All together</button>}<button
    className="secondary-button"
    disabled={plan.scenes.length < 2 || Boolean(recording)}
    title="Play every scene, tweening between them"
    onClick={() => void playWholeSession()}
  ><FilmStrip /> Play session</button><button
    className="secondary-button"
    disabled={Boolean(recording) || isPlaying}
    title="Save this drill as a video for the team chat"
    onClick={() => void exportVideo()}
  ><VideoCamera /> {recording ? `${Math.round(recording.progress * 100)}%` : "Video"}</button></div><select
    value={playbackSpeed}
    aria-label="Playback speed"
    onChange={(event) => setPlaybackSpeed(Number(event.target.value))}
  ><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x</option><option value="1.5">1.5x</option></select></div></div></section><aside className="inspector-panel"><div className="panel-heading inspector-heading"><div><span className="panel-kicker">Details</span><h2>{selectedObject ? "Object" : selectedDrawing ? "Drawing" : "Session"}</h2></div>{(selectedObject || selectedDrawing) && <button
    className="icon-button"
    onClick={() => setSelected(null)}
    aria-label="Close inspector"
  ><X /></button>}</div>{selectedObject ? <div className="inspector-form"><div className="selection-summary"><span className={`large-object-preview preview-${selectedObject.kind}`}><ObjectVisual artwork={plan.artwork} object={selectedObject} /></span><div><strong>{selectedObject.kind}</strong><span>Pitch object</span></div></div>{selectedObject.kind === "player" && <label className="input-field"><span>Player number <small>Used in numbered circles</small></span><input
    aria-label="Player number"
    inputMode="numeric"
    value={selectedObject.number ?? selectedObject.label ?? ""}
    onChange={(event) => updateObject(selectedObject.id, { number: event.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
  /></label>}<label className="input-field"><span>{selectedObject.kind === "player" ? "Player label" : "Label"} {selectedObject.kind === "player" && roster.length > 0 ? "(pick a squad name or type)" : ""}</span><input
    value={selectedObject.label}
    list={selectedObject.kind === "player" ? "jf-roster-names" : void 0}
    onChange={(event) => updateObject(selectedObject.id, { label: event.target.value })}
  /></label><label className="input-field"><span>Colour</span><div className="color-row">{["#45a8ff", "#ff6b67", "#f5cb5c", "#f4f7fb", "#17212d"].map(
    (color) => <button
      key={color}
      className={selectedObject.color === color ? "is-active" : ""}
      style={{ background: color }}
      aria-label={`Set colour ${color}`}
      onClick={() => updateObject(selectedObject.id, { color })}
    />
  )}</div></label><label className="range-field"><span><span>Size</span><strong>{selectedObject.size}px</strong></span><input
    type="range"
    min="20"
    max="96"
    value={selectedObject.size}
    aria-label="Object size"
    onChange={(event) => updateObject(selectedObject.id, { size: Number(event.target.value) })}
  /></label>{selectedObject.kind === "player" && <div className="player-control-presets" aria-label="Player size"><span>Quick size</span><div>{[[42, "Small"], [58, "Medium"], [76, "Large"]].map(([size, label]) => <button key={size} type="button" className={selectedObject.size === size ? "is-active" : ""} onClick={() => updateObject(selectedObject.id, { size })}>{label}</button>)}</div></div>}<label className="range-field"><span><span>Rotation</span><strong>{selectedObject.rotation}°</strong></span><input
    type="range"
    min="-180"
    max="180"
    value={selectedObject.rotation}
    aria-label="Object rotation"
    onChange={(event) => updateObject(selectedObject.id, {
      rotation: Number(event.target.value)
    })}
  /></label>{selectedObject.kind === "player" && <div className="player-control-presets" aria-label="Player rotation"><span>Quick rotation</span><div><button type="button" onClick={() => updateObject(selectedObject.id, { rotation: Math.max(-180, selectedObject.rotation - 45) })}>↶ 45°</button><button type="button" className={selectedObject.rotation === 0 ? "is-active" : ""} onClick={() => updateObject(selectedObject.id, { rotation: 0 })}>Forward</button><button type="button" onClick={() => updateObject(selectedObject.id, { rotation: Math.min(180, selectedObject.rotation + 45) })}>45° ↷</button></div></div>}{selectedObject.kind === "player" && <div className="kit-swatch-field"><span>Kit colour</span><div className="kit-swatches">{[
    ["#e8000d", "Red kit"], ["#45a8ff", "Blue kit"], ["#ffd23c", "Yellow bib"], ["#19b562", "Keeper green"], ["#f4f7fb", "White kit"], ["#20242b", "Dark kit"]
  ].map(([hex, title]) => <button
    key={hex}
    type="button"
    className={`kit-swatch ${selectedObject.color === hex ? "is-on" : ""}`}
    style={{ background: hex }}
    title={title}
    aria-label={title}
    onClick={() => updateObject(selectedObject.id, { color: hex })}
  />)}</div></div>}{(selectedObject.kind === "player" || selectedObject.kind === "coach") && <label className="toggle-field"><div><strong>Face the other way</strong><span>Flip this player left or right</span></div><input
    type="checkbox"
    checked={Boolean(selectedObject.flipped)}
    onChange={(event) => updateObject(selectedObject.id, { flipped: event.target.checked })}
  /></label>}<label className="toggle-field"><div><strong>Lock position</strong><span>Prevent accidental dragging</span></div><input
    type="checkbox"
    checked={selectedObject.locked}
    onChange={(event) => updateObject(selectedObject.id, { locked: event.target.checked })}
  /></label><div className="object-link-editor"><div className="panel-section-heading"><h3>Joner Football APP link</h3><span>Attach a drill or video to this object</span></div><input
    placeholder="Link label"
    value={selectedObject.linkLabel ?? ""}
    onChange={(event) => updateObject(selectedObject.id, { linkLabel: event.target.value })}
  /><input
    placeholder="https://teams.jonerfootball.com/..."
    value={selectedObject.linkUrl ?? ""}
    onChange={(event) => updateObject(selectedObject.id, { linkUrl: event.target.value })}
    onBlur={() => {
      if (!selectedObject.linkUrl) return;
      updateObject(selectedObject.id, { linkUrl: normalizeUrl(selectedObject.linkUrl) });
    }}
  />{selectedObject.linkUrl && <a
    className="secondary-button open-object-link"
    href={normalizeUrl(selectedObject.linkUrl)}
    target="_blank"
    rel="noopener noreferrer"
  ><LinkSimple /> Open linked drill
                  </a>}</div><div className="inspector-actions"><button className="secondary-button" onClick={duplicateSelection}><Copy /> Duplicate
                </button><button className="danger-button" onClick={deleteSelection}><Trash /> Delete
                </button></div></div> : selectedDrawing ? <div className="inspector-form"><div className="selection-summary drawing-summary">{selectedDrawing.kind === "movement" ? <Path /> : selectedDrawing.kind === "zone" ? <BoundingBox /> : <ArrowUpRight />}<div><strong>{selectedDrawing.kind}</strong><span>{selectedDrawing.kind === "movement" ? "Animated path" : "Pitch drawing"}</span></div></div><label className="input-field"><span>Colour</span><div className="color-row">{["#f4f7fb", "#f5cb5c", "#45a8ff", "#ff6b67"].map((color) => <button
    key={color}
    className={selectedDrawing.color === color ? "is-active" : ""}
    style={{ background: color }}
    aria-label={`Set colour ${color}`}
    onClick={() => updateDrawing(selectedDrawing.id, { color })}
  />)}</div></label><label className="range-field"><span><span>Line width</span><strong>{selectedDrawing.width}px</strong></span><input
    type="range"
    min="2"
    max="10"
    value={selectedDrawing.width}
    onChange={(event) => updateDrawing(selectedDrawing.id, { width: Number(event.target.value) })}
  /></label>{ANIMATED_KINDS.has(selectedDrawing.kind) && <><div className="step-field"><div><strong>Step {stepOf(selectedDrawing)}</strong><span>{stepNumbers.length > 1
    ? `Runs after step ${stepOf(selectedDrawing) - 1 || "none"}, with anything else on step ${stepOf(selectedDrawing)}`
    : "Everything plays together until you number the steps"}</span></div><div className="step-stepper"><button
    className="icon-button"
    aria-label="Earlier step"
    disabled={stepOf(selectedDrawing) <= 1}
    onClick={() => setDrawingStep(selectedDrawing.id, stepOf(selectedDrawing) - 1)}
  >−</button><span className="step-value">{stepOf(selectedDrawing)}</span><button
    className="icon-button"
    aria-label="Later step"
    onClick={() => setDrawingStep(selectedDrawing.id, stepOf(selectedDrawing) + 1)}
  >+</button></div></div><div className="waypoint-field"><div><strong>{(selectedDrawing.waypoints?.length || 0)} waypoint{(selectedDrawing.waypoints?.length || 0) === 1 ? "" : "s"}</strong><span>Double-click the line to bend it around a mannequin. Drag a dot to shape it, alt-click to remove.</span></div>{Boolean(selectedDrawing.waypoints?.length) && <button
    className="secondary-button"
    onClick={() => updateDrawing(selectedDrawing.id, { waypoints: undefined })}
  >Straighten</button>}</div><label className="range-field"><span><span>Curve</span><strong>{selectedDrawing.curve}</strong></span><input
    type="range"
    min="-160"
    max="160"
    value={selectedDrawing.curve}
    onChange={(event) => updateDrawing(selectedDrawing.id, { curve: Number(event.target.value) })}
  /></label><label className="range-field"><span><span>Duration</span><strong>{((selectedDrawing.duration ?? 1200) / 1e3).toFixed(1)}s</strong></span><input
    type="range"
    min="400"
    max="3000"
    step="100"
    value={selectedDrawing.duration ?? 1200}
    onChange={(event) => updateDrawing(selectedDrawing.id, { duration: Number(event.target.value) })}
  /></label></>}<div className="inspector-actions"><button className="secondary-button" onClick={duplicateSelection}><Copy /> Duplicate
                </button><button className="danger-button" onClick={deleteSelection}><Trash /> Delete
                </button></div></div> : <div className="inspector-form session-form"><label className="input-field"><span>Team</span><input
    value={plan.team}
    onChange={(event) => editPlan((value) => ({ ...value, team: event.target.value }))}
  /></label><label className="input-field"><span>Session focus</span><input
    value={plan.focus}
    onChange={(event) => editPlan((value) => ({ ...value, focus: event.target.value }))}
  /></label><div className="two-field-row"><label className="input-field"><span>Duration</span><div className="number-suffix"><input
    type="number"
    min="5"
    max="240"
    value={plan.duration}
    onChange={(event) => editPlan((value) => ({
      ...value,
      duration: Number(event.target.value)
    }))}
  /><span>min</span></div></label><label className="input-field"><span>Players</span><input
    type="number"
    min="1"
    max="40"
    value={plan.players}
    onChange={(event) => editPlan((value) => ({
      ...value,
      players: Number(event.target.value)
    }))}
  /></label></div><div className="plan-jump"><button className="plan-jump-button" onClick={() => setNotesOpen(true)}><NotePencil weight="bold" /><span><strong>Write the session plan</strong><small>Sequence, notes, coaching points and APP links</small></span></button><div className="plan-jump-stats"><span>{notesWritten} of {NOTE_FIELDS.length} boxes filled in</span><span>{plan.links.length} APP {plan.links.length === 1 ? "link" : "links"}</span></div>{plan.links.length > 0 && <div className="link-list">{plan.links.map((link) => <div className="link-chip" key={link.id}><a href={normalizeUrl(link.url)} target="_blank" rel="noopener noreferrer"><LinkSimple weight="bold" /><span>{link.label || link.url}</span></a></div>)}</div>}</div><div className="session-stats"><div><span>Scenes</span><strong>{plan.scenes.length}</strong></div><div><span>Objects</span><strong>{plan.scenes.reduce((sum, scene) => sum + scene.objects.length, 0)}</strong></div><div><span>Movements</span><strong>{plan.scenes.reduce((sum, scene) => sum + scene.drawings.filter((drawing) => drawing.kind === "movement").length, 0)}</strong></div></div><button className="danger-ghost" onClick={clearScene}><Trash /> Clear current scene
              </button></div>}</aside><aside className="pitch-rail" aria-label="Pitch styles and templates"><div className="rail-heading">Style</div><div className="preset-row">{STYLE_PRESETS.map((preset) => <button
    key={preset.id}
    className={`preset-swatch ${(plan.pitchStyle || "classic") === preset.id ? "is-active" : ""}`}
    title={preset.name}
    aria-label={`Pitch style ${preset.name}`}
    onClick={() => editPlan((value) => ({ ...value, pitchStyle: preset.id }))}
  ><span style={{ background: `linear-gradient(90deg, ${preset.grassA} 50%, ${preset.grassB} 50%)` }}><i style={{ background: preset.line }} /></span></button>)}</div><div className="rail-heading">Pitches</div><div className="rail-pitches">{PITCH_OPTIONS.map((option) => <button
    key={option.id}
    className={`pitch-option ${plan.pitch === option.id ? "is-active" : ""}`}
    title={option.name}
    onClick={() => editPlan((value) => ({ ...value, pitch: option.id }))}
  ><span className="pitch-option-art"><PitchSvg id={option.id} styleId={plan.pitchStyle || "classic"} /></span><span>{option.name}</span></button>)}</div></aside></section>{toast && <div className="toast" role="status"><Check weight="bold" />{toast}</div>}{confirmAsk && <div className="ask-overlay" role="dialog" aria-label="Please confirm"><div className="ask-box"><p>{confirmAsk.message}</p><div className="ask-actions"><button className="secondary-button" onClick={() => setConfirmAsk(null)}>Cancel</button><button
    className="primary-button"
    autoFocus
    onClick={() => {
      const run = confirmAsk.action;
      setConfirmAsk(null);
      void run();
    }}
  >{confirmAsk.confirmLabel}</button></div></div></div>}<LibraryOverlay
    open={plansOpen}
    onClose={() => setPlansOpen(false)}
    teamId={teamId}
    teamName={teamName}
    savedPlans={savedPlans}
    currentPlanId={planId}
    onOpenPlan={openCloudPlan}
    onDeletePlan={deleteCloudPlan}
    onNewSession={newSession}
    onSaveCopy={() => void saveToTeam(true)}
    cloudBusy={cloudBusy}
  /><PlanSheetEditor
    open={notesOpen}
    onClose={() => setNotesOpen(false)}
    plan={plan}
    scene={currentScene}
    sceneIndex={plan.scenes.findIndex((s) => s.id === currentScene.id)}
    steps={stepNumbers}
    noteFields={NOTE_FIELDS}
    noteHints={NOTE_HINTS}
    emptyNotes={EMPTY_NOTES}
    onEditPlan={editPlan}
    onEditScene={editScene}
    normalizeUrl={normalizeUrl}
    linkDraft={linkDraft}
    onLinkDraft={setLinkDraft}
    onAddLink={addLinkFromDraft}
    onRemoveLink={(id) => editPlan((value) => ({ ...value, links: value.links.filter((item) => item.id !== id) }))}
  /><datalist id="jf-roster-names">{roster.map((name) => <option key={name} value={name} />)}</datalist>{/* hidden live copy of the current scene, used by the PNG exporter */}<div ref={exportSvgRef} className="export-staging" aria-hidden><SceneSvg plan={plan} scene={currentScene} rot={viewRot} idPrefix="png" /></div>{/* full session sheet, visible only when printing - styled on Lee's CP drill
    pack: black header band, framed diagrams with captions, bulleted note
    columns, and a CLICKABLE video link that survives Save-as-PDF */}<div className="print-sheet"><header className="print-band"><span className="print-band-tag">JF</span><div className="print-band-title"><h1>{plan.title || "Session plan"}</h1><span>Joner Football · Session Plan</span></div><div className="print-band-facts">{[
    teamName && ["Team", teamName],
    plan.focus && ["Focus", plan.focus],
    plan.duration && ["Duration", `${plan.duration} min`],
    plan.players && ["Players", String(plan.players)]
  ].filter(Boolean).map(([k, v]) => <div key={k}><small>{k}</small><strong>{v}</strong></div>)}</div></header>{plan.videoUrl && <a className="print-video" href={normalizeUrl(plan.videoUrl)}>▶ WATCH THE DRILL VIDEO: {normalizeUrl(plan.videoUrl)}</a>}<div className="print-columns"><div className="print-scenes">{plan.scenes.map((scene, index) => {
    // The numbered script for this frame: the steps a coach actually calls
    // out, in the order they happen.
    const script = Object.entries(scene.stepNotes || {})
      .map(([step, text]) => [Number(step), String(text).trim()])
      .filter(([step, text]) => Number.isFinite(step) && text)
      .sort((a, b) => a[0] - b[0]);
    return <div className="print-scene" key={scene.id}><h2><i>{String(index + 1).padStart(2, "0")}</i> {scene.name}</h2><div className="print-board"><SceneSvg plan={plan} scene={scene} idPrefix={`pr-${index}`} /></div>{script.length > 0 && <ol className="print-script">{script.map(([step, text]) => <li key={step}><b>{step}</b><span>{text}</span></li>)}</ol>}</div>;
  })}</div><div className="print-notes">{NOTE_FIELDS.filter(([key]) => plan.notesSections?.[key] && key !== "note" && key !== "develops").map(([key, label]) => <div className="print-note" key={key}><h3>{label}</h3><ul>{plan.notesSections[key].split("\n").map((line) => line.replace(/^[•\-\s]+/, "").trim()).filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}</ul></div>)}{plan.notesSections?.develops && <div className="print-develops"><b>THIS DRILL DEVELOPS:</b> {plan.notesSections.develops}</div>}{plan.links.length > 0 && <div className="print-note"><h3>Joner Football APP links</h3><ul>{plan.links.map((link) => <li key={link.id}><a href={normalizeUrl(link.url)}>{link.label ? `${link.label}: ` : ""}{link.url}</a></li>)}</ul></div>}</div></div>{plan.notesSections?.note && <div className="print-joner-note"><b>COACH'S NOTE</b><p>"{plan.notesSections.note}"</p></div>}<p className="print-footer"><span>Built with the Joner Football session planner</span><span>jonerfootball.com</span></p></div></main></div>;
}
var App_default = SessionPlanner;
export {
  App_default as default
};
