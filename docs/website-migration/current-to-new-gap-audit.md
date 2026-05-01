# Joner Football Current To New Website Gap Audit

Date: 2026-04-29

Scope: public website migration audit from the current WordPress site at `https://jonerfootball.com` to the new Astro site source in this repo, intended for the Vercel staging site at `https://joner-football-website.vercel.app`.

Important note: the shell environment could not resolve public hosts, and the browser fetch for the Vercel staging URL did not return a document. New-site comparison is therefore based on the local Astro source in `/Users/jonerai/joner-football-website`, which appears to be the staging source. Current-site findings come from public WordPress pages and search-indexed public content only. No admin, payment, DNS, Vercel, checkout, or private pages were accessed.

## Executive Summary

The new Astro site has a stronger structure than the current WordPress navigation and already covers most launch-critical routes: homepage, training, camps, camp detail pages, app, HQ, about, workshops, coaches course, mindset seminars, shop, teams, blog, privacy, and terms.

The main launch risk is not page count. It is factual reconciliation and preservation:

- Camp details need final verification. WordPress hub lists LA as June 22-24, 2026, but an older live LA detail page still says April 7-9, 2026. The new site uses June 22-24, 2026, matching the launch brief and the WordPress hub. Mark LA detail as needs verification before publishing.
- April Sacramento and Portland camp pages still exist on WordPress and should not remain in new public nav. Since those camps are finished as of 2026-04-29, they should redirect to `/camps` or a past-camps/closed state, not be promoted.
- WordPress also lists Melbourne October 2026 as coming soon on the camps hub. The new site currently omits Melbourne. Decide whether to add a coming soon card or intentionally leave it out.
- New camp detail pages currently use placeholder main payment links to `https://app.jonerfootball.com` in fallbacks and seed data. Do not launch camp registration until actual payment/checkout routing is confirmed.
- The shop is the biggest migration risk. Current WordPress has digital WooCommerce products under `jonerfootball.com/product/...` and `product-category/...`. Apparel is on `apparel.jonerfootball.com`, with Off Field and On Field split, and On Field links to `deployfootball.com`. The new `/shop` page is a high-level routing page only. It does not preserve digital product paths or category paths.
- App pricing varies by region. WordPress and Uscreen show specific prices, but Lee's rule is not to show exact app prices on the marketing site. The new app page still has no exact monthly/annual display in the main content, but CTAs point to specific Uscreen checkout offers. That is probably fine if Lee approves, but marketing copy should keep saying free trial / view plans.
- Public WordPress app content contains several embedded videos. The new app page uses a Cloudinary hero video and screenshots, but it does not copy all WordPress app section videos. Decide whether to preserve, replace, or intentionally simplify.
- New forms use site-side Brevo/subscribe handlers for many marketing forms. Old WordPress forms are more specific, and camp forms included payment method selection. Before DNS, confirm every lead form lands in the right list, sheet, and notification route.

## Recommended Final Navigation

This is the recommended production nav based on the new direction, with old URLs mapped through redirects rather than exposed.

Desktop top nav:

- Home: `/`
- Training: `/training`
  - Training Hub: `/training`
  - JFP Program: `/training#jfp`
  - Professional Training: `/training#pro-training`
  - Joners Juniors: `/training#joners-juniors`
  - Game Analysis: `/training#game-analysis`
  - The HQ: `/hq`
- Camps: `/camps`
  - LA Complete Player Experience: `/camps/la-tcpe-june`
  - Houston Camp: `/camps/texas-houston-june`
  - Dallas Camp: `/camps/texas-dallas-june`
  - Sydney July Camp: `/camps/sydney-big-1-july`
  - Melbourne 2026: add only if Lee confirms it stays public
- Workshops: `/workshops`
  - Online Coaches Course: `/workshops/coaches-course`
  - Mindset Seminars: `/workshops/mindset-seminars`
  - Coaches Experience: future page or redirect to coaches course if not active
- JF APP: `/app`
  - JF APP: `/app`
  - 100 Day Program: `/programmes`
  - For The Coaches: `/app/for-coaches`
  - Teams and Clubs: `/teams`
  - Free Section: external `https://app.jonerfootball.com/categories/category-vpi8uazway4`
- Shop: `/shop`
  - Apparel: `https://apparel.jonerfootball.com`
  - Off Field: `https://apparel.jonerfootball.com/offfield/`
  - On Field: `https://deployfootball.com` or the final approved on-field shop URL
  - Digital Products: decision needed. Either retain WooCommerce, migrate into Uscreen/app, or redirect category pages to `/app` / `/programmes`.
- More:
  - About: `/about`
  - Blog: `/blog`
  - Hub: `/hub`
  - Technique Test: `/technique-test`
  - Contact: `/about#contact`
  - Privacy: `/privacy`
  - Terms: `/terms`

Mobile nav should keep the same grouping but expose fewer nested links per group:

- Training: Training Hub, JFP, Pro Training, Juniors, HQ
- Camps: All Camps plus the four active 2026 camp detail pages
- JF APP: App, 100 Day, For Coaches, Teams
- More: About, Blog, Hub, Contact

