# JON-6 Lightweight Scroll Mechanic Audit

Status: complete
Source audited: https://lightweight.info/en
Method: Playwright desktop and mobile review, scroll-state screenshots, DOM inspection, resource inspection
Rule: inspiration only. Do not copy their code, assets, text, branding, class structure, model files, or implementation.

## Verdict

The magic is not a spinning wheel. The magic is a pinned product story where one central object evolves through timed scroll chapters.

For Joner, the football cannot just spin in the middle. It needs to carry the story: roots, technique, coaching system, app, global camps, and the wider Joner Football empire.

## What Lightweight is doing

### 1. Fixed smooth-scroll wrapper

The page uses a fixed `smooth-wrapper` that fills the viewport while the document body provides scroll height.

Observed desktop:

- Viewport: 1440 x 1100
- Body height: 19132px
- Main hero section height: about 5500px
- Hero pin wrapper stays viewport-sized and is moved with transforms
- After the pinned sequence releases, the rest of the page becomes normal content

Observed mobile:

- Viewport: 390 x 844
- Body height: 11918px
- Same fixed wrapper pattern
- Mobile keeps the pinned intro but the mid-sequence is much weaker and can appear blank in automated capture

Translation for Joner:

Use one pinned hero stage for the first major experience. Do not make the whole site scroll-jacked. The wow should happen up front, then the site must become easy and fast.

### 2. One object controls the story

The wheel is always the visual anchor. It changes position, scale, crop, lighting, and camera angle while text beats change around it.

Observed stages:

1. Dark intro, wheel mostly hidden, headline appears
2. Transition to light technical canvas
3. Wheel close-up moves across screen
4. Rim/profile view appears
5. Component/product feature reveal
6. Regular content begins

Translation for Joner:

The ball should not sit there like decoration. It should become the navigation object.

Joner stages should be:

1. Ball in darkness, Joner origin and intensity
2. Ball close-up, technical mastery and first touch detail
3. Ball opens the coaching system, drills, app, session plans
4. Ball moves through the global map, camps, coaches, Sydney to USA
5. Ball releases into the full homepage, app, camps, shop, courses, books, seminars

### 3. Text beats are chapter markers, not paragraphs

Lightweight uses short uppercase statements with tiny eyebrow labels.

Observed beats:

- Welcome, The Evolution Of Performance
- Philosophy, Performance Engineered
- Craft, Handmade In Germany
- Innovation, Alpha Rib Technology
- Evolution, Meilenstein Art

Translation for Joner:

Use short chapter beats. No long hero paragraphs.

Recommended Joner beats:

- 01 ROOTS, BUILT ON THE GRASS
- 02 TECHNIQUE, MASTER THE BALL
- 03 SYSTEM, COACHES PARENTS PLAYERS
- 04 GLOBAL, FROM SYDNEY TO THE WORLD
- 05 APP, DOWNLOAD THE TRAINING SYSTEM

### 4. The left rail makes it feel engineered

Lightweight has a fixed left progress rail with numbered chapters.

Observed desktop rail:

- Fixed position
- Thin vertical progress line
- Small section labels
- Labels visible as `01 philosophy`, `02 craft`, `03 innovation`
- It acts as a chapter tracker, not a normal menu

Observed mobile rail:

- Thin rail remains
- Labels are largely hidden
- It is present but less useful

Translation for Joner:

Use a left rail on desktop only. On mobile, turn it into a small top or bottom progress marker.

Joner rail labels:

- 01 Roots
- 02 Technique
- 03 System
- 04 Global
- 05 App

### 5. Letter animation is split per character

Headlines are split into individual character elements. This enables tight mask or character reveal timing.

Translation for Joner:

We do not need to copy the character DOM approach. Use CSS clip-path or simple line masks first. The motion needs to feel premium, not busy.

Best Joner version:

- Eyebrow fades first
- Headline reveals line by line
- Supporting text appears only on chapter 2 onward
- CTA only appears on final beat

### 6. Background state matters

Lightweight changes the whole page mood from black to pale technical grey. That contrast makes the scroll feel like a real scene change.

Translation for Joner:

Stay inside brand colours only:

- Black intro
- Dark grey technical section
- White flash or white technical canvas only for one chapter
- Red pulse as the Joner signature
- Back to black for the app CTA

No gradients as a brand style. Subtle radial lighting is acceptable as scene lighting, not brand colour.

### 7. The regular page starts after the showpiece

Once the pinned product story ends, Lightweight goes into normal modules:

