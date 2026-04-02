# JEFFREY , OVERNIGHT BUILD BRIEF (NIGHT 2)
## March 29/30 2026 , You smashed it last night. Tonight we go deeper.

---

## STATUS CHECK , WHAT'S DONE

✅ Homepage , fully built
✅ Training page , fully built (JFP, Pro Training, Joners Juniors, Game Analysis, Reports, Partnerships)
✅ Camps page , fully built (all 6 camps, filters, "What to Expect", gallery placeholder)
✅ App page , fully built (features, pricing, FAQ, testimonials)
✅ HQ page , fully built (facility details, programs, location, Google Maps link)
✅ Nav + Footer , working across all pages
✅ Meta Pixel , installed
✅ GA4 , installed (G-H73LP37D8D)

🟡 Workshops hub , stub (just two links)
🟡 About , stub (placeholder text only)
🟡 Shop , stub (just two links)
🟡 Blog , not checked / likely stub
🟡 Teams , not checked / likely stub
🟡 Workshops sub-pages , not checked

---

## TONIGHT'S WORK , IN ORDER

---

### PHASE 1: FIXES ON EXISTING PAGES (do these first)

#### 1. Fix App Store Links
The Apple and Google Play links are wrong across the entire site.

**Apple App Store (CORRECT LINK):**
```
https://apps.apple.com/au/app/joner-football-app/id6737069275
```

**Google Play (CORRECT LINK):**
```
https://play.google.com/store/apps/details?id=tv.uscreen.jonerfootball
```

**Fix these EVERYWHERE they appear:** Homepage, App page, HQ page, footer, and any other page with download CTAs.

**Also fix:** The free section link on the App page pricing section currently goes to `https://app.jonerfootball.com/categories/category-vpi8uazway4` , this is CORRECT. Keep it.

#### 2. Fix Camp Dates , REMOVE APRIL CAMPS

**IMPORTANT:** Sacramento and Portland camps will be FINISHED by the time this website goes live. REMOVE them from the camps page entirely.

**Keep only these camps:**
- **LA Complete Player Experience:** June 22-24 at Gol Soccer Complex, North Hollywood
- **Houston:** June 2026
- **Dallas:** June/July 2026
- **Sydney:** July 2026 ft M Grande

Remove Sacramento and Portland from the camp cards grid.

#### 3. Fix Pricing on App Page
You've listed pricing as:
- Monthly: $14.99
- Annual: $99.99

**DO NOT display specific prices.** Lee's rule is never mention specific app pricing on the website , pricing varies by region and Uscreen handles it. Replace the pricing cards with:

- **Free:** "Access the free section. No credit card required." → [Start Free]
- **Full Access:** "Monthly and annual plans available. Start with a free trial." → [View Plans] → links to app.jonerfootball.com
- Remove the exact dollar amounts. Keep the "Save 44%" messaging if you want but don't show the numbers.

#### 4. Homepage , App Store Badges
The App Store and Google Play badge images need to be real badge assets, not text. Download the official badge SVGs:
- Apple: https://developer.apple.com/app-store/marketing/guidelines/ (get the black "Download on the App Store" badge)
- Google: https://play.google.com/intl/en_us/badges/ (get the "Get it on Google Play" badge)
- Place them as actual images, not styled text divs

---

### PHASE 2: PHOTOS FROM THE MAC MINI

You have access to Lee's coaching photos on the Mac Mini in the "lee coaching folders". Time to replace every placeholder.

**How to approach this:**
1. Browse the photo folders on the Mac Mini
2. Pick the best, highest-energy photos for each section
3. Optimize them for web (compress to WebP format, max 1200px wide for hero images, 800px for cards, 400px for thumbnails)
4. Place them in `public/images/` in the repo organized by page

**Photo assignments:**

**Homepage:**
- Hero background: Best wide-angle training shot (high energy, action, The HQ or outdoor pitch). Needs to work with dark overlay + white text on top.
- Audience router cards (3 photos): one of a player training, one of Lee coaching coaches, one of a parent watching/kid training
- App showcase: screenshot of the actual app (take screenshots from app.jonerfootball.com on a phone or use browser dev tools to simulate mobile)
- Camp highlights cards: one photo from a US camp, one from an Australian camp, one high-energy group shot
- Testimonial section: if there are photos of parents/coaches/players at sessions, use them as testimonial avatars

