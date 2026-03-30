# JEFFREY — OVERNIGHT BUILD BRIEF (NIGHT 3)
## March 31 / April 1 2026

Read skills/joner-website/SKILL.md context. This brief builds on top of it.

## BRAND RULES (from SKILL.md)
- Colors: Red #E30613, Black #0A0A0A, White #FFFFFF, Gray dark #1A1A1A, Gray light #F5F5F5
- No em dashes ever
- No stock photos
- Audience priority: Coaches > Parents > Players
- NEVER display specific app subscription prices EXCEPT on the /app pricing page where Lee has now approved showing them
- Mobile first everything

## PRIORITY ORDER

### 1. JONER FOOTBALL LOGO — TOP LEFT OF EVERY PAGE
The "JONER FOOTBALL" text in nav needs to be the actual logo image.
- Get logo from current live site (jonerfootball.com) or find in public/images/
- Place top left in nav, clickable to homepage
- ~140-180px wide desktop, scale on mobile
- White version on dark nav
- It's in Nav.astro so one change fixes all pages

### 2. HOMEPAGE IMAGE CAROUSEL — "WHAT WE DO" SLIDER
Full-width image slider between Hero and Social Proof Bar (or replace hero if better).

8 slides, each full-width with text overlay:
1. Training Programs - "ELITE TRAINING PROGRAMS" / "Sydney-based. World-class coaching." → /training
2. Global Camps - "WORLD RECOGNISED CAMPS" / "15+ countries. Limited spots." → /camps
3. The App - "1,500+ DRILLS ON YOUR PHONE" / "The Joner Football App." → /app
4. Professional Training - "PROFESSIONAL PLAYER COACHING" / "Train with Coach Joner." → /training#pro-training
5. Joners Juniors - "FIRST TOUCH STARTS HERE" / "Joners Juniors. Ages 5+." → /training#joners-juniors
6. The HQ - "THE JONER FOOTBALL HQ" / "Brand new indoor facility. Belrose, Sydney." → /hq
7. Workshops - "LEVEL UP YOUR COACHING" / "Workshops and courses for coaches." → /workshops
8. Apparel - "JONER APPAREL" / "On-field and off-field gear." → /shop

Design: 60-70vh, auto-play 3-4s, pause on hover/touch, nav dots + arrows, swipeable mobile, dark overlay on images, lightweight (Embla/CSS scroll-snap), lazy-load.

### 3. APP PRICING — 4 PLANS + COMPARISON TABLE

Replace current /app pricing with:

Plan 1: Monthly - $23.99/month, 7-day FREE trial
CTA → https://app.jonerfootball.com/checkout/new?o=183083
Features: 1,500+ Videos ✓, New Content Weekly ✓, Daily Challenges ✓, Community ✓, Live Sessions ✓, Follow-along Programs ✓, Age Specific Content ✓, DM Lee ✗, Team Training ✗, Coaches Section ✗

Plan 2: Annual (MOST POPULAR) - $204.99/year, 7-day FREE trial, "Save $83/year"
CTA → https://app.jonerfootball.com/checkout/new?o=183092
Everything Monthly + DM Lee ✓, Team Training ✓, Coaches Section ✗

Plan 3: For The Coaches - $319.99/year, NO trial, full access day one
CTA → https://app.jonerfootball.com/checkout/new?o=202578
Everything Annual + Coaches Section ✓, PDF Season Plans ✓, Advanced Team Training ✓, Pro Player Sessions ✓, Workshop Discounts ✓, Coaching Templates ✓

Plan 4: Club Subscriptions - Custom pricing
CTA → /teams
Custom onboarding, Multi-seat, Transferable seats, Dedicated community, Single-invoice, Priority support, Account rep, Bespoke plans

ADD comparison table below cards. 3 columns (Monthly | Annual | Coaches) with ✓/✗ rows. Scrollable on mobile.

### 4. FIX IMAGE FITTING
All pages: object-fit: cover + object-position: center on heroes/cards. No stretched/squished images.

### 5. YOUTUBE VIDEOS
Embed from youtube.com/@jonerfootball:
- Homepage: 3-4 Shorts in horizontal carousel "Latest from Joner"
- Training: highlight videos per section
- Camps: 2-3 camp highlight videos
- HQ: facility tour video
Use lazy loading iframes.

### 6. PARTNERS — ADD MIZUNO + SKLZ
Full list: Mizuno, SKLZ, FPA, FullNinety
Show logos + one-line descriptions on Training page (bottom), About page, optionally homepage.

### 7. ABOUT PAGE — REMOVE DEAN
Remove Dean's section/photo/bio/phone from About page.
Dean stays on Training page under JFP only.

### 8. JFP PLAYER PATHWAY VISUAL
Visual journey map on Training page near JFP section:

JONERS JUNIORS → JONER 6-8 YEAR OLD PROGRAM → JFP → [Benefits fan out: App, S&C (FPA), FullNinety, Game Analysis, Mentorship, High Level Training] → A CAREER IN FOOTBALL

Design: Red #E30613 pathway line, icons per stage, benefits branch out, aspirational goal at bottom. SVG or styled HTML. Must be a showpiece.

### 9. SHOP PAGE REBUILD
4 category cards (2x2 desktop):
1. On-Field Training Gear → apparel.jonerfootball.com
2. Off-Field Apparel → apparel.jonerfootball.com
3. Downloadable Products → /app
4. The App → /app

Books teaser banner "Coming Soon" + email capture.
Physical pickup note: The HQ, Unit 2, 20 Narabang Way, Belrose.

### 10. BREVO FORM INTEGRATION
Wire all forms to Brevo webhooks. Test submissions.

### 11. COACHES COURSE PAGE — FULL BUILD
Hero, "What You'll Learn" (6 points), "Who It's For", "What's Included", testimonials, application form.

### 12. HOMEPAGE APP SCREENSHOTS
Replace placeholder with real screenshots from app.jonerfootball.com (simulate mobile in dev tools). 3-4 screens in phone mockup.

### 13. TECHNIQUE TEST PAGE
Landing page with email gate (name + email → Brevo) before showing test.
Embed existing test from is.gd/jonertechtest if possible.

### 14. LINK AUDIT
Every link on every page must work. No # placeholders. No "coming soon" on built pages. Correct App Store + Google Play links. Google Play: https://play.google.com/store/apps/details?id=tv.uscreen.jonerfootball

### 15. MOBILE CHECK
Test at 375px: sticky bar, hamburger, carousels swipeable, images don't overflow, forms usable, pathway scales.

## LAST TASK: Update SKILL.md
Move completed pages from NEEDS WORK to COMPLETE. Add new components. Update known issues. Add YouTube IDs. Add Uscreen checkout URLs. Add Mizuno + SKLZ. Note Dean removal. Log unfinished items.

## DEPLOYMENT
After all work, commit and run: npx vercel --prod
