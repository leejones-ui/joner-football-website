// The planner's motion model, kept pure and free of React or the DOM.
//
// Three consumers share it, which is the point: on-screen playback, the video
// recorder and the tests all ask this module where things are at time t. If a
// drill plays one way on screen and another in the exported video, that is a
// bug in one consumer, not two rival implementations of the same maths.
//
// Geometry:  a path is a start point, optional waypoints, and an end point.
//            Two points bend by `curve`; three or more follow a smooth spline.
// Sequencing: every animated path carries a `step` (default 1). Paths in the
//            same step run together; step 2 starts when step 1 has finished.

export const DEFAULT_STEP = 1;
export const DEFAULT_DURATION = 1200;
export const SCENE_TWEEN_MS = 900;
export const STEP_GAP_MS = 180; // a beat between steps so a drill reads as steps

// ---------- geometry ----------

export function pathPoints(drawing) {
  const points = [{ x: drawing.x1, y: drawing.y1 }];
  if (Array.isArray(drawing.waypoints)) {
    for (const point of drawing.waypoints) {
      if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) points.push({ x: point.x, y: point.y });
    }
  }
  points.push({ x: drawing.x2, y: drawing.y2 });
  return points;
}

function quadraticAt(t, a, control, b) {
  const inv = 1 - t;
  return {
    x: inv * inv * a.x + 2 * inv * t * control.x + t * t * b.x,
    y: inv * inv * a.y + 2 * inv * t * control.y + t * t * b.y,
  };
}

// The control point for a two-point path: perpendicular offset by `curve`, so
// a straight drag stays straight and the slider bows it either way.
export function curveControl(drawing) {
  const a = { x: drawing.x1, y: drawing.y1 };
  const b = { x: drawing.x2, y: drawing.y2 };
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const curve = Number(drawing.curve) || 0;
  return { x: mx - (dy / length) * curve, y: my + (dx / length) * curve };
}

// Catmull-Rom through the waypoints, converted to cubic beziers. `curve` acts
// as tension here, so the slider still does something useful on a bent run.
function splineSegments(points, curve = 0) {
  const tension = 1 + Math.max(-0.9, Math.min(2, (Number(curve) || 0) / 160));
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || points[i + 1];
    segments.push({
      p1,
      c1: { x: p1.x + ((p2.x - p0.x) / 6) * tension, y: p1.y + ((p2.y - p0.y) / 6) * tension },
      c2: { x: p2.x - ((p3.x - p1.x) / 6) * tension, y: p2.y - ((p3.y - p1.y) / 6) * tension },
      p2,
    });
  }
  return segments;
}

function cubicAt(t, s) {
  const inv = 1 - t;
  const a = inv * inv * inv;
  const b = 3 * inv * inv * t;
  const c = 3 * inv * t * t;
  const d = t * t * t;
  return {
    x: a * s.p1.x + b * s.c1.x + c * s.c2.x + d * s.p2.x,
    y: a * s.p1.y + b * s.c1.y + c * s.c2.y + d * s.p2.y,
  };
}

// Raw points along the whole path, before speed correction.
function rawSamples(drawing, per = 24) {
  const points = pathPoints(drawing);
  if (points.length === 2) {
    const control = curveControl(drawing);
    return Array.from({ length: per + 1 }, (_, i) => quadraticAt(i / per, points[0], control, points[1]));
  }
  const segments = splineSegments(points, drawing.curve);
  const out = [];
  segments.forEach((segment, index) => {
    const start = index === 0 ? 0 : 1;
    for (let i = start; i <= per; i++) out.push(cubicAt(i / per, segment));
  });
  return out;
}