**Training page:**
- Hero: training action shot (ideally at The HQ)
- JFP section: photo of a JFP session in action, small groups, coaches working with players
- Pro Training section: photo of Lee coaching a professional player (there should be pro training specific photos)
- Joners Juniors section: photo of young kids training, fun environment, indoor facility
- Dean McDonnell: if there's a photo of Dean coaching, use it. If not, use a coaching team photo.

**Camps page:**
- Hero: wide camp photo (big group, energy, outdoor)
- Individual camp cards: use camp photos from relevant locations if available. US camps, Sydney camps.
- Past camps gallery: pick 8 of the best camp photos across different locations
- "What to Expect" section: 4 small photos showing coaching, small groups, kit, atmosphere

**App page:**
- Take actual screenshots from the Joner Football app (app.jonerfootball.com)
- Need at least 3-4 different screens: drill video playing, session plan, drill library, coaches section
- Use a phone mockup frame if you have one, or just use clean screenshots

**HQ page:**
- 3 photos of the facility: the pitch, training in action, the outside/entrance
- If there are photos specifically from inside The HQ at Belrose, prioritize those

**All images must have proper alt tags** (see SEO section below).

---

### PHASE 3: SEO ON ALL EXISTING PAGES

Go through every page that's already built and add/fix the following:

#### Meta Tags (every page needs these)

```html
<title>[Page Title] | Joner Football</title>
<meta name="description" content="[unique 150-160 char description for this page]">
<meta name="keywords" content="[relevant keywords]">
<link rel="canonical" href="https://jonerfootball.com/[page-path]">

<!-- Open Graph -->
<meta property="og:title" content="[Page Title] | Joner Football">
<meta property="og:description" content="[same as meta description]">
<meta property="og:image" content="https://jonerfootball.com/images/og-[page].jpg">
<meta property="og:url" content="https://jonerfootball.com/[page-path]">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Joner Football">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="[Page Title] | Joner Football">
<meta name="twitter:description" content="[same as meta description]">
<meta name="twitter:image" content="https://jonerfootball.com/images/og-[page].jpg">
```

**Page-specific meta descriptions (use these exactly):**

- **Homepage:** "Joner Football , elite football coaching, 1,500+ training drills, global camps, and the world's best coaching app. Train with Coach Joner. Technique above everything."
- **Training:** "Sydney football training programs at Joner Football. JFP Performance program, professional training, and Joners Juniors. Indoor facility at Belrose. Ages 8+."
- **Camps:** "Joner Football elite training camps in USA, Australia, and worldwide. Limited spots. Ages 8-18. Book now for 2026 camps in California, Texas, and Sydney."
- **App:** "Download the Joner Football App , 1,500+ drills, session plans, follow-along programs, coaches section, and weekly live sessions. Free section available."
- **HQ:** "The Joner Football HQ , brand new indoor training facility at 20 Narabang Way, Belrose, Sydney. Professional standard surface. All-weather training."
- **Workshops:** "Joner Football workshops , online coaches course and mindset seminars. Level up your coaching and mental game with the Joner Football methodology."
- **Shop:** "Joner Football official apparel and training resources. Shop the collection and download the training app."
- **About:** "About Lee Jones and Joner Football. Voted Top 10 Technical Trainers in the World. From Sydney to global. The Joner Football story."

#### Schema Markup

Add JSON-LD schema to the `<head>` of each page:

