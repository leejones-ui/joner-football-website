# JON-8 Visual Storyboard Keyframes

Status: ready for Image 2.0 and prototype
Source: Lee computer-use audit and homepage direction, April 29, 2026
Depends on: `docs/JON-6-lightweight-scroll-mechanic-audit.md` and `docs/JON-7-ten-year-storyboard-homepage-prototype-brief.md`

## The Starting Point

Do not start with code.

Start with 7 static keyframes that feel like stills from the finished scroll experience. Once the keyframes feel right, Codex builds the pinned scroll mechanic around them.

The audit confirms the winning pattern:

- one dominant visual anchor
- pinned section
- short text beats
- negative space
- object or scene transformation
- progress feedback
- proof after the abstract sequence
- mobile version that is simpler and safer

For Joner, the visual anchor is the football, but the experience is a 10 year storyboard.

## Visual Rule

Each frame should feel like a premium sports documentary title sequence.

Not a timeline graphic.
Not a social media stats graphic.
Not a local coaching website.

Think:

- Nike football campaign
- F1 technical film
- Netflix sports documentary opener
- Elite training lab
- Black, white, red only

## Keyframe Set

Create these as individual stills first.

Recommended formats:

- 16:9 desktop keyframe, 1920 x 1080
- 9:16 mobile crop keyframe, 1080 x 1920
- Leave negative space for code text overlay
- Make versions with no text first

### Keyframe 1: Origin, 2013

Visual:

One football in darkness on grass or indoor pitch texture. A subtle red light catches one edge. The feeling is humble but intense.

Story:

This started with real coaching, one ball, one player, one session.

Text overlay later:

FROM ONE BALL ON THE GRASS
2013

### Keyframe 2: Technique Above Everything

Visual:

Close-up football and boots. Technical footwork marks, cone shadows, red precision lines, ball mastery feel. The ball is closer and more detailed than frame 1.

Story:

First touch, weak foot, 1v1, ball mastery, confidence.

Text overlay later:

TECHNIQUE ABOVE EVERYTHING

### Keyframe 3: The Internet Took Notice

Visual:

The ball stays central while numbers and social proof build around it like a premium data wall. Use abstract counters, not messy platform screenshots.

Story:

The work went global through real training content.

Text overlay later:

THE WORK WENT GLOBAL
2.5M+ AUDIENCE
50K+ APP DOWNLOADS

### Keyframe 4: The Joner System

Visual:

The ball becomes the hub. Around it are clean app screen shapes, drill cards, session plans, coach/player/parent labels, and training diagrams.

Story:

The method became a repeatable system for players, parents, and coaches.

Text overlay later:

THE METHOD BECAME A SYSTEM

### Keyframe 5: Global Camps

Visual:

A dark world or USA/Australia map layer with red city points. Sydney, LA, Houston, Dallas, Sacramento, Portland. Football travels through the map as the connector.

Story:

Joner moved from local training to global camp energy.

Text overlay later:

FROM SYDNEY TO THE WORLD

### Keyframe 6: The Empire

Visual:

Premium collage around the ball: HQ, staff, JFP, Joners Juniors, app, camps, apparel, books, courses, partners. This should feel controlled and expensive, not cluttered.

Story:

Joner Football is a football development company, not a content account.

Text overlay later:

BIGGER THAN A TRAINING PAGE

### Keyframe 7: Action

Visual:

The ball settles centre. The background is black again. Red glow. App phone or app CTA area appears cleanly. This is the final click moment.

Story:

After seeing the story, the visitor knows what to do.

Text overlay later:

JOIN THE JONER WORLD
DOWNLOAD THE APP
BOOK A CAMP

## Image 2.0 Master Prompt

Use this to create the first visual direction set.