// Evenly spaced by DISTANCE, not by parameter, so a figure travels at a
// constant speed instead of racing through the straight bits of a curve.
export function samplePath(drawing, count = 24) {
  const raw = rawSamples(drawing);
  const lengths = [0];
  for (let i = 1; i < raw.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
  }
  const total = lengths[lengths.length - 1];
  if (!total) return Array.from({ length: count + 1 }, () => ({ ...raw[0] }));
  const out = [];
  let cursor = 0;
  for (let i = 0; i <= count; i++) {
    const target = (total * i) / count;
    while (cursor < lengths.length - 2 && lengths[cursor + 1] < target) cursor += 1;
    const span = lengths[cursor + 1] - lengths[cursor] || 1;
    const t = Math.max(0, Math.min(1, (target - lengths[cursor]) / span));
    out.push({
      x: raw[cursor].x + (raw[cursor + 1].x - raw[cursor].x) * t,
      y: raw[cursor].y + (raw[cursor + 1].y - raw[cursor].y) * t,
    });
  }
  return out;
}

export function pointOnPath(drawing, t) {
  const clamped = Math.max(0, Math.min(1, t));
  const samples = samplePath(drawing, 48);
  const position = clamped * (samples.length - 1);
  const index = Math.floor(position);
  const rest = position - index;
  const a = samples[index];
  const b = samples[Math.min(samples.length - 1, index + 1)];
  return { x: a.x + (b.x - a.x) * rest, y: a.y + (b.y - a.y) * rest };
}

// SVG path string. Straight and two-point curves keep the exact quadratic the
// planner has always drawn; waypointed paths use the spline.
export function pathD(drawing) {
  const points = pathPoints(drawing);
  if (points.length === 2) {
    const control = curveControl(drawing);
    return `M ${drawing.x1} ${drawing.y1} Q ${control.x} ${control.y} ${drawing.x2} ${drawing.y2}`;
  }
  const segments = splineSegments(points, drawing.curve);
  let d = `M ${points[0].x} ${points[0].y}`;
  for (const s of segments) d += ` C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.p2.x} ${s.p2.y}`;
  return d;
}

// A dribble is drawn as a squiggle along its own path.
export function wavyPathD(drawing, amplitude = 9, waves = 12) {
  const base = samplePath(drawing, 42);
  return base
    .map((point, index) => {
      const previous = base[Math.max(0, index - 1)];
      const next = base[Math.min(base.length - 1, index + 1)];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const length = Math.max(Math.hypot(dx, dy), 1);
      const wave = Math.sin((index / (base.length - 1)) * Math.PI * waves) * amplitude;
      return `${index === 0 ? "M" : "L"} ${point.x - (dy / length) * wave} ${point.y + (dx / length) * wave}`;
    })
    .join(" ");
}

// ---------- sequencing ----------

export function stepOf(drawing) {
  const step = Math.round(Number(drawing?.step));
  return Number.isFinite(step) && step > 0 ? step : DEFAULT_STEP;
}

export function durationOf(drawing) {
  const ms = Number(drawing?.duration);
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_DURATION;
}

const DRIBBLE_BALL_OFFSET = { x: 14, y: 10 };

// Build the ordered plan of what moves when for one scene.
// `resolve(drawing, objects)` maps a path to { targetId, companionId }.
export function buildSceneTimeline(scene, resolve, { startAt = 0 } = {}) {
  const objects = scene?.objects || [];
  const moves = [];
  for (const drawing of scene?.drawings || []) {
    const animation = resolve?.(drawing, objects);
    if (!animation?.targetId) continue;
    moves.push({ drawing, step: stepOf(drawing), duration: durationOf(drawing), ...animation });
  }
  const steps = [...new Set(moves.map((move) => move.step))].sort((a, b) => a - b);
  const tracks = [];
  let cursor = startAt;
  const stepRanges = [];
  for (const step of steps) {
    const inStep = moves.filter((move) => move.step === step);
    const longest = Math.max(...inStep.map((move) => move.duration));
    for (const move of inStep) {
      tracks.push({
        objectId: move.targetId,
        drawing: move.drawing,
        startMs: cursor,
        endMs: cursor + move.duration,
        step,
      });
      if (move.companionId) {
        tracks.push({
          objectId: move.companionId,
          drawing: move.drawing,
          offset: DRIBBLE_BALL_OFFSET,
          startMs: cursor,
          endMs: cursor + move.duration,
          step,
        });
      }
    }
    stepRanges.push({ step, startMs: cursor, endMs: cursor + longest });
    cursor += longest + STEP_GAP_MS;
  }
  const endMs = stepRanges.length ? stepRanges[stepRanges.length - 1].endMs : startAt;
  return { tracks, steps: stepRanges, startAt, endMs, duration: endMs - startAt };
}