**BaseLayout (every page) , Organization schema:**
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Joner Football",
  "url": "https://jonerfootball.com",
  "logo": "https://jonerfootball.com/images/logo.png",
  "sameAs": [
    "https://www.instagram.com/jonerfootball/",
    "https://www.youtube.com/@jonerfootball",
    "https://www.facebook.com/Jonerfootball/",
    "https://www.tiktok.com/@jonerfootball"
  ],
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "+61-404-780-351",
    "contactType": "customer service",
    "email": "leejones@jonerfootball.com"
  }
}
```

**Training page + HQ page , LocalBusiness schema:**
```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Joner Football HQ",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Unit 2, 20 Narabang Way",
    "addressLocality": "Belrose",
    "addressRegion": "NSW",
    "postalCode": "2085",
    "addressCountry": "AU"
  },
  "telephone": "+61-426-885-924",
  "url": "https://jonerfootball.com/hq",
  "openingHours": "Mo-Sa",
  "priceRange": "$$"
}
```

**Each camp , Event schema (add to camps page for each camp):**
```json
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Joner Football Camp , LA Complete Player Experience",
  "startDate": "2026-06-22",
  "endDate": "2026-06-24",
  "location": {
    "@type": "Place",
    "name": "Gol Soccer Complex",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "North Hollywood",
      "addressRegion": "CA",
      "addressCountry": "US"
    }
  },
  "organizer": {
    "@type": "Organization",
    "name": "Joner Football"
  }
}
```
Repeat for each camp with correct details.

**Workshops , Course schema:**
```json
{
  "@context": "https://schema.org",
  "@type": "Course",
  "name": "Joner Football Online Coaches Course",
  "description": "Learn the Joner Football coaching methodology. Application-based online workshop for football coaches.",
  "provider": {
    "@type": "Organization",
    "name": "Joner Football"
  }
}
```

**App page , SoftwareApplication schema:**
```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Joner Football App",
  "operatingSystem": "iOS, Android",
  "applicationCategory": "SportsApplication",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "AUD"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "50000"
  }
}
```

#### Heading Hierarchy
Check every page has a clean H1 → H2 → H3 structure. Rules:
- Only ONE `<h1>` per page (the main page title)
- `<h2>` for major sections
- `<h3>` for subsections within those
- Never skip levels (no h1 → h3 without h2 in between)

#### Alt Tags on All Images
Every `<img>` tag needs a descriptive alt attribute. When you add the real photos, use these patterns:
- Training photos: `alt="Joner Football player training at The HQ indoor facility in Belrose"`
- Camp photos: `alt="Joner Football elite training camp in Los Angeles, California"`
- Coach photos: `alt="Lee Jones coaching at Joner Football"`
- App screenshots: `alt="Joner Football App showing drill library with 1500+ training drills"`

#### Internal Linking Strategy
Add contextual internal links within page content:
- Training page → link to App page ("Continue your training at home with the Joner Football App")
- Training page → link to Camps ("Take your development further at our global camps")
- Camps page → link to Training ("Based in Sydney? Train with us year-round")
- App page → link to Camps ("Meet Coach Joner in person at our camps")
- HQ page → link to Training (already done)
- Every page → the email capture section should link to App as a secondary CTA

#### Sitemap
Generate an XML sitemap at `/sitemap.xml`. Astro likely has a plugin for this:
```bash
npm install @astrojs/sitemap
```
Configure with `site: 'https://jonerfootball.com'` in astro.config.

#### robots.txt
Create a `public/robots.txt`:
```
User-agent: *
Allow: /
Sitemap: https://jonerfootball.com/sitemap.xml
```

---

### PHASE 4: BUILD THE REMAINING PAGES

#### A. About Page (`/about`) , FULL BUILD

This page needs real content, not a placeholder.

**Hero:**
- Photo of Lee coaching (ideally an iconic shot)
- Heading: **"THE JONER FOOTBALL STORY"**
- Sub: "From Sydney to the world. Technique above everything."

**Lee's Story Section:**
Lee Jones started Joner Football in Sydney, Australia with one mission , technique above everything. What began as individual coaching sessions has grown into a global football development brand with over 2.1 million followers, 50,000+ app downloads, and training camps across 15+ countries.

In 2017, Joner Football was voted Top 10 Technical Trainers in the World.

Today, Joner Football operates out of a state-of-the-art indoor facility in Belrose, Sydney, runs the Joner Football Performance program, delivers elite camps worldwide, and provides the Joner Football App , the most comprehensive football training platform available, with 1,500+ drills used by players and coaches around the globe.

Lee's coaching philosophy is simple: master the ball, and the game opens up. Every drill, every session, every camp is built around technical excellence, high intensity, and genuine player development.

**Head Coach , Dean McDonnell Section:**
Dean McDonnell is the Head Coach of the Joner Football Performance program. With a deep background in player development and a passion for technical coaching, Dean leads the JFP team across all Sydney training locations.

Contact Dean: 0426 885 924

**The Coaching Team Section:**
"Our team of qualified, experienced coaches deliver every session to a professional standard. Grouped by age and ability, with a maximum of 6 players per group, every player gets the attention they deserve."

(Placeholder for additional coach profiles , Lee will provide names and bios)

**Partnerships Section:**
- **FPA** , Strength & Conditioning. Professional physical development integrated into the JFP program.
- **FullNinety** , Tactical Analysis. Game analysis and video breakdowns for JFP players.

**Contact Section (anchor: #contact):**
- General enquiries: leejones@jonerfootball.com
- Training enquiries link → /training
- Camp enquiries link → /camps
- Joners Juniors: jonersjuniors@jonerfootball.com
- Coaching roles: link to application form or email

**Careers/Coaching Roles:**
"Think you've got what it takes to coach at Joner Football? We're always looking for passionate, qualified coaches."
- Brief application form or email link

---

#### B. Workshops Hub Page (`/workshops`) , FULL BUILD

Currently just two links. Build it properly.

**Hero:**
- Heading: **"LEVEL UP YOUR GAME"**
- Sub: "Coaching workshops and mindset seminars from Joner Football"

**Two Workshop Cards (side by side on desktop, stacked on mobile):**

Card 1: Online Coaches Course
- Placeholder image (coaching workshop)
- Heading: **"ONLINE COACHES COURSE"**
- Text: "Application-based coaching workshop for serious football coaches. Learn the Joner Football methodology."
- CTA: **[Learn More]** → /workshops/coaches-course

Card 2: Mindset Seminars
- Placeholder image (seminar/group setting)
- Heading: **"MINDSET SEMINARS"**
- Text: "Mental performance workshops for players and coaches. Build resilience, confidence, and a winning mindset."
- CTA: **[Learn More]** → /workshops/mindset-seminars

**App Coaches Section CTA:**
"Already a coach? Access the Coaches Section inside the Joner Football App , mentoring clips, session plans, and analysis breakdowns."
- CTA: **[Access in App]** → https://app.jonerfootball.com

---

#### C. Online Coaches Course Page (`/workshops/coaches-course`) , FULL BUILD

**Hero:**
- Heading: **"ONLINE COACHES COURSE"**
- Sub: "Learn the Joner Football methodology. Application only."

**What You'll Learn:**
- The Joner Football coaching methodology explained
- How to structure technical training sessions
- Drill design and session planning principles
- How to coach different age groups and ability levels
- Managing small groups for maximum development
- The mental side of coaching , building confidence in players

**Who It's For:**
- Grassroots coaches looking to improve their sessions
- Academy coaches wanting a fresh approach to technical development
- Aspiring professional coaches building their methodology
- Parents who coach their kids' teams

**What's Included:**
- Full access to the coaching course content library
- Session plan templates you can use immediately
- Video breakdowns of the Joner Football coaching method
- Discount on the Joner Football App (Coaches Section access)

**Testimonials:**
(Use placeholder quotes for now)
- "Completely changed how I approach training. My players are more engaged and improving faster." , Coach, UK
- "The session plan templates alone saved me hours every week." , Academy Coach, Sydney

**Application Form:**
- Name
- Email
- Phone
- Current coaching role/experience
- Club or team name
- Why do you want to join?
- CTA: **[Submit Application]**
- Form POSTs to webhook (placeholder endpoint for now)

---

#### D. Mindset Seminars Page (`/workshops/mindset-seminars`) , FULL BUILD

**Hero:**
- Heading: **"MINDSET SEMINARS"**
- Sub: "The mental side of football. For players and coaches."

**What It Covers:**
- Mental resilience and dealing with setbacks
- Confidence building on and off the pitch
- Pressure performance , performing when it matters
- Pre-match preparation and routines
- Goal setting and self-motivation
- The mindset of elite players

**Who It's For:**
- Players (youth and senior) wanting a mental edge
- Coaches looking to support their players' mental game
- Parents wanting to understand the psychological side of development

**Format:**
"Seminars delivered online and in-person at select camps and events. Register your interest to be notified when the next seminar is announced."

**Register Interest Form:**
- Name
- Email
- Role (Player / Coach / Parent)
- CTA: **[Register Interest]**
- Form POSTs to webhook (placeholder endpoint)

---

#### E. Shop Page (`/shop`) , FULL BUILD

**Hero:**
- Heading: **"SHOP"**
- Sub: "Official Joner Football apparel and training resources"

**Three Sections:**

Section 1: Joner Apparel
- Photo grid or banner showing apparel (if photos available on Mac Mini, use them , otherwise placeholder)
- Text: "Official Joner Football training gear, match wear, and off-field apparel."
- Text: "Collect in person at The HQ , 20 Narabang Way, Belrose"
- CTA: **[Shop Apparel]** → https://apparel.jonerfootball.com

Section 2: Training App
- App mockup or screenshot
- Text: "1,500+ drills, session plans, follow-along programs, and more."
- CTA: **[Download the App]** → /app

Section 3: Books (Coming Soon)
- Placeholder section with a "Coming Soon" badge
- Text: "The Joner Football book is on its way. Stay tuned."
- CTA: **[Get Notified]** → email capture (name + email, feeds to Brevo when wired)

---

#### F. Teams / Club Subscriptions Page (`/teams`) , FULL BUILD

**Hero:**
- Heading: **"TRAIN YOUR WHOLE SQUAD"**
- Sub: "Team and club subscriptions for the Joner Football App"

**Why Teams Love It:**
- Give every player access to 1,500+ drills
- Coaches get session plans they can run at training
- Players train independently between sessions
- Track development across the squad
- One subscription, whole team access

**How It Works:**
1. Tell us your team size
2. We send you a custom pricing quote
3. Onboard your squad in minutes

**Who It's For:**
- Club coaches with squads of 10-50+ players
- Academies looking for a training platform
- Schools running football programs
- State or national associations

**Contact Form:**
- Name
- Email
- Club/Team name
- Number of players
- Message
- CTA: **[Get a Quote]**
- Form POSTs to webhook (placeholder)

---

#### G. Blog Page (`/blog`) , STRUCTURE + FIRST 5 POSTS

Set up the blog infrastructure and write 5 SEO-targeted posts. These should be proper articles, 600-800 words each, targeting long-tail search terms.

**Blog index page:**
- Clean card grid layout
- Each card: featured image, title, excerpt (first 2 sentences), read time, date, category tag
- Categories: Drills | Coaching Tips | Player Development | Camp Stories

**Post 1: "10 Football Drills You Can Do Alone at Home"**
- Target keyword: "football drills at home"
- Cover: ball mastery, wall work, first touch, weak foot, close control
- Include: "For 1,500+ drills like these, download the Joner Football App"
- CTA at bottom: app download + email capture

**Post 2: "How to Improve Your First Touch in Football"**
- Target keyword: "improve first touch football"
- Cover: cushion technique, body positioning, receiving on the move, weak foot receiving
- Reference: Joner Football methodology, technique above everything

**Post 3: "The Best Football Training Program for Kids (Ages 8-12)"**
- Target keyword: "football training for kids"
- Cover: what to look for in a training program, importance of technical focus at young ages, small group training benefits
- Mention: Joners Juniors program in Sydney, the Joner Football App for at-home training

**Post 4: "What Makes a Great Football Coach? 5 Things to Look For"**
- Target keyword: "what makes a great football coach"
- Cover: technical knowledge, communication, adaptability, passion, player-centred approach
- Mention: Joner Football coaching team, Online Coaches Course

**Post 5: "Football Camp Packing List , Everything Your Child Needs"**
- Target keyword: "football camp packing list"
- Cover: boots, shin guards, water, sunscreen, attitude, what to expect at a camp
- Mention: Joner Football camps, link to /camps

**Each blog post must have:**
- Proper H1 title, H2 subheadings
- Meta description (unique, 150-160 chars)
- Schema markup (Article type)
- Alt-tagged images
- Internal links to at least 2 other pages on the site
- App download CTA at the bottom
- Email capture section at the bottom

---

### PHASE 5: GOOGLE MAPS EMBED ON HQ PAGE

Replace the "Google Maps embed coming soon" placeholder with an actual embedded map.

Use this iframe:
```html
<iframe
  src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3319.5!2d151.2164!3d-33.7394!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2s20+Narabang+Way+Belrose+NSW+2085!5e0!3m2!1sen!2sau"
  width="100%"
  height="400"
  style="border:0;"
  allowfullscreen=""
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade">
</iframe>
```

If that embed URL doesn't render correctly, search Google Maps for "20 Narabang Way, Belrose NSW 2085" and grab the correct embed code from Maps → Share → Embed.

---

### PHASE 6: VERIFY GA4 TRACKING

GA4 should already be installed from Night 1.

**GA4 Measurement ID:** `G-H73LP37D8D`

Verify it's in BaseLayout.astro `<head>`:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-H73LP37D8D"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-H73LP37D8D');
</script>
```