Footer nav should be simpler and utility-led:

- Training
- Camps
- App
- Workshops
- Shop
- About
- Blog
- Teams
- Contact
- Privacy
- Terms

## Public WordPress Inventory

### Core Site

| Current page | Current URL | New target | Status |
| --- | --- | --- | --- |
| Homepage | `https://jonerfootball.com/` | `/` | New page exists. Needs final image/video parity check and source content reconciliation. |
| About Lee | `https://jonerfootball.com/lee-jones-head-coach-owner/` | `/about` | New page exists but is condensed. Preserve important Lee biography/resume details as a longer About or History section. |
| Our Coaches | `https://jonerfootball.com/our-coaches/` | `/about#coaching-team` or `/about` | Old page is mostly Instagram feed. New about has a team section but no individual coach profiles. |
| General enquiries | `https://jonerfootball.com/generel-enquiries/` | `/about#contact` | Redirect typo URL. New contact forms exist. |
| Training enquiries | `https://jonerfootball.com/training-enquiries/` | `/training#jfp-form` or `/about#contact` | Redirect to training form. |
| Junior enquiries | `https://jonerfootball.com/junior-general-enquiries/` | `/training#joners-juniors` or `/about#contact` | Redirect to Juniors or contact tab. |
| Coaching role | `https://jonerfootball.com/new-coaching-role/` | `/about#contact` coaching tab | New page has coaching application form but not the full job requirements. Preserve role copy if hiring is active. |
| HQ | `https://jonerfootball.com/thehq/` | `/hq` | New page exists and is stronger. Keep address and training application path. |

Source URLs:

- Homepage: `https://jonerfootball.com/`
- About Lee: `https://jonerfootball.com/lee-jones-head-coach-owner/`
- Our Coaches: `https://jonerfootball.com/our-coaches/`
- General enquiries: `https://jonerfootball.com/generel-enquiries/`
- Training enquiries: `https://jonerfootball.com/training-enquiries/`
- Junior enquiries: `https://jonerfootball.com/junior-general-enquiries/`
- Coaching role: `https://jonerfootball.com/new-coaching-role/`
- HQ: `https://jonerfootball.com/thehq/`

### Training And Programme Pages

| Current page | Current URL | New target | Status |
| --- | --- | --- | --- |
| JFP | `https://jonerfootball.com/jfp/` | `/training#jfp` | New training page contains most core copy. Verify exact current term details, group limits, and location wording. |
| Professional Training | `https://jonerfootball.com/protraining/` | `/training#pro-training` | New section has summary and form. Old page mentions Alex Robbo and Adrian Segacic video/players trained. Preserve if still approved. |
| Joners Juniors | `https://jonerfootball.com/jonersjuniors/` | `/training#joners-juniors` | New section has classes and form. WordPress search result says Term 1 dates May 2 to July 4, 2026, while a live page fetch showed older Jan 31 to Apr 4 dates. Needs verification. |
| Elite Small Group Training | `https://jonerfootball.com/2on1-3on1/` | `/training` or `/training#jfp` | Old standalone page is not represented as its own new page. Decide if it should be a section under Training. |
| JF Skills Program | `https://jonerfootball.com/joner-1on1-skills-clinics/` | `/training` or redirect to `/training#jfp` | Old 2021 content. Likely redirect unless Lee says active. |
| California privates | `https://jonerfootball.com/californiaprivates/` | `/camps` or closed redirect | Old date and location. Redirect to camps unless recurring. |

Training facts to carry or verify:

- JFP has run since 2013.
- JFP is for ages 8+ and all ability levels.
- JFP operates Monday to Saturday on a term-by-term basis.
- Afternoon sessions are at the indoor HQ in Belrose.
- Morning sessions are at North Turramurra and Rydalmere Park.
- JFP groups are limited to 6 players per group.
- Joners Juniors is for boys and girls from ages 3 to early primary.
- Joners Juniors contact email: `jonersjuniors@jonerfootball.com`.
- Dean McDonnell is Head Coach of JFP, phone `0426 885 924`.

Source URLs:

- JFP: `https://jonerfootball.com/jfp/`
- Pro Training: `https://jonerfootball.com/protraining/`
- Juniors: `https://jonerfootball.com/jonersjuniors/`
- Elite Small Group Training: `https://jonerfootball.com/2on1-3on1/`
- JF Skills Program: `https://jonerfootball.com/joner-1on1-skills-clinics/`
- California privates: `https://jonerfootball.com/californiaprivates/`

### Camps

Current WordPress hub: `https://jonerfootball.com/elitecampbookings/`

New target hub: `/camps`

Current active/new-site camp comparison:

