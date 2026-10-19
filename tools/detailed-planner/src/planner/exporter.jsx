"use client";
import { inlineSvgImages } from "./inline-svg-images.js";
// Pure-SVG scene composer. One source of truth for how a scene rasterizes,
// used by the on-screen PNG export, the print sheet and future share cards.
// Everything here draws original Joner artwork from figures.jsx / pitches.jsx.
import { PITCH_OPTIONS, PitchSvg, PW, PH, styleVars } from "./pitches"
import { EquipmentArt, PlayerFigure } from "./figures"
import { pathD, samplePath, wavyPathD, stepOf } from "./timeline"

// Geometry lives in timeline.js so the still export, the animation and the
// video all draw the identical curve. These re-exports keep older callers
// working without a second implementation of the same maths.
export const drawingPath = pathD
export const sampleDrawing = samplePath

export function renderedDrawingPath(drawing) {
  return drawing.kind === "dribble" ? wavyPathD(drawing) : pathD(drawing)
}

const ARROW_FILL = {
  movement: "#ff3d42",
  pass: "#11151a",
  dribble: "#f4f7fb",
  shoot: "#ffe329",
}

function ExportDrawing({ drawing, markerPrefix }) {
  if (drawing.kind === "zone") {
    const x = Math.min(drawing.x1, drawing.x2)
    const y = Math.min(drawing.y1, drawing.y2)
    const width = Math.abs(drawing.x2 - drawing.x1)
    const height = Math.abs(drawing.y2 - drawing.y1)
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} rx="12" fill={`${drawing.color}22`} stroke={drawing.color} strokeWidth={drawing.width} strokeDasharray="14 9" />
      </g>
    )
  }
  const path = renderedDrawingPath(drawing)
  const marker = ARROW_FILL[drawing.kind] ? `url(#${markerPrefix}-${drawing.kind})` : undefined
  // A printed sheet is read on the touchline, so the step order has to survive
  // the export, not just the screen.
  const step = ARROW_FILL[drawing.kind] ? stepOf(drawing) : null
  const showStep = step != null && (drawing.step || 0) > 0
  return (
    <g>
      <path d={path} fill="none" stroke="rgba(6, 16, 12, .28)" strokeWidth={drawing.width + 5} strokeLinecap="round" />
      <path
        d={path}
        fill="none"
        stroke={drawing.color}
        strokeWidth={drawing.width}
        strokeDasharray={drawing.kind === "pass" || drawing.kind === "shoot" ? "16 10" : undefined}
        strokeLinecap="round"
        markerEnd={marker}
      />
      {showStep && (
        <g>
          <circle cx={drawing.x1} cy={drawing.y1} r={11} fill="rgba(9, 14, 20, 0.88)" stroke={drawing.color} strokeWidth={2} />
          <text x={drawing.x1} y={drawing.y1 + 4.5} textAnchor="middle" fontSize={12} fontWeight={800} fill="#ffffff" fontFamily="Arial, sans-serif">
            {step}
          </text>
        </g>
      )}
    </g>
  )
}

