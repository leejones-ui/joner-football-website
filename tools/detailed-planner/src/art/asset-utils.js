export function artUrl(file) {
  return `/jfp-planner/detailed/art/illustrated-v1/${file}`;
}
// Plastic kit colours remain meaningful when a coach changes artwork style.
export function equipmentFilter(colour, baseHue) {
  if(baseHue==null || !/^#[0-9a-f]{6}$/i.test(colour||''))return undefined;
  const [r,g,b]=[1,3,5].map(i=>parseInt(colour.slice(i,i+2),16)/255);
  const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  if(delta<0.08)return max<0.25?'grayscale(1) brightness(0.2)':`grayscale(1) brightness(${max>0.8?1.8:0.7})`;
  let hue=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
  hue=(hue*60+360)%360;
  return `hue-rotate(${Math.round(hue-baseHue)}deg)`;
}
