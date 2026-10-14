// Small shared pieces of My account: names, money, page heads.
import { esc } from './jfp-common.js'
import { ic } from './jfp-account-icons.js'

export const first = (name) => String(name || '').trim().split(/\s+/)[0] || ''
export const initials = (name) => String(name || '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'J'
export const money = (c) => `A$${(c / 100).toFixed(2).replace(/\.00$/, '')}`

export function pageHead(kicker, title, lede = '', right = '') {
  return `<header class="ja-head"><div class="ja-head-row"><div><p class="ja-kicker"><i></i>${esc(kicker)}</p><h1 class="ja-display">${esc(title)}</h1></div>${right}</div>${lede ? `<p class="ja-lede">${lede}</p>` : ''}</header>`
}

export function hero({ img, imgSmall, kicker, title, lede = '', actions = '' }) {
  return `<div class="ja-hero"><img src="${esc(imgSmall || img)}" srcset="${esc(imgSmall || img)} 900w, ${esc(img)} 1600w" sizes="(min-width: 640px) 80vw, 100vw" alt="" fetchpriority="high">
    <p class="ja-kicker"><i></i>${esc(kicker)}</p><h1 class="ja-display">${title}</h1>${lede ? `<p class="ja-lede">${lede}</p>` : ''}${actions ? `<div class="ja-actions">${actions}</div>` : ''}</div>`
}

export function secHead(title, sub = '', railId = '', right = '') {
  return `<div class="ja-sec-head"><div><h2 class="ja-h2">${esc(title)}</h2>${sub ? `<p class="ja-muted ja-small">${sub}</p>` : ''}</div>${railId ? `<div class="ja-sec-nav"><button type="button" class="ja-round" data-rail-prev="${railId}" aria-label="Back">${ic('left')}</button><button type="button" class="ja-round" data-rail-next="${railId}" aria-label="More">${ic('right')}</button></div>` : right}</div>`
}