| Camp | WordPress source | New route | Gap |
| --- | --- | --- | --- |
| LA Complete Player Experience | Hub says June 22-24, 2026 at Gol Soccer Complex. Detail page still says April 7-9, 2026. | `/camps/la-tcpe-june` | Date conflict. New uses June 22-24. Needs Lee verification, then old detail URL redirect. |
| Houston World Cup Camp | `https://jonerfootball.com/houston2026/` | `/camps/texas-houston-june` | New page is close. Verify all day options, jersey cutoff, payment links, partner names. |
| Dallas World Cup Camp | `https://jonerfootball.com/dallas2026/` | `/camps/texas-dallas-june` | New page is close. Preserve World Sport FC, Aaron Lopez, Armando Pelaez if approved. Verify payment links. |
| Sydney July Camp ft Miguel Grande | `https://jonerfootball.com/sydneyjuly2026/` plus old indexed `/elitecampbookings/sydneycamp/` | `/camps/sydney-big-1-july` | New page is close. Verify max capacity typo on WordPress, JFP priority spots, day options, jersey wording. |
| Melbourne October 2026 | Listed on hub as coming soon | Missing | Decision needed. Add coming soon card or intentionally omit. |
| Sacramento April 2026 | `https://jonerfootball.com/sacramento-california-april-2026/` | Redirect to `/camps` | Finished before launch. Do not expose. Preserve redirect. |
| Portland April 2026 | likely old nav/detail URL, exact slug not surfaced by search | Redirect to `/camps` | Finished before launch. Do not expose. Preserve if old slug is known from WP. |
| Speed Clinic | `https://jonerfootball.com/elitecampbookings/speed-camp/` | Redirect to `/camps` or archive | Old January event. Do not expose. |
| Selection Training Day LA April 2025 | `https://jonerfootball.com/elitecampbookings/selectiontrainingday/` | Redirect to `/camps` or LA camp | Old 2025 event. |
| Gold Coast Jan 2025 postponed | `https://jonerfootball.com/gold-coast-january-2025/` | Redirect to `/camps` or archive | Old postponed event. |
| Position Specific Oct 2024 | `https://jonerfootball.com/positionspecifictraining/` | Redirect to `/training` or `/camps` | Old event. |

Camp facts to preserve:

- Camps are grouped by age and skill or age and ability.
- Most camps use max 16 players per coach language.
- Camp players bring football boots, shin guards, drink bottle, waterproof jacket, black shorts, white socks, and a good attitude.
- Refund policy on old camp pages says full refunds within 14 days of camp start date.
- Final day photo/autograph time is expected on several camp pages.
- Jersey inclusion varies by camp and day count. Do not generalize without confirming.

Critical camp gaps in new site:

- `tmp-camps-seed.json` and `src/pages/camps/[slug].astro` fallback data use `stripePaymentLink: "https://app.jonerfootball.com"` for all camps. This is not an actual camp checkout link.
- Sanity schema supports `dayPaymentLinks`, `stripePaymentLink`, and `paypalPaymentLink`, but source data must be filled before launch.
- Camp registration form must be tested end to end into the correct Google Sheet tab and Brevo list.
- Sanity fallback title exclusion code suggests generic Sanity drafts may be ignored. Verify production Sanity docs override fallback data as expected.

Source URLs:

- Camps hub: `https://jonerfootball.com/elitecampbookings/`
- LA detail: `https://jonerfootball.com/thecompleteplayerexperience/`
- Houston detail: `https://jonerfootball.com/houston2026/`
- Dallas detail: `https://jonerfootball.com/dallas2026/`
- Sydney detail: `https://jonerfootball.com/sydneyjuly2026/`
- Old Sydney indexed detail: `https://jonerfootball.com/elitecampbookings/sydneycamp/`
- Sacramento detail: `https://jonerfootball.com/sacramento-california-april-2026/`
- Speed clinic: `https://jonerfootball.com/elitecampbookings/speed-camp/`
- Selection day: `https://jonerfootball.com/elitecampbookings/selectiontrainingday/`
- Gold Coast: `https://jonerfootball.com/gold-coast-january-2025/`
- Position Specific: `https://jonerfootball.com/positionspecifictraining/`

### Workshops

| Current page | Current URL | New target | Status |
| --- | --- | --- | --- |
| Online Coaches Course | `https://jonerfootball.com/jfonlinecoachescourse/` | `/workshops/coaches-course` | New page exists and is much richer. It also adds claims like certificate, direct Q&A, community access, and business module. Verify before launch. |
| Online Mindset Seminar | `https://jonerfootball.com/mindsetseminar/` | `/workshops/mindset-seminars` | New page exists but lacks some WordPress specifics. Preserve if active: age 12+, Zoom, Lee's wife is qualified Counsellor and Psychotherapist, booklet, app access, timezone guidance, refund terms. |
| Coaches Experience Texas | `https://jonerfootball.com/coachesexperience/` | Missing or redirect to `/workshops/coaches-course` | Event was 2025. If future coaches experiences continue, create `/workshops/coaches-experience` later. |
| Coaches Experience terms | `https://jonerfootball.com/coaches-exp-terms-agreement/` | Missing or terms archive | Preserve only if needed for old event/payment records. |

Workshop gaps:

