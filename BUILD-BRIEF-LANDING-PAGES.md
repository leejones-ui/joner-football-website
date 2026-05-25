# Overnight Build Brief: 3 Landing Pages

**Author:** Lee Jones (briefed via Claude)
**Date:** 2026-05-25
**Target:** rebuild 3 sales landing pages on the Joner Football site in one overnight pass.

This brief is self-contained. Do not stop to ask questions. If something is missing, leave a `// TODO: ASK LEE` comment and keep building.

---

## 1. Mission

Rebuild these three landing pages so each one actually sells:

| Page | File | Live URL | Audience | Price | Checkout |
|------|------|----------|----------|-------|----------|
| **100-Day Player Programme** | `src/pages/100-day.astro` (new) | `/100-day` | Players + parents of players | $204.99 AUD/yr (Annual tier) | `https://app.jonerfootball.com/checkout/new?o=183092` |
| **Coaches Only** | `src/pages/app/for-coaches.astro` (exists, polish + extend) | `/app/for-coaches` | Coaches, all levels | $319.99 AUD/yr (Coaches tier) | `https://app.jonerfootball.com/checkout/new?o=202578` |
| **Team Subscriptions** | `src/pages/teams.astro` (exists, rebuild) | `/teams` | Clubs, academies, schools | Custom (lead-gen, no self-serve checkout) | Contact form to `leejones@jonerfootball.com` + book-a-call link |

Branch all work off `main` into `overnight-landing-page-rebuild`. Push to that branch only. Do NOT merge to `main`. Lee reviews via Vercel preview before merging.

---

## 2. Hard Rules. Never Break. (Source of truth: `/Users/joner/Documents/Joner Football/wiki/RULES.md`)

The QC agent scans every file. Violations block merge.

### 2.1 Writing rules
- **NO em dashes.** Zero. Anywhere. Use commas, colons, or full stops.
- **NO en dashes.** Same rule.
- **Banned words:** `check out`, `don't miss`, `link in bio`, `unlock`, `elevate`, `no credit card required`.
- **Approved words to lean on where natural:** worldie, levels, game changer, masterclass, your game, your technique.
- **No vague CTAs.** Never "click here", "learn more", or "find out more". CTAs must say what happens. Examples: `START THE 100-DAY PROGRAMME`, `JOIN COACHES ONLY`, `BOOK A TEAMS CALL`.

### 2.2 Link rules
- All `app.jonerfootball.com` links MUST include `target="_blank" rel="noopener noreferrer"`. This is non-negotiable.
- The `join_us` URL is permanently banned. Never use the old `join_us` app URL. Use `https://jonerfootball.com/join/` instead.

### 2.3 Content rules
- Photo or video must match the caption sitting next to it. No stock photos with unrelated copy.
- Website pages may show prices when transparency helps conversion. Show the AUD price on every landing page hero and final CTA.

### 2.4 Pre-flight QC checklist (run on every file before commit)
```bash
# From the project root
grep -nP "\x{2014}" src/pages/PATH.astro     # must return 0 lines (U+2014 = em dash)
grep -nP "\x{2013}" src/pages/PATH.astro     # must return 0 lines (U+2013 = en dash)
grep -niE "check out|don't miss|link in bio|unlock|elevate|no credit card" src/pages/PATH.astro   # must return 0 lines
grep -n "join_us" src/pages/PATH.astro   # must return 0 lines
# Every app.jonerfootball.com href must be followed by target="_blank" rel="noopener noreferrer"
```

If any check fails, fix it before committing.

---

## 3. Tech Stack & Conventions

- **Framework:** Astro 6 (SSG, islands)
- **Styling:** Tailwind CSS v4 (via `@tailwindcss/vite`)
- **CMS:** Sanity (optional override layer per page, see section 3.4)
- **Deployment:** Vercel. Push to branch = preview URL auto-generated.
- **Node:** >=22.12.0

