// Standalone SVGs cannot fetch external images when painted onto a canvas.
const cache = new Map();
export async function inlineSvgImages(svg) {
  await Promise.all(Array.from(svg.querySelectorAll("image")).map(async image=>{
    const href=image.getAttribute("href");
    if(!href)return;
    const url=new URL(href,location.origin);
    const internalArt=url.origin===location.origin && (url.pathname.startsWith("/jfp-planner/detailed/art/"));
    if(!internalArt)return;
    if(!cache.has(href))cache.set(href,fetch(href).then(response=>{if(!response.ok)throw Error("Could not load session artwork.");return response.blob();}).then(blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);})).catch(error=>{cache.delete(href);throw error;}));
    image.setAttribute("href",await cache.get(href));
  }));
}
