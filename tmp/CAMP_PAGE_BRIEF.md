# Joner Football Camp Page, Codex Build Brief

**File to update:** `src/pages/camps/[slug].astro` (and the `CAMP_FALLBACKS` block inside it)
**Goal:** ship a premium, conversion focused camp landing page that swaps to a new destination by editing one config block + dropping in a folder of images.
**First slug:** `texas-houston-june` (Houston World Cup Camp).
**Brand rules to respect (non negotiable):**
- No em dashes, no en dashes anywhere in copy or comments.
- Lee's voice: short, direct, passionate. Banned words: check out, don't miss, link in bio, unlock, elevate.
- Pricing only inside the booking module, never in hero, never in proof bars.
- All images must come from `public/images/camps/joner-camps-pack/` or `public/images/camps/houston/`. Do not invent visuals.

---

## 0. Codex prompt (paste this at the top of your Codex task)

> Refactor `src/pages/camps/[slug].astro` into a premium camp landing page based on the brief in `tmp/CAMP_PAGE_BRIEF.md`. Keep the existing form logic, Brevo/sheet hidden inputs, payment link rotator, FAQ accordion script, and SEO/JSON-LD untouched. Add a new `images` config block per camp inside `CAMP_FALLBACKS` and read every image / video reference from there so we can ship new destinations by copy-pasting one camp object. Build to the section order in part 2 of the brief. Use Tailwind utility classes only. Do not introduce new npm packages. Run `npm run build` after.

---

## 1. The duplication pattern (THIS IS THE WHOLE POINT)

Each camp is one entry in `CAMP_FALLBACKS` keyed by slug. We extend it with one new field: `images`. Every visual on the page reads from this block. To launch a new city, Lee copies a camp object, edits text and dates, and points the image paths at a new folder.

```ts
// inside CAMP_FALLBACKS
'texas-houston-june': {
  // ... existing fields stay
  images: {
    // hero
    heroVideoYoutubeId: 'wSFyNDLu3zc',          // Houston2026 YouTube Shorts
    heroVideoLocal: '/images/camps/houston/houston-hero-720.mp4', // optional local mp4 fallback
    heroPoster: '/images/camps/joner-camps-pack/06_large_camp_v1_polished_blank_4x3.jpg',

    // promise band
    promiseImage: '/images/camps/joner-camps-pack/11_1v1_detail_v1_polished_blank_4x3.jpg',

    // 4 V3 tiles in "What This Camp Is"
    valueTiles: [
      { src: '/images/camps/joner-camps-pack/03_real_coaching_v3_full_text_overlay_4x3.jpg', alt: 'For players who want to be coached hard' },
      { src: '/images/camps/joner-camps-pack/04_night_session_v3_full_text_overlay_4x3.jpg', alt: 'No babysitting, only dedicated players' },
      { src: '/images/camps/joner-camps-pack/05_small_group_v3_full_text_overlay_4x3.jpg', alt: 'Max 16 players per coach' },
      { src: '/images/camps/joner-camps-pack/01_fcballer22_v3_full_text_overlay_4x3.jpg', alt: 'Built for development' },
    ],

    // cinematic gallery
    gallery: [
      '/images/camps/joner-camps-pack/07_group_detail_v1_polished_blank_4x3.jpg',
      '/images/camps/joner-camps-pack/04_night_session_v1_polished_blank_4x3.jpg',
      '/images/camps/joner-camps-pack/05_small_group_v1_polished_blank_4x3.jpg',
      '/images/camps/joner-camps-pack/09_red_drills_v1_polished_blank_4x3.jpg',
      '/images/camps/joner-camps-pack/02_indoor_detail_v1_polished_blank_4x3.jpg',
    ],

    // day by day backdrops (one per day card)
    scheduleImages: [
      '/images/camps/joner-camps-pack/05_small_group_v1_polished_blank_4x3.jpg',
      '/images/camps/joner-camps-pack/11_1v1_detail_v1_polished_blank_4x3.jpg',
      '/images/camps/joner-camps-pack/07_group_detail_v1_polished_blank_4x3.jpg',
    ],

    // included tile
    includedTile: '/images/camps/joner-camps-pack/07_group_detail_v3_full_text_overlay_4x3.jpg',

    // coach module portrait
    coachPortrait: '/images/camps/joner-camps-pack/08_coach_explains_v1_polished_blank_4x3.jpg',

    // testimonial section dark backdrop
    testimonialBackdrop: '/images/camps/joner-camps-pack/02_indoor_detail_v1_polished_blank_4x3.jpg',

    // booking section ambient image
    bookingBackdrop: '/images/camps/joner-camps-pack/10_standards_v1_polished_blank_4x3.jpg',

    // final CTA banner
    finaleBackdrop: '/images/camps/joner-camps-pack/06_large_camp_v1_polished_blank_4x3.jpg',
  },
},
```