If not there, add it.

---

## RULES FOR TONIGHT

1. **Photos first.** The site looks 10x better with real photos. Browse the Mac Mini folders and get images onto every page before anything else structural. Optimize for web , WebP format, compressed.
2. **SEO as you go.** Every time you touch a page, add the meta tags, schema, and alt tags before moving on. Don't leave it as a separate pass.
3. **No specific app pricing anywhere.** Remove the $14.99 and $99.99 from the app page. Link to the app and let Uscreen handle pricing display.
4. **Commit after every page.** Don't batch. Push to GitHub after finishing each page so nothing is lost.
5. **All links must work.** Before you finish tonight, click every link on every page. No broken links, no placeholder hrefs, no "#" links that go nowhere. If a page doesn't exist yet, either build it or link to the closest relevant page.
6. **Canonical URLs should use jonerfootball.com** (the real domain), not the Vercel staging URL. We're building for production , the DNS swap will make these correct.

---

## PRIORITY ORDER IF YOU RUN OUT OF TIME

If you can't finish everything, here's what matters most:

1. Fix the broken links and wrong prices (Phase 1) , 30 mins
2. Add real photos from the Mac Mini (Phase 2) , 1-2 hours
3. SEO on all existing pages (Phase 3) , 1-2 hours
4. About page (Phase 4A) , 1 hour
5. Workshops hub + both sub-pages (Phase 4B/C/D) , 1.5 hours
6. Shop page (Phase 4E) , 30 mins
7. Teams page (Phase 4F) , 30 mins
8. Blog structure + 5 posts (Phase 4G) , 2-3 hours
9. Google Maps embed (Phase 5) , 15 mins
10. GA4 tracking verification (Phase 6) , 15 mins

That's roughly 8-10 hours of work. If you finish early: go back through every page on mobile view and check nothing is broken, overlapping, or hard to tap.

---

## WHEN YOU'RE DONE

Run a Lighthouse audit on the homepage and training page. Target: 90+ on Performance, Accessibility, Best Practices, and SEO. Screenshot the results and save them , Lee will want to see these.

Lee checks the staging URL in the morning. Make it count. 🔥

---

## KEY LINKS REFERENCE

| What | Link |
|------|------|
| Apple App Store | https://apps.apple.com/au/app/joner-football-app/id6737069275 |
| Google Play | https://play.google.com/store/apps/details?id=tv.uscreen.jonerfootball |
| Free Section | https://app.jonerfootball.com/categories/category-vpi8uazway4 |
| App Home | https://app.jonerfootball.com |
| Apparel Shop | https://apparel.jonerfootball.com |
| GA4 ID | G-H73LP37D8D |
| Meta Pixel | 232666285545279 |
