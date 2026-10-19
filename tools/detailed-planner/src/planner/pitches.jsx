const PW = 1e3;
const PH = 640;
const PITCH_OPTIONS = [
  { id: "perspective-full", name: "Perspective full pitch" },
  { id: "perspective-half", name: "Perspective half pitch" },
  { id: "full", name: "Full pitch" },
  { id: "full-thirds", name: "Full pitch, thirds" },
  { id: "full-grid", name: "Full pitch, grid" },
  { id: "portrait", name: "Full pitch, portrait" },
  { id: "half", name: "Half pitch" },
  { id: "portrait-half", name: "Half pitch, portrait" },
  { id: "final-third", name: "Final third" },
  { id: "box-only", name: "Penalty box" },
  { id: "double-box", name: "Small sided, two goals" },
  { id: "channels", name: "Thirds and channels" },
  { id: "grids", name: "Training grids" },
  { id: "futsal", name: "Futsal court" },
  { id: "circle-zone", name: "Circle practice area" },
  { id: "triangle-zone", name: "Triangle practice area" },
  { id: "square-zone", name: "Square practice area" },
  { id: "blank", name: "Blank grass" }
];
const LINE = "var(--jfp-line, rgba(244, 250, 255, 0.92))";
const LW = 3;
const GRASS_A = "var(--jfp-grass-a, #2f8038)";
const GRASS_B = "var(--jfp-grass-b, #2a7532)";
const stroke = { fill: "none", stroke: LINE, strokeWidth: LW };
const dashed = {
  fill: "none",
  stroke: LINE,
  strokeWidth: 2.4,
  strokeDasharray: "12 12",
  opacity: 0.85
};
function Stripes({ vertical = true, n = 14 }) {
  return <g>{Array.from(
    { length: n },
    (_, i) => vertical ? <rect
      key={i}
      x={PW / n * i}
      y={0}
      width={PW / n}
      height={PH}
      fill={i % 2 ? GRASS_B : GRASS_A}
    /> : <rect
      key={i}
      x={0}
      y={PH / n * i}
      width={PW}
      height={PH / n}
      fill={i % 2 ? GRASS_B : GRASS_A}
    />
  )}</g>;
}
function FullMarkings({ x, y, w, h }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const boxW = w * 0.16;
  const boxH = h * 0.6;
  const sixW = w * 0.062;
  const sixH = h * 0.3;
  const goalH = h * 0.115;
  const r = h * 0.145;
  return <g><rect x={x} y={y} width={w} height={h} {...stroke} /><line x1={cx} y1={y} x2={cx} y2={y + h} {...stroke} /><circle cx={cx} cy={cy} r={r} {...stroke} /><circle cx={cx} cy={cy} r={3.4} fill={LINE} /><rect x={x} y={cy - boxH / 2} width={boxW} height={boxH} {...stroke} /><rect x={x} y={cy - sixH / 2} width={sixW} height={sixH} {...stroke} /><circle cx={x + w * 0.108} cy={cy} r={3.4} fill={LINE} /><path
    d={`M ${x + boxW} ${cy - r * 0.6} A ${r * 0.74} ${r * 0.74} 0 0 1 ${x + boxW} ${cy + r * 0.6}`}
    {...stroke}
  /><rect x={x + w - boxW} y={cy - boxH / 2} width={boxW} height={boxH} {...stroke} /><rect x={x + w - sixW} y={cy - sixH / 2} width={sixW} height={sixH} {...stroke} /><circle cx={x + w - w * 0.108} cy={cy} r={3.4} fill={LINE} /><path
    d={`M ${x + w - boxW} ${cy - r * 0.6} A ${r * 0.74} ${r * 0.74} 0 0 0 ${x + w - boxW} ${cy + r * 0.6}`}
    {...stroke}
  /><rect x={x - 9} y={cy - goalH / 2} width={9} height={goalH} {...stroke} /><rect x={x + w} y={cy - goalH / 2} width={9} height={goalH} {...stroke} /><path d={`M ${x + 11} ${y} A 11 11 0 0 1 ${x} ${y + 11}`} {...stroke} /><path d={`M ${x + w} ${y + 11} A 11 11 0 0 1 ${x + w - 11} ${y}`} {...stroke} /><path d={`M ${x} ${y + h - 11} A 11 11 0 0 1 ${x + 11} ${y + h}`} {...stroke} /><path d={`M ${x + w - 11} ${y + h} A 11 11 0 0 1 ${x + w} ${y + h - 11}`} {...stroke} /></g>;
}
// Pitch appearance presets, in the spirit of sport presets: same markings,
// different surface and line colours. Values feed the --jfp-* CSS variables.
const STYLE_PRESETS = [
  { id: "classic", name: "Classic grass", grassA: "#2f8038", grassB: "#2a7532", line: "rgba(244, 250, 255, 0.92)", bg: "#071b31" },
  { id: "fresh", name: "Fresh turf", grassA: "#3c9a46", grassB: "#35893e", line: "#ffffff", bg: "#0a2b17" },
  { id: "night", name: "Night session", grassA: "#1c4023", grassB: "#18391f", line: "#ffd23c", bg: "#05070a" },
  { id: "court", name: "Indoor court", grassA: "#2a83cc", grassB: "#2678bd", line: "#f4f7fb", bg: "#123047" },
  { id: "chalk", name: "Whiteboard", grassA: "#f7f8f5", grassB: "#eef0ea", line: "#22343c", bg: "#d7dce0" },
  { id: "slate", name: "Tactics board", grassA: "#3c4854", grassB: "#37424d", line: "#f4f7fb", bg: "#171d24" }
];
function styleVars(styleId) {
  const preset = STYLE_PRESETS.find((s) => s.id === styleId);
  if (!preset || preset.id === "classic") return void 0;
  return {
    "--jfp-grass-a": preset.grassA,
    "--jfp-grass-b": preset.grassB,
    "--jfp-line": preset.line,
    "--jfp-bg": preset.bg
  };
}
function PitchSvg({ id, rot = 0, styleId = "classic" }) {
  const M = 30;
  const x = M;
  const y = M;
  const w = PW - M * 2;
  const h = PH - M * 2;
  const cx = PW / 2;
  const cy = PH / 2;
  let content;
  switch (id) {
    case "perspective-full":
      content = <g><rect width={PW} height={PH} fill="var(--jfp-bg, #071b31)" /><path d="M 250 90 L 750 90 L 910 550 L 90 550 Z" fill={GRASS_A} stroke={LINE} strokeWidth={LW} />{[0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
        const topA = 250 + index * 62.5;
        const topB = topA + 62.5;
        const bottomA = 90 + index * 102.5;
        const bottomB = bottomA + 102.5;
        return index % 2 === 0 ? <path key={index} d={`M ${topA} 90 L ${topB} 90 L ${bottomB} 550 L ${bottomA} 550 Z`} fill={GRASS_B} /> : null;
      })}<path d="M 250 90 L 750 90 L 910 550 L 90 550 Z" fill="none" stroke={LINE} strokeWidth={LW} /><line x1={170} y1={320} x2={830} y2={320} {...stroke} /><ellipse cx={500} cy={320} rx={92} ry={55} {...stroke} /><rect x={382} y={90} width={236} height={88} {...stroke} /><rect x={440} y={90} width={120} height={42} {...stroke} /><path d="M 240 550 L 300 410 L 700 410 L 760 550" {...stroke} /><path d="M 390 550 L 420 475 L 580 475 L 610 550" {...stroke} /><circle cx={500} cy={447} r={4} fill={LINE} /></g>;
      break;
    case "perspective-half":
      content = <g><rect width={PW} height={PH} fill="var(--jfp-bg, #071b31)" /><path d="M 275 105 L 725 105 L 900 550 L 100 550 Z" fill={GRASS_A} />{[0, 1, 2, 3, 4, 5].map((index) => {
        const topA = 275 + index * 75;
        const topB = topA + 75;
        const bottomA = 100 + index * 133.33;
        const bottomB = bottomA + 133.33;
        return index % 2 === 0 ? <path key={index} d={`M ${topA} 105 L ${topB} 105 L ${bottomB} 550 L ${bottomA} 550 Z`} fill={GRASS_B} /> : null;
      })}<path d="M 275 105 L 725 105 L 900 550 L 100 550 Z" fill="none" stroke={LINE} strokeWidth={LW} /><rect x={385} y={105} width={230} height={92} {...stroke} /><rect x={442} y={105} width={116} height={43} {...stroke} /><path d="M 385 197 A 130 78 0 0 0 615 197" {...stroke} /><circle cx={500} cy={225} r={4} fill={LINE} /></g>;
      break;
    case "full":
      content = <FullMarkings x={x} y={y} w={w} h={h} />;
      break;
    case "full-thirds":
      content = <g><FullMarkings x={x} y={y} w={w} h={h} /><line x1={x + w / 3} y1={y} x2={x + w / 3} y2={y + h} {...dashed} /><line x1={x + w / 3 * 2} y1={y} x2={x + w / 3 * 2} y2={y + h} {...dashed} /></g>;
      break;
    case "full-grid":
      content = <g><FullMarkings x={x} y={y} w={w} h={h} />{[1, 2, 3].map((i) => <line key={`v${i}`} x1={x + w / 4 * i} y1={y} x2={x + w / 4 * i} y2={y + h} {...dashed} />)}{[1, 2].map((i) => <line key={`h${i}`} x1={x} y1={y + h / 3 * i} x2={x + w} y2={y + h / 3 * i} {...dashed} />)}</g>;
      break;
    case "portrait": {
      const pw = h * 0.68;
      const px = cx - pw / 2;
      const boxW = pw * 0.6;
      const boxH = h * 0.155;
      const sixW = pw * 0.3;
      const sixH = h * 0.062;
      const r = pw * 0.2;
      content = <g><rect x={px} y={y} width={pw} height={h} {...stroke} /><line x1={px} y1={cy} x2={px + pw} y2={cy} {...stroke} /><circle cx={cx} cy={cy} r={r} {...stroke} /><circle cx={cx} cy={cy} r={3.4} fill={LINE} /><rect x={cx - boxW / 2} y={y} width={boxW} height={boxH} {...stroke} /><rect x={cx - sixW / 2} y={y} width={sixW} height={sixH} {...stroke} /><path
        d={`M ${cx - r * 0.6} ${y + boxH} A ${r * 0.72} ${r * 0.72} 0 0 0 ${cx + r * 0.6} ${y + boxH}`}
        {...stroke}
      /><rect x={cx - boxW / 2} y={y + h - boxH} width={boxW} height={boxH} {...stroke} /><rect x={cx - sixW / 2} y={y + h - sixH} width={sixW} height={sixH} {...stroke} /><path
        d={`M ${cx - r * 0.6} ${y + h - boxH} A ${r * 0.72} ${r * 0.72} 0 0 1 ${cx + r * 0.6} ${y + h - boxH}`}
        {...stroke}
      /><rect x={cx - pw * 0.11} y={y - 8} width={pw * 0.22} height={8} {...stroke} /><rect x={cx - pw * 0.11} y={y + h} width={pw * 0.22} height={8} {...stroke} /></g>;
      break;
    }
    case "half": {
      const boxW = w * 0.3;
      const boxH = h * 0.7;
      const sixW = w * 0.115;
      const sixH = h * 0.36;
      const goalH = h * 0.15;
      const r = h * 0.26;
      content = <g><rect x={x} y={y} width={w} height={h} {...stroke} /><path d={`M ${x} ${cy - r * 0.85} A ${r * 0.85} ${r * 0.85} 0 0 1 ${x} ${cy + r * 0.85}`} {...stroke} /><rect x={x + w - boxW} y={cy - boxH / 2} width={boxW} height={boxH} {...stroke} /><rect x={x + w - sixW} y={cy - sixH / 2} width={sixW} height={sixH} {...stroke} /><circle cx={x + w - w * 0.2} cy={cy} r={3.4} fill={LINE} /><path
        d={`M ${x + w - boxW} ${cy - r * 0.48} A ${r * 0.6} ${r * 0.6} 0 0 0 ${x + w - boxW} ${cy + r * 0.48}`}
        {...stroke}
      /><rect x={x + w} y={cy - goalH / 2} width={10} height={goalH} {...stroke} /></g>;
      break;
    }
    case "portrait-half": {
      const pw = h * 0.86;
      const px = cx - pw / 2;
      const boxW = pw * 0.58;
      const boxH = h * 0.26;
      const sixW = pw * 0.28;
      const sixH = h * 0.105;
      const r = pw * 0.24;
      content = <g><rect x={px} y={y} width={pw} height={h} {...stroke} /><rect x={cx - boxW / 2} y={y} width={boxW} height={boxH} {...stroke} /><rect x={cx - sixW / 2} y={y} width={sixW} height={sixH} {...stroke} /><circle cx={cx} cy={y + h * 0.335} r={3.4} fill={LINE} /><path
        d={`M ${cx - r * 0.55} ${y + boxH} A ${r * 0.66} ${r * 0.66} 0 0 0 ${cx + r * 0.55} ${y + boxH}`}
        {...stroke}
      /><path
        d={`M ${px} ${y + h} A ${r} ${r} 0 0 1 ${px + r} ${y + h} `}
        {...stroke}
        opacity={0}
      /><path
        d={`M ${cx - r * 0.9} ${y + h} A ${r * 0.9} ${r * 0.9} 0 0 1 ${cx + r * 0.9} ${y + h}`}
        {...stroke}
      /><rect x={cx - pw * 0.13} y={y - 8} width={pw * 0.26} height={8} {...stroke} /></g>;
      break;
    }
    case "final-third": {
      const boxW = w * 0.42;
      const boxH = h * 0.78;
      const sixW = w * 0.16;
      const sixH = h * 0.42;
      const goalH = h * 0.18;
      content = <g><rect x={x} y={y} width={w} height={h} {...stroke} /><rect x={x + w - boxW} y={cy - boxH / 2} width={boxW} height={boxH} {...stroke} /><rect x={x + w - sixW} y={cy - sixH / 2} width={sixW} height={sixH} {...stroke} /><circle cx={x + w - w * 0.28} cy={cy} r={3.6} fill={LINE} /><path
        d={`M ${x + w - boxW} ${cy - h * 0.155} A ${h * 0.235} ${h * 0.235} 0 0 0 ${x + w - boxW} ${cy + h * 0.155}`}
        {...stroke}
      /><rect x={x + w} y={cy - goalH / 2} width={11} height={goalH} {...stroke} /></g>;
      break;
    }
    case "box-only": {
      const boxW = w * 0.62;
      const boxH = h * 0.92;
      const sixW = w * 0.24;
      const sixH = h * 0.5;
      const goalH = h * 0.22;
      content = <g><line x1={x + w - 2} y1={y - M} x2={x + w - 2} y2={y + h + M} {...stroke} /><rect x={x + w - boxW} y={cy - boxH / 2} width={boxW} height={boxH} {...stroke} /><rect x={x + w - sixW} y={cy - sixH / 2} width={sixW} height={sixH} {...stroke} /><circle cx={x + w - w * 0.42} cy={cy} r={4} fill={LINE} /><path
        d={`M ${x + w - boxW} ${cy - h * 0.19} A ${h * 0.29} ${h * 0.29} 0 0 0 ${x + w - boxW} ${cy + h * 0.19}`}
        {...stroke}
      /><rect x={x + w} y={cy - goalH / 2} width={12} height={goalH} {...stroke} /></g>;
      break;
    }
    case "double-box": {
      const boxW = w * 0.2;
      const boxH = h * 0.64;
      const goalH = h * 0.16;
      content = <g><rect x={x} y={y} width={w} height={h} rx={14} {...stroke} /><line x1={cx} y1={y} x2={cx} y2={y + h} {...stroke} /><circle cx={cx} cy={cy} r={h * 0.16} {...stroke} /><rect x={x} y={cy - boxH / 2} width={boxW} height={boxH} {...stroke} /><rect x={x + w - boxW} y={cy - boxH / 2} width={boxW} height={boxH} {...stroke} /><rect x={x - 9} y={cy - goalH / 2} width={9} height={goalH} {...stroke} /><rect x={x + w} y={cy - goalH / 2} width={9} height={goalH} {...stroke} /></g>;
      break;
    }
    case "channels":
      content = <g><rect x={x} y={y} width={w} height={h} {...stroke} /><line x1={x + w / 3} y1={y} x2={x + w / 3} y2={y + h} {...dashed} /><line x1={x + w / 3 * 2} y1={y} x2={x + w / 3 * 2} y2={y + h} {...dashed} /><line x1={x} y1={y + h * 0.22} x2={x + w} y2={y + h * 0.22} {...dashed} /><line x1={x} y1={y + h * 0.78} x2={x + w} y2={y + h * 0.78} {...dashed} /></g>;
      break;
    case "grids": {
      const gw = w * 0.29;
      const gh = h * 0.42;
      const gapX = (w - gw * 3) / 2;
      const gapY = h - gh * 2;
      content = <g>{[0, 1, 2].map(
        (col) => [0, 1].map((row) => <rect
          key={`${col}-${row}`}
          x={x + col * (gw + gapX)}
          y={y + row * (gh + gapY)}
          width={gw}
          height={gh}
          {...stroke}
        />)
      )}</g>;
      break;
    }
    case "futsal": {
      const r = h * 0.14;
      const dR = h * 0.34;
      const goalH = h * 0.17;
      content = <g><rect x={0} y={0} width={PW} height={PH} fill="#1f6fb2" /><rect x={x} y={y} width={w} height={h} fill="#2a83cc" /><rect x={x} y={y} width={w} height={h} {...stroke} /><line x1={cx} y1={y} x2={cx} y2={y + h} {...stroke} /><circle cx={cx} cy={cy} r={r} {...stroke} /><path d={`M ${x} ${cy - dR} A ${dR} ${dR} 0 0 1 ${x} ${cy + dR}`} {...stroke} /><path d={`M ${x + w} ${cy - dR} A ${dR} ${dR} 0 0 0 ${x + w} ${cy + dR}`} {...stroke} /><rect x={x - 8} y={cy - goalH / 2} width={8} height={goalH} {...stroke} /><rect x={x + w} y={cy - goalH / 2} width={8} height={goalH} {...stroke} /></g>;
      break;
    }
    case "circle-zone":
      content = <g><rect x={x} y={y} width={w} height={h} {...stroke} /><circle cx={cx} cy={cy} r={h * 0.32} {...stroke} /></g>;
      break;
    case "triangle-zone":
      content = <g><rect x={x} y={y} width={w} height={h} {...stroke} opacity={0.38} /><path d={`M ${cx} ${y + 60} L ${x + w - 120} ${y + h - 70} L ${x + 120} ${y + h - 70} Z`} {...stroke} /></g>;
      break;
    case "square-zone":
      content = <g><rect x={x} y={y} width={w} height={h} {...stroke} opacity={0.38} /><rect x={cx - h * 0.32} y={cy - h * 0.32} width={h * 0.64} height={h * 0.64} {...stroke} /></g>;
      break;
    case "blank":
    default:
      content = <rect x={x} y={y} width={w} height={h} {...stroke} opacity={0.22} />;
      break;
  }
  const grassless = id === "futsal" || id === "perspective-full" || id === "perspective-half";
  const art = <g>{!grassless && <Stripes vertical={id !== "portrait" && id !== "portrait-half"} />}{content}</g>;
  // rot rotates the whole pitch artwork in 90 degree steps so coaches can view
  // the session from any side. 90 and 270 swap the canvas to portrait.
  const portraitView = rot % 180 !== 0;
  const viewW = portraitView ? PH : PW;
  const viewH = portraitView ? PW : PH;
  const ROT_TRANSFORM = {
    0: void 0,
    90: `translate(${PH} 0) rotate(90)`,
    180: `translate(${PW} ${PH}) rotate(180)`,
    270: `translate(0 ${PW}) rotate(-90)`,
  };
  return <svg
    className="pitch-art"
    viewBox={`0 0 ${viewW} ${viewH}`}
    preserveAspectRatio="none"
    style={styleVars(styleId)}
    aria-hidden
  ><g transform={ROT_TRANSFORM[rot]}>{art}</g></svg>;
}
// Rotation transform for any 1000x640 artwork group placed on a rotated view.
function viewTransform(rot) {
  if (rot === 90) return `translate(${PH} 0) rotate(90)`;
  if (rot === 180) return `translate(${PW} ${PH}) rotate(180)`;
  if (rot === 270) return `translate(0 ${PW}) rotate(-90)`;
  return void 0;
}
export {
  PH,
  PITCH_OPTIONS,
  PW,
  PitchSvg,
  STYLE_PRESETS,
  styleVars,
  viewTransform
};
