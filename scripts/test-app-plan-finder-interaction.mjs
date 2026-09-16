// DOM-level interaction regression tests. Not a real-browser visual audit.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const root = fileURLToPath(new URL('../', import.meta.url))
const component = fs.readFileSync(path.join(root, 'src/components/AppPlanFinder.astro'), 'utf8')
const script = component.match(/<script>([\s\S]*?)<\/script>/)[1]
const bundled = await build({stdin:{contents:script,loader:'ts',resolveDir:path.join(root,'src/components')},bundle:true,write:false,format:'iife',target:'es2022'})
const html = fs.readFileSync(path.join(root,'dist/join/index.html'),'utf8')

function setup({ seen = false, width = 1440 } = {}) {
  const dom = new JSDOM(html, {url:'http://localhost/join/',runScripts:'outside-only',pretendToBeVisual:true})
  const w=dom.window, d=w.document, events=[]
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true}
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))}
  w.HTMLElement.prototype.scrollIntoView=function(){}
  w.requestAnimationFrame=fn=>{fn();return 0}
  w.matchMedia=query=>({matches:query==='(min-width: 1051px)'?width>=1051:true})
  const timers=[]
  w.setTimeout=(fn,delay)=>{timers.push({fn,delay});return timers.length}
  w.clearTimeout=()=>{}
  if(seen)w.sessionStorage.setItem('jf-app-plan-help-seen','yes')
  w.JonerTracking={trackEvent:(name,data)=>events.push({name,data})}
  w.eval(bundled.outputFiles[0].text)
  const dialog=d.querySelector('#app-plan-finder')
  const click=selector=>{const el=d.querySelector(selector);assert.ok(el,selector);el.click()}
  const pick=(key,id)=>click(`input[name="finder-${key}"][value="${id}"]`)
  const next=()=>click('.pf-next')
  return {dom,w,d,dialog,events,click,pick,next,timers}
}

// Standard parent journey, mixed roles, saved state and price synchronisation.
{
  const {dom,w,d,dialog,events,click,pick,next}=setup()
  assert.ok(d.querySelector('.app-finder-banner'), 'Keep the original compact join-page prompt')
  assert.equal(d.querySelector('.pf-story'),null,'No editorial sidebar')
  assert.equal(dialog.getAttribute('aria-labelledby'),'pf-dialog-title')
  assert.equal(d.querySelector('#pf-dialog-title').textContent,'Find my plan')
  assert.equal(d.querySelectorAll('[data-finder-step] .pf-option-copy > span').length,0,'Main answers use concise labels only')
  assert.equal(dialog.querySelectorAll('img').length,0,'Keep the questionnaire photo-free')
  assert.equal(d.querySelectorAll('input[name="finder-goals"]').length,8)
  assert.equal(d.querySelectorAll('.pf-content-group:last-child input').length,4)
  assert.equal(dialog.open,false,'Never open automatically')
  assert.equal(d.querySelectorAll('#app-plan-finder input:checked').length,0)
  click('[data-open-app-finder]')
  assert.equal(dialog.open,true)
  assert.equal(d.body.style.overflow,'hidden')
  assert.equal(d.querySelector('.pf-next').disabled,true)
  pick('roles','parent');pick('roles','player');next()
  pick('goals','child');next()
  pick('content','programmes');pick('content','goalkeeper')
  click('.pf-close');assert.equal(d.body.style.overflow,'')
  click('[data-open-app-finder]')
  assert.equal(d.querySelectorAll('input[name="finder-content"]:checked').length,2)
  assert.equal(d.querySelector('[data-finder-step="2"]').hidden,false)
  next()
  assert.equal(d.querySelector('.pf-result').dataset.plan,'plus')
  assert.equal(d.querySelector('.pf-upgrade').hidden,false)
  assert.equal(d.querySelector('.pf-result-link').getAttribute('href'),'#plus')
  d.querySelector('[data-billing="annual"]').setAttribute('aria-pressed','false')
  d.querySelector('#plus .billing-price').textContent='$29.99'
  d.querySelector('#plus .billing-sub').textContent='billed monthly'
  d.querySelector('#currency-note').textContent='Prices shown in AUD (Australia)'
  d.dispatchEvent(new w.Event('app-billing-updated'))
  assert.equal(d.querySelector('.pf-price').textContent,'$29.99 /month')
  assert.match(d.querySelector('.pf-billing').textContent,/AUD/)
  assert.equal(events.filter(e=>e.name==='JoinPlanFinderComplete').length,1)
  click('.pf-close');click('[data-open-app-finder]')
  assert.equal(events.filter(e=>e.name==='JoinPlanFinderComplete').length,1,'Reopening a result does not duplicate completion')
  click('[data-finder-max]');assert.equal(dialog.open,false)
  assert.equal(d.activeElement,d.querySelector('#max h2'))
  assert.equal(events.filter(e=>e.name==='JoinPlanFinderUpgradeClick').length,1)
  dom.window.close()
}