**To launch a new destination Lee runs three steps:**
1. Drop new city photos into `public/images/camps/<city-slug>/`.
2. Copy the Houston camp object, change slug, title, dates, venue, prices, and the 13 image paths in `images`.
3. Push. Page is live at `/camps/<city-slug>`.

---

## 2. Section order, top to bottom

Mobile and desktop share the same section order. Mobile differences are called out per section.

### Section 1, Hero
**Goal:** instant cinematic proof + 1 CTA, no clutter.

- Background: YouTube Shorts video (`wSFyNDLu3zc`) embedded full bleed, autoplay muted loop, hidden controls, hidden YouTube branding (`?rel=0&controls=0&modestbranding=1&playsinline=1&loop=1&playlist=wSFyNDLu3zc&mute=1&autoplay=1`). If `images.heroVideoLocal` is set, prefer the local mp4 over YouTube (lower latency, no chrome). Fall back to `heroPoster` image if both missing.
- Dark scrim: linear gradient from `rgba(0,0,0,.78)` at left to `rgba(0,0,0,.18)` at right, plus bottom-up fade to pure black for the next section transition.
- Top thin red bar (1px, joner-red).
- Top-left location chip: `HOUSTON, TEXAS, USA` in heading font, 0.18em letter spacing.
- Headline (h1, font-heading, uppercase, leading-none, clamp 3.5rem to 6.5rem):
  > **HOUSTON.**
  > **WORLD CUP CAMP.**
- Subhead (font-body semibold, max-w-xl, white, 1.25rem mobile to 1.5rem desktop):
  > 3 mornings. Real coaching. World Cup energy. Built for players who actually want to improve.
- Scarcity strip (sits below subhead): 3 mini stats in a row, mobile = horizontal scroll
  - `JUNE 26 to 28, 2026`
  - `7AM TO 10AM`
  - `MAX 80 PLAYERS, SOLD OUT 2025`
- Primary CTA: solid red button, full-width on mobile, auto on desktop, label `Book My Houston Spot`. Anchors to `#register`.
- Secondary text under CTA in 0.85rem white/70: `14 day refund policy. Pay in full or split with PayPal.`

**Image:** YouTube `wSFyNDLu3zc` (the Houston2026 camp video). Poster fallback `06_large_camp_v1`.
**Mobile:** keep the same video, contain it inside a 16:9 frame above the headline so 9:16 phones still see player faces. Headline drops to 3.25rem.

### Section 2, Sticky payment bar (mobile only)
Already exists. Keep `<a class="camp-mobile-cta">`. Update label to `Book My Houston Spot, $130 to $350 USD`.

### Section 3, Quick Facts strip
**Goal:** scannable answer to "what, where, when, how much, who is it for".

- White section, joner-black text, py-12 desktop / py-8 mobile.
- Eyebrow: `THE FACTS`.
- Heading: `Houston 2026, the essentials`.
- Grid of 5 cards, mobile = horizontal snap-scroll, desktop = 5 cols:
  1. **WHERE**, `Tomball Training Venue, Houston TX`
  2. **WHEN**, `Friday 26 to Sunday 28 June, 2026`
  3. **TIMES**, `7am to 10am, early start due to heat`
  4. **WHO**, `Ages 8 to 18, grouped by age and skill`
  5. **GROUP STANDARD**, `Max 16 players per coach`

**Image:** none.

### Section 4, The Houston Promise
**Goal:** state the outcome in Lee's voice.

- Two-column on desktop (text left, image right), stacked on mobile (image first).
- Eyebrow: `THE PROMISE`.
- Heading (h2, font-heading, uppercase, 2.5rem to 4rem clamp):
  > **TRAIN HARD. LEARN DETAIL. LEAVE BETTER.**
