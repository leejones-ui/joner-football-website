import { existsSync, readFileSync } from 'node:fs'

const appPagePath = 'src/pages/app.astro'
const source = readFileSync(appPagePath, 'utf8')

const required = [
  'KNOW EXACTLY WHAT TO TRAIN EVERY DAY.',
  'data-hero-device-carousel',
  '/images/home-storyboard/06-app-header-video-desktop.mp4',
  '/images/app/joner-app-main-ipad-current-transparent.png',
  '/images/app/joner-app-main-iphone-current-transparent.png',
]

const blocked = [
  'data-scroll-expand-hero',
  '--hero-progress',
  'app-device-layer',
  'development-term',
  'https://res.cloudinary.com/dmzisjwdf/video/upload/v1775278435/joner-website/hero-video.mp4',
]

const missing = required.filter((needle) => !source.includes(needle))
const stale = blocked.filter((needle) => source.includes(needle))

const requiredFiles = [
  'public/images/home-storyboard/06-app-header-video-desktop.mp4',
  'public/images/app/joner-app-main-ipad-current-transparent.png',
  'public/images/app/joner-app-main-iphone-current-transparent.png',
  'public/images/app/joner-app-main-ipad-2026-05-13.png',
]

const missingFiles = requiredFiles.filter((path) => !existsSync(path))

if (missing.length || stale.length || missingFiles.length) {
  console.error('\nJoner app hero guard failed. This prevents the /app hero from silently reverting to the old motion graphic.\n')
  if (missing.length) console.error('Missing required app hero markers:\n- ' + missing.join('\n- '))
  if (stale.length) console.error('Stale blocked app hero markers found:\n- ' + stale.join('\n- '))
  if (missingFiles.length) console.error('Missing required app hero assets:\n- ' + missingFiles.join('\n- '))
  console.error('\nIf Lee/Res approve a future redesign, update scripts/guard-app-hero.mjs in the same commit.\n')
  process.exit(1)
}

console.log('App hero guard passed')
