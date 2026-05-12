from playwright.sync_api import sync_playwright
from pathlib import Path
from urllib.parse import urljoin, urlparse
import re, json, time
BASE='http://127.0.0.1:4173'
xml=Path('dist/sitemap-0.xml').read_text()
paths=[urlparse(u).path for u in re.findall(r'<loc>https://jonerfootball.com([^<]*)</loc>', xml)]
paths=list(dict.fromkeys(paths))
key=['/','/about/','/training/','/camps/','/camps/sydney-big-1-july/','/join/','/programmes/','/app/','/teams/','/shop/','/blog/','/home-storyboard-prototype/']

def audit_viewport(browser, width, height, paths_to_check):
    ctx=browser.new_context(viewport={'width':width,'height':height}, ignore_https_errors=True)
    results=[]
    for path in paths_to_check:
        page=ctx.new_page(); logs=[]; errs=[]; failed=[]
        page.on('console', lambda msg: logs.append({'type':msg.type,'text':msg.text[:300]}))
        page.on('pageerror', lambda err: errs.append(str(err)[:500]))
        page.on('requestfailed', lambda req: failed.append({'url':req.url,'failure': req.failure}))
        resp=page.goto(BASE+path, wait_until='domcontentloaded', timeout=20000)
        # Wait a touch for lazy media/animations
        page.wait_for_timeout(1200)
        metrics=page.evaluate('''() => {
          const vw=innerWidth, doc=document.documentElement, body=document.body;
          const els=[...document.querySelectorAll('body *')];
          const overflow=els.map(el=>{ const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); return {tag:el.tagName, cls:el.className?.toString().slice(0,80), id:el.id, text:(el.innerText||el.alt||'').trim().slice(0,80), left:r.left, right:r.right, width:r.width, display:cs.display, pos:cs.position};}).filter(x=>x.width>0 && (x.right>vw+2 || x.left<-2)).slice(0,20);
          const imgs=[...document.images].map(img=>({src:img.currentSrc||img.src, alt:img.alt, complete:img.complete, naturalWidth:img.naturalWidth, rect: (()=>{const r=img.getBoundingClientRect(); return {w:r.width,h:r.height,top:r.top}})()})).filter(i=>!i.complete||i.naturalWidth===0);
          const videos=[...document.querySelectorAll('video')].map((v,i)=>({i,src:v.currentSrc||v.src, poster:v.poster, readyState:v.readyState, paused:v.paused, autoplay:v.autoplay, muted:v.muted, w:v.videoWidth, h:v.videoHeight, rect:(()=>{const r=v.getBoundingClientRect();return {top:r.top,left:r.left,w:r.width,h:r.height}})()}));
          const navLinks=[...document.querySelectorAll('nav a, header a')].map(a=>({text:a.innerText.trim(), href:a.href})).slice(0,30);
          const ctas=[...document.querySelectorAll('a,button')].filter(a=>/join|camp|start|app|book|shop|coach|test|program/i.test(a.innerText)).map(a=>({text:a.innerText.trim().replace(/\s+/g,' ').slice(0,80), href:a.href||'', tag:a.tagName})).slice(0,30);
          return {title:document.title, status:document.readyState, scrollW:doc.scrollWidth, clientW:doc.clientWidth, scrollH:doc.scrollHeight, overflow, brokenImgs:imgs, videos, navLinks, ctas};
        }''')
        results.append({'path':path,'http': resp.status if resp else None, 'logs':[l for l in logs if l['type'] in ('error','warning')], 'pageerrors':errs, 'failed':failed[:10], 'metrics':metrics})
        page.close()
    ctx.close(); return results

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    desktop=audit_viewport(browser,1440,1200,key)
    mobile=audit_viewport(browser,390,844,['/','/join/','/camps/','/training/'])
    allpages=audit_viewport(browser,1280,900,paths)
    # section screenshots homepage desktop for visual evidence
    ctx=browser.new_context(viewport={'width':1440,'height':900})
    p=ctx.new_page(); p.goto(BASE+'/', wait_until='domcontentloaded'); p.wait_for_timeout(1800)
    # screenshot each main section-ish viewport
    h=p.evaluate('document.documentElement.scrollHeight')
    shots=[]
    for y in [0,800,1600,2400,3200,4000,5200,6500,7800,9000,10500,12000]:
        if y>=h: break
        p.evaluate('(y)=>scrollTo(0,y)', y); p.wait_for_timeout(300)
        fname=f'tmp/audit-section-{y}.png'; p.screenshot(path=fname, full_page=False); shots.append(fname)
    # video attempt: find videos and play
    video_status=p.evaluate('''async () => {
      const vs=[...document.querySelectorAll('video')];
      const out=[];
      for (const [i,v] of vs.entries()){
        try { await v.play(); await new Promise(r=>setTimeout(r,800)); } catch(e) { out.push({i,playError:e.message}); continue; }
        out.push({i,currentTime:v.currentTime, paused:v.paused, readyState:v.readyState, w:v.videoWidth,h:v.videoHeight,src:v.currentSrc||v.src,rect:(()=>{const r=v.getBoundingClientRect(); return {top:r.top,w:r.width,h:r.height}})()});
      }
      return out;
    }''')
    ctx.close(); browser.close()
    Path('tmp/audit-results.json').write_text(json.dumps({'desktop':desktop,'mobile':mobile,'allpages':allpages,'video_status':video_status,'section_shots':shots}, indent=2))
    print(json.dumps({'desktop_pages':len(desktop),'mobile_pages':len(mobile),'all_pages':len(allpages),'video_status':video_status,'shots':shots}, indent=2))