- Body (font-body, 1.125rem, max-w-md):
  > This is not a clinic. It's a proper Joner Football environment with high standards, technical detail, and energy. We bring the coaches, the drills, and the World Cup buzz. Players bring the work.
- 3 bullet rows with red 4px left border:
  - **No babysitting.** Only players who actually want to improve.
  - **Max 16 per coach.** Grouped by age first, then skill.
  - **Sold out every year.** Houston moves fast. Spots are real.

**Image:** `11_1v1_detail_v1_polished_blank_4x3.jpg` (premium tropical 1v1 portrait, conveys "elite coaching feel").

### Section 5, Proof bar
**Goal:** social proof in 4 seconds.

- Black band, py-8.
- Single row, 4 items, mobile = 2x2 grid:
  - **SOLD OUT 2025**, `Houston camp filled before April`
  - **80 PLAYERS MAX**, `Capacity capped on purpose`
  - **WORLD CUP CAMP**, `Run alongside the 2026 World Cup`
  - **PARTNERS**, `Kingdom Soccer Training, Grande Sports Training`
- Each item: white heading-font label, red 0.78rem eyebrow above, white/70 subtext.

**Image:** none.

### Section 6, What This Camp Is (V3 tiles)
**Goal:** 4 pre-styled image tiles do all the brand work, zero copy required from Codex.

- Black section, py-16.
- Eyebrow: `WHAT THIS CAMP IS`.
- Heading: `Built for the player who's serious.`
- 4-up grid of 4:3 image tiles. The pack already supplies the typography baked in (V3 = full text overlay).
  - Tile 1: `03_real_coaching_v3` ("FOR PLAYERS")
  - Tile 2: `04_night_session_v3` ("NO BABYSITTING")
  - Tile 3: `05_small_group_v3` ("MAX 16 PER COACH")
  - Tile 4: `01_fcballer22_v3` ("BUILT FOR DEVELOPMENT")
- Hover (desktop): scale 1.02, red 1px outline appears.
- Mobile: 2x2 grid, full width tiles, snap-scroll optional if >4 tiles.

**Image:** four V3 tiles above. These are the tiles. Don't add captions, the typography is in the image.

### Section 7, Cinematic gallery slab
**Goal:** show the energy in 5 photos. No text. Pure atmosphere.

- Full-bleed (100vw), white background.
- Desktop: a 5-column staggered grid where the centre image is taller (1.5x). Use `aspect-[3/4]` for centre, `aspect-[4/3]` for others.
- Mobile: horizontal snap-scroll, one image per viewport, 92vw width, hint of next image showing.
- Lazy-load all images, eager-load first.
- Subtle grain overlay (`mix-blend-overlay` SVG noise) for premium texture.

**Images (in order):**
1. `07_group_detail_v1` (Texas semicircle, hero scale)
2. `04_night_session_v1` (dusk lights)
3. `05_small_group_v1` (sunny ladder drill, the centre tall image)
4. `09_red_drills_v1` (red shirt drill detail)
5. `02_indoor_detail_v1` (indoor turf hands-on)

### Section 8, Day-by-day plan
**Goal:** parents see the structure of the 3 days at a glance.

- White section.
- Eyebrow: `THE 3 MORNINGS`.
- Heading: `What every player works on.`
- 3 cards, equal width, desktop 3-col, mobile 1-col.
- Each card:
  - 4:3 image at top (use `images.scheduleImages[i]`)
  - Day label in red eyebrow: `FRIDAY 26 JUNE`
  - Card title (h3, font-heading uppercase, 1.5rem):
    - Day 1: `Ball Mastery & Standards`
    - Day 2: `1v1 & First Touch`
    - Day 3: `Decision Making & Confidence`
  - One paragraph (45 to 60 words) per day, voice-of-Lee, copy below.

**Day 1 copy:** Players settle into groups, learn the camp standards, then attack high-rep technical work. Ball mastery, footwork patterns, and the basics done with intent. The tone for the week gets set on day one.

**Day 2 copy:** The intensity rises. Receiving under pressure, body shape, sharper first touch. Then 1v1 attacking work where players are pushed to be brave. The day every player remembers.

**Day 3 copy:** Game realistic pictures, decision making, and live situations. Final challenges to test what they've learned. Photos, autographs, and a clear push to keep developing after camp.

