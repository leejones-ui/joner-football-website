# JONER FOOTBALL — Website Concept

Inspired by lightweight.info. Not a clone. Stealing the feeling, not the design.

---

## PART 1 — LIGHTWEIGHT TEARDOWN

### What they actually built
Next.js app, dark theme, one giant scroll-pinned hero that holds the entire product story. Five beats stacked over ~5 viewports of scroll. The wheel is a real Three.js model (compressed GLB) lit by an HDRI environment map (.exr), not an image sequence. They run a film-grain canvas overlay on top of everything for that cinematic texture. CSS modules with hashed class names. Page is roughly 18,700px tall on desktop.

### Page structure (top to bottom)
1. Heavy black preloader with a thin progress bar. Gates the entire experience until the GLB and HDRI are ready.
2. Pinned hero with 3D wheel. Five scroll beats: WELCOME, PERFORMANCE ENGINEERED, HANDMADE IN GERMANY, ALPHA RIB TECHNOLOGY, MEILENSTEIN ART. The wheel rotates and the camera pushes in as text swaps.
3. A wide banner / mission section.
4. UGC strip (#RIDELIGHTWEIGHT) with rider quotes.
5. Big manifesto type. Capitalised, anchored centre.
6. Newsletter capture and footer.

### Hero experience
One sentence: the wheel does the talking, the words just label the chapters. Everything else gets out of the way. Black canvas, tiny eyebrow text in the corner, oversized centred wordmark, the model rotates as you scroll. No carousels, no badges, no clutter.

### Scroll behaviour
Smooth scroll feel (Lenis-style inertia). The hero is pinned for 4 to 5 screen heights. Each beat fades the previous text out and the next text in. The 3D model is the through-line that never disappears. After the hero unpins, the rest of the page scrolls normally.

### Animation patterns
Slow, tightly easing. No bounce. No spring. Letters fade up from below, sometimes mask-revealed line by line. The wheel is constantly moving very slightly even when you stop scrolling, almost like a breathing idle state. Film grain shimmers across the whole screen. Warm rim light around the edges of the page (a vignette glow that tells your eye "this is premium").

### Navigation
Borderline invisible. Logo top-left, four primary links, a language toggle. No mega-menus. The product is the navigation.

### Visual rhythm
Black, near-black, off-white, one subtle warm accent. Type system is one bold sans-serif at three sizes: tiny eyebrow, body, oversized headline. Everything left or centre aligned to a tight grid.

### Mobile experience (inferred)
The pinned scrolly hero is the highest-risk part on mobile. The pattern that works: shrink to 3 beats instead of 5, drop the camera dolly, keep the rotation simple. The grain overlay is cheap so it stays. Heavy preloader becomes a deal-breaker on slow networks, so they likely lazy-load the HDRI and serve a smaller GLB on phones.

### Likely tech approach
- Next.js 14 (App Router) + React Three Fiber
- Three.js with DRACO-compressed GLB
- HDRI lighting via .exr (RGBELoader / EXRLoader)
- Custom shader or Canvas2D film grain overlay
- Lenis or similar for smooth scroll
- GSAP ScrollTrigger (or Framer Motion) for the pinned hero and text swaps
- Vercel hosting (the build IDs in their script URLs match the Vercel deployment fingerprint)

### What makes it feel premium
The product is the hero, not the headline. Heavy preloader signals "this is going to be worth the wait". Restrained type. Patience in the motion. No stock photography. Film grain. The fact that it costs them performance and they spent it anyway.

---

## PART 2 — JONER FOOTBALL CONCEPT

### Core idea
The Joner ball is the wheel. It spins on its axis, never leaves the screen, and carries the user through a four-act story about elite training. Where Lightweight sells engineering, we sell mastery. Where they whisper, we punch.

Audience priority: coaches, parents, players. Primary CTA: Download the App. Brand: black, white, red. Nothing else.

### Homepage structure

1. **Preload curtain.** Black. Centre-screen, "JONER" types in letter by letter, then a tiny red dot pulses while the ball loads. Two seconds max. We do not gate the whole experience like Lightweight does. This is football, not a luxury watch.

2. **Pinned hero with the Joner ball.** Four beats over four viewports of scroll. Ball rotates, camera dollies, headline swaps:
   - Beat 1: "TRAIN LIKE THE BEST."
   - Beat 2: "MASTER THE BALL."
   - Beat 3: "BUILT FOR COACHES, PARENTS, PLAYERS."
   - Beat 4: "DOWNLOAD THE APP." (with the red CTA appearing under the headline)

3. **Numbers strip.** Three big stats only. 2.1M followers. 379K on YouTube. Coaches in five US cities and Sydney. Pure white type on black, red underline animates across as it enters viewport.

4. **The system.** Three-card scroll snap. Technique. Mastery. Mentality. Each card is a 4-second loop video of a real coaching moment. Hover or tap reveals one line of copy in white on red.

5. **The app.** A phone mockup pinned centre, the ball orbits it. Three short value props ride in beside it as you scroll. Single CTA button.

6. **Coaches section.** Plain grid of five faces. Black-and-white portraits. Hover plays a 2-second clip of them coaching. One quote each.

7. **Camps strip.** Horizontal scroll. LA. Sacramento. Portland. Houston. Dallas. Sydney. Each city is a card with one hero shot and a date.

8. **Athletes / players reel.** Tiny grid of 9 to 12 social posts pulled from your real Instagram feed via API. UGC proof.

9. **Manifesto block.** Oversized centred type. Two lines. "WORK HARDER. THINK SHARPER. PLAY FREER." Red full stop on the last word.

10. **Footer.** Email capture, app store badges, social icons, legal. Minimal.

### Hero section concept

Black canvas. Top-left, the JONER wordmark in white. Top-right, a tiny "DOWNLOAD APP" pill in white with a red dot. Centre of viewport is the ball. Beneath the ball, the headline for the current beat in oversized white sans-serif. To the right of the ball, a thin white progress line shows you how far through the hero story you are. As you scroll the ball rotates, the camera drifts in slightly, and the headlines swap with a mask-reveal. No buttons in the hero except the corner pill. The ball is the only thing that moves until beat four, where a red CTA rises up from below the fold.

### Football spin interaction (the showpiece)

Replace the wheel idea with this. The ball is a real 3D mesh, lit cinematically, sitting at the centre of the hero canvas. Default state: the ball spins slowly on a tilted axis (like a real football mid-flight) at about 8 degrees per second. As you scroll, scroll velocity is added to the spin, so the faster you scroll the faster it spins. When you stop, it eases back to the idle rotation. The camera moves on its own track from a slightly low angle (looking up at the ball, hero stance) to a top-down angle (looking at the ball flat, "ready to strike"). At beat 4 the ball settles dead centre, dead still, and the red CTA appears under it. The whole thing tells a story without a single word: ball arrives, ball moves, ball is ready, you click.

Premium touches: a subtle contact shadow under the ball that distorts as the ball rotates. A faint red glow on one panel of the ball (signature). Film grain over the whole canvas. Soft particles drifting in the background like dust in a stadium light. No motion blur on slow rotation, but a hint of radial blur when the user scrolls fast.

### Section by section flow

| # | Section | Motion |
|---|---|---|
| 1 | Preload | Letters type in, red pulse |
| 2 | Hero scrolly (4 beats) | Ball rotates and camera dollies as you scroll, text mask-reveals |
| 3 | Stats strip | Numbers count up on viewport entry, red underline draws left to right |
| 4 | The system (3 cards) | Cards translate in from below with stagger, video loops on view |
| 5 | The app | Phone fades in, ball orbits via 3D path |
| 6 | Coaches | Portraits desaturate to b&w, hover plays clip |
| 7 | Camps | Horizontal scroll snap, parallax on city cards |
| 8 | UGC reel | Subtle infinite marquee |
| 9 | Manifesto | Oversized type fades up line by line |
| 10 | Footer | Email field underlines red on focus |

### Copy direction (in your voice)
Short. Direct. Active verbs. No corporate fluff. The headlines are commands, not slogans.

Examples:
- "Train like the best."
- "We build worldies."
- "If you want to get good, get on this."
- "Coaches use it. Parents trust it. Players live in it."
- "From Sydney to Houston. We bring the work."
- "No theory. Just reps."

Save the brand language ("worldie", "got it on toast", "I'm having that") for one or two punctuation moments, not every line. Used too often it becomes a costume.

### Mobile-first UX
The hero scrolly stays, but cut to 3 beats and shrink the ball to roughly 50% of viewport width. Drop the camera dolly on small screens (it's a 60fps lottery on cheap phones). Keep the rotation, the grain, and the text swaps. Stats strip stacks vertically. Cards become a horizontal swipe instead of a snap row. Coach grid becomes a 2-up. App section flips to a stacked layout with the phone above the copy.

Touch behaviour: scroll velocity drives spin on mobile too, which feels great because flicking on a phone naturally sends the ball spinning.

### What to avoid so the site stays fast
1. No background autoplay video on the hero. The 3D model carries it.
2. No HDRI loaded on mobile. Use baked image-based lighting in a small JPG instead.
3. No third-party chat widgets. They wreck Lighthouse scores.
4. No webfont overload. One typeface, three weights maximum.
5. No animation on every block. Animate the hero, the manifesto, and the CTAs. Let the rest sit still.
6. No carousel libraries. Native scroll-snap.
7. No GIFs. MP4 or AV1 only, served via CDN.
8. No client-side analytics until the page is visible.
9. No prices anywhere on the site (per your rule).

---

## PART 3 — BUILD PLAN

### Recommended technical approach

For the football spin we have four real options. Here is the call.

**Winner: Three.js (via React Three Fiber), with a procedural icosahedron football. Fallback to image-sequence on slow devices.**

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| CSS only (3D transforms on a sprite) | Tiny, fast, runs anywhere | Looks flat, no real lighting, panels will not feel real | Use as the absolute fallback for very slow phones |
| Image sequence (PNG frames scrubbed by scroll) | Looks photo-real, great on mobile, no WebGL needed | 100 to 200 frames is 5 to 15 MB. No interactive idle spin. Cannot react to scroll velocity smoothly | Solid plan B and what we serve to Save-Data users |
| Three.js / R3F with a real GLB | Photoreal, lit properly, true 3D, cheap to animate | GLB plus HDRI is 1 to 4 MB to download. Needs careful perf work | Best on desktop and modern phones |
| Three.js with a procedural icosahedron football | Tiny payload (under 50 KB of code, no textures), looks stylised-premium, scales perfectly | Not photoreal | **Best balance for launch. Upgrade to GLB later if needed.** |

The hybrid: ship the procedural icosahedron version on day one. It loads in under a second, looks distinctly Joner, and runs at 60fps everywhere. In v2, swap the geometry for a real GLB scanned from a Joner-branded match ball. Same code.

### Performance tradeoffs

- Three.js (core) is around 150 KB gzipped. React Three Fiber adds maybe 30 KB.
- An icosahedron sphere with subdivision 1 is 80 faces. Trivial GPU cost.
- HDRI environment lighting is what makes 3D feel real. .exr files are large. Use a baked .hdr at 1K resolution, not 4K. On mobile, swap for a 256x128 JPG environment.
- Run the 3D scene at a max DPR of 1.5, not the native pixel ratio. You will not see the difference. You will feel the framerate.
- Pause rendering when the hero leaves viewport. Save battery and CPU.
- Lighthouse target: 90+ performance on mobile, 95+ on desktop. Achievable with this stack.

### How to prototype it quickly

I built you a working hero prototype as part of this brief. It's a single HTML file with Three.js inline, a procedural football, scroll-driven rotation, the four story beats, the red CTA, and the film grain overlay. Open it in any browser. It is the fastest way to feel whether the concept lands before you commit to a build.

The build file: `joner-hero-prototype.html`

### Assets we need to commission

1. **Real Joner ball GLB** (v2 upgrade from the procedural one). Scan a real Joner-branded ball with a phone photogrammetry app, clean it up in Blender, compress with DRACO. Brief is "the actual ball Joner camps use, with a red Joner stripe on one panel".
2. **HDRI environment.** A neutral studio HDRI is fine to start. If we want it to feel like a Joner setting, shoot a 360 in your Sydney studio with an iPhone Pro and convert.
3. **Coach portraits.** Five coaches, locked-off shoulders-up shots, neutral background, available in colour and b&w.
4. **System loops.** Three 4-second slow-motion clips. Technique. Mastery. Mentality. Tight crops, no faces.
5. **Camp hero shots.** One image per city. Wide. Sun on faces. Real.
6. **Wordmark and red dot lockup.** SVG, two weights. Already on brand.
7. **Type system.** Pick one bold sans (Suisse Int'l, GT Walsheim, Inter, or Söhne). Three weights only.

### Exact first component to build

Build the **PinnedHero** component first. Everything else is a normal page. The hero is the entire risk and the entire wow. Ship it standalone in Storybook, get it feeling perfect, then drop it into the home page.

Component contract:

```
<PinnedHero
  beats={[
    { eyebrow: "01", headline: "TRAIN LIKE THE BEST." },
    { eyebrow: "02", headline: "MASTER THE BALL." },
    { eyebrow: "03", headline: "FOR COACHES, PARENTS, PLAYERS." },
    { eyebrow: "04", headline: "DOWNLOAD THE APP.", cta: { label: "Get the app", href: "https://app.jonerfootball.com" } }
  ]}
  ballMode="procedural"   // or "glb" for v2
/>
```

Inside it: an R3F Canvas, the Football mesh, three lights (key, fill, rim red), a ScrollControls instance from drei, and a stack of `<Text>` overlays driven by scroll progress. About 250 lines of TSX in production.

### Build paths (you said you weren't sure who would build it)

**Solo dev (recommended for v1):**
A senior front-end with Astro plus Tailwind plus React-island plus React Three Fiber experience. About 4 to 6 weeks for a polished launch.
- Week 1: Astro skeleton, Tailwind config, brand tokens, type system. Static homepage in plain HTML.
- Week 2: PinnedHero component built with R3F, procedural football, scroll beats wired up. Desktop only.
- Week 3: Mobile pass on the hero. Reduce-motion fallback. Image-sequence fallback path.
- Week 4: Stats, system, coaches, camps sections. CMS wiring (content can live in Astro Content Collections or Sanity).
- Week 5: App section, UGC reel, manifesto, footer. SEO. Schema. OG images.
- Week 6: Performance pass. Lighthouse work. Real device testing. Launch.

**Small agency:**
Designer plus dev plus motion person. 8 to 10 weeks but the production value goes up. Custom GLB ball, custom HDRI, real coach photoshoot, custom typography licensing, motion direction across the whole site. Recommend this if you want the site to be the calling card for the next two years. Recommend solo if you want to ship fast and iterate.

### Stack confirmation (matches your brief)

- **Framework:** Astro 4 with React islands for the interactive bits
- **Styling:** Tailwind, with a tight design-token layer (`bg-jet`, `bg-bone`, `bg-blood`, `text-bone`, etc) to enforce the three-colour rule
- **3D:** Three.js + React Three Fiber + drei (helpers)
- **Smooth scroll:** Lenis
- **Animation:** GSAP ScrollTrigger for the pinned hero, native CSS for everything else
- **CMS:** Sanity or Astro Content Collections
- **Hosting:** Vercel or Cloudflare Pages
- **Analytics:** Plausible or Cloudflare. No Google Tag Manager bloat.

---

## ONE LAST THING

The thing that will make or break this is patience in the motion. Lightweight feels premium because nothing rushes. Every easing curve is slow. Every text fade has a beat. Resist the urge to fill silence with extra animation. The ball spins. The headline lands. The CTA waits for the user. That is the whole game.

If the prototype feels right when you open it, we are on. If it feels close but not quite, tell me which beat is off and I will tighten it.