// Where every moved object sits at time `ms`. Objects with no track keep their
// scene position, so the caller only has to apply what comes back.
export function sampleAt(timeline, ms) {
  const positions = new Map();
  for (const track of timeline.tracks) {
    if (ms < track.startMs) continue;
    const t = ms >= track.endMs ? 1 : (ms - track.startMs) / Math.max(1, track.endMs - track.startMs);
    const point = pointOnPath(track.drawing, t);
    positions.set(track.objectId, {
      x: point.x + (track.offset?.x || 0),
      y: point.y + (track.offset?.y || 0),
      startedAt: track.startMs,
    });
  }
  return positions;
}

export function activeStepAt(timeline, ms) {
  let current = null;
  for (const range of timeline.steps) {
    if (ms >= range.startMs) current = range.step;
  }
  return current;
}

// ---------- whole session ----------

// Scenes played back to back: each scene's steps, then a tween that carries
// shared objects into their next-scene positions. Two frames become a drill.
export function buildSessionTimeline(plan, resolve, { tweenMs = SCENE_TWEEN_MS } = {}) {
  const segments = [];
  let cursor = 0;
  const scenes = plan?.scenes || [];
  scenes.forEach((scene, index) => {
    const timeline = buildSceneTimeline(scene, resolve, { startAt: cursor });
    segments.push({ kind: "scene", sceneId: scene.id, sceneIndex: index, timeline, startMs: cursor, endMs: timeline.endMs });
    cursor = timeline.endMs;
    const next = scenes[index + 1];
    if (!next) return;
    // Only objects present in both frames can travel between them.
    const endOf = sampleAt(timeline, timeline.endMs);
    const from = new Map();
    for (const object of scene.objects || []) {
      const moved = endOf.get(object.id);
      from.set(object.id, moved ? { x: moved.x, y: moved.y } : { x: object.x, y: object.y });
    }
    const moves = [];
    for (const object of next.objects || []) {
      const start = from.get(object.id);
      if (!start) continue;
      if (Math.hypot(object.x - start.x, object.y - start.y) < 0.5) continue;
      moves.push({ objectId: object.id, from: start, to: { x: object.x, y: object.y } });
    }
    segments.push({
      kind: "tween",
      fromSceneId: scene.id,
      toSceneId: next.id,
      sceneIndex: index,
      moves,
      startMs: cursor,
      endMs: cursor + tweenMs,
    });
    cursor += tweenMs;
  });
  return { segments, duration: cursor };
}

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// What the board looks like at `ms` of a whole-session playback.
export function sampleSessionAt(session, ms) {
  let active = session.segments[0];
  for (const segment of session.segments) {
    if (ms >= segment.startMs) active = segment;
  }
  if (!active) return { sceneId: null, positions: new Map() };
  if (active.kind === "scene") {
    return { sceneId: active.sceneId, sceneIndex: active.sceneIndex, positions: sampleAt(active.timeline, ms) };
  }
  const t = easeInOut(Math.max(0, Math.min(1, (ms - active.startMs) / Math.max(1, active.endMs - active.startMs))));
  const positions = new Map();
  for (const move of active.moves) {
    positions.set(move.objectId, {
      x: move.from.x + (move.to.x - move.from.x) * t,
      y: move.from.y + (move.to.y - move.from.y) * t,
    });
  }
  return { sceneId: active.fromSceneId, sceneIndex: active.sceneIndex, positions, tweening: true };
}
