// Shared player renderer: no legacy stick figures in either planner.
export const PLAYER_POSES = ['run','throw-in','strike','glance-header','jump-header','dribble','volley','pass','stand','receive','feed','receive-ball','tackle','slide','gk-dive','gk-ready','gk-high-catch','gk-low','gk-feed','gk-receive','gk-dive-save','gk-head-catch','gk-set','gk-scoop','gk-underarm','gk-overarm','gk-spread','gk-lateral','gk-top-high','gk-block','gk-parry','gk-cross','gk-staggered','gk-top-low','gk-starfish','gk-punch-two','gk-punch-one','gk-volley'];
const original=new Set(['run','pass','receive']);
export function playerArtUrl(pose='stand',skin='light') {
  const resolved=PLAYER_POSES.includes(pose)?pose:'stand';
  const variant=['medium','deep'].includes(skin)&&['pass','receive'].includes(resolved)?`-${skin}`:'';
  const folder=original.has(resolved)&&!variant?'illustrated-v1':'players-v2';
  return `/jfp-planner/detailed/art/${folder}/${resolved}${variant}.png`;
}
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function playerSvgContent({pose='stand',color='#e8000d',artwork='classic',number='1',official=false,skin='light',filterId='player-kit'}={}) {
  color=/^#[0-9a-f]{6}$/i.test(color)?color:'#e8000d';
  if(artwork!=='illustrated')return `<circle cx="32" cy="44" r="25" fill="${color}" stroke="white" stroke-width="2"/><text x="32" y="45" text-anchor="middle" dominant-baseline="middle" fill="${['#ffd23c','#f4f7fb','#ffffff'].includes(color)?'#10151c':'white'}" font-family="Arial,sans-serif" font-weight="bold" font-size="24">${escape(official?'C':String(number).slice(0,3))}</text>`;
  const id=String(filterId).replace(/[^a-zA-Z0-9_-]/g,'');
  const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255/0.9);
  const matrix=rgb.map(c=>`${c.toFixed(4)} 0 0 0 0`).join(' ')+' 0 0 0 1 0';
  // Only strongly red fabric enters the mask. Skin, gloves, boots and the ball retain their original colour.
  const filter=`<defs><filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 20 -80 60 0 -0.15" result="kitMask"/><feColorMatrix in="SourceGraphic" type="matrix" values="${matrix}" result="kitTint"/><feComposite in="kitTint" in2="kitMask" operator="in" result="kit"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="kit"/></feMerge></filter></defs>`;
  return filter+`<image href="${escape(playerArtUrl(pose==='volley'&&color==='#19b562'?'gk-volley':pose,skin))}" width="64" height="88" preserveAspectRatio="xMidYMid meet"${['#e8000d','#c42318'].includes(color)?'':` filter="url(#${id})"`}/>`;
}