function ExportObject({ object, disc = false, artwork = "classic" }) {
  const size = object.size || 40
  const x = object.x
  const y = object.y
  const isFigure = object.kind === "player" || object.kind === "coach"
  // Classic is always a tactics-board. In Realistic, the scene choice turns
  // players (but not officials) into numbered circles.
  const useCircle = isFigure && (artwork === "classic" || (disc && object.kind === "player"))
  if (useCircle) {
    const r = size * 0.3
    const value = object.kind === "coach" ? "C" : (object.number ?? object.label ?? "")
    return (
      <g transform={`rotate(${object.rotation || 0} ${x} ${y})`}>
        <circle cx={x} cy={y} r={r} fill={object.color || "#e8000d"} stroke="rgba(255,255,255,0.85)" strokeWidth={2} />
        <text x={x} y={y + r * 0.38} textAnchor="middle" fontSize={r * 1.05} fontWeight={800}
          fill={object.color === "#f4f7fb" || object.color === "#ffd23c" ? "#10151c" : "#ffffff"}
          fontFamily="Arial, sans-serif">{value}</text>
      </g>
    )
  }
  if (object.kind === "text") {
    const width = Math.max(84, (object.label?.length || 6) * 9 + 26)
    return (
      <g>
        <rect x={x - width / 2} y={y - 15} width={width} height={30} rx={7} fill="rgba(8, 18, 14, 0.76)" stroke="rgba(255,255,255,0.22)" />
        <text x={x} y={y + 4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill={object.color || "#f4f7fb"} fontFamily="Arial, sans-serif">
          {object.label}
        </text>
      </g>
    )
  }
  // Player artwork is 64x88; equipment tiles are roughly square.
  const w = isFigure ? size * 0.73 : size
  const h = isFigure ? size : size
  const flip = object.flipped ? -1 : 1
  return (
    <g transform={`rotate(${object.rotation || 0} ${x} ${y})`}>
      <g transform={`translate(${x} ${y}) scale(${flip} 1)`}>
        <svg x={-w / 2} y={-h / 2} width={w} height={h}>
          {isFigure ? (
            <PlayerFigure artwork={artwork} pose={object.pose ?? "stand"} color={object.color} official={object.kind === "coach"} />
          ) : (
            <EquipmentArt artwork={artwork} kind={object.kind} color={object.color} />
          )}
        </svg>
      </g>
      {object.label && isFigure && (
        <g>
          <rect x={x - 11} y={y + h / 2 - 4} width={22} height={15} rx={7} fill="rgba(9, 14, 20, 0.82)" stroke="rgba(255,255,255,0.35)" strokeWidth={0.8} />
          <text x={x} y={y + h / 2 + 7.5} textAnchor="middle" fontSize={10} fontWeight={800} fill="#f4f7fb" fontFamily="Arial, sans-serif">
            {object.label}
          </text>
        </g>
      )}
    </g>
  )
}

// A complete scene as one standalone SVG. rot matches the on-screen view
// rotation so what the coach sees is what exports.
export function SceneSvg({ plan, scene, rot = 0, idPrefix = "exp" }) {
  const portraitView = rot % 180 !== 0
  const viewW = portraitView ? PH : PW
  const viewH = portraitView ? PW : PH
  const rotTransform =
    rot === 90
      ? `translate(${PH} 0) rotate(90)`
      : rot === 180
        ? `translate(${PW} ${PH}) rotate(180)`
        : rot === 270
          ? `translate(0 ${PW}) rotate(-90)`
          : undefined
  const toDisp = (x, y) => {
    if (rot === 90) return { x: PH - y, y: x }
    if (rot === 180) return { x: PW - x, y: PH - y }
    if (rot === 270) return { x: y, y: PW - x }
    return { x, y }
  }
  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      width={viewW}
      height={viewH}
      xmlns="http://www.w3.org/2000/svg"
      className="scene-export-svg"
      style={styleVars(plan.pitchStyle || "classic")}
    >
      <defs>
        {Object.entries(ARROW_FILL).map(([kind, fill]) => (
          <marker key={kind} id={`${idPrefix}-${kind}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={fill} />
          </marker>
        ))}
      </defs>
      <svg x={0} y={0} width={viewW} height={viewH} viewBox={`0 0 ${viewW} ${viewH}`}>
        <PitchSvg id={plan.pitch} rot={rot} styleId={plan.pitchStyle || "classic"} />
      </svg>
      <g transform={rotTransform}>
        {scene.drawings.map((drawing) => (
          <ExportDrawing key={drawing.id} drawing={drawing} markerPrefix={idPrefix} />
        ))}
      </g>
      {/* objects stay upright (billboard style) so figures read correctly */}
      {scene.objects.map((object) => {
        const p = toDisp(object.x, object.y)
        return <ExportObject artwork={plan.artwork} key={object.id} object={{ ...object, x: p.x, y: p.y }} disc={Boolean(scene.disc)} />
      })}
    </svg>
  )
}

export function pitchName(id) {
  return PITCH_OPTIONS.find((option) => option.id === id)?.name || "Pitch"
}

// Rasterize an <svg> DOM node to a PNG blob at scale x resolution.
export async function svgNodeToPngBlob(svgNode, scale = 2) {
  const viewBox = svgNode.getAttribute("viewBox").split(" ")
  const width = Number(viewBox[2])
  const height = Number(viewBox[3])
  const clone = svgNode.cloneNode(true)
  clone.setAttribute("width", String(width))
  clone.setAttribute("height", String(height))
  await inlineSvgImages(clone)
  const markup = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }))
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error("Could not rasterize the scene"))
      image.src = url
    })
    const canvas = document.createElement("canvas")
    canvas.width = width * scale
    canvas.height = height * scale
    const context = canvas.getContext("2d")
    context.fillStyle = "#0b1016"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))), "image/png"),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