### 3.1 File pattern
Every page is `.astro`. One page per file. Use `BaseLayout`.

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro'

const title = 'Page Title | Joner Football'
const description = '...'
const checkoutUrl = '...'
---

<BaseLayout title={title} description={description} canonical="..." ogImage="...">
  <main class="bg-joner-black text-white">
    <!-- sections here -->
  </main>
</BaseLayout>
```

### 3.2 Brand tokens (Tailwind)
- `bg-joner-black`, primary dark background (`#000` ish)
- `bg-joner-gray`, secondary dark grey (cards, panels)
- `text-joner-red`, `bg-joner-red`, `border-joner-red`, primary accent (`#CC0000`)
- `font-heading`, headline font (DM Sans bold uppercase)
- `font-body`, body font

### 3.3 Reusable components (use these, do not rebuild)
- `BaseLayout.astro`, page shell with nav + footer
- `HighlightsCarousel.astro`, used on `/app`, image carousel
- `CloserLook.astro`, pill-stack with image-stage pattern (used on `/app`)
- `Footer.astro`, site footer with email opt-in
- `TestimonialCarousel.astro`, testimonial carousel

If a section needs the same shape on multiple pages, extract it into `src/components/`.

### 3.4 Sanity CMS override pattern
Every existing landing page has this at the top:
```astro
const sanityPage = await fetchSanityPage('SLUG')
---
{shouldReplaceSanityPage(sanityPage) ? (
  <SanityPageRenderer page={sanityPage} />
) : (
  <BaseLayout>...</BaseLayout>
)}
```

This means: if Lee has edited the page in Sanity Studio, Sanity wins. Otherwise the Astro file renders. For this overnight build, set the override flag to FALSE so the new Astro file always wins:

```astro
{false && shouldReplaceSanityPage(sanityPage) ? (
```

Add a comment above it: `// TEMPORARY: forcing Astro version. Remove false && to restore Sanity control after Lee approves.`

---

## 4. Layout Patterns (mirror `src/pages/app.astro`)

Every landing page follows roughly the same skeleton. Order matters.

### 4.1 Standard section order
1. **Hero** (dark, eyebrow + 3-line declarative headline + sub + dual CTA + price line)
2. **Video intro** (optional, 60 to 90 second talk-to-camera from Lee)
3. **Problem section** (light bg, 4 pain points in red-bordered cards, short transition line, CTA)
4. **Founder block / authority** (dark grey bg, copy left with signature + photo right, mirrors `/app` Personal Guarantee section)
5. **What is inside** (horizontal alternating cards, image left then image right, dark bg)
6. **Audience-fit section or why-yearly section** (light bg, objection-handling copy)
7. **Testimonials** (dark grey bg, 3-card grid in `/app` style with red quote mark + name + role in red + location in grey)
8. **FAQ** (light bg, expandable details, minimum 7 questions, must include price + cancellation + audience + level)
9. **Final CTA** (dark bg, big headline, two CTAs, price line under)

### 4.2 Headline pattern (every hero)
Three short declaratives stacked vertically. Examples already in production:
- `/app` hero: `ONE APP. COMPLETE FOOTBALL DEVELOPMENT.`
- `/app` coaches panel: `EVERY SESSION. PLANNED. DELIVERED. DONE.`
- `/app/for-coaches` (new): `EVERY SESSION. EVERY DETAIL. EVERY WEEK.`

Each page in this brief has its own headline. Use it.

### 4.3 Card patterns
- **Horizontal feature card:** grid with image left or right (alternate by index), copy on opposite side. Eyebrow in red caps, then headline in uppercase, then 2-3 sentence body.
- **Testimonial card:** red `"` mark, italic quote, then border-top with name (white), role (red caps), location (grey small).
- **Pain-point card:** light grey background, red 4px left border, single sentence.

### 4.4 CTA pattern
- Primary: `class="btn-red text-base px-8 py-4 text-center"`
- Secondary: `class="btn-outline text-base px-8 py-4 text-center"`
- Always include `data-meta-checkout-event="..."` attribute on the checkout button (use page-specific event name).

