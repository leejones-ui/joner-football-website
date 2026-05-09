import { animate, inView, hover, stagger } from 'framer-motion/dom'

const prefersReduced =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const EASE_OUT = [0.22, 0.61, 0.36, 1] as const

type FadeKind = 'fade-up' | 'fade' | 'fade-scale'

function readKind(el: Element): FadeKind {
  const v = (el.getAttribute('data-motion') || 'fade-up') as FadeKind
  return v === 'fade' || v === 'fade-scale' ? v : 'fade-up'
}

function readDelay(el: Element): number {
  const raw = el.getAttribute('data-motion-delay')
  const n = raw ? parseFloat(raw) : NaN
  return Number.isFinite(n) ? n : 0
}

function setInitial(el: HTMLElement, kind: FadeKind) {
  el.style.willChange = 'opacity, transform'
  el.style.opacity = '0'
  if (kind === 'fade-up') el.style.transform = 'translate3d(0, 1.25rem, 0)'
  else if (kind === 'fade-scale') el.style.transform = 'scale(0.96)'
  else el.style.transform = 'none'
}

function clearInitial(el: HTMLElement) {
  el.style.willChange = ''
}

function animateInto(el: HTMLElement, kind: FadeKind, delay = 0) {
  const keyframes: Record<string, (string | number)[]> = { opacity: [0, 1] }
  if (kind === 'fade-up') keyframes.transform = ['translate3d(0, 1.25rem, 0)', 'translate3d(0, 0, 0)']
  else if (kind === 'fade-scale') keyframes.transform = ['scale(0.96)', 'scale(1)']

  return animate(el, keyframes, {
    duration: 0.7,
    delay,
    ease: EASE_OUT as unknown as number[],
  })
}

function setupSingleFades() {
  const nodes = document.querySelectorAll<HTMLElement>('[data-motion]:not([data-motion-stagger-child])')
  nodes.forEach((el) => {
    if (el.closest('[data-motion-stagger]')) return
    const kind = readKind(el)
    if (prefersReduced) {
      el.style.opacity = '1'
      el.style.transform = 'none'
      return
    }
    setInitial(el, kind)
    inView(
      el,
      () => {
        const controls = animateInto(el, kind, readDelay(el))
        controls.then?.(() => clearInitial(el))
        return () => {}
      },
      { amount: 0.2 }
    )
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
      children.forEach((c) => {
        c.style.opacity = '1'
        c.style.transform = 'none'
      })
      return
    }

    const kind = (group.getAttribute('data-motion-stagger-kind') as FadeKind) || 'fade-up'
    const baseDelay = readDelay(group)
    const step = parseFloat(group.getAttribute('data-motion-stagger-step') || '0.09')
    const amount = parseFloat(group.getAttribute('data-motion-amount') || '0.15')

    children.forEach((child) => setInitial(child, kind))

    const keyframes: Record<string, (string | number)[]> = { opacity: [0, 1] }
    if (kind === 'fade-up') keyframes.transform = ['translate3d(0, 1.25rem, 0)', 'translate3d(0, 0, 0)']
    else if (kind === 'fade-scale') keyframes.transform = ['scale(0.96)', 'scale(1)']

    inView(
      group,
      () => {
        const controls = animate(children, keyframes, {
          duration: 0.7,
          delay: stagger(step, { startDelay: baseDelay }),
          ease: EASE_OUT as unknown as number[],
        })
        controls.then?.(() => children.forEach(clearInitial))
        return () => {}
      },
      { amount }
    )
  })
}

function setupHoverLifts() {
  if (prefersReduced) return
  const targets = document.querySelectorAll<HTMLElement>('[data-motion-hover="lift"]')
  targets.forEach((el) => {
    el.style.transformOrigin = 'center'
    hover(el, () => {
      animate(el, { transform: 'translate3d(0, -4px, 0) scale(1.015)' }, { duration: 0.32, ease: EASE_OUT as unknown as number[] })
      return () => {
        animate(el, { transform: 'translate3d(0, 0, 0) scale(1)' }, { duration: 0.42, ease: EASE_OUT as unknown as number[] })
      }
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