- New `/workshops` hub exists and is structurally strong.
- New coaches course hero uses `/images/coaching-session.webp` and `/images/coaches-course-preview.webp`, which are not present in the public image listing. This likely breaks images unless assets exist outside the listing. Replace with existing `/images/training/jfp-session.webp` or add verified assets.
- New coaches course has `data-payment="pending"` in the Apply Now CTA. That is a visible implementation marker and should be removed or wired.
- New mindset page has an explicit "Seminar photo coming soon" placeholder. Needs real image or no framed placeholder.

Source URLs:

- Online Coaches Course: `https://jonerfootball.com/jfonlinecoachescourse/`
- Mindset Seminar: `https://jonerfootball.com/mindsetseminar/`
- Coaches Experience: `https://jonerfootball.com/coachesexperience/`
- Coaches Experience terms: `https://jonerfootball.com/coaches-exp-terms-agreement/`

### App And Programmes

| Current page | Current URL | New target | Status |
| --- | --- | --- | --- |
| WordPress app page | `https://jonerfootball.com/app/` | `/app` | New app page exists and is more modern. It omits some WordPress videos and some detailed FAQ content. |
| WordPress pricing page | `https://jonerfootball.com/join/` | `/app`, `/programmes`, `/teams`, `/app/for-coaches` | Do not show exact app prices on new marketing site. Redirect carefully. |
| Uscreen app landing page | `https://app.jonerfootball.com/pages/jfapp?id=jfapp` | External app ecosystem | Do not migrate checkout/admin. Use as source for feature copy and app links only. |
| Uscreen join | `https://app.jonerfootball.com/join` | External app checkout | Keep external. Do not copy region-specific prices. |
| Free bundle / free section | `https://app.jonerfootball.com/categories/category-vpi8uazway4` and indexed checkout `https://app.jonerfootball.com/checkout/new?o=205911` | External free CTA | Keep free section link approved by brief. |
| 100 Day Program | current WP pricing mentions it, app page references programs | `/programmes` | New route exists and is substantial. Verify guarantee and annual-only claims with Lee. |
| For Coaches | WordPress app has coaches section detail | `/app/for-coaches` | New route exists but says page will be built stronger later. Needs more production-ready copy if it remains in nav. |
| Teams and Clubs | WordPress join page has Club Subscriptions section | `/teams` | New route exists. Needs form routing verification and "custom pricing" only. |

App content to preserve or verify:

- "Designed for players and coaches of all levels."
- Programs designed for you.
- Position specific training.
- Coaching and community.
- Free to watch content.
- Coaches Only Section.
- Team Training, Group Training, Session Planning.
- Coaching the Coaches.
- Voice Over Series.
- Coaching Professional Players.
- Score More Goals Program.
- Membership perks: weekly new videos, livestream training, offline downloads, community, nutrition, custom programs, direct messaging.
- WordPress app page claims 2.5 million followers and 40 million YouTube views. New about/app copy uses 2.1 million and other stats. Needs one approved source of truth.

Pricing rule:

- Do not display specific app prices on the new marketing website.
- It is acceptable to link to Uscreen "Start Free Trial", "View Plans", "Free Section", and "Coaches Access" if Lee approves the exact offer links.
- Avoid copying WordPress `Monthly $14.99`, `Yearly $129.99`, `Coaches Only $199.99`, or WordPress `/join/` regional prices into new pages.

Source URLs:

- WordPress app: `https://jonerfootball.com/app/`
- WordPress pricing: `https://jonerfootball.com/join/`
- Uscreen landing: `https://app.jonerfootball.com/pages/jfapp?id=jfapp`
- Uscreen join: `https://app.jonerfootball.com/join`
- Free section: `https://app.jonerfootball.com/categories/category-vpi8uazway4`
- Free bundle checkout indexed publicly: `https://app.jonerfootball.com/checkout/new?o=205911`

### Shop

Current shop surfaces are split across:

- Digital products on `https://jonerfootball.com/shop/`
- Digital product/category paths on `https://jonerfootball.com/product/...` and `https://jonerfootball.com/product-category/...`
- Apparel on `https://apparel.jonerfootball.com/`
- Apparel category Off Field: `https://apparel.jonerfootball.com/offfield/`
- Apparel On Field nav: `https://deployfootball.com` from apparel site
- Apparel help and policy: `https://apparel.jonerfootball.com/helpandinfo/`

New `/shop` status:

- New page is a route hub with cards for training gear, apparel, app, and books.
- It links both training gear and apparel to `https://apparel.jonerfootball.com`.
- It does not expose old digital products.
- It does not distinguish Off Field from On Field.
- It does not link apparel help/policies.
- It includes book notification form.

Digital WordPress shop products found publicly:

