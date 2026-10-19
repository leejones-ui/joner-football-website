"use client";
import { inlineSvgImages } from "./inline-svg-images.js";
// Records a drill to a video file the coach can drop straight into team chat.
//
// The frames are drawn on a canvas from sprites lifted out of the live DOM:
// the pitch, the drawn arrows and each figure are serialised exactly as they
// appear on screen, then repositioned frame by frame using the shared timeline.
// Nothing here re-implements the artwork or the motion, so an exported video
// cannot drift from what the coach just watched.

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
]

export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null
  for (const type of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type
    } catch {
      /* older browsers throw on odd strings */
    }
  }
  return null
}

export function videoSupported() {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined"
    && typeof HTMLCanvasElement.prototype.captureStream === "function" && Boolean(pickMimeType())
}

async function svgToImage(node, width, height) {
  const clone = node.cloneNode(true)
  clone.setAttribute("width", String(Math.max(1, Math.round(width))))
  clone.setAttribute("height", String(Math.max(1, Math.round(height))))
  clone.removeAttribute("class")
  await inlineSvgImages(clone)
  const markup = new XMLSerializer().serializeToString(clone)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

// Everything needed to paint a frame, captured once up front.
async function collectSprites(surface, scale) {
  const rect = surface.getBoundingClientRect()
  const pitchNode = surface.querySelector("svg.pitch-art")
  const drawingNode = surface.querySelector("svg.drawing-layer")
  const [pitch, drawings] = await Promise.all([
    pitchNode ? svgToImage(pitchNode, rect.width * scale, rect.height * scale) : null,
    drawingNode ? svgToImage(drawingNode, rect.width * scale, rect.height * scale) : null,
  ])

  const objects = []
  for (const element of surface.querySelectorAll("[data-object-id]")) {
    const id = element.getAttribute("data-object-id")
    const box = element.getBoundingClientRect()
    const rotationHost = element.querySelector(".object-rotation")
    const rotation = (() => {
      const transform = rotationHost?.style?.transform || ""
      const match = /rotate\((-?[\d.]+)deg\)/.exec(transform)
      return match ? Number(match[1]) : 0
    })()
    const badge = element.querySelector(".figure-badge")?.textContent || ""
    const disc = element.querySelector(".marker-disc")
    const art = element.querySelector("svg")
    const width = box.width || 40
    const height = box.height || 40
    if (disc) {
      objects.push({ id, disc: disc.textContent?.trim() || "", colour: getComputedStyle(disc).backgroundColor || "#e8000d", width, height, rotation })
    } else if (art) {
      const image = await svgToImage(art, width * scale, height * scale)
      objects.push({ id, image, width, height, rotation, badge, flipped: element.querySelector(".is-flipped") != null })
    } else {
      // Text markers are plain DOM; redraw them rather than rasterise HTML.
      const text = element.textContent?.trim() || ""
      const colour = getComputedStyle(element.querySelector(".marker") || element).color || "#f4f7fb"
      objects.push({ id, text, colour, width, height, rotation, badge: "" })
    }
  }
  return { pitch, drawings, objects, rect }
}

function drawBadge(context, text, x, y, scale) {
  if (!text) return
  const paddingX = 5 * scale
  context.font = `800 ${10 * scale}px Inter, Arial, sans-serif`
  const width = Math.max(18 * scale, context.measureText(text).width + paddingX * 2)
  const height = 15 * scale
  const left = x - width / 2
  const top = y
  const radius = height / 2
  context.beginPath()
  context.moveTo(left + radius, top)
  context.arcTo(left + width, top, left + width, top + height, radius)
  context.arcTo(left + width, top + height, left, top + height, radius)
  context.arcTo(left, top + height, left, top, radius)
  context.arcTo(left, top, left + width, top, radius)
  context.closePath()
  context.fillStyle = "rgba(9, 14, 20, 0.86)"
  context.fill()
  context.strokeStyle = "rgba(255,255,255,0.35)"
  context.lineWidth = Math.max(1, scale * 0.8)
  context.stroke()
  context.fillStyle = "#f4f7fb"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(text, x, top + height / 2)
}

function drawTextMarker(context, sprite, x, y, scale) {
  const paddingX = 10 * scale
  context.font = `700 ${12 * scale}px Inter, Arial, sans-serif`
  const width = context.measureText(sprite.text).width + paddingX * 2
  const height = 30 * scale
  context.fillStyle = "rgba(8, 18, 14, 0.78)"
  context.strokeStyle = "rgba(255,255,255,0.22)"
  context.lineWidth = Math.max(1, scale * 0.8)
  context.beginPath()
  context.roundRect(x - width / 2, y - height / 2, width, height, 7 * scale)
  context.fill()
  context.stroke()
  context.fillStyle = sprite.colour
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(sprite.text, x, y)
}

function drawDiscMarker(context, sprite, scale) {
  const radius = Math.min(sprite.width, sprite.height) * scale * 0.3
  const rgb = sprite.colour.match(/\d+/g)?.map(Number) || []
  const light = rgb.length >= 3 && (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 150
  context.beginPath()
  context.arc(0, 0, radius, 0, Math.PI * 2)
  context.fillStyle = sprite.colour
  context.fill()
  context.strokeStyle = "rgba(255,255,255,0.85)"
  context.lineWidth = Math.max(1, 2 * scale)
  context.stroke()
  context.fillStyle = light ? "#10151c" : "#ffffff"
  context.font = `800 ${radius * 1.05}px Inter, Arial, sans-serif`
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(sprite.disc, 0, radius * 0.08)
}

// Draw one frame. Exported so the exact frame content can be tested without a
// browser: what this paints is what ends up in the video.
export function paintFrame({ context, canvas, sprites, scale, positions, basePositions }) {
  context.fillStyle = "#0b1016"
  context.fillRect(0, 0, canvas.width, canvas.height)
  if (sprites.pitch) context.drawImage(sprites.pitch, 0, 0, canvas.width, canvas.height)
  if (sprites.drawings) context.drawImage(sprites.drawings, 0, 0, canvas.width, canvas.height)
  for (const sprite of sprites.objects) {
    const point = positions.get(sprite.id) || basePositions.get(sprite.id)
    if (!point) continue
    const x = point.x * scale
    const y = point.y * scale
    context.save()
    context.translate(x, y)
    if (sprite.rotation) context.rotate((sprite.rotation * Math.PI) / 180)
    if (sprite.disc != null) {
      drawDiscMarker(context, sprite, scale)
    } else if (sprite.text != null) {
      drawTextMarker(context, sprite, 0, 0, scale)
    } else if (sprite.image) {
      const width = sprite.width * scale
      const height = sprite.height * scale
      context.drawImage(sprite.image, -width / 2, -height / 2, width, height)
    }
    context.restore()
    if (sprite.badge) drawBadge(context, sprite.badge, x, y + (sprite.height * scale) / 2 - 4 * scale, scale)
  }
}

/**
 * Record a drill.
 *
 * @param surface   the .pitch-surface element currently on screen
 * @param duration  total length in ms
 * @param positionsAt (ms) => Map(objectId -> {x, y}) in SURFACE PIXELS
 * @param basePositions Map(objectId -> {x, y}) for anything that never moves
 */
export async function recordDrill({
  surface,
  duration,
  positionsAt,
  basePositions,
  fps = 30,
  maxWidth = 1280,
  tailMs = 700,
  onProgress,
}) {
  const mimeType = pickMimeType()
  if (!mimeType) throw new Error("This browser cannot record video")
  const rect = surface.getBoundingClientRect()
  const scale = Math.min(2.5, Math.max(1, maxWidth / Math.max(1, rect.width)))
  const sprites = await collectSprites(surface, scale)

  const canvas = document.createElement("canvas")
  // Even dimensions keep H.264 encoders happy.
  canvas.width = Math.round((rect.width * scale) / 2) * 2
  canvas.height = Math.round((rect.height * scale) / 2) * 2
  const context = canvas.getContext("2d")

  const paint = (ms) =>
    paintFrame({ context, canvas, sprites, scale, positions: positionsAt(ms), basePositions })

  const stream = canvas.captureStream(fps)
  const chunks = []
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data)
  }
  const finished = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
  })

  paint(0)
  recorder.start()
  const total = duration + tailMs
  // MediaRecorder timestamps frames off the wall clock, so the loop is paced in
  // real time. A hidden tab stops firing rAF, so a timer runs alongside it:
  // between them the recording always finishes rather than hanging forever.
  await new Promise((resolve) => {
    const started = performance.now()
    let finished = false
    let pending = 0 // whichever of rAF / timer fires first drives the frame
    const schedule = () => {
      const token = ++pending
      const run = () => {
        if (finished || token !== pending) return
        frame()
      }
      requestAnimationFrame(run)
      setTimeout(run, 1000 / fps)
    }
    const frame = () => {
      const elapsed = performance.now() - started
      paint(Math.min(elapsed, duration))
      onProgress?.(Math.min(1, elapsed / total))
      if (elapsed >= total) {
        finished = true
        resolve()
        return
      }
      schedule()
    }
    frame()
  })
  recorder.stop()
  stream.getTracks().forEach((track) => track.stop())
  const blob = await finished
  return { blob, extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm" }
}
