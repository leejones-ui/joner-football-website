# JON-7 Ten Year Storyboard Homepage Prototype Brief

Status: ready for prototype
Source: Lee direction, April 29, 2026
Depends on: `docs/JON-6-lightweight-scroll-mechanic-audit.md`
Story source: `/Users/jonerai/.openclaw/workspace/dynasty/wiki/business/joner-football-story.md`

## Core Decision

The new Joner Football homepage hero should be a 10 year quick storyboard.

The football is the anchor, but the scroll experience is not about a football spinning. It is about the Joner Football story building around the football as the user scrolls.

The feeling we want from Lightweight is the pinned scroll mechanic, object evolution, chapter rail, and premium rhythm. The content must be Joner: real coaching, technique, growth, global scale, app, camps, staff, facility, partners, books, courses, and future tools.

## Creative Principle

One ball becomes a global football development system.

Start with one coach and one football on the grass in 2013. As the user scrolls, the story evolves into technique, social growth, app, global camps, HQ, staff, partners, books, courses, and the future Joner operating system.

This must feel like a premium sports documentary opening, not a timeline page and not a local coaching brochure.

## Prototype Route

Build this safely before replacing the homepage.

Recommended route:

`/home-storyboard-prototype`

Do not modify the live homepage until Lee approves the prototype.

## Desktop Scroll Structure

Pinned section length: 6 to 8 viewport heights.

Use one central stage with:

- football anchor
- chapter rail
- short uppercase text beats
- animated numbers
- image or video panels
- map points
- app phone frame
- partner and future product hints

After the pinned section releases, continue into normal fast homepage sections.

## Story Beats

### Beat 1: Origin, 2013

Headline:

FROM ONE BALL ON THE GRASS

Supporting idea:

Private and small group training. Real player development before the internet found it.

Visual:

Dark stage. One football. One training texture. Subtle grass or indoor pitch line. Small `2013` marker.

Motion:

Ball sits low and still. First scroll wakes it up.

### Beat 2: Technique Above Everything

Headline:

TECHNIQUE ABOVE EVERYTHING

Supporting idea:

First touch, weak foot, ball mastery, 1v1, confidence.

Visual:

Ball rotates into close technical details. Footwork lines, cone marks, training annotations, red precision marks.

Motion:

Ball moves closer to camera. Detail labels appear and fade.

### Beat 3: The Internet Took Notice

Headline:

THE WORK WENT GLOBAL

Supporting idea:

Views, followers, YouTube, Facebook, TikTok, Instagram, and global attention start climbing.

Visual:

Numbers click upward around the ball. Social icons stay minimal and brand-safe. Do not let this feel like a dashboard template.

Suggested counters:

- 2.5M+ total audience
- 382K+ YouTube subscribers
- 630K+ Facebook followers
- 639K+ TikTok followers
- 325K+ Instagram followers
- 50K+ app downloads

Motion:

Counters climb as the user scrolls. The ball spins faster for this beat, then settles.

### Beat 4: The Joner System

Headline:

THE METHOD BECAME A SYSTEM

Supporting idea:

The app, drills, coaches section, players, parents, session plans, and the repeatable Joner methodology.

Visual:

Phone/app frame appears beside or behind the ball. Drill cards, session plan lines, and coach/player/parent labels orbit subtly.

Motion:

Ball becomes the hub. App and content cards reveal around it.

### Beat 5: Camps And Global Training

Headline:

FROM SYDNEY TO THE WORLD

Supporting idea:

Sydney, LA, Houston, Dallas, Sacramento, Portland, and international camp energy.

Visual:

Map points light up. City names appear one by one. Camp image panels slide in briefly.

Motion:

Ball travels across a subtle map path, then returns centre.

### Beat 6: The Football Development Empire

Headline:

BIGGER THAN A TRAINING PAGE

Supporting idea:

HQ, staff, JFP, Joners Juniors, Mizuno, SKLZ, Penguin, courses, seminars, apparel, S&C, future tools.

Visual:

Storyboard panels stack around the ball: HQ, staff, app, camps, apparel, books, courses, partners.

Motion:

The world builds around the ball. This is the clearest empire moment.

### Beat 7: Action

Headline:

JOIN THE JONER WORLD

Supporting idea:

Download the app, book a camp, join the coaching world.

Visual:

Ball settles centre. Red CTA appears. Background returns to black for impact.

CTAs:

- Download the App
- Book a Camp
- Explore Training

## Mobile Version

Mobile must feel great, not like a broken desktop animation.

Use 4 beats only:

1. Origin
2. Technique
3. Growth and global proof
4. App and action

Rules:

- Ball or core visual must never disappear
- No long blank pinned areas
- Counters must be large and readable
- CTA should appear quickly
- Sticky app CTA remains available
- If animation fails, static storyboard cards must still tell the full story

## Asset Plan

### Image 2.0

Use Image 2.0 for concept graphics and premium storyboard panels:

- origin training scene
- technique close-up panel
- social growth graphic background
- app system panel
- global camps map style
- empire collage panel

Image 2.0 should not create fake logos or unrealistic trophies. Keep it premium and brand-safe.

### Real Joner Media

Use real Joner photos and video wherever trust matters:

- Lee coaching
- players training
- camps
- HQ
- staff
- app screenshots
- partner logos if available

### Codex

Codex owns implementation:

- pinned scroll mechanic
- chapter rail
- animated counters
- football object motion
- responsive states
- mobile fallback
- performance checks

## Technical Recommendation

Start with a standalone Astro prototype, not the live homepage.

First version should use:

- Astro route
- CSS sticky or fixed stage
- lightweight JavaScript scroll progress
- CSS/canvas football placeholder
- HTML counters
- static storyboard panels
- no heavy external animation library unless needed

Only upgrade to Three.js or a GLB football after the story timing is approved.

## What To Avoid

- Do not clone Lightweight
- Do not copy their assets, code, text, class structure, or design
- Do not make a generic spinning football hero
- Do not make it too literal or cartoonish
- Do not overload the first screen with every business unit
- Do not create mobile blank states
- Do not replace the live homepage until the prototype is approved

## Success Criteria

The prototype works if a visitor understands this in under 30 seconds:

- Joner started from real coaching
- The method is technique-first
- The brand became global
- The app is the scalable training system
- Camps, HQ, staff, partners, books, and courses are part of one machine
- Joner Football is bigger than a content account
- The next action is obvious

## First Codex Build Prompt

Build a safe Astro prototype route called `/home-storyboard-prototype` for the Joner Football website.

Use `docs/JON-6-lightweight-scroll-mechanic-audit.md` and `/Users/jonerai/.openclaw/workspace/dynasty/wiki/business/joner-football-story.md` as source context.

Do not modify the live homepage.

Create a pinned scroll hero that tells a 10 year Joner Football storyboard. The football is the visual anchor, but the story evolves around it as the user scrolls.

Desktop beats:

1. Origin, 2013, from one ball on the grass
2. Technique above everything
3. The work went global, animated social numbers and app downloads
4. The method became a system, app, drills, coaches, players, parents
5. From Sydney to the world, global camps and city markers
6. Bigger than a training page, HQ, staff, JFP, Joners Juniors, partners, books, courses, future tools
7. Join the Joner world, CTA buttons

Build with Astro, HTML, CSS, and lightweight JavaScript first. Use placeholder graphics and simple shapes if needed. Prioritise scroll timing, story clarity, mobile behaviour, and performance over final art.

Include a mobile version with 4 compressed beats and no blank pinned states.

Run build after changes and report the route, files changed, and any tradeoffs.