### 4.5 Sticky mobile CTA
Add this to every page above closing `BaseLayout`:

```astro
<a href={checkoutUrl} target="_blank" rel="noopener noreferrer" class="app-mobile-cta btn-red">JOIN NOW</a>

<style>
.app-mobile-cta {
  position: fixed; left: 0.75rem; right: 0.75rem; bottom: 0.75rem; z-index: 40;
  display: none; opacity: 0; transform: translateY(110%); pointer-events: none;
  transition: opacity 280ms ease, transform 360ms cubic-bezier(0.32, 0.72, 0, 1);
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.42); text-align: center;
}
.app-mobile-cta.is-revealed { opacity: 1; transform: translateY(0); pointer-events: auto; }
@media (max-width: 1024px), (hover: none) and (pointer: coarse) {
  .app-mobile-cta { display: inline-flex; }
  body { padding-bottom: 90px; }
}
</style>

<script is:inline>
;(function () {
  var heroEl = document.querySelector('section'); // first section is hero
  var cta = document.querySelector('.app-mobile-cta');
  if (!heroEl || !cta || !('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      cta.classList.toggle('is-revealed', !entry.isIntersecting);
    });
  }, { threshold: 0, rootMargin: '-40px 0px 0px 0px' });
  io.observe(heroEl);
})();
</script>
```

### 4.6 Schema markup
Add JSON-LD for each page. Example for a paid digital product:

```js
const offerSchema = {
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Joner Football App: Coaches Only",
  "offers": {
    "@type": "Offer",
    "price": "319.99",
    "priceCurrency": "AUD",
    "availability": "https://schema.org/InStock"
  }
}
```

Pass via `schema` prop on `BaseLayout`.

---

## 5. Voice & Copy Rules

Match the existing `/app` page voice exactly. Short sentences. Declarative. No marketing fluff.

**Bad (sounds like AI):**
> "Discover the ultimate way to elevate your training and unlock your full potential as a coach."

**Good (Joner voice):**
> "Stop spending hours building session plans from scratch. The Joner Football App gives you a complete library."

Reference for tone: `src/pages/app.astro` lines 148 to 172 (audience panels). Re-read before writing.

Per-page voice cues:
- **100-Day:** aspirational, transformation-focused, energetic
- **Coaches:** premium, no-nonsense, "inside view"
- **Teams:** professional, B2B, ROI-led

---

## 6. Asset Conventions

Place new assets in:
```
public/images/100-day/         <- new
public/images/coaches-only/    <- exists, add to it
public/images/teams/           <- new
public/videos/                 <- new for hero videos
```

Naming: `kebab-case.png` or `.webp` for photos, `.mp4` for video. Always include alt text that matches the caption next to it.

Lee's coder has access to all photos and videos. Pull from his existing folders. If you cannot find a matching asset, use a clearly named placeholder like `/images/100-day/PLACEHOLDER-hero.jpg` and add `// TODO: ASK LEE for hero shot` in a comment.

---

## 7. PAGE 1: The 100-Day Player Programme (`/100-day`)

### 7.1 What is this page
The flagship player programme. Daily training plan that takes a player from where they are now to a technically complete footballer in 100 days. Sold via the Annual plan. Audience is players age 6 to 18+ plus the parents who pay.

### 7.2 Setup constants
```astro
const title = 'The 100-Day Player Programme | Joner Football App'
const description = 'A structured day-by-day training plan that takes any player from where they are now to a technically complete footballer in 100 days. Inside the Joner Football App.'
const checkoutUrl = 'https://app.jonerfootball.com/checkout/new?o=183092'
const freeContentUrl = 'https://app.jonerfootball.com/categories/category-vpi8uazway4'
const price = '$204.99 AUD per year'
const trial = '7-day free trial'
```

### 7.3 Section-by-section

