// Joner apparel on jonerfootball.com: product sheet, bag and Shopify checkout.
// Product cards anywhere on the page carry data-shop-open="<handle>" (and keep a real href as the
// no-JS fallback). Prices and stock are re-read live from the Storefront API on load, so a size
// selling out never needs a website deploy. Checkout creates a Shopify cart and sends the buyer
// to Shopify's own checkout.
import { PRODUCTS_QUERY, SHOP_ENDPOINT, mapProducts, money, pickLabel, priceLabel, sized, type ShopProduct, type ShopVariant } from '../lib/shopify'

type BagLine = { id: string; qty: number; handle: string; title: string; variant: string; price: number; image: string }

const BAG_KEY = 'jf-bag'
const LIVE_KEY = 'jf-shop-live'
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null

let products: ShopProduct[] = []
let current: ShopProduct | null = null
let picked: Record<string, string> = {}
let qty = 1

function track(name: string, data: Record<string, unknown>) {
  try { (window as any).JonerTracking?.trackEvent?.(name, { custom_data: data }) } catch {}
}

function readBag(): BagLine[] {
  try { const v = JSON.parse(localStorage.getItem(BAG_KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function writeBag(lines: BagLine[]) {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(lines)) } catch {}
  renderBag()
}

async function gql(query: string, variables?: Record<string, unknown>) {
  const r = await fetch(SHOP_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) })
  if (!r.ok) throw new Error(`shopify ${r.status}`)
  return r.json()
}

// Shopify says Color; the site is Australian.
const optName = (n: string) => (n.toLowerCase() === 'color' ? 'Colour' : n)

function esc(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

// ---------- live prices and stock on the cards ----------
function paintCards() {
  document.querySelectorAll<HTMLElement>('[data-shop-open]').forEach((card) => {
    const p = products.find((x) => x.handle === card.dataset.shopOpen)
    if (!p) return
    const price = card.querySelector<HTMLElement>('[data-shop-price]')
    if (price) price.innerHTML = priceLabel(p)
    card.toggleAttribute('data-sold-out', !p.available)
    const status = card.querySelector<HTMLElement>('[data-shop-status]')
    if (status) status.textContent = pickLabel(p)
  })
}

async function loadLive() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(LIVE_KEY) || 'null')
    if (cached && Date.now() - cached.at < 120000 && Array.isArray(cached.products)) {
      products = cached.products
      paintCards()
      return
    }
  } catch {}
  try {
    const live = mapProducts(await gql(PRODUCTS_QUERY))
    if (live.length) {
      products = live
      try { sessionStorage.setItem(LIVE_KEY, JSON.stringify({ at: Date.now(), products })) } catch {}
      paintCards()
      if (current) { const again = products.find((p) => p.handle === current!.handle); if (again) { current = again; renderSheet() } }
    }
  } catch {}
}

// ---------- product sheet ----------
function variantFor(p: ShopProduct, sel: Record<string, string>): ShopVariant | null {
  if (!p.options.length) return p.variants[0] || null
  return p.variants.find((v) => p.options.every((o) => v.options[o.name] === sel[o.name])) || null
}

function optionAvailable(p: ShopProduct, name: string, value: string) {
  return p.variants.some((v) => v.available && v.options[name] === value && p.options.every((o) => o.name === name || !picked[o.name] || v.options[o.name] === picked[o.name] || p.options.length === 1))
}

function openProduct(handle: string, opener?: HTMLElement) {
  const p = products.find((x) => x.handle === handle)
  if (!p) return false
  current = p
  qty = 1
  picked = {}
  // Preselect options that only have one value (e.g. a single colour).
  p.options.forEach((o) => { if (o.values.length === 1) picked[o.name] = o.values[0] })
  renderSheet()
  const dlg = $<HTMLDialogElement>('#jfs-sheet')!
  ;(dlg as any)._opener = opener || null
  if (!dlg.open) dlg.showModal()
  document.documentElement.classList.add('jfs-lock')
  track('ShopViewProduct', { content_name: p.title, content_ids: [p.handle], value: p.minPrice, currency: 'AUD' })
  return true
}

