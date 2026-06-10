// Joner motion system. Dependency-free reveal-on-scroll + hover lift.
// Shared by the homepage and camps pages via the data-motion API:
//   data-motion="fade-up | fade | fade-scale"   single element reveal
//   data-motion-delay="0.12"                    seconds
//   data-motion-stagger                         group wrapper
//   data-motion-stagger-child                   staggered child
//   data-motion-stagger-kind / -step / -amount  group tuning
//   data-motion-hover="lift"                    pointer hover lift
// Uses inline initial styles + WAAPI so it never clobbers CSS transitions
// that components define for their own hover/focus states.

const prefersReduced =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const isSmallViewport =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(max-width: 767px)').matches

const EASE_OUT = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
// Calmer, shorter travel on phones; fuller travel on desktop.
const RISE = isSmallViewport ? '0.85rem' : '1.25rem'
const DURATION = isSmallViewport ? 560 : 700

type FadeKind = 'fade-up' | 'fade' | 'fade-scale'

function readKind(el: Element, fallback: FadeKind = 'fade-up'): FadeKind {
  const v = (el.getAttribute('data-motion') || fallback) as FadeKind
  return v === 'fade' || v === 'fade-scale' ? v : fallback
}

function readDelay(el: Element): number {
  const raw = el.getAttribute('data-motion-delay')
  const n = raw ? parseFloat(raw) : NaN
  return Number.isFinite(n) ? n * 1000 : 0
}

function showInstantly(el: HTMLElement) {
  el.style.opacity = ''
  el.style.transform = ''
}

function setInitial(el: HTMLElement, kind: FadeKind) {
  el.style.opacity = '0'
  if (kind === 'fade-up') el.style.transform = `translate3d(0, ${RISE}, 0)`
  else if (kind === 'fade-scale') el.style.transform = 'scale(0.96)'
}

function keyframesFor(kind: FadeKind): Keyframe[] {
  if (kind === 'fade-up') {
    return [
      { opacity: 0, transform: `translate3d(0, ${RISE}, 0)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ]
  }
  if (kind === 'fade-scale') {
    return [
      { opacity: 0, transform: 'scale(0.96)' },
      { opacity: 1, transform: 'scale(1)' },
    ]
  }
  return [{ opacity: 0 }, { opacity: 1 }]
}

function reveal(el: HTMLElement, kind: FadeKind, delay = 0) {
  if (typeof el.animate !== 'function') {
    showInstantly(el)
    return
  }
  const animation = el.animate(keyframesFor(kind), {
    duration: DURATION,
    delay,
    easing: EASE_OUT,
    fill: 'backwards',
  })
  const settle = () => showInstantly(el)
  animation.addEventListener('finish', settle)
  animation.addEventListener('cancel', settle)
}

type RevealTarget = { run: () => void }

const pending = new Map<Element, RevealTarget>()
const observers = new Map<number, IntersectionObserver>()

function observe(el: Element, amount: number, run: () => void) {
  const threshold = Math.min(Math.max(amount, 0), 0.95)
  let observer = observers.get(threshold)
  if (!observer) {
    observer = new IntersectionObserver(
      (entries, io) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          const target = pending.get(entry.target)
          if (target) {
            pending.delete(entry.target)
            target.run()
          }
          io.unobserve(entry.target)
        })
      },
      { threshold }
    )
    observers.set(threshold, observer)
  }
  pending.set(el, { run })
  observer.observe(el)
}

function setupSingleFades() {
  const nodes = document.querySelectorAll<HTMLElement>('[data-motion]:not([data-motion-stagger-child])')
  nodes.forEach((el) => {
    if (el.closest('[data-motion-stagger]')) return
    const kind = readKind(el)
    if (prefersReduced) {
      showInstantly(el)
      return
    }
    setInitial(el, kind)
    observe(el, 0.2, () => reveal(el, kind, readDelay(el)))
  })
}

function setupStaggers() {
  const groups = document.querySelectorAll<HTMLElement>('[data-motion-stagger]')
  groups.forEach((group) => {
    const children = Array.from(
      group.querySelectorAll<HTMLElement>('[data-motion-stagger-child]')
    ).filter((child) => child.closest('[data-motion-stagger]') === group)

    if (!children.length) return

    if (prefersReduced) {
      children.forEach(showInstantly)
      return
    }

    const rawKind = (group.getAttribute('data-motion-stagger-kind') as FadeKind) || 'fade-up'
    const finalKind: FadeKind = rawKind === 'fade' || rawKind === 'fade-scale' ? rawKind : 'fade-up'
    const baseDelay = readDelay(group)
    const step = parseFloat(group.getAttribute('data-motion-stagger-step') || '0.09') * 1000
    const amount = parseFloat(group.getAttribute('data-motion-amount') || '0.15')

    children.forEach((child) => setInitial(child, finalKind))

    observe(group, amount, () => {
      children.forEach((child, index) => reveal(child, finalKind, baseDelay + step * index))
    })
  })
}

function setupHoverLifts() {
  if (prefersReduced) return
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
  const targets = document.querySelectorAll<HTMLElement>('[data-motion-hover="lift"]')
  const BASE = 'translate3d(0, 0, 0) scale(1)'
  const LIFTED = 'translate3d(0, -4px, 0) scale(1.015)'
  targets.forEach((el) => {
    if (typeof el.animate !== 'function') return
    el.style.transformOrigin = 'center'
    let lift: Animation | null = null
    // Explicit from-keyframe captured before cancel: cancelling a
    // forwards-fill animation reverts the element to base first, so an
    // implicit from would resolve to base and the tween would render as
    // a snap instead of easing from the in-flight position.
    const animateTo = (target: string, duration: number) => {
      const from = getComputedStyle(el).transform
      lift?.cancel()
      return el.animate(
        [{ transform: from === 'none' ? BASE : from }, { transform: target }],
        { duration, easing: EASE_OUT, fill: 'forwards' }
      )
    }
    el.addEventListener('pointerenter', () => {
      lift = animateTo(LIFTED, 320)
    })
    el.addEventListener('pointerleave', () => {
      const done = animateTo(BASE, 420)
      lift = done
      done.addEventListener('finish', () => {
        // Release the element back to stylesheet control once settled;
        // target equals base so dropping the fill cannot snap.
        if (lift === done) {
          done.cancel()
          lift = null
        }
      })
    })
  })
}

function init() {
  setupSingleFades()
  setupStaggers()
  setupHoverLifts()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true })
} else {
  init()
}