- Video or media block
- Community strip
- Brand story panel
- Newsletter
- Footer

Translation for Joner:

After the pinned hero, release into normal fast homepage sections:

1. Proof numbers
2. What Joner Football does
3. App section
4. Training and JFP
5. Camps
6. Shop and apparel
7. Books, courses, seminars
8. Coaches and partners
9. Email capture
10. Footer

## Performance notes

Observed resource shape:

- About 1.79MB script transfer on desktop
- About 1.78MB script transfer on mobile
- Main 3D model file: about 348KB GLB
- Environment file: about 103KB EXR on desktop capture
- Two large font files: about 371KB combined
- Multiple canvases, including a film grain canvas and a WebGL canvas

What this means for Joner:

We can afford one special hero, but not a heavy clone.

Recommended launch approach:

- Vanilla Astro page
- One client-side hero island only if needed
- CSS and canvas first
- Three.js only if the prototype proves it is worth the weight
- No React Three Fiber in v1 unless we accept extra dependency weight
- No HDRI on mobile
- No autoplay video behind the hero
- Pause rendering after the pinned section leaves view
- Respect `prefers-reduced-motion`

## Mobile risk

Lightweight is much less convincing on mobile in the audit. The intro works, but mid-scroll captures become mostly pale empty space with the rail still visible.

That is the warning.

For Joner, mobile must not depend on perfect WebGL and scroll timing. It needs a simpler version that still feels premium.

Mobile plan:

- 3 chapters only
- Ball stays visible at all times
- No complex camera dolly
- No hidden mid-scroll blank states
- CTA visible by the third chapter
- Normal sections begin quickly
- Use native scroll, not a heavy smooth-scroll library

## Build recommendation for Joner

Do not copy Lightweight's code path. Build the same mechanic in a Joner-safe way.

### Desktop mechanic

- One `PinnedStoryHero` section
- Height: 500vh max
- Sticky or fixed viewport stage
- Football canvas or layered image object
- Scroll progress from 0 to 1
- Chapter index derived from progress
- Left rail tied to chapter index and progress
- Text masks tied to chapter transitions
- Ball transform tied to progress

### Mobile mechanic

- Height: 300vh max
- No left label rail
- Top progress marker or small bottom rail
- Ball never disappears
- Reduced chapter count
- Static fallback image if canvas fails

### Football object options

1. Layered PNG/WebP football with CSS transforms
   - Fastest
   - Good enough for first prototype
   - Limited realism

2. Canvas 2D image sequence
   - Strong visual control
   - Can use generated or rendered frames
   - Needs asset compression discipline

3. Three.js procedural football
   - Best original interactive feel
   - Medium code cost
   - No heavy model asset required

4. Real GLB Joner football
   - Best long-term version
   - Needs a proper 3D asset
   - Should be v2, not first rebuild pass

My recommendation: build the first Joner prototype with a CSS/canvas football and the real scroll mechanic. Upgrade to Three.js only after the story timing feels right.

## Exact JON-7 build brief

Build `PinnedStoryHero.astro` as a self-contained prototype route before replacing the live homepage.

Route:

- `/home-lightweight-prototype`

Component structure:

- `src/components/home/PinnedStoryHero.astro`
- Optional script in `src/scripts/pinned-story-hero.js`
- Optional CSS inside component first, then move stable rules into global CSS only after approval

Desktop story beats:

1. ROOTS, FROM THE GRASS TO THE WORLD
2. TECHNIQUE, MASTER THE BALL
3. SYSTEM, COACHES PARENTS PLAYERS
4. GLOBAL, CAMPS APPAREL COURSES BOOKS
5. APP, DOWNLOAD THE TRAINING SYSTEM

Interaction:

- Football starts low and large in the dark
- It rises and rotates as the first text appears
- It pushes left on the technique beat
- It snaps centre on the system beat with app/cards orbiting lightly
- It tracks across a subtle map/city marker layer on the global beat
- It settles on the app CTA beat
- CTA appears only at the end

Non-negotiables:

- No full homepage replacement until Lee approves the prototype
- No copy of Lightweight code or assets
- No external paid libraries
- No prices outside the app pricing page
- Must build and pass mobile sanity before review

## Audit artifacts

Generated files:

- `tmp/lightweight-audit/report.json`
- `tmp/lightweight-audit/desktop-contact-sheet.jpg`
- `tmp/lightweight-audit/mobile-contact-sheet.jpg`

The contact sheets are for internal audit only and should not be shipped or used as assets.