function renderSheet() {
  const p = current
  if (!p) return
  const box = $('#jfs-sheet-body')!
  const v = variantFor(p, picked)
  const price = v ? v.price : p.minPrice
  const compare = v ? v.compareAt : p.compareAt
  const ready = !!v && v.available
  const missing = p.options.find((o) => !picked[o.name])
  const imgs = p.images.length ? p.images : [{ url: '', alt: p.title }]
  box.innerHTML = `
    <div class="jfs-gallery" aria-label="Photos">${imgs.map((i, n) => i.url ? `<img src="${esc(sized(i.url, 900))}" alt="${esc(i.alt)}" ${n ? 'loading="lazy"' : ''}>` : '').join('')}</div>
    ${imgs.length > 1 ? `<p class="jfs-swipe">${imgs.length} photos, swipe</p>` : ''}
    <div class="jfs-info">
      <p class="jfs-type">${esc(p.type || 'Joner Apparel')}</p>
      <h2 id="jfs-title" class="jfs-title">${esc(p.title)}</h2>
      <p class="jfs-price">${money(price)}${compare && compare > price ? ` <s>${money(compare)}</s>` : ''}</p>
      ${p.options.map((o) => `
        <fieldset class="jfs-opt">
          <legend>${esc(optName(o.name))}${picked[o.name] ? `: <b>${esc(picked[o.name])}</b>` : ''}</legend>
          <div class="jfs-chips">${o.values.map((val) => {
            const ok = optionAvailable(p, o.name, val)
            const on = picked[o.name] === val
            return `<button type="button" class="jfs-chip" data-opt="${esc(o.name)}" data-val="${esc(val)}" aria-pressed="${on}" ${ok ? '' : 'data-out'}>${esc(val)}${ok ? '' : '<span class="sr-only"> sold out</span>'}</button>`
          }).join('')}</div>
        </fieldset>`).join('')}
      <div class="jfs-buy">
        <div class="jfs-qty" role="group" aria-label="Quantity">
          <button type="button" data-qty="-1" aria-label="One less">&minus;</button>
          <span aria-live="polite">${qty}</span>
          <button type="button" data-qty="1" aria-label="One more">+</button>
        </div>
        <button type="button" class="jfs-add" data-add ${ready ? '' : 'disabled'}>
          ${!p.available ? 'Sold out' : missing ? `Pick a ${esc(optName(missing.name).toLowerCase())}` : v && !v.available ? 'That one is sold out' : `Add to bag · ${money(price * qty)}`}
        </button>
      </div>
      ${p.description ? `<p class="jfs-desc">${esc(p.description)}</p>` : ''}
      <p class="jfs-small">Secure checkout by Shopify. Delivery options at checkout.</p>
    </div>`
}

function closeSheet() {
  const dlg = $<HTMLDialogElement>('#jfs-sheet')
  if (dlg?.open) dlg.close()
}

// ---------- bag ----------
function bagCount() { return readBag().reduce((n, l) => n + l.qty, 0) }

function renderBag() {
  const lines = readBag()
  const count = lines.reduce((n, l) => n + l.qty, 0)
  document.querySelectorAll<HTMLElement>('[data-bag-count]').forEach((el) => { el.textContent = String(count) })
  const fab = $('#jfs-fab')
  if (fab) fab.hidden = count === 0
  const list = $('#jfs-bag-lines')
  if (!list) return
  const total = lines.reduce((n, l) => n + l.price * l.qty, 0)
  list.innerHTML = lines.length ? lines.map((l, i) => `
    <li class="jfs-line">
      ${l.image ? `<img src="${esc(sized(l.image, 160))}" alt="">` : '<span class="jfs-line-ph"></span>'}
      <div class="jfs-line-main">
        <p class="jfs-line-title">${esc(l.title)}</p>
        ${l.variant && l.variant !== 'Default Title' ? `<p class="jfs-line-var">${esc(l.variant)}</p>` : ''}
        <div class="jfs-qty jfs-qty-sm" role="group" aria-label="Quantity for ${esc(l.title)}">
          <button type="button" data-line="${i}" data-step="-1" aria-label="One less">&minus;</button>
          <span>${l.qty}</span>
          <button type="button" data-line="${i}" data-step="1" aria-label="One more">+</button>
        </div>
      </div>
      <div class="jfs-line-end">
        <p>${money(l.price * l.qty)}</p>
        <button type="button" class="jfs-remove" data-remove="${i}">Remove</button>
      </div>
    </li>`).join('') : '<li class="jfs-empty">Your bag is empty.</li>'
  const foot = $('#jfs-bag-foot')
  if (foot) {
    foot.hidden = !lines.length
    const t = $('#jfs-bag-total')
    if (t) t.textContent = money(total)
  }
  const err = $('#jfs-bag-error')
  if (err && !lines.length) err.textContent = ''
}

function openBag() {
  closeSheet()
  renderBag()
  const dlg = $<HTMLDialogElement>('#jfs-bag')!
  if (!dlg.open) dlg.showModal()
  document.documentElement.classList.add('jfs-lock')
}

function addToBag() {
  const p = current
  if (!p) return
  const v = variantFor(p, picked)
  if (!v || !v.available) return
  const lines = readBag()
  const have = lines.find((l) => l.id === v.id)
  if (have) have.qty = Math.min(20, have.qty + qty)
  else lines.push({ id: v.id, qty, handle: p.handle, title: p.title, variant: p.options.length ? v.title : '', price: v.price, image: v.image || p.images[0]?.url || '' })
  writeBag(lines)
  track('ShopAddToBag', { content_name: p.title, content_ids: [p.handle], value: v.price * qty, currency: 'AUD' })
  openBag()
}