**Section 1: Hero**
- Eyebrow: `THE 100-DAY PLAYER PROGRAMME`
- Headline (3-line stack): `100 DAYS.` / `ONE PLAYER.` / `TOTALLY DIFFERENT.`
- Sub: "Follow the day-by-day pathway Lee built to take any player from where they are now to a technically complete footballer. No guesswork. No wasted sessions. Just daily progress you can see and feel."
- Primary CTA: `START THE 100-DAY PROGRAMME` to `{checkoutUrl}`, event name `OneHundredDayClickToCheckout`
- Secondary CTA: `BROWSE FREE SESSIONS` to `{freeContentUrl}`
- Price line: `$204.99 AUD per year. 7-day free trial. Cancel anytime.`
- Hero image: device mockup or action shot of a young player training. Look in `public/images/app/` and `public/images/programmes/` for existing assets.

**Section 2: Video intro (optional)**
- Eyebrow: `90 SECONDS WITH LEE`
- Headline: `WATCH THIS FIRST`
- Drop `/videos/100-day-intro.mp4` placeholder. If no file yet, leave the video tag pointing at the placeholder path.

**Section 3: Problem**
- Eyebrow: `SOUND FAMILIAR`
- Headline: `STOP TRAINING WITHOUT A PLAN`
- 4 pain-point cards:
  1. "You want to get better but you do not know what to practise."
  2. "You train hard but nothing changes."
  3. "You watch endless YouTube drills and never finish one."
  4. "Your coach is doing their best but you need more between sessions."
- Transition: "That stops here."
- CTA: `START THE 100-DAY PROGRAMME`

**Section 4: Founder block**
- Eyebrow: `WHO BUILT THE PROGRAMME`
- Headline: `LEE JONES. 20 YEARS OF COACHING.`
- Body: "Lee built the 100-Day Player Programme from the same blueprint he uses with elite players. The drills, the standards, the technique work, the volume. All adapted so any player at any level can follow it day by day."
- Signature: `Lee Jones` / `Founder, Joner Football`
- Photo: `/images/programmes/lee-coaching-red.jpg` (or better if available)
- CTA: `START THE 100-DAY PROGRAMME`

**Section 5: What is inside (horizontal alternating cards)**
Pull the 8 to 10 features from existing 100-day content. Suggested 6 cards minimum:
1. **DAILY PATHWAY.** Day by day, week by week. Just press play and train.
2. **FIRST TOUCH MASTERY.** Lee's first-touch system. The foundation of every elite player.
3. **PASSING + RECEIVING.** Build the technique that lets you play in any system.
4. **1V1 + FINISHING.** The bit that wins games.
5. **PROGRESS TRACKING.** See your improvement week to week, not vibes.
6. **AGE-SPECIFIC.** Content tuned for 6-9, 10-13, and 14+.

Plus optional:
7. **DAILY CHALLENGES.** Short focused tasks that build consistency.
8. **DIRECT MESSAGING WITH LEE.** Ask questions, get answers.

Use existing 100-day or app screenshots. Look in `public/images/app/`.

**Section 6: Social proof testimonials**
3 cards in `/app` style. Lee will supply real quotes. Use these as placeholders:
1. "My boy started in week 1 and by day 60 his first touch was a different level. He looks like a different player.", Parent, UK
2. "I was the kid who never knew what to practise. Now I press play and train. My coach has noticed.", Player, 14, USA
3. "Best money I have spent on my son's football. He actually finishes a session and asks for more.", Parent, Australia

**Section 7: Why now / urgency**
- Headline: `EVERY DAY YOU WAIT IS A DAY YOU DO NOT IMPROVE`
- Short pitch about compound improvement over 100 days
- CTA: `START THE 100-DAY PROGRAMME`

