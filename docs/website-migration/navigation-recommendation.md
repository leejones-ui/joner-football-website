# Joner Football Navigation Recommendation

Date: 2026-04-29

Goal: keep the new navigation direction, make launch routes complete, and preserve old WordPress URLs through redirects.

## Desktop Nav

### Home

- Label: Home
- URL: `/`

### Training

- Top URL: `/training`
- Dropdown:
  - Training Hub: `/training`
  - JFP Program: `/training#jfp`
  - Professional Training: `/training#pro-training`
  - Joners Juniors: `/training#joners-juniors`
  - Game Analysis: `/training#game-analysis`
  - The HQ: `/hq`

Old WordPress URLs:

- `/jfp/` -> `/training#jfp`
- `/protraining/` -> `/training#pro-training`
- `/jonersjuniors/` -> `/training#joners-juniors`
- `/thehq/` -> `/hq`
- `/2on1-3on1/` -> `/training` or `/training#jfp`
- `/joner-1on1-skills-clinics/` -> `/training` or `/training#jfp`
- `/training-enquiries/` -> `/training#jfp-form`
- `/junior-general-enquiries/` -> `/training#joners-juniors`

### Camps

- Top URL: `/camps`
- Dropdown:
  - All Camps: `/camps`
  - LA Complete Player Experience: `/camps/la-tcpe-june`
  - Houston Camp: `/camps/texas-houston-june`
  - Dallas Camp: `/camps/texas-dallas-june`
  - Sydney July Camp: `/camps/sydney-big-1-july`
  - Melbourne 2026: add only if Lee confirms it remains public

Do not show:

- Sacramento April 2026
- Portland April 2026
- Old January, April 2025, or October 2024 camp pages

Old WordPress URLs:

- `/elitecampbookings/` -> `/camps`
- `/thecompleteplayerexperience/` -> `/camps/la-tcpe-june`
- `/houston2026/` -> `/camps/texas-houston-june`
- `/dallas2026/` -> `/camps/texas-dallas-june`
- `/sydneyjuly2026/` -> `/camps/sydney-big-1-july`
- `/elitecampbookings/sydneycamp/` -> `/camps/sydney-big-1-july`
- `/sacramento-california-april-2026/` -> `/camps`
- `/elitecampbookings/speed-camp/` -> `/camps`
- `/elitecampbookings/selectiontrainingday/` -> `/camps`
- `/gold-coast-january-2025/` -> `/camps`
- `/positionspecifictraining/` -> `/training` or `/camps`
- `/californiaprivates/` -> `/camps`

### Workshops

- Top URL: `/workshops`
- Dropdown:
  - Workshops Hub: `/workshops`
  - Online Coaches Course: `/workshops/coaches-course`
  - Mindset Seminars: `/workshops/mindset-seminars`
  - Coaches Experience: future page only if active

Old WordPress URLs:

- `/jfonlinecoachescourse/` -> `/workshops/coaches-course`
- `/mindsetseminar/` -> `/workshops/mindset-seminars`
- `/coachesexperience/` -> `/workshops/coaches-course` or future `/workshops/coaches-experience`
- `/coaches-exp-terms-agreement/` -> `/terms` or an archive page

### JF APP

- Top URL: `/app`
- Dropdown:
  - JF APP: `/app`
  - 100 Day Program: `/programmes`
  - For The Coaches: `/app/for-coaches`
  - Team Subscriptions: `/teams`
  - Free Section: `https://app.jonerfootball.com/categories/category-vpi8uazway4`

CTA:

- Button label: Download the App or Try the App Free
- URL: `/app`

Old WordPress and app URLs:

- `/app/` -> `/app`
- `/join/` -> `/app` or `/programmes` depending on final paid-offer strategy
- `https://app.jonerfootball.com/pages/jfapp?id=jfapp` remains external
- `https://app.jonerfootball.com/join` remains external
- `https://app.jonerfootball.com/categories/category-vpi8uazway4` remains external free section
- `https://app.jonerfootball.com/checkout/new?o=205911` remains external free bundle checkout if approved

### Shop

- Top URL: `/shop`
- Dropdown recommendation:
  - Shop Hub: `/shop`
  - Apparel: `https://apparel.jonerfootball.com`
  - Off Field Apparel: `https://apparel.jonerfootball.com/offfield/`
  - On Field Training Gear: final approved URL, currently `https://deployfootball.com` from apparel site nav
  - Apparel Help: `https://apparel.jonerfootball.com/helpandinfo/`
  - Training App: `/app`
  - 100 Day Program: `/programmes`

Important:

- Do not put old digital WooCommerce products into the main nav until the shop strategy is decided.
- Do not 404 old product URLs.
- Keep apparel checkout external for launch.

Old WordPress shop URLs:

