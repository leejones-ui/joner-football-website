# JON-9 Homepage Graphics Asset Plan

Status: ready for graphics pass
Source: Lee feedback, April 30, 2026
Route: `/home-storyboard-prototype`

## Decision

The big circle should not be the final hero object.

Keep the circle language as a technical overlay, like a coaching analysis reticle, but replace the main anchor with a real football or player-touch visual.

Best final style:

- Real Joner photo or video frame as the full-screen scene
- A real football or player-touch moment as the anchor
- Subtle technical rings, red dot, and precision lines layered over it
- Text moves around the screen by beat
- Dark to white scene shift remains
- No generic abstract ball target as the main visual

## Why

The current scroll mechanic works. The concept is now right.

The weak point is graphics. The circle makes it feel like a prototype and slightly like a tech radar. Lightweight works because the wheel is a real premium object. Joner needs the equivalent: a real ball, boot, player touch, app screen, camp moment, or map scene, depending on the beat.

## Visual System

Use a hybrid system:

1. Real Joner media for trust
2. Image 2.0 keyframes for premium scenes we cannot shoot quickly
3. Technical overlay graphics for the Lightweight feeling
4. Codex to integrate the layers and scroll motion

## Beat By Beat Asset Direction

### 01 Origin

Best asset:
A moody real training photo, ball at foot, Lee or player in frame.

Overlay:
Small red dot on the ball, one thin circle, one pitch line.

Do not use:
Huge abstract circle as the main thing.

### 02 Method

Best asset:
Close-up of boot, ball, cone, player touch, or Lee coaching detail.

Overlay:
Touch zone marks, red precision lines, coaching cue labels.

### 03 Built On The Grass

Best asset:
JFP, Joners Juniors, small group, or The HQ action photo.

Overlay:
Light technical white canvas, group structure, simple labels.

### 04 App System

Best asset:
App screen or phone mockup mixed with real training footage.

Overlay:
Drill cards, session plan lines, coach/player/parent labels.

### 05 Global

Best asset:
Camp photo or group training with map/city points layered over it.

Overlay:
Sydney, LA, Houston, Dallas, Sacramento, Portland. Audience and app counters.

## What To Source First

Find 3 to 5 strong real images for each category:

- ball at foot
- Lee coaching detail
- small group training
- The HQ
- app screenshots or app mockups
- global camps
- team or staff
- partners and book assets if available

Pick images with:

- strong subject
- space for text
- dark or clean background
- visible football context
- premium energy
- no messy crowds behind the headline area

## Image 2.0 Prompt

Use this when real images are not enough.

```text
Create premium Joner Football homepage storyboard graphics using real football training energy.

Style:
Black, white, red only
Premium sports documentary
Nike football campaign feel
F1 technical film energy
Elite training lab
Sharp, cinematic, serious
Real coaching environment
No cartoon style
No fake logos
No prices
No clutter
No pastel colours

Create blank keyframe-style website graphics with no embedded text.
Leave negative space for website text.
Use a real football or player-touch moment as the central anchor.
Use subtle technical rings, red dot overlays, pitch lines, coaching cue marks, and precision details.
Do not make the big circle the main object. It should only be a technical overlay.

Create variations for:
1. Origin, one ball on the grass, 2013, moody dark training feel
2. Technique, close-up boot and ball, touch zones, cone shadows
3. Method, coaching detail, player receiving instruction, technical marks
4. System, app screen shapes, drill cards, session plans, football-first
5. Global, camp energy, world map or city points, football connecting the story
```

## Codex Change Request

Once assets are selected, ask Codex to:

- Replace the abstract circle anchor with real football or player-touch visual assets
- Keep subtle rings as overlays only
- Tune each beat so the object feels different, not the same circle on every frame
- Add an animated counter treatment on the global beat
- Keep the full-screen dark-to-light scroll mechanic
- Preserve mobile readability
- Run `npm run build`

## Rule

Do not rebuild the scroll mechanic again unless it breaks.

The scroll is good enough now. The next win is graphics.