| Product | Current URL | Price on WP | Suggested new handling |
| --- | --- | --- | --- |
| 6 Week Passing and 1st Touch Program | `/product/6-week-passing-1st-touch-program/` | $49.99 AUD | Decide if kept as legacy WooCommerce, migrated into app/programmes, or redirected to `/programmes`. |
| S&C program | `/product/12-weeks-advanced-football-specific-strength-conditioning/` | $49.99 AUD | Likely map to `/programmes` or app S&C section. |
| Buy all Joner Football training videos | `/product/all-1-on-1-videos/` | $500 AUD | Major legacy digital product. Do not lose SEO or customer expectations. |
| Buy all training tools | `/product/buy-all-of-the-training-tools/` | $79.99 AUD | Needs content owner decision. |
| Improve fast feet in 7 days | `/product/improve-fast-feet-in-7-days-full-program/` | $19.99 AUD | Map to app/programmes or retain legacy. |
| Buy all Speed and Agility drills | `/product/buy-all-of-the-speed-agility-drills/` | $69.99 AUD | Map to app category or retain legacy. |
| Buy all passing drills | likely `/product/buy-all-of-the-passing-drills/` | $69.99 AUD on shop grid | Slug needs verification. |
| Buy all Shooting drills | `/product/buy-all-of-the-shooting-drills/` | $89.99 AUD | Map to app category or retain legacy. |

Digital categories found publicly:

- `/product-category/1st-touch-drills/`
- `/product-category/passing-drills/`
- `/product-category/shooting-drills/`
- `/product-category/online-training-programs/`

Apparel products found publicly:

- `https://apparel.jonerfootball.com/product/joner-football-hat-black/`
- `https://apparel.jonerfootball.com/product/joner-football-essential-tee-black/`
- `https://apparel.jonerfootball.com/product/joner-training-shirt-red/`
- `https://apparel.jonerfootball.com/product/tank-top/`
- `https://apparel.jonerfootball.com/product/shorts/`
- `https://apparel.jonerfootball.com/product/joner-football-jogger-pants-black/`
- `https://apparel.jonerfootball.com/product/joner-football-hoodie-black/`
- `https://apparel.jonerfootball.com/product/joner-football-beanie-black/`

Shop migration recommendation:

1. Keep `apparel.jonerfootball.com` live for apparel for now. Do not migrate checkout before DNS switch.
2. New `/shop` should act as a clean router:
   - Apparel: `https://apparel.jonerfootball.com`
   - Off Field: `https://apparel.jonerfootball.com/offfield/`
   - On Field: final approved URL, currently apparel nav points to `https://deployfootball.com`
   - Help and Info: `https://apparel.jonerfootball.com/helpandinfo/`
   - Training App: `/app`
   - 100 Day Program: `/programmes`
3. Decide what happens to digital WooCommerce products before DNS switch:
   - Option A: keep WordPress/WooCommerce under a legacy subdomain such as `legacy.jonerfootball.com` and redirect old product URLs there.
   - Option B: migrate digital products into the app/Uscreen and redirect old product pages to the closest app category or `/programmes`.
   - Option C: rebuild digital product pages in Astro with external checkout links, only if checkout ownership is clear.
4. Do not delete or 404 digital product/category URLs. They are indexed and revenue-related.
5. Preserve apparel policy/help links externally. The new Astro site should not copy shipping/refund policy unless Lee wants a policy mirror.

Source URLs:

- Digital shop: `https://jonerfootball.com/shop/`
- 6 Week Passing: `https://jonerfootball.com/product/6-week-passing-1st-touch-program/`
- S&C: `https://jonerfootball.com/product/12-weeks-advanced-football-specific-strength-conditioning/`
- All training videos: `https://jonerfootball.com/product/all-1-on-1-videos/`
- Training tools: `https://jonerfootball.com/product/buy-all-of-the-training-tools/`
- Fast feet: `https://jonerfootball.com/product/improve-fast-feet-in-7-days-full-program/`
- Speed and Agility drills: `https://jonerfootball.com/product/buy-all-of-the-speed-agility-drills/`
- Shooting drills: `https://jonerfootball.com/product/buy-all-of-the-shooting-drills/`
- Passing category: `https://jonerfootball.com/product-category/passing-drills/`
- 1st touch category: `https://jonerfootball.com/product-category/1st-touch-drills/`
- Shooting category: `https://jonerfootball.com/product-category/shooting-drills/`
- Online training programs category: `https://jonerfootball.com/product-category/online-training-programs/`
- Apparel home: `https://apparel.jonerfootball.com/`
- Apparel off field: `https://apparel.jonerfootball.com/offfield/`
- Apparel help: `https://apparel.jonerfootball.com/helpandinfo/`

### Blog And Resources

Current WordPress site did not expose a visible blog index in the crawl. The new Astro site has an active blog structure with many posts.

New blog status:

- `/blog` exists.
- Static posts exist for drills, first touch, kids training, coach qualities, packing list, coachability, youth mentality, viral drills, parent TikTok warning, different football cultures, coaching ages, 50 ball mastery, and mistakes.
- There is also a dynamic Sanity blog route at `/blog/[slug]`.

Blog gaps:

- New blog is additive rather than migrated from WordPress.
- Verify category taxonomy. New index uses audience groups like Coaches, Players, Parents, while the original brief had Drills, Coaching Tips, Player Development, Camp Stories.
- Confirm no future-dated posts should appear publicly if launch date is before their dates.
- Article schema exists in `src/layouts/BlogPost.astro`.
- Blog images exist for many newer posts, but some original five posts use the layout default image unless specified. Check OG images before launch.