```text
Create 7 premium website storyboard keyframes for the new Joner Football homepage.

The site will use a pinned scroll experience inspired by luxury sports product storytelling, but this must be original to Joner Football.

Brand:
Joner Football
Black #0A0A0A
Red #E30613
White #FFFFFF
Dark grey #1A1A1A
Light grey #F5F5F5
No other colours
No pastels
No gradients as a brand style
No fake logos
No prices
No childish graphics
No cartoon style
No clutter

Visual feel:
Premium football development company
Nike level sports campaign
F1 technical film energy
Netflix sports documentary opener
Elite training lab
Fast, cinematic, expensive, serious
Real football coaching feel
Technique above everything

Important:
Create the images as mostly blank keyframes with no embedded text first.
Leave strong negative space where website code can place the headline and counters later.
The football should be the visual anchor across the full sequence, but the story around it evolves.

Create these 7 keyframes:

1. ORIGIN 2013
One football in darkness on grass or indoor pitch texture. Subtle red rim light. Humble but intense. Feels like the beginning of a serious coaching story.

2. TECHNIQUE ABOVE EVERYTHING
Close-up football and boots. Technical footwork marks, cone shadows, red precision lines, ball mastery feel. Premium and sharp.

3. THE WORK WENT GLOBAL
Football central with abstract social growth counters and data energy building around it. Make it feel premium, not like a generic dashboard. Leave space for animated numbers.

4. THE METHOD BECAME A SYSTEM
Football as the hub, with clean app screen shapes, drill cards, session plan lines, and coach/player/parent system elements around it. Futuristic but still football-first.

5. FROM SYDNEY TO THE WORLD
Dark global map or USA/Australia map layer with red city points. Sydney, LA, Houston, Dallas, Sacramento, Portland. Football connects the locations.

6. BIGGER THAN A TRAINING PAGE
Controlled premium collage around the ball: HQ, staff, app, camps, apparel, books, courses, partnerships, football development empire. Not cluttered.

7. JOIN THE JONER WORLD
Final black hero frame. Football settled centre, red glow, clean space for app CTA, premium closing frame.

Output requirements:
Create each keyframe in 16:9 desktop format.
Also create a mobile 9:16 crop concept for each if possible.
No text embedded unless requested separately.
Make each keyframe distinct, but clearly part of the same visual system.
```

## Text Overlay Prompt

After the blank keyframes are approved, use this for text-overlay variants.

```text
Using the approved Joner Football storyboard keyframes, create text-overlay versions for website concept review.

Keep text large, bold, uppercase, clean, and readable.
Use only black, white, red, dark grey, and light grey.
Do not overcrowd the image.
Make the text look like premium website typography, not a poster.

Use these overlays:

1. FROM ONE BALL ON THE GRASS
2013

2. TECHNIQUE ABOVE EVERYTHING
First touch. Weak foot. Ball mastery. 1v1.

3. THE WORK WENT GLOBAL
2.5M+ audience
50K+ app downloads

4. THE METHOD BECAME A SYSTEM
For coaches, parents, and players.

5. FROM SYDNEY TO THE WORLD
Camps. Coaching. Community.

6. BIGGER THAN A TRAINING PAGE
App. HQ. Staff. Camps. Books. Courses. Partners.

7. JOIN THE JONER WORLD
Download the App
Book a Camp
```

## Codex Prototype Direction

Codex should not invent the visuals first. Use placeholder panels or approved keyframes.

Build the prototype like this:

1. Create `/home-storyboard-prototype`
2. Pinned stage with 7 beats on desktop
3. 4 compressed beats on mobile
4. Football anchor remains visible across the sequence
5. Keyframe panels fade, slide, scale, or mask in around the ball
6. Counters animate during the social growth beat
7. Progress rail on desktop
8. Small progress bar or dots on mobile
9. Normal homepage sections release after the pinned story

## First Test Goal

The first prototype does not need final art.

It needs to answer one question:

Does scrolling through the Joner story feel premium, clear, and exciting in the first 20 to 30 seconds?

If yes, then polish visuals.
If no, change the storyboard before investing in 3D or heavy animation.