- `/shop/` -> `/shop`
- `/product/6-week-passing-1st-touch-program/` -> needs decision
- `/product/12-weeks-advanced-football-specific-strength-conditioning/` -> needs decision
- `/product/all-1-on-1-videos/` -> needs decision
- `/product/buy-all-of-the-training-tools/` -> needs decision
- `/product/improve-fast-feet-in-7-days-full-program/` -> needs decision
- `/product/buy-all-of-the-speed-agility-drills/` -> needs decision
- `/product/buy-all-of-the-shooting-drills/` -> needs decision
- `/product-category/1st-touch-drills/` -> needs decision
- `/product-category/passing-drills/` -> needs decision
- `/product-category/shooting-drills/` -> needs decision
- `/product-category/online-training-programs/` -> needs decision

### More

- Top URL: `/about`
- Dropdown:
  - About Lee: `/about`
  - Coaching Team: `/about#coaching-team`
  - Contact: `/about#contact`
  - Blog: `/blog`
  - Joner Football Hub: `/hub`
  - Technique Test: `/technique-test`
  - Privacy: `/privacy`
  - Terms: `/terms`

Old WordPress URLs:

- `/lee-jones-head-coach-owner/` -> `/about`
- `/our-coaches/` -> `/about#coaching-team`
- `/generel-enquiries/` -> `/about#contact`
- `/new-coaching-role/` -> `/about#contact`

## Mobile Nav

Mobile should be grouped by intent, not as a flat long list.

Suggested mobile order:

1. Home
2. Training
   - Training Hub
   - JFP Program
   - Professional Training
   - Joners Juniors
   - The HQ
3. Camps
   - All Camps
   - LA
   - Houston
   - Dallas
   - Sydney
4. JF APP
   - JF APP
   - 100 Day Program
   - For Coaches
   - Teams
5. Workshops
   - Workshops Hub
   - Coaches Course
   - Mindset Seminars
6. Shop
   - Shop Hub
   - Apparel
   - Off Field
   - On Field
7. More
   - About
   - Blog
   - Hub
   - Technique Test
   - Contact

Mobile sticky CTA:

- Keep one bottom CTA only.
- Preferred label: Try The App Free
- URL: `/app`

## Footer Nav

Primary footer links:

- Training: `/training`
- Camps: `/camps`
- App: `/app`
- Workshops: `/workshops`
- Shop: `/shop`
- About: `/about`
- Blog: `/blog`
- Teams: `/teams`
- Contact: `/about#contact`

Secondary footer links:

- The HQ: `/hq`
- 100 Day Program: `/programmes`
- For Coaches: `/app/for-coaches`
- Technique Test: `/technique-test`
- Privacy Policy: `/privacy`
- Terms and Conditions: `/terms`
- Apparel Help: `https://apparel.jonerfootball.com/helpandinfo/`

Social footer:

- Instagram: `https://www.instagram.com/jonerfootball/`
- YouTube: `https://www.youtube.com/@jonerfootball`
- TikTok: `https://www.tiktok.com/@jonerfootball`
- Facebook: `https://www.facebook.com/Jonerfootball/`
- X: `https://twitter.com/jonerfootball`
- Threads: `https://www.threads.net/@jonerfootball`

## Redirect Priority

### Priority 1: Must Have Before DNS

- `/jfp/`
- `/protraining/`
- `/jonersjuniors/`
- `/thehq/`
- `/elitecampbookings/`
- `/thecompleteplayerexperience/`
- `/houston2026/`
- `/dallas2026/`
- `/sydneyjuly2026/`
- `/jfonlinecoachescourse/`
- `/mindsetseminar/`
- `/app/`
- `/join/`
- `/training-enquiries/`
- `/generel-enquiries/`
- `/junior-general-enquiries/`
- `/lee-jones-head-coach-owner/`
- `/our-coaches/`

### Priority 2: Shop/Product URLs, Do Not Guess

These need a commercial decision before redirecting:

- `/shop/`
- `/product/...`
- `/product-category/...`
- Cart, checkout, account, and order URLs if they exist

Recommendation: keep the old shop system reachable until Lee confirms all digital product revenue paths are replaced or intentionally retired.

### Priority 3: Old Campaign/Event URLs

- Sacramento, Portland, speed clinic, Gold Coast, selection day, California privates, coaches experience, old terms pages.

Recommendation: redirect to the nearest active hub if no archive is needed.

## Nav Cleanups In Current Astro Source

Current source already mostly follows this structure in `src/components/Nav.astro`.

Recommended adjustments:

- Hide or de-emphasize `/app/for-coaches` until the page is fully production-ready.
- Add external shop sublinks only if the dropdown is added. Otherwise keep `/shop` as the only top nav link and make `/shop` a strong router.
- Add Melbourne only if Lee confirms October 2026 should stay public.
- Keep Contact under More and footer, not top-level desktop nav, unless Lee wants enquiries front and center.
- Use `Download the App` or `Try the App Free` consistently. Avoid mixing too many CTA labels.
