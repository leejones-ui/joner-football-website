const { chromium } = require('/Users/jonerai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const base = 'http://127.0.0.1:4331';
const dist = path.resolve('dist');
const sitemap = fs.readFileSync(path.join(dist, 'sitemap-0.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => new URL(m[1]).pathname);
const keyShotPages = new Set(['/', '/app/', '/join/', '/training/', '/camps/', '/shop/', '/workshops/', '/teams/', '/hq/', '/about/']);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const results = [];
  fs.mkdirSync('tmp/desktop-audit-shots', { recursive: true });

  for (const route of urls) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
    const errors = [];
    const failed = [];
    page.on('console', msg => {
      if (['error'].includes(msg.type())) errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));
    page.on('requestfailed', req => {
      const url = req.url();
      if (!url.includes('google-analytics') && !url.includes('googletagmanager') && !url.includes('cloudinary')) {
        failed.push({ url, failure: req.failure()?.errorText });
      }
    });

    const url = base + route;
    let status = 0;
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      status = res?.status() || 0;
      await page.waitForTimeout(300);
      const metrics = await page.evaluate(async () => {
        const imgs = [...document.images].map(img => ({ src: img.currentSrc || img.src, alt: img.alt, ok: img.complete && img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight, rect: (() => { const r=img.getBoundingClientRect(); return {w:r.width,h:r.height,top:r.top,left:r.left}; })() })).filter(x => !x.ok || (x.rect.w > 20 && x.rect.h > 20 && x.w === 0));
        const videos = [...document.querySelectorAll('video')].map(v => ({ src: v.currentSrc || v.querySelector('source')?.src || '', readyState: v.readyState, w: v.videoWidth, h: v.videoHeight, paused: v.paused, autoplay: v.autoplay, loop: v.loop, muted: v.muted }));
        const wide = [...document.querySelectorAll('body *')].map(el => { const r = el.getBoundingClientRect(); return { tag: el.tagName, cls: el.className && String(el.className).slice(0,120), text: (el.innerText||'').trim().slice(0,80), left:r.left, right:r.right, width:r.width, height:r.height }; }).filter(x => x.width > 0 && (x.right > window.innerWidth + 3 || x.left < -3)).slice(0,20);
        const smallText = [...document.querySelectorAll('a,button')].map(el => { const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); return { text:(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,60), w:r.width,h:r.height,font:cs.fontSize, top:r.top,left:r.left }; }).filter(x => x.w>0 && x.h>0 && (x.w < 34 || x.h < 30)).slice(0,20);
        return { title: document.title, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, scrollH: document.documentElement.scrollHeight, imgs, videos, wide, smallText, h1: document.querySelector('h1')?.innerText?.trim() || '' };
      });
      const shotName = route === '/' ? 'home' : route.replace(/^\//,'').replace(/\/$/,'').replaceAll('/','_');
      if (keyShotPages.has(route)) await page.screenshot({ path: `tmp/desktop-audit-shots/${shotName}.png`, fullPage: false });
      results.push({ route, status, errors, failed, ...metrics });
    } catch (e) {
      results.push({ route, status, fatal: e.message, errors, failed });
    }
    await page.close();
  }

  fs.writeFileSync('tmp/desktop-audit-results.json', JSON.stringify(results, null, 2));
  const summary = results.map(r => ({ route:r.route, status:r.status, fatal:r.fatal, errors:r.errors?.length||0, failed:r.failed?.length||0, overflow:r.scrollW && r.clientW ? r.scrollW-r.clientW : null, brokenImgs:r.imgs?.length||0, videos:r.videos?.length||0, smallTargets:r.smallText?.length||0 })).filter(r => r.fatal || r.status>=400 || r.errors || r.failed || r.overflow>3 || r.brokenImgs || r.smallTargets>5);
  console.log(JSON.stringify({pages: results.length, flagged: summary}, null, 2));
  await browser.close();
})();