### Section 9, What's Included
**Goal:** kill any "what do I get?" hesitation.

- Black section.
- 2 columns desktop (40 / 60 split), 1 column mobile.
- Left column: a single V3 tile.
- Right column: bullet list of included items, red checkmark icons (inline SVG, 14px).

**Bullets (from Houston camp data):**
- 3 morning training blocks, 7am to 10am
- Technical detail from the Joner Football coaching team
- Players grouped by age then ability
- Max 16 players per coach
- Joner training jersey for players doing all 3 days
- Free access to the Joner Football App
- On-site Joner merch and training kit
- Professional photos and player moments captured all 3 days

**Image:** `07_group_detail_v3` ("INCLUDED").

### Section 10, The Coach
**Goal:** trust transfer, this is Lee's camp.

- Split section. Left = portrait. Right = quote and bio.
- Eyebrow: `YOUR HEAD COACH`.
- Heading: `Lee Jones, Joner Football.`
- Quote, font-heading italic, 1.5rem, dropquote style:
  > "I run these camps because I want to coach players who actually want to be coached. Houston brings that energy every year."
- 3 short bio lines:
  - Founder of Joner Football, 382K YouTube subscribers
  - Built the Joner Football App, used in 80+ countries
  - Coached at camps across USA, UK, Europe, Australia
- Below the bio, a small Joner App callout card:
  - Heading: `Every camp player gets the App.`
  - Body: `Free access while the camp runs and the months after. Same training, same standards, every day.`
  - CTA link: `See what's inside →` linking to https://app.jonerfootball.com

**Image:** `08_coach_explains_v1` (Lee mid-instruction with mic, Sydney pitch). Best Lee portrait in the pack.

### Section 11, Parent voices
**Goal:** parent-to-parent proof. Houston specific where possible.

- Dark section with backdrop image at 12% opacity, black overlay 80%.
- Eyebrow: `PARENTS WHO'VE DONE IT`.
- Heading: `What Houston parents say.`
- 3 testimonial cards, desktop 3-col, mobile horizontal snap-scroll.
- Each card: glass effect (`bg-white/8 backdrop-blur border-white/14`), padding 1.5rem.
  - Pull-quote, font-heading 1.125rem, white
  - Attribution: `Parent, Houston 2025` in red 0.78rem eyebrow
  - Optional 5-star row in red

**Testimonial copy (placeholder until real ones swapped in via Sanity):**
- "My son didn't stop talking about Lee for a month. Best 3 mornings of his summer." Parent, Houston 2025
- "Proper coaching. The detail and the standards were on another level. Worth every dollar." Parent, Boston Camp
- "We flew in from Dallas. We'll do it again. The 16-per-coach ratio is the real deal." Parent, Houston 2025

**Image (background):** `02_indoor_detail_v1` at 12% opacity.

### Section 12, Pricing & Book (the form)
**Goal:** the existing form, dressed premium.

- Keep the existing booking form, hidden inputs, day/payment link rotator, recaptcha hook, success/failure handler. Do NOT touch the API call.
- Wrap the form in a 2-column desktop layout:
  - Left panel (booking summary, dark): camp name, dates, what's included recap, refund line, 4-row pricing table.
  - Right panel (form, white): the existing fields.
- Pricing table inside the dark panel:

  | Option | Price |
  |---|---|
  | 1 day | $130 USD |
  | 2 days | $250 USD |
  | 3 days, jersey included | $350 USD (best value) |

- Below pricing, a single line in white/70: `14 day refund policy. Pay in full or split with PayPal.`
- Form fields stay identical to current `[slug].astro` (player name, surname, parent name, email, age, mobile, jersey size, days, payment method, agreement).
- Form button text: `Book Houston Spot Now`.

**Image:** `10_standards_v1` faint behind the dark panel at 25% opacity, black overlay 80%.

### Section 13, FAQ
**Goal:** kill objections.

- White section.
- Keep existing accordion script.
- 5 questions max above the fold (rest are expandable):
  1. What does my child need to bring?
  2. What should they wear?
  3. What can we expect?
  4. Will bad weather cancel the camp?
  5. Can I get a refund?
- Use copy already in `commonFaqs`. Tighten any sentence over 25 words.

**Image:** none.

### Section 14, Final CTA banner
**Goal:** last push before they bounce.