## Page By Page Migration Checklist

### Homepage

New status: `/` exists and uses components for carousel, social proof, audience router, technique test CTA, app showcase, YouTube shorts, camps, testimonials, partners, and email capture.

Checklist:

- Reconcile current WordPress intro copy with new homepage brand story.
- Preserve key WordPress homepage signals: JONER FOOTBALL, Professional Training, JF HQ, World Recognised Camps, Technique Above Everything, Joner Apparel.
- Confirm homepage app CTAs use approved App Store, Google Play, free section, and app links.
- Confirm app badges are real image assets, not custom text blocks, if still required by Lee.
- Verify hero and carousel images are real and current.
- Preserve "Latest Video / Our Training" intent with YouTube Shorts or a featured video.
- Add redirect from old footer About/Our Coaches/Buy Online Drills links.

### Training

New status: `/training` exists with JFP, Pro Training, Juniors, Game Analysis, reports, partnerships, forms, and videos.

Checklist:

- Verify JFP term details and dates.
- Verify Joners Juniors current term dates. Search result and live fetch conflict.
- Verify Juniors second class time. WordPress search result says TBC, fetch showed 10:00am to 10:45am.
- Preserve "maximum 6 players per group" and "grouped by age first, then ability".
- Preserve North Turramurra, Rydalmere Park, HQ Belrose locations.
- Preserve exact JFP application form fields if needed.
- Confirm forms post to correct lists/sheets and email notifications.
- Consider adding Elite Small Group Training content or redirect.
- Verify embedded YouTube videos are the correct training videos.

### Camps

New status: `/camps` plus four dynamic/fallback detail pages exist.

Checklist:

- Remove or redirect finished April camp pages.
- Verify LA dates and detail copy.
- Decide on Melbourne October 2026.
- Verify payment links and day-specific payment options.
- Verify jersey cutoff dates and inclusion rules.
- Verify partner names: First Strike, Kingdom Soccer Training, Grande Sports Training, World Sport FC, Miguel Grande.
- Verify Google Sheet tabs and Brevo list IDs.
- Verify map links and venues.
- Add redirect map for every old camp URL.
- Add closed/past event status if old links still get traffic.

### App

New status: `/app`, `/programmes`, `/app/for-coaches`, and `/teams` exist.

Checklist:

- Do not display specific prices.
- Verify checkout offer IDs in CTAs.
- Keep free section URL exactly: `https://app.jonerfootball.com/categories/category-vpi8uazway4`.
- Preserve important WordPress app feature copy and FAQs.
- Decide whether to preserve WordPress app videos or use new Cloudinary/screenshot assets.
- Verify "world's #1" claim with Lee.
- Reconcile 2.1M vs 2.5M followers and 40M YouTube views.
- Verify 100 Day guarantee wording and annual-only restrictions.
- Make `/app/for-coaches` production-ready if it stays in desktop nav.

### HQ

New status: `/hq` exists with images, facility features, programs, contact, map iframe, and email capture.

Checklist:

- Preserve exact old address wording: 20 Narabang Way, Belrose, Unit 2.
- Confirm phone and email contacts.
- Verify Google Maps iframe renders after deployment.
- Verify "brand new indoor facility" copy is still desired.
- Confirm photos are actual HQ photos.

### About

New status: `/about` exists with Lee story, coaching team, partners, contact tabs, forms.

Checklist:

- Add a fuller Lee biography from WordPress or create a "Lee's Journey" section.
- Preserve playing history and coaching CV in condensed form: Everton, Wrexham, Wales U16/U17, Rhyl FC, UEFA C and B, teaching/community work, A-League trials.
- Preserve references if Lee wants authority proof: Alanna Kennedy, Steve Cooper, Dorothy Langley, David Nickless.
- Add Dean McDonnell section if not already visible in About body.
- Add specific coaching role requirements if the hiring page remains active.
- Remove "individual coach profiles coming soon" if no profiles are ready, or make it a quiet note not a dashed placeholder.

### Workshops

New status: `/workshops`, `/workshops/coaches-course`, `/workshops/mindset-seminars` exist.

Checklist:

- Replace missing coaches-course images.
- Remove pending payment marker.
- Verify coaches course deliverables before showing certificate/direct Q&A/community/business claims.
- Bring Mindset Seminar specifics across if active: age 12+, Zoom, booklet, app access, timezone, recording, parent/guardian policy, 5-day refund.
- Decide if `coachesexperience` gets archived, redirected, or rebuilt for future events.

### Shop

New status: `/shop` exists as router.

Checklist:

- Add Off Field and On Field distinction.
- Add Apparel Help and Info link.
- Add explicit "Digital training resources" decision.
- Redirect old digital product/category URLs. Do not 404.
- Verify external apparel URL and on-field URL with Lee.
- Keep checkout/admin untouched.

### Teams

New status: `/teams` exists.