**Section 8: FAQ (minimum 8)**
- How much is it? ($204.99 AUD per year, 7-day free trial)
- Is there a free trial? (Yes, 7 days)
- What age is it for? (6 to adult, with age-specific tracks for 6-9, 10-13, 14+)
- How long does each day take? (15 to 45 minutes, scalable)
- Do I need equipment? (Ball, cones or markers, a wall is a bonus)
- What if I miss a day? (Pick it back up. Programme adapts.)
- Can I cancel? (Yes, anytime during or after trial)
- Does it work on Android? (Yes, App Store and Google Play)

**Section 9: Final CTA**
- Eyebrow: `100 DAYS FROM TODAY`
- Headline: `WHO DO YOU WANT TO BE`
- Sub: "Start the programme today. In 100 days you will know."
- Primary CTA: `START THE 100-DAY PROGRAMME`
- Secondary CTA: `BROWSE FREE SESSIONS`
- Price line.

---

## 8. PAGE 2: Coaches Only (`/app/for-coaches`)

**This page already exists in working form on the `coaches-page-rewrite` branch.** The structure, copy, and QC have already passed.

Your job: pull from `coaches-page-rewrite` branch, merge into the overnight build branch, and add the items below that were marked as TODO.

### 8.1 TODO items to complete
1. **Real testimonials.** Replace the 3 placeholder testimonials in the `testimonials` array. Lee will supply.
2. **Real intro video.** Drop the trimmed walkthrough at `public/videos/coaches-only-intro.mp4`. If not available, keep the `<video>` tag pointing at the placeholder path and add `// TODO: ASK LEE for trimmed intro` comment.
3. **Specific founder photo.** Replace `/images/programmes/lee-coaching-red.jpg` with a "Lee coaching a pro" shot if available in his asset library. Otherwise leave as-is.
4. **Sticky mobile CTA.** Add the sticky mobile CTA pattern from section 4.5.
5. **Schema markup.** Add the Product schema from section 4.6 with price `319.99` and currency `AUD`.
6. **Trust row above the fold.** Add a thin row directly under the hero CTA: `Trusted by coaches in [X] countries`. Use `// TODO: ASK LEE for real number` if unknown.

### 8.2 Do not touch
- Hero headline `EVERY SESSION. EVERY DETAIL. EVERY WEEK.`
- The 8 feature cards (already written in Joner voice)
- The Why Yearly Only section (premium positioning is intentional)
- The FAQ list (already covers price, cancellation, audience, frequency)

---

## 9. PAGE 3: Team Subscriptions (`/teams`)

### 9.1 What is this page
Lead-gen page for clubs, academies, schools, and football organisations who want bulk app access for their players and coaches. This is B2B. Longer sale cycle. The page does NOT have a self-serve checkout. It captures a lead and sends Lee an email.

### 9.2 Setup constants
```astro
const title = 'Team Subscriptions | Joner Football App'
const description = 'Give your whole club, academy, or school access to the Joner Football App. Bulk licenses, custom pricing, dedicated support.'
const bookCallUrl = '/contact?topic=teams'   // or a Calendly URL Lee will provide later
const contactEmail = 'leejones@jonerfootball.com'
```

### 9.3 Section-by-section

**Section 1: Hero**
- Eyebrow: `TEAMS, ACADEMIES, AND CLUBS`
- Headline (3-line stack): `ONE APP.` / `YOUR WHOLE CLUB.` / `ZERO PREP TIME.`
- Sub: "Give every player and coach in your organisation the full Joner Football App. Session plans, drills, follow-along programmes, and the way Lee coaches at the elite level. Bulk licenses, dedicated support, custom pricing."
- Primary CTA: `BOOK A TEAMS CALL` to `{bookCallUrl}`
- Secondary CTA: `EMAIL LEE DIRECTLY` to `mailto:{contactEmail}?subject=Teams Enquiry`
- No price line on this hero. Replace with: `Custom pricing. From 20 to 2,000 players. Dedicated onboarding.`

