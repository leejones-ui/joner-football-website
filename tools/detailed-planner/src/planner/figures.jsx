import { useId } from "react";
import { playerSvgContent } from "../art/player-art.js";
import { EQUIPMENT_ART, artUrl, equipmentFilter } from "../lib/planner-art.js";
const OUTFIELD_POSES = [
  { id: "run", name: "Running" },
  { id: "throw-in", name: "Throw-in" },
  { id: "strike", name: "Striking" },
  { id: "glance-header", name: "Glancing header" },
  { id: "jump-header", name: "Jumping header" },
  { id: "dribble", name: "Dribbling" },
  { id: "volley", name: "Volley" },
  { id: "pass", name: "Passing" },
  { id: "stand", name: "Standing" },
  { id: "receive", name: "Receiving" },
  { id: "feed", name: "Feeding the ball" },
  { id: "receive-ball", name: "Receiving the ball" },
  { id: "tackle", name: "Tackling" },
  { id: "slide", name: "Sliding tackle" }
];
const KEEPER_POSES = [
  { id: "gk-dive", name: "Diving" },
  { id: "gk-ready", name: "Ready position" },
  { id: "gk-high-catch", name: "High catch" },
  { id: "gk-low", name: "Low receive" },
  { id: "gk-feed", name: "Feeding the ball" },
  { id: "gk-receive", name: "Receiving the ball" },
  { id: "gk-dive-save", name: "Diving save" },
  { id: "gk-head-catch", name: "Head height catch" },
  { id: "gk-set", name: "Set position" },
  { id: "gk-scoop", name: "Scoop catch" },
  { id: "gk-underarm", name: "Underarm throw" },
  { id: "gk-overarm", name: "Overarm throw" },
  { id: "gk-spread", name: "Spread save" },
  { id: "gk-lateral", name: "Lateral split save" },
  { id: "gk-top-high", name: "Top hand save (high)" },
  { id: "gk-block", name: "Block save" },
  { id: "gk-parry", name: "Dropping parry save" },
  { id: "gk-cross", name: "Dealing with crosses" },
  { id: "gk-staggered", name: "Staggered stance" },
  { id: "volley", name: "Volley" },
  { id: "gk-top-low", name: "Top hand save (low)" },
  { id: "gk-starfish", name: "Starfish shape" },
  { id: "gk-punch-two", name: "Punching (two hands)" },
  { id: "gk-punch-one", name: "Punching (one hand)" }
];
function darken(hex, amount = 0.72) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const channel = (i) => Math.round(parseInt(value.slice(i, i + 2), 16) * amount);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}
function PlayerFigure({pose="stand",color="#e8000d",official=false,artwork="classic",number="1"}) {
 const filterId="player-kit-"+useId().replace(/[^a-zA-Z0-9_-]/g, "");
 return <svg viewBox="0 0 64 88" className="figure-art" aria-hidden dangerouslySetInnerHTML={{__html:playerSvgContent({pose,color,official,artwork,number,filterId})}} />;
}
function Shadow({ cx, cy, rx }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={rx * 0.22} fill="rgba(0,0,0,0.28)" />;
}
function EquipmentArt({ kind, color, artwork = "classic" }) {
  const art = EQUIPMENT_ART[kind];
  if(artwork === "illustrated" && art) return <svg viewBox={`0 0 ${art.width} ${art.height}`} className="figure-art" aria-hidden><image href={artUrl(art.file)} width={art.width} height={art.height} style={{filter:equipmentFilter(color,art.baseHue)}} preserveAspectRatio="xMidYMid meet" /></svg>;
  switch (kind) {
    case "ball":
      return <svg viewBox="0 0 40 40" className="figure-art" aria-hidden><Shadow cx={20} cy={35} rx={11} /><circle cx={20} cy={19} r={13.5} fill="#fdfdfd" stroke="#2a2d33" strokeWidth={1.1} /><path d="M 20 13 L 25.5 17 L 23.4 23.6 L 16.6 23.6 L 14.5 17 Z" fill="#23262c" /><path
        d="M 20 13 L 20 5.6 M 25.5 17 L 32.6 14.5 M 23.4 23.6 L 28.4 29.4 M 16.6 23.6 L 11.6 29.4 M 14.5 17 L 7.4 14.5"
        stroke="#3a3e45"
        strokeWidth={1.4}
        fill="none"
      /></svg>;
    case "cone":
      return <svg viewBox="0 0 40 46" className="figure-art" aria-hidden><Shadow cx={20} cy={41} rx={13} /><path d="M 8 38 L 32 38 L 27.5 34 L 12.5 34 Z" fill={darken(color, 0.78)} /><path d="M 12.5 35 L 20 6 L 27.5 35 Z" fill={color} /><path d="M 15.6 24 L 24.4 24 L 23 18.5 L 17 18.5 Z" fill="rgba(255,255,255,0.85)" /><path d="M 20 6 L 27.5 35 L 23 35 Z" fill="rgba(0,0,0,0.16)" /></svg>;
    case "disc-marker":
      return <svg viewBox="0 0 40 26" className="figure-art" aria-hidden><Shadow cx={20} cy={21} rx={14} /><ellipse cx={20} cy={14} rx={16} ry={7} fill={color} stroke={darken(color,0.72)} strokeWidth={1.2}/><ellipse cx={20} cy={14} rx={3} ry={1.4} fill="#152028" /></svg>;
    case "saucer":
      return <svg viewBox="0 0 40 26" className="figure-art" aria-hidden><Shadow cx={20} cy={21} rx={14} /><path d="M 5 17 Q 20 4 35 17 L 32 19 Q 20 10 8 19 Z" fill={color} /><path d="M 8 19 Q 20 10 32 19 Q 20 23.5 8 19 Z" fill={darken(color, 0.7)} /><ellipse cx={20} cy={12.6} rx={4.6} ry={1.7} fill={darken(color, 0.62)} /></svg>;
    case "flag":
      return <svg viewBox="0 0 40 52" className="figure-art" aria-hidden><Shadow cx={14} cy={48} rx={8} /><rect x={12.4} y={6} width={2.6} height={41} rx={1.3} fill="#d8dde3" stroke="#9aa3ad" strokeWidth={0.5} /><path d="M 15 6.5 L 34 10 L 15 16.5 Z" fill="#ffe100" stroke="#d6bd00" strokeWidth={0.7} /></svg>;
    case "pole":
      return <svg viewBox="0 0 20 52" className="figure-art" aria-hidden><Shadow cx={10} cy={48} rx={6} /><rect x={8} y={4} width={4} height={43} rx={2} fill={color} />{[10, 22, 34].map((y) => <rect key={y} x={8} y={y} width={4} height={6} fill={darken(color, 0.45)} />)}<path d="M 8 4 Q 10 2 12 4 L 12 7 L 8 7 Z" fill={darken(color, 0.6)} /></svg>;
    case "mannequin":
      return <svg viewBox="0 0 36 58" className="figure-art" aria-hidden><Shadow cx={18} cy={54} rx={11} /><circle cx={18} cy={8.5} r={5.4} fill={color} /><path d="M 12.5 15 Q 18 12 23.5 15 L 26 34 L 24 50 L 12 50 L 10 34 Z" fill={color} /><path d="M 18 15 L 26 34 L 24 50 L 18 50 Z" fill="rgba(0,0,0,0.16)" /><rect x={8} y={50} width={20} height={3.4} rx={1.7} fill={darken(color, 0.55)} /><circle cx={15} cy={22} r={1.4} fill="rgba(255,255,255,0.7)" /><circle cx={20.5} cy={22} r={1.4} fill="rgba(255,255,255,0.7)" /></svg>;
    case "goal": {
      const mesh = [];
      for (let i = 1; i < 12; i++)
        mesh.push(<line key={`v${i}`} x1={6 + i * 6.4} y1={12} x2={6 + i * 6.4} y2={46} stroke="rgba(255,255,255,0.55)" strokeWidth={0.7} />);
      for (let i = 1; i < 6; i++)
        mesh.push(<line key={`h${i}`} x1={7} y1={12 + i * 5.6} x2={83} y2={12 + i * 5.6} stroke="rgba(255,255,255,0.55)" strokeWidth={0.7} />);
      return <svg viewBox="0 0 90 52" className="figure-art" aria-hidden><Shadow cx={45} cy={48.6} rx={41} /><rect x={6} y={11} width={78} height={35.5} fill="rgba(255,255,255,0.1)" />{mesh}<path d="M 6 46.5 L 6 11 L 84 11 L 84 46.5" fill="none" stroke="#f4f6f8" strokeWidth={3.4} strokeLinecap="round" /><path d="M 6 11 L 12 5 L 78 5 L 84 11" fill="none" stroke="#dfe4e9" strokeWidth={2.6} strokeLinejoin="round" /></svg>;
    }
    case "minigoal": {
      const mesh = [];
      for (let i = 1; i < 7; i++)
        mesh.push(<line key={`v${i}`} x1={7 + i * 6} y1={14} x2={7 + i * 6} y2={38} stroke="rgba(255,255,255,0.5)" strokeWidth={0.7} />);
      for (let i = 1; i < 4; i++)
        mesh.push(<line key={`h${i}`} x1={8} y1={14 + i * 6} x2={49} y2={14 + i * 6} stroke="rgba(255,255,255,0.5)" strokeWidth={0.7} />);
      return <svg viewBox="0 0 56 44" className="figure-art" aria-hidden><Shadow cx={28} cy={40.6} rx={25} /><rect x={7} y={13} width={42} height={25.5} fill="rgba(255,255,255,0.1)" />{mesh}<path d="M 7 38.5 L 7 13 L 49 13 L 49 38.5" fill="none" stroke="#f4f6f8" strokeWidth={2.8} strokeLinecap="round" /><path d="M 7 13 L 13 25 M 49 13 L 43 25" stroke="#dfe4e9" strokeWidth={1.8} /></svg>;
    }
    case "net": {
      const mesh = [];
      for (let i = 1; i < 16; i++)
        mesh.push(<line key={`v${i}`} x1={4 + i * 5.2} y1={10} x2={4 + i * 5.2} y2={30} stroke="rgba(255,255,255,0.7)" strokeWidth={0.7} />);
      for (let i = 1; i < 4; i++)
        mesh.push(<line key={`h${i}`} x1={5} y1={10 + i * 5} x2={87} y2={10 + i * 5} stroke="rgba(255,255,255,0.7)" strokeWidth={0.7} />);
      return <svg viewBox="0 0 92 38" className="figure-art" aria-hidden><Shadow cx={46} cy={34.6} rx={42} /><rect x={4} y={9} width={84} height={21.5} fill="rgba(255,255,255,0.12)" />{mesh}<line x1={4} y1={9.4} x2={88} y2={9.4} stroke="#c77b3a" strokeWidth={3} strokeLinecap="round" /><rect x={2.6} y={8} width={3} height={25} rx={1.4} fill="#a8632c" /><rect x={86.4} y={8} width={3} height={25} rx={1.4} fill="#a8632c" /><path d="M 1 33 L 7.4 33 M 84.6 33 L 91 33" stroke="#a8632c" strokeWidth={2.4} strokeLinecap="round" /></svg>;
    }
    case "hurdle":
      return <svg viewBox="0 0 44 40" className="figure-art" aria-hidden><Shadow cx={22} cy={36} rx={16} /><path
        d="M 8 35 L 8 14 Q 8 8 14 8 L 30 8 Q 36 8 36 14 L 36 35"
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
      /><path d="M 8 24 L 8 14 Q 8 8 14 8 L 22 8" fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth={1.6} strokeLinecap="round" /></svg>;
    case "minihurdle":
      return <svg viewBox="0 0 40 26" className="figure-art" aria-hidden><Shadow cx={20} cy={23} rx={14} /><path d="M 6 22 L 12 8 L 28 8 L 34 22" fill="none" stroke={color} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" /><line x1={12} y1={8} x2={28} y2={8} stroke={darken(color, 0.65)} strokeWidth={3.4} strokeLinecap="round" /></svg>;
    case "bosu":
      return <svg viewBox="0 0 40 26" className="figure-art" aria-hidden><Shadow cx={20} cy={23} rx={14} /><path d="M 6 19 Q 20 1 34 19 Z" fill={color} /><path d="M 10 16.4 Q 20 6 30 16.4" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.6} /><ellipse cx={20} cy={19.6} rx={14.6} ry={2.6} fill="#20262d" /></svg>;
    case "ladder":
      return <svg viewBox="0 0 34 60" className="figure-art" aria-hidden><rect x={6} y={2} width={3} height={56} rx={1.5} fill="#d8412f" /><rect x={25} y={2} width={3} height={56} rx={1.5} fill="#d8412f" />{[7, 16, 25, 34, 43, 52].map((y) => <rect key={y} x={7} y={y} width={20} height={3.2} rx={1.6} fill="#ffd23c" />)}</svg>;
    case "box":
      return <svg viewBox="0 0 48 36" className="figure-art" aria-hidden><Shadow cx={24} cy={33} rx={19} /><path d="M 6 12 L 15 5 L 42 5 L 42 12 Z" fill="#3a3f46" /><path d="M 6 12 L 42 12 L 42 30 L 6 30 Z" fill="#23272d" />{[0, 1, 2, 3].map((i) => <path key={i} d={`M ${8 + i * 9} 30 L ${14 + i * 9} 12 L ${18 + i * 9} 12 L ${12 + i * 9} 30 Z`} fill="#ffd23c" />)}<path d="M 15 5 L 42 5 L 42 12 L 15 12 Z" fill="#ffd23c" opacity={0.85} /></svg>;
    case "rebound-single":
      return <svg viewBox="0 0 64 42" className="figure-art" aria-hidden><Shadow cx={32} cy={38} rx={27} /><path d="M 7 10 L 19 5 L 57 8 L 50 34 L 12 35 Z" fill="#23272d" stroke="#56606a" strokeWidth={1.3} />{[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M ${12 + i * 8} 35 L ${20 + i * 7} 6 L ${24 + i * 7} 6 L ${17 + i * 8} 35 Z`} fill={color} />)}</svg>;
    case "rebound-double":
      return <svg viewBox="0 0 78 44" className="figure-art" aria-hidden><Shadow cx={39} cy={40} rx={34} /><path d="M 5 10 L 15 5 L 38 8 L 38 36 L 9 36 Z" fill="#23272d" stroke="#56606a" strokeWidth={1.2} /><path d="M 73 10 L 63 5 L 40 8 L 40 36 L 69 36 Z" fill="#23272d" stroke="#56606a" strokeWidth={1.2} />{[12, 20, 28, 47, 55, 63].map((x) => <path key={x} d={`M ${x - 3} 35 L ${x + 3} 7 L ${x + 7} 7 L ${x + 1} 35 Z`} fill={color} />)}</svg>;
    case "dummy":
      return <svg viewBox="0 0 38 60" className="figure-art" aria-hidden><Shadow cx={19} cy={56} rx={13} /><circle cx={19} cy={9} r={6} fill="#f4f7fb" stroke="#a9b3be" strokeWidth={1} /><path d="M 12 16 Q 19 12 26 16 L 29 38 L 25 52 L 13 52 L 9 38 Z" fill="#f4f7fb" stroke="#a9b3be" strokeWidth={1} /><path d="M 19 15 L 27 39 L 24 51 L 19 51 Z" fill="rgba(39,73,214,.16)" /><circle cx={19} cy={28} r={5} fill="#2749d6" opacity={0.8} /></svg>;
    case "arc":
      return <svg viewBox="0 0 48 32" className="figure-art" aria-hidden><Shadow cx={24} cy={28} rx={18} /><path d="M 8 27 L 8 20 Q 8 6 24 6 Q 40 6 40 20 L 40 27" fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" /></svg>;
    case "tyre":
      return <svg viewBox="0 0 42 34" className="figure-art" aria-hidden><Shadow cx={21} cy={29} rx={16} /><ellipse cx={21} cy={17} rx={15} ry={11} fill="#161a1f" stroke="#424950" strokeWidth={3} /><ellipse cx={21} cy={17} rx={7} ry={5} fill="#343b42" />{[8, 14, 20, 26, 32].map((x) => <path key={x} d={`M ${x} 10 L ${x + 3} 23`} stroke="#5a626a" strokeWidth={1} />)}</svg>;
    case "footprint-left":
    case "footprint-right": {
      const flip = kind === "footprint-right" ? "translate(34 0) scale(-1 1)" : void 0;
      return <svg viewBox="0 0 34 48" className="figure-art" aria-hidden><g transform={flip} fill={color}><path d="M 13 16 Q 8 23 10 34 Q 12 43 19 42 Q 25 40 24 31 Q 23 22 19 16 Z" /><circle cx={11} cy={11} r={3.2} /><circle cx={15} cy={8} r={3} /><circle cx={19} cy={7} r={2.7} /><circle cx={23} cy={8.5} r={2.3} /><circle cx={26} cy={11.5} r={2} /></g></svg>;
    }
    case "rings":
      return <svg viewBox="0 0 62 44" className="figure-art" aria-hidden>{[[17, 14], [39, 12], [28, 29], [49, 28], [8, 29]].map(([cx, cy], index) => <ellipse key={index} cx={cx} cy={cy} rx={11} ry={7} fill="none" stroke={index % 2 ? "#ff3d42" : color} strokeWidth={3} />)}</svg>;
    case "agility-cones":
      return <svg viewBox="0 0 66 40" className="figure-art" aria-hidden>{[8, 24, 40, 56].map((x, index) => <g key={x} transform={`translate(${x} ${index % 2 ? 6 : 0})`}><ellipse cx={0} cy={32} rx={7} ry={2} fill="rgba(0,0,0,.25)" /><path d="M -6 30 L 0 8 L 6 30 Z" fill={index % 2 ? "#ffe329" : color} /></g>)}</svg>;
    case "bib":
      return <svg viewBox="0 0 40 42" className="figure-art" aria-hidden><path
        d="M 12 6 L 16 3 L 24 3 L 28 6 L 33 12 L 29 16 L 29 37 L 11 37 L 11 16 L 7 12 Z"
        fill={color}
        stroke={darken(color, 0.6)}
        strokeWidth={1.2}
      /><path d="M 16 3 Q 20 8 24 3" fill="none" stroke={darken(color, 0.55)} strokeWidth={1.6} /><path d="M 11 22 L 29 22" stroke="rgba(255,255,255,0.4)" strokeWidth={2} /></svg>;
    default:
      return null;
  }
}
export {
  EquipmentArt,
  KEEPER_POSES,
  OUTFIELD_POSES,
  PlayerFigure,
  darken
};