Checklist:

- Preserve WordPress join page club subscription benefits if approved: multi-seat licences, transferable seats, dedicated community page, single invoice, flexible billing, priority support, usage analytics, dedicated account rep, bespoke plans.
- Verify form goes to correct sales destination.
- Do not invent team pricing.

### Blog

New status: `/blog` exists with many posts.

Checklist:

- Decide whether blog should be in top nav or footer only at launch.
- Verify category taxonomy and dates.
- Verify article images and OG images.
- Add redirect only if WordPress had old blog URLs not found in this crawl.

## Asset And Video Inventory

### Current WordPress image sources to audit visually

The browser text crawl exposes image placeholders and alt labels, but not file URLs. Use these source pages to manually pull or match final assets if needed:

- Homepage hero/slider and camp cards: `https://jonerfootball.com/`
- JFP images and testimonials: `https://jonerfootball.com/jfp/`
- Pro training images and player trained section: `https://jonerfootball.com/protraining/`
- Joners Juniors photos/testimonials: `https://jonerfootball.com/jonersjuniors/`
- HQ photos: `https://jonerfootball.com/thehq/`
- App images: `https://jonerfootball.com/app/`
- Lee history/reference images: `https://jonerfootball.com/lee-jones-head-coach-owner/`
- Camp images by page:
  - `https://jonerfootball.com/elitecampbookings/`
  - `https://jonerfootball.com/houston2026/`
  - `https://jonerfootball.com/dallas2026/`
  - `https://jonerfootball.com/sydneyjuly2026/`
  - `https://jonerfootball.com/thecompleteplayerexperience/`
- Apparel product photos:
  - `https://apparel.jonerfootball.com/`
  - `https://apparel.jonerfootball.com/offfield/`

### Current public videos and embeds found

| Source | URL | Notes |
| --- | --- | --- |
| WordPress app page | `https://jonerfootball.com/app/` | Several video tags exist, but text crawl did not expose MP4 URLs. Need browser/source inspection if preserving exact files. |
| Houston 2026 camp | `https://www.youtube.com/shorts/wSFyNDLu3zc` | Public YouTube Short referenced on Houston page. |
| Passing product preview | `https://www.youtube.com/watch?v=U54fbBkLSLk&t=1271s` | Product preview for 6 Week Passing and 1st Touch Program. |
| S&C product preview | `https://youtu.be/kx6ojLKrWTs?si=jKJeZ5zIE40MLm-2` | Product preview for 12-week S&C program. |
| Mindset seminar | `https://jonerfootball.com/mindsetseminar/` | Page references "sneak peek of our in house mindset seminar" but text crawl did not expose video URL. |

### New site video assets already in source

| New page | URL or ID | Notes |
| --- | --- | --- |
| `/app` hero | `https://res.cloudinary.com/dmzisjwdf/video/upload/v1775278435/joner-website/hero-video.mp4` | Cloudinary hero video. |
| `/training` highlight | `https://www.youtube.com/embed/D13QAvWlZWg` | Also reused on HQ as facility video. Verify it is correct for both. |
| `/training` highlight | `https://www.youtube.com/embed/1a1EOdqwF54` | Pro Soccer Drills. |
| `/training` highlight | `https://www.youtube.com/embed/J8uguy9_OQ4` | Passing Drill Combo. |
| `/camps` highlight | `https://www.youtube.com/embed/P-qQj2J_-mE` | Camp highlight. |
| `/camps` highlight | `https://www.youtube.com/embed/ZEAlkFIzVQc` | Camp highlight. |
| `/camps` highlight | `https://www.youtube.com/embed/oooWE3pAgm8` | Camp highlight. |
| Blog viral drills | `https://www.youtube.com/watch?v=9sbA1vhWSlU&t=4s` | Blog source video. |
| Blog coaching ages | `https://www.youtube.com/watch?v=dcw7bayv3Ok` | Blog source video. |
| Blog ball mastery | `https://www.youtube.com/watch?v=rZ-_7DyDn2g` | Blog source video. |
| Blog TikTok warning | `https://www.youtube.com/watch?v=TXscTcuNNj0` | Blog source video. |

### New site local image inventory to verify visually

Important public folders:

- `public/images/homepage/`
- `public/images/training/`
- `public/images/camps/`
- `public/images/app/`
- `public/images/hq/`
- `public/images/about/`
- `public/images/shop/`
- `public/images/programmes/`
- `public/images/blog/`
- `public/images/partners/`

Potential broken image references:

- `/images/coaching-session.webp` in `src/pages/workshops/coaches-course.astro`
- `/images/coaches-course-preview.webp` in `src/pages/workshops/coaches-course.astro`

These were not present in the `public/images` listing. Replace or add before launch.

## SEO And Redirect Risks

Critical redirect principles:

- Every old WordPress URL with traffic should 301 to a relevant new page.
- Keep `jonerfootball.com` canonical URLs on the new site.
- Do not redirect shop checkout/cart/account URLs to unrelated pages until checkout strategy is clear.
- Do not 404 old product URLs.
- Do not expose finished April camps in new nav, but preserve their URLs with a redirect or closed event page.
- Preserve the typo `/generel-enquiries/`.