async function checkout(btn: HTMLButtonElement) {
  const lines = readBag()
  if (!lines.length) return
  const err = $('#jfs-bag-error')!
  err.textContent = ''
  btn.disabled = true
  const label = btn.textContent
  btn.textContent = 'Opening secure checkout...'
  try {
    const res = await gql(
      `mutation($lines: [CartLineInput!]!) { cartCreate(input: { lines: $lines }) { cart { checkoutUrl totalQuantity lines(first: 50) { nodes { quantity merchandise { ... on ProductVariant { id } } } } } userErrors { message } } }`,
      { lines: lines.map((l) => ({ merchandiseId: l.id, quantity: l.qty })) },
    )
    const out = res?.data?.cartCreate
    const cart = out?.cart
    if (!cart?.checkoutUrl) throw new Error(out?.userErrors?.[0]?.message || 'no cart')
    const got = new Map<string, number>((cart.lines?.nodes || []).map((n: any) => [n.merchandise?.id, n.quantity]))
    const short = lines.filter((l) => (got.get(l.id) || 0) < l.qty)
    if (short.length) {
      // Something sold out since it went in the bag: fix the bag and let them decide.
      writeBag(lines.map((l) => ({ ...l, qty: got.get(l.id) || 0 })).filter((l) => l.qty > 0))
      err.textContent = `Sorry, ${short.map((l) => l.title + (l.variant ? ` (${l.variant})` : '')).join(', ')} just sold out or has fewer left. Your bag is updated.`
      btn.disabled = false
      btn.textContent = label
      return
    }
    const total = lines.reduce((n, l) => n + l.price * l.qty, 0)
    track('ShopCheckout', { value: total, currency: 'AUD', num_items: bagCount(), content_ids: lines.map((l) => l.handle) })
    const url = new URL(cart.checkoutUrl)
    url.searchParams.set('utm_source', 'jonerfootball.com')
    url.searchParams.set('utm_medium', 'website')
    url.searchParams.set('utm_campaign', 'shop')
    url.searchParams.set('utm_content', location.pathname)
    window.location.href = url.toString()
  } catch {
    err.textContent = 'Checkout did not open. Please try again in a moment.'
    btn.disabled = false
    btn.textContent = label
  }
}

// ---------- wiring ----------
function init() {
  const data = $('#jfs-data')
  try { products = JSON.parse(data?.textContent || '[]') } catch { products = [] }

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const opener = t.closest<HTMLElement>('[data-shop-open]')
    if (opener && !(e as MouseEvent).metaKey && !(e as MouseEvent).ctrlKey) {
      if (openProduct(opener.dataset.shopOpen!, opener)) e.preventDefault()
      return
    }
    if (t.closest('[data-bag-open]')) { e.preventDefault(); openBag(); return }
    const sheet = t.closest('#jfs-sheet')
    if (sheet && current) {
      const chip = t.closest<HTMLElement>('.jfs-chip')
      if (chip) { picked[chip.dataset.opt!] = chip.dataset.val!; renderSheet(); return }
      const q = t.closest<HTMLElement>('[data-qty]')
      if (q) { qty = Math.max(1, Math.min(10, qty + Number(q.dataset.qty))); renderSheet(); return }
      if (t.closest('[data-add]')) { addToBag(); return }
    }
    const step = t.closest<HTMLElement>('[data-step]')
    if (step) {
      const lines = readBag(); const l = lines[Number(step.dataset.line)]
      if (l) { l.qty = Math.max(0, Math.min(20, l.qty + Number(step.dataset.step))); writeBag(lines.filter((x) => x.qty > 0)) }
      return
    }
    const rm = t.closest<HTMLElement>('[data-remove]')
    if (rm) { const lines = readBag(); lines.splice(Number(rm.dataset.remove), 1); writeBag(lines); return }
    const co = t.closest<HTMLButtonElement>('[data-checkout]')
    if (co) { checkout(co); return }
    if (t.closest('[data-close]')) { (t.closest('dialog') as HTMLDialogElement | null)?.close(); return }
    // Tap on the dim backdrop closes.
    if (t.tagName === 'DIALOG') (t as HTMLDialogElement).close()
  })

  document.querySelectorAll<HTMLDialogElement>('.jfs-dialog').forEach((d) => d.addEventListener('close', () => {
    if (!document.querySelector('.jfs-dialog[open]')) document.documentElement.classList.remove('jfs-lock')
    if (d.id === 'jfs-sheet') {
      const op = (d as any)._opener as HTMLElement | null
      if (op && document.contains(op)) op.focus({ preventScroll: true })
      if (location.hash.startsWith('#p=')) history.replaceState(null, '', location.pathname + location.search)
    }
  }))

  renderBag()
  paintCards()
  const deep = location.hash.match(/^#p=([\w-]+)/)
  if (deep) openProduct(deep[1])
  else if (location.hash === '#bag' && bagCount()) openBag()
  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#p=([\w-]+)/)
    if (m) { closeSheet(); openProduct(m[1]) }
  })
  loadLive()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()