**Section 2: Who this is for**
- Eyebrow: `BUILT FOR`
- 3-column grid:
  1. **CLUBS.** Run your whole age-group structure on the same technical curriculum.
  2. **ACADEMIES.** Give your players a daily plan that complements your in-person sessions.
  3. **SCHOOLS.** Roll out structured football development across the whole student body.

**Section 3: Problem**
- Eyebrow: `THE CLUB PROBLEM`
- Headline: `EVERY COACH IS DOING THEIR OWN THING`
- 4 pain points:
  1. "Every coach in your club runs different sessions. No consistency across age groups."
  2. "Your players have nothing to do between training nights."
  3. "Your coaches spend Sunday building Tuesday's plan from scratch."
  4. "You want to lift the standard of your whole club but you cannot scale Lee."
- Transition: "That changes with Team Subscriptions."

**Section 4: Founder block**
- Eyebrow: `WHO YOU WORK WITH`
- Headline: `LEE JONES. DIRECT.`
- Body: "Team Subscriptions are not a self-serve plan. Lee runs the onboarding personally. You get a dedicated setup, a structure mapped to your age groups, and ongoing support from the Joner Football team."
- Photo: Lee with a group of coaches or in a workshop.
- CTA: `BOOK A TEAMS CALL`

**Section 5: What is inside (horizontal alternating cards)**
1. **WHOLE-CLUB ACCESS.** Every player and coach in your organisation, one app.
2. **COACHES TIER INCLUDED.** Every coach in your club gets the full Coaches Only section.
3. **CUSTOM ROLLOUT.** Lee builds the structure for your age groups and standards.
4. **DEDICATED SUPPORT.** A direct line for your coaches and managers.
5. **WORKSHOPS BOLT-ON.** Optional in-person or remote sessions with Lee for your coaching staff.
6. **REPORTING.** See what your players are training and how often.

**Section 6: Pricing transparency (B2B style)**
- Eyebrow: `HOW PRICING WORKS`
- Headline: `BUILT AROUND YOUR CLUB`
- 3-tier indicator (display only, not interactive):
  - **20 to 50 players:** Most academies and small clubs.
  - **50 to 250 players:** Mid-size clubs and full age-group structures.
  - **250+ players:** Multi-site clubs, federations, school networks.
- Sub: "Every Team Subscription is priced around the number of players, coaches, and the level of onboarding you need. Book a 15-minute call and Lee will quote you on the spot."
- CTA: `BOOK A TEAMS CALL`

**Section 7: Social proof testimonials**
3 cards in `/app` style. Use these placeholders (Lee will supply real ones):
1. "We rolled the app out across our U10 to U16 squads. Coaches stopped winging sessions. Our players are training between nights.", Director of Football, UK Academy
2. "Lee built us a 12-week structure for the start of season. Our whole club is on the same page now.", Head Coach, USA Club
3. "Best decision we made this season. Worth it for the coaches section alone.", Football Director, AUS Academy

**Section 8: FAQ (minimum 7)**
- How is the pricing worked out? (Per-player or per-coach, plus optional onboarding)
- How long is the agreement? (Annual, with multi-year discounts)
- Can we cancel? (Yes, at renewal)
- Who gets access? (Every player and coach you license)
- Does it include the Coaches Only tier for our coaches? (Yes)
- Can Lee come and run a workshop for our coaches? (Yes, as a bolt-on)
- How do we get started? (Book a call. 15 minutes. Lee quotes on the spot.)

**Section 9: Final CTA**
- Eyebrow: `READY TO LIFT YOUR CLUB`
- Headline: `BOOK 15 MINUTES WITH LEE`
- Sub: "Tell us your club, your numbers, and your goal. Lee will quote you on the spot."
- Primary CTA: `BOOK A TEAMS CALL`
- Secondary CTA: `EMAIL LEE DIRECTLY`