- Full-bleed image with 65% black overlay.
- Heading (font-heading, uppercase, 3rem to 5rem clamp, white):
  > **HOUSTON IS BACK.**
  > **80 SPOTS. ONE CAMP.**
- Subhead: `Sold out 2025. Don't wait this time.`
- Big red CTA: `Book My Houston Spot`.
- Below CTA: `Questions? Email leejones@jonerfootball.com`.

**Image:** `06_large_camp_v1` (golden hour, big group, scale + warmth).

### Footer
Use existing site footer.

---

## 3. Final image map (one glance)

| Slot | Image | Why |
|---|---|---|
| Hero video | YouTube `wSFyNDLu3zc` | Lee specified the houston2026 camp video |
| Hero poster fallback | `06_large_camp_v1` | Wide proof shot if video fails |
| Promise band image | `11_1v1_detail_v1` | Premium 1v1 brand portrait |
| Value tile 1 | `03_real_coaching_v3` | Has "FOR PLAYERS" overlay baked in |
| Value tile 2 | `04_night_session_v3` | "NO BABYSITTING" overlay |
| Value tile 3 | `05_small_group_v3` | "MAX 16 PER COACH" overlay |
| Value tile 4 | `01_fcballer22_v3` | "BUILT FOR DEVELOPMENT" overlay |
| Gallery 1 | `07_group_detail_v1` | Hero-class semicircle scale |
| Gallery 2 | `04_night_session_v1` | Dusk lights cinematic |
| Gallery 3 | `05_small_group_v1` (centre tall) | Sunny coachable moment |
| Gallery 4 | `09_red_drills_v1` | Red shirt drill detail |
| Gallery 5 | `02_indoor_detail_v1` | Indoor turf hands-on |
| Day 1 card | `05_small_group_v1` | Standards, ladder work |
| Day 2 card | `11_1v1_detail_v1` | 1v1 detail |
| Day 3 card | `07_group_detail_v1` | Group decision making |
| Included tile | `07_group_detail_v3` | "INCLUDED" overlay baked in |
| Coach portrait | `08_coach_explains_v1` | Best Lee instruction shot |
| Testimonials backdrop | `02_indoor_detail_v1` (12% opacity) | Atmospheric, no faces compete |
| Booking backdrop | `10_standards_v1` (25% opacity) | Standards, premium tone |
| Final CTA banner | `06_large_camp_v1` | Golden hour scale, warm finale |

Total: 13 unique images used (5 V1 in gallery, 4 V3 tiles, 4 supporting V1, 1 video). Easy to swap for a new city.

---

## 4. Interaction logic

- **Sticky mobile CTA** (existing). Always visible bottom 72px. Hides when form is in viewport.
- **Hero video** autoplay muted loop. Tap to unmute (mobile). Pause when tab inactive.
- **Day card hover** (desktop): subtle scale 1.02, red 4px bottom border slides in.
- **Gallery snap-scroll** on mobile: native CSS `scroll-snap-type: x mandatory`. No JS.
- **FAQ accordion**: keep existing script.
- **Form**: keep all existing logic. After submit:
  - Save to Brevo + Google Sheet via `/api/camp-registration`.
  - Redirect to selected payment link.
  - Show inline message on failure.
- **Spots remaining**: read `camp.spotsRemaining`. If `< 20`, show small red pulsing dot in hero scarcity strip + final CTA: `Only X spots left`.
- **Sold out**: if `camp.status === 'sold-out'`, replace primary CTA with `Join the waitlist` linking to a Brevo list. Form panel switches to email-only waitlist form.

---

## 5. Mobile layout principles

- One column everywhere.
- Hero: video sits in a 16:9 frame above the headline so the player faces are not cropped on 9:16 phones.
- Quick Facts: horizontal snap-scroll, one card visible + a peek of the next.
- Cinematic gallery: horizontal snap-scroll, one image per swipe, hint of next.
- Day cards: vertical stack, image-on-top each card.
- Form: single column, 16px font on inputs (avoid iOS zoom), big 52px tap targets, native autocompletes (`autocomplete="email"` etc, already in current file).
- Sticky CTA: red, full width minus 12px gutter, 56px tall, bottom-aligned.
- Section padding: py-12 mobile, py-20 desktop.
- Headlines: clamp() for fluid sizing.

---

## 6. Conversion logic

