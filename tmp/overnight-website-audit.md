# Overnight website audit — Tue 2026-05-05

Repo: `/Users/jonerai/joner-football-website`  
Requested preview: `https://joner-football-website-13d15ibk8-leejones-6826s-projects.vercel.app/`  
Commit pushed: `d97b558 Fix missing website media references`

## Access / scope

- The supplied Vercel preview URL returned `401 Unauthorized` for public page requests, so I audited the built static site locally from `dist/` after `npm run build`.
- Crawled all 50 sitemap pages locally.
- Desktop first: homepage/storyboard, nav/menu, CTAs, media, console/network, overflow checks on key pages.
- Mobile smoke check: homepage, join, camps, training at 390px.
- No DNS, domain, credentials, env, or config changes made.

## Fixed

Fixed 3 real local 404 media references and pushed to `main`:

1. `src/pages/workshops/coaches-course.astro`
   - `/images/coaching-session.webp` → `/images/coaches-only/coaching-the-coaches.png`
   - `/images/coaches-course-preview.webp` → `/images/coaches-only/session-planning.png`
2. `src/pages/shop/training-programs.astro`
   - `/images/programmes/programme-hero.webp` → `/images/programmes/100-day/hero-2.png`

Verification after fix:

- `npm run build` passes.
- Local sitemap crawl: 50/50 pages returned 200.
- Local asset HEAD crawl: 105/105 local assets returned 200.

## Build status

Latest build after fixes: ✅ pass

Notes from Astro build:

- Existing warning: route conflict for `/camps/la-tcpe-june` because both `/camps/[slug]` and `/camps/la-tcpe-june.astro` can render it. Build still completes.
- Existing Vite warning about unused Astro internal helper imports. Build still completes.

## Desktop audit notes

### Homepage / storyboard

- Section 06 app video asset loads locally and has valid metadata:
  - `src: /images/home-storyboard/06-app-header-video-desktop.mp4`
  - `readyState: 4`, `videoWidth: 1280`, `videoHeight: 544`
- In automated playback, the section 06 video advanced briefly (`currentTime ~0.47s`) but then reported `paused: true` in headless Chromium. Needs a real-browser/manual check on the deployed preview because autoplay policies/headless behaviour can differ.
- Visual pass found bigger product/design issues that I did **not** change because they need judgement:
  - Storyboard 06/07 transition can feel visually confusing: active rail and visible content appear slightly out of sync around the app/HQ transition in scroll screenshots.
  - “Choose Your Next Step” action section has large oversized typography and some clipping/overlap with the left story rail on desktop.
  - App/pathway graphic begins close under the sticky header in screenshots; may need more top padding/scroll offset.
  - “Inside Joner Football” YouTube area appears very tall/cropped in viewport screenshots, with a large black/empty gap before footer/newsletter.
- Full-page screenshot compression made the homepage look like it had huge blank gaps; viewport screenshots showed the main issue is section spacing/cropping around late storyboard/video/footer areas, not a totally missing page.

### Nav / CTAs

- Desktop nav renders and key links are present.
- CTA links are present across checked pages.
- Several external/legacy commerce links still point to old/live domains such as `jonerfootball.com/product/...`, `app.jonerfootball.com`, Shopify/apparel URLs. I did not change these because they may be intentional revenue links.

### Console / network

- No page JS runtime exceptions found in the local crawl.
- Console 404s before the fix came from the 3 missing local image references above; fixed.
- Some GA requests and one Cloudinary video request appeared as `net::ERR_ABORTED` in headless checks; not treated as site breakage.

## Mobile smoke notes

- Mobile menu opens and shows large tap targets; it is scrollable and usable.
- Mobile homepage is basically usable but still feels tall/sparse.
- Mobile issues to consider later:
  - Header/logo/hamburger are visually small.
  - Some hero/story text is low contrast on imagery.
  - Timeline/rail decoration consumes horizontal space and can make sections feel tight.
  - “Choose Your Next Step” buttons/grid are crowded.
  - Same late-page video/footer spacing concerns as desktop.

## Still broken / needs decision

Priority order:

1. **Deploy-preview access:** supplied Vercel preview returns 401; latest deployed preview needs to be checked once accessible.
2. **Homepage late-storyboard polish:** desktop section 06 → 07 → action transition needs manual/product design review before changing.
3. **Inside Joner Football embed spacing/crop:** likely CSS/layout tuning, but needs desired visual direction.
4. **Route conflict:** decide whether `/camps/la-tcpe-june.astro` or Sanity/generated `/camps/[slug]` owns that URL.
5. **Legacy external shop/product links:** confirm whether old product URLs should remain or migrate into the new site/app/shop flow.
6. **Mobile polish:** after desktop is nailed, tighten header sizing, contrast, rail spacing, CTA/button density.

## Latest preview URL

- Latest known requested preview URL: `https://joner-football-website-13d15ibk8-leejones-6826s-projects.vercel.app/`
- It was inaccessible to this audit session due to `401 Unauthorized`.
- I pushed `main` at commit `d97b558`; Vercel should create a new deployment from that commit if Git integration is active, but I could not confirm the new URL from the CLI in this session.