### 9.4 Contact form
If `bookCallUrl` is not yet a Calendly link, build a Brevo-integrated contact form using the pattern in `CLAUDE.md`:
- Form fields: Full Name, Club / Organisation, Role, Email, Number of Players (range), Country, Message (optional)
- POST to a new `/api/teams-enquiry.js` Vercel API route that pushes to Brevo list 22 (Upgrade sequence) or a new Teams list. Add the new list ID at the top of `api/teams-enquiry.js` and document it.
- Never put the Brevo API key client-side. Use `BREVO_API_KEY` env var.
- Reference existing working pattern: see `CLAUDE.md` section "Forms: CRITICAL PATTERN".

---

## 10. Workflow

### 10.1 Branch
```bash
git checkout main
git pull
git checkout -b overnight-landing-page-rebuild
```

### 10.2 Build order (suggested)
1. Coaches Only TODOs (smallest, page already 90% there)
2. 100-Day Programme (new page, fresh build)
3. Teams Subscriptions (new page, fresh build with form integration)

### 10.3 Commit pattern
Commit after each completed section. Plain English one-line commit messages.

Examples:
- `Add 100-day hero and problem section`
- `Wire up Teams enquiry form to Brevo API route`
- `Add sticky mobile CTA to Coaches Only`

### 10.4 Pre-flight before pushing
Run the QC scan from section 2.4 on every file you touched. Zero violations required.

```bash
# Quick all-file scan
grep -rnP "\x{2014}" src/pages/100-day.astro src/pages/teams.astro src/pages/app/for-coaches.astro
grep -rnP "\x{2013}" src/pages/100-day.astro src/pages/teams.astro src/pages/app/for-coaches.astro
grep -rniE "check out|don't miss|link in bio|unlock|elevate|no credit card" src/pages/100-day.astro src/pages/teams.astro src/pages/app/for-coaches.astro
```

### 10.5 Push
```bash
git push -u origin overnight-landing-page-rebuild
```
Vercel auto-creates a preview URL. Lee reviews on the URL.

### 10.6 Build verification
Before pushing, run:
```bash
npm run build
```
This catches Astro syntax errors and broken imports. Do not push a broken build.

---

## 11. Acceptance Criteria

A page is "done" when ALL of the following are true:

- [ ] QC scan returns zero em dashes
- [ ] QC scan returns zero en dashes
- [ ] QC scan returns zero banned words
- [ ] No `join_us` URLs
- [ ] Every `app.jonerfootball.com` href has `target="_blank" rel="noopener noreferrer"`
- [ ] Hero has eyebrow + 3-line headline + sub + dual CTA + price line (or B2B equivalent)
- [ ] Founder block uses Lee photo + signature pattern
- [ ] At least 6 horizontal feature cards
- [ ] At least 3 testimonial cards in `/app` style
- [ ] Minimum 7 FAQs including price + cancellation + audience
- [ ] Final CTA with both CTAs and price line
- [ ] Sticky mobile CTA wired up
- [ ] Schema markup added (or `// TODO: ASK LEE` for B2B page)
- [ ] `npm run build` passes
- [ ] Page is responsive at 375px, 768px, 1024px, 1440px
- [ ] All images have meaningful alt text matching captions
- [ ] Sanity override flag set to `false &&` with comment

---

## 12. Where to ask for help

If genuinely blocked, do NOT stop the build. Use one of:
1. `// TODO: ASK LEE: [specific question]` in the code
2. Add to a top-level `BUILD-QUESTIONS.md` file at the project root listing all questions in one place

Lee reviews both before merging.

---

## 13. What "great" looks like

Open `https://jonerfootball.com/app` in a browser. Scroll through it. Note:
- The way the hero feels (devices, video, scroll-expand)
- The audience rotator (Players / Coaches / Parents)
- The "Take a closer look" pills + image stage
- The Personal Guarantee block with the photo and signature
- The 3 testimonial cards
- The final CTA with app store badges

Every page you build should feel like a sibling of that page. Same brand. Same voice. Same level of polish. Just pointed at a different audience and a different offer.

Good luck. Ship it.