- **One CTA target:** every primary button anchors to `#register`. No competing actions.
- **Scarcity stack:** hero scarcity strip + sold-out 2025 proof bar + final CTA spots-left counter. Three different proof points, all true.
- **Pricing tucked:** prices appear once, inside the booking module. Hero says nothing about cost. Final CTA says nothing about cost. This protects perceived value and respects the "no public prices" brand rule for the parts of the page that get screenshot.
- **Trust before form:** parent voices section sits directly above the booking module. The last thing they read before paying is another parent.
- **Refund line everywhere money appears:** "14 day refund policy" under every CTA that mentions buying.
- **Friction reduction:** day choice → payment link auto-updates (existing logic). Optional fields collapsed by default in `<details>`. Required fields marked with `*`.
- **Checkout speed test:** brief target is < 90 seconds from hero CTA tap to payment link redirect on mobile.

---

## 7. Visual direction

- **Palette:** joner-black `#0A0A0A`, joner-red `#E30613`, white, gray scale 100/300/700.
- **Type:** existing `--font-heading` (uppercase, condensed, bold) for all eyebrows, headings, CTAs. `--font-body` for paragraphs and form.
- **Letter-spacing:** 0.18em for eyebrows, 0.08em for tile titles, 0 for body.
- **Borders:** thin (1px) joner-red accents on cards, never round corners. Sharp corners everywhere (matches existing style).
- **Motion:** scroll-triggered fade-up on each section heading using IntersectionObserver, 0.5s, ease-out, once. No bouncy animation. Premium = restrained.
- **Texture:** add a 1.5% SVG grain noise overlay on the cinematic gallery and the final CTA banner only. Adds film-grade polish.
- **Shadows:** none on dark sections. On white sections, 0 30px 80px rgba(0,0,0,.08) on form panel only.

---

## 8. Performance and SEO

- All gallery images served via Astro's `<Image>` component for `webp` + responsive sizes.
- Hero YouTube embed uses `loading="lazy"` and a poster image so first paint is the still image, video boots after.
- Keep existing `eventSchema` and `faqSchema` JSON-LD.
- Add `OrganizerEvent` reviews if testimonials become real.
- Page weight target: < 1.6MB on first load (mobile).

---

## 9. Acceptance checklist for Codex

- [ ] `[slug].astro` reads every visual from `camp.images`. Page renders if `camp.images` is missing (fall back to `heroImage`/`galleryImages`).
- [ ] Hero embeds `wSFyNDLu3zc` YouTube Shorts, autoplay muted loop, hidden chrome, poster fallback.
- [ ] All 14 sections present in the order in part 2.
- [ ] No em dashes anywhere.
- [ ] No prices outside the booking module.
- [ ] Form submits to `/api/camp-registration` with all existing hidden fields.
- [ ] Day option change updates payment link (existing logic preserved).
- [ ] FAQ accordion still works.
- [ ] Lighthouse mobile performance ≥ 85.
- [ ] Page builds with `npm run build` with zero errors.
- [ ] To duplicate for a new city: copy the camp object in `CAMP_FALLBACKS`, change text + image paths, the page works.

---

## 10. Out of scope (for this Codex task)

- Sanity schema updates for the new `images` field. (Stub for now, Sanity can keep using existing fields. The fallback object is the source of truth until Lee migrates.)
- Real Houston testimonial copy. (Use placeholders, real ones swap in later.)
- New camp pages for Dallas, Sydney, LA. (Once Houston ships and Lee approves, copy the object.)

---

## 11. Quick copy bank (Lee's voice, ready to paste)

**Hero subhead options (pick one, A is default):**
- A. `3 mornings. Real coaching. World Cup energy. Built for players who actually want to improve.`
- B. `Houston camp is back for the World Cup. 3 mornings, real coaching, levels up.`
- C. `Sold out last year. Back for the World Cup. 3 mornings of proper Joner Football.`

**Promise paragraph:**
> This is not a clinic. It's a proper Joner Football environment with high standards, technical detail, and energy. We bring the coaches, the drills, and the World Cup buzz. Players bring the work.

**Final CTA subhead options:**
- A. `Sold out 2025. Don't wait this time.`
- B. `80 spots. One camp. Houston moves fast.`

**Email line:** `Questions? Email leejones@jonerfootball.com`

---

End of brief.