// Full library is exclusive, not sticky when individual choices change.
{
  const {dom,d,click,pick,next}=setup()
  click('[data-open-app-finder]');pick('roles','player');next();pick('goals','basics');next()
  pick('content','follow-along');pick('full','full')
  assert.equal(d.querySelectorAll('input[name="finder-content"]:checked').length,0)
  pick('content','follow-along')
  assert.equal(d.querySelector('input[name="finder-full"]').checked,false)
  next();assert.equal(d.querySelector('.pf-result').dataset.plan,'starter')
  click('.pf-edit');next();next();pick('full','full');next()
  assert.equal(d.querySelector('.pf-result').dataset.plan,'max')
  assert.equal(d.querySelector('.pf-upgrade').hidden,true)
  assert.match(d.querySelector('.pf-trial').textContent,/No free trial/)
  dom.window.close()
}

// A team coach can need personal content OR group accounts; never infer Teams.
for(const access of ['individual','group','both']) {
  const {dom,d,click,pick,next}=setup()
  click('[data-open-app-finder]');pick('roles','team-coach');next();pick('goals','team');next();pick('content','team-training');next()
  assert.equal(d.querySelector('[data-finder-extra="access"]').hidden,false)
  pick('access',access);next()
  assert.equal(d.querySelector('.pf-result').dataset.plan,access==='individual'?'max':'club')
  assert.equal(d.querySelector('.pf-result-link').getAttribute('href'),access==='individual'?'#max':'/teams/')
  dom.window.close()
}

// Conflicting coaching goal receives a choice, and changing roles clears stale group access.
{
  const {dom,d,click,pick,next}=setup()
  click('[data-open-app-finder]');pick('roles','team-coach');next();pick('goals','coaching');next();pick('content','follow-along');next()
  pick('access','individual');next()
  assert.equal(d.querySelector('[data-finder-extra="coaching"]').hidden,false)
  pick('coaching','training-only');next()
  assert.equal(d.querySelector('.pf-result').dataset.plan,'starter')
  click('.pf-edit');pick('roles','team-coach');pick('roles','player')
  assert.equal(d.querySelectorAll('input[name="finder-access"]:checked').length,0)
  assert.equal(d.querySelectorAll('input[name="finder-coaching"]:checked').length,0)
  next();next();next();pick('coaching','include');next()
  assert.equal(d.querySelector('.pf-result').dataset.plan,'max')
  dom.window.close()
}
console.log('PASS: DOM journeys, multi-select, close/resume, billing, full-library exclusivity, group routing, clarification, stale-answer invalidation and event deduplication')

// Nonmodal desktop helper, shared finder, session dismissal and stable return focus.
{
  const {dom,w,d,dialog,click,timers}=setup()
  const nudge=d.querySelector('.pf-nudge')
  assert.equal(nudge.hidden,true)
  assert.equal(timers[0].delay,30000)
  timers[0].fn()
  assert.equal(nudge.hidden,false)
  assert.equal(dialog.open,false,'The timed prompt never opens the questionnaire')
  click('.pf-nudge [data-open-app-finder]')
  assert.equal(dialog.open,true)
  assert.equal(nudge.hidden,true)
  assert.equal(w.sessionStorage.getItem('jf-app-plan-help-seen'),'yes')
  click('.pf-close')
  assert.equal(d.activeElement,d.querySelector('.app-finder-banner [data-open-app-finder]'))
  timers[0].fn();assert.equal(nudge.hidden,true)
  dom.window.close()
}
for(const config of [{seen:true},{width:390}]) {
  const {dom,d,timers}=setup(config)
  timers[0].fn();assert.equal(d.querySelector('.pf-nudge').hidden,true)
  dom.window.close()
}
{
  const {dom,w,d,click,timers}=setup()
  timers[0].fn();click('.pf-nudge-close')
  assert.equal(d.querySelector('.pf-nudge').hidden,true)
  assert.equal(w.sessionStorage.getItem('jf-app-plan-help-seen'),'yes')
  dom.window.close()
}

// Messaging is included in Plus; learning Lee's coaching can add Max resources.
{
  const {dom,d,click,pick,next}=setup()
  click('[data-open-app-finder]');pick('roles','player');next();pick('goals','basics');next();pick('content','message-lee');next()
  assert.equal(d.querySelector('.pf-result').dataset.plan,'plus')
  click('.pf-edit');next();pick('goals','lee-coaching');next();next()
  assert.equal(d.querySelector('[data-finder-extra="coaching"]').hidden,false)
  pick('coaching','include');next()
  assert.equal(d.querySelector('.pf-result').dataset.plan,'max')
  dom.window.close()
}