Suggested redirect map:

| Old URL | New URL |
| --- | --- |
| `/jfp/` | `/training#jfp` |
| `/protraining/` | `/training#pro-training` |
| `/jonersjuniors/` | `/training#joners-juniors` |
| `/thehq/` | `/hq` |
| `/training-enquiries/` | `/training#jfp-form` |
| `/junior-general-enquiries/` | `/training#joners-juniors` |
| `/generel-enquiries/` | `/about#contact` |
| `/new-coaching-role/` | `/about#contact` |
| `/lee-jones-head-coach-owner/` | `/about` |
| `/our-coaches/` | `/about#coaching-team` |
| `/elitecampbookings/` | `/camps` |
| `/thecompleteplayerexperience/` | `/camps/la-tcpe-june` |
| `/houston2026/` | `/camps/texas-houston-june` |
| `/dallas2026/` | `/camps/texas-dallas-june` |
| `/sydneyjuly2026/` | `/camps/sydney-big-1-july` |
| `/elitecampbookings/sydneycamp/` | `/camps/sydney-big-1-july` |
| `/sacramento-california-april-2026/` | `/camps` |
| `/elitecampbookings/speed-camp/` | `/camps` |
| `/elitecampbookings/selectiontrainingday/` | `/camps` |
| `/gold-coast-january-2025/` | `/camps` |
| `/positionspecifictraining/` | `/training` |
| `/californiaprivates/` | `/camps` |
| `/jfonlinecoachescourse/` | `/workshops/coaches-course` |
| `/mindsetseminar/` | `/workshops/mindset-seminars` |
| `/coachesexperience/` | `/workshops/coaches-course` or future `/workshops/coaches-experience` |
| `/coaches-exp-terms-agreement/` | `/terms` or archive page |
| `/join/` | `/app` |
| `/shop/` | `/shop` |
| `/product/6-week-passing-1st-touch-program/` | needs decision: `/programmes`, `/app`, or legacy product |
| `/product/12-weeks-advanced-football-specific-strength-conditioning/` | needs decision: `/programmes`, `/app`, or legacy product |
| `/product/all-1-on-1-videos/` | needs decision: legacy product, `/app`, or `/programmes` |
| `/product/buy-all-of-the-training-tools/` | needs decision |
| `/product/improve-fast-feet-in-7-days-full-program/` | needs decision |
| `/product/buy-all-of-the-speed-agility-drills/` | needs decision |
| `/product/buy-all-of-the-shooting-drills/` | needs decision |
| `/product-category/1st-touch-drills/` | needs decision |
| `/product-category/passing-drills/` | needs decision |
| `/product-category/shooting-drills/` | needs decision |
| `/product-category/online-training-programs/` | needs decision |

## Critical Pre-Launch Blockers

1. Finalize camp facts and dates, especially LA and Melbourne.
2. Replace or remove broken workshop images.
3. Wire or remove all camp payment placeholder links.
4. Test camp forms end to end into Google Sheets, Brevo lists, notification emails, and payment routing.
5. Decide digital shop strategy before DNS switch.
6. Add 301 redirects for old training, camp, app, contact, about, and shop URLs.
7. Verify app CTAs and offer IDs with Lee or Uscreen source of truth.
8. Remove exact app prices from marketing pages if any remain after final route scan.
9. Reconcile global stat claims: 2.1M vs 2.5M followers, 40M YouTube views, 50K downloads, 1,500+ drills.
10. Verify all new public images render, especially workshops/coaches-course.
11. Decide if `/app/for-coaches` is nav-ready or should be hidden until expanded.
12. Confirm no "coming soon" placeholder cards are visible on launch-critical pages unless intentional.

## Quick Wins For The Next 48 Hours

1. Add redirect rules for all non-shop old URLs first.
2. Create a separate shop redirect decision sheet before touching product URLs.
3. Replace `/images/coaching-session.webp` and `/images/coaches-course-preview.webp` with existing training assets.
4. Add Off Field, On Field, and Help links to `/shop`.
5. Hide or soften `/app/for-coaches` from desktop nav if it is not launch-ready.
6. Remove "payment pending" markers from coaches-course UI.
7. Add a short "Need verification" comment to Sanity camp docs for LA date and Melbourne status.
8. Test new `/training`, `/camps`, `/app`, `/hq`, `/about`, `/shop`, and `/teams` forms manually.
9. Run a link check after redirects are implemented.
10. Pull the best WordPress app page FAQ items into the new `/app` FAQ without adding prices.

## Notes For Jeffrey And Lee

- The new site is directionally stronger and should not be redesigned in this pass.
- The highest-risk areas are registration/payment flow, shop/product preservation, and old URL redirects.
- Keep checkout systems external until ownership is clear.
- Treat WordPress as the factual source, except where WordPress clearly conflicts with time-sensitive launch direction. In those cases, mark needs verification rather than guessing.
