# NIGHT 4 BUILD BRIEF , April 1, 2026

## LEE'S BIO (from live site jonerfootball.com)

Use this as reference for the About Lee rewrite:

- UEFA C licence at 16 (Wrexham AFC youth player)
- UEFA B licence at 19
- Academy Director at Rhyl FC Academy at 19
- Won international tournament in France with U14s (including best coach award)
- Qualified teacher, ran community football project for unemployed/ex-offenders
- Coached at Llandudno FC (player/coach)
- Trialled for A-League clubs including Central Coast Mariners
- Started Joner Football in Australia
- Coached A-League, W-League and elite international players
- Key stats to add: Voted Top 10 Technical Trainers in the World (2017), 2.1M social media followers, 50,000+ app downloads, camps in 15+ countries, based at brand new JFP HQ in Belrose Sydney

## PRIORITY ORDER

1. Homepage: merge hero + carousel into one slider
2. Fix blurry/low-quality images across the site
3. Remove all em dashes globally
4. Add "Home" to nav
5. About Lee rewrite
6. Camps FAQ + photos replacing emojis in "What to Expect"
7. Contact forms replacing email addresses
8. Partner logos (real images, not text)
9. Fix JFP stretched image
10. Build /hub page
11. Sanity CMS integration
12. App page pricing rebuild if not done
13. JFP pathway visual if not done
14. Shop page rebuild if not done

## BRAND RULES
- Colors: Red #E30613, Black #0A0A0A, White #FFFFFF
- NO em dashes or en dashes ANYWHERE
- No stock photos
- Mobile first
- Images must be 1920px+ wide for heroes, WebP quality 85+

## CAMP FAQ CONTENT

Q: What does the player need to bring?
A: Football boots for synthetic. Shin guards. Drinks bottle. Waterproof jacket. A smile. Good attitude.

Q: What should the player wear?
A: Black shorts. White socks. Joner Football will provide a training jersey.

Q: What to expect?
A: Expect energy, enthusiasm, intensity, knowledge, drills that you've never done before and above all else bags of fun. Our team of coaches will go above and beyond to make sure you are learning.

Q: Will bad weather cancel the camp?
A: No! Only really bad storms can delay the camp.

Q: Will there be photos and videos?
A: We will have our team of professional photographers and videographers on the day doing their thing. You can ask on the day for copies.

Q: What about sizing for the training jersey?
A: Please be mindful of the size you choose on the form. That is the size you will get. Be mindful of how much your son or daughter would have grown by the time the camp comes around.

## NAV UPDATE
```
[LOGO]    Home    Training    Camps    Workshops    Shop    More    [Download the App]
```

## HUB PAGE SPEC
See the full brief in Lee's message. Key points:
- /hub route
- ?embed=true hides nav/footer for Uscreen external tab
- Card-based grid, dark background, mobile-first
- Cards: Technique Test, Weekly Challenge, Football Quiz, Free Drill of the Week, Latest Blog, Ask Lee, Camp Announcements, New on App, Latest Drop
- Email capture at bottom with App Store badges
- Each card is a separate component

## SANITY CMS
- Camp listings, blog posts, hub weekly content, testimonials, partner logos
- Do NOT move page layouts, nav, pricing, forms, or SEO to Sanity
- Build alongside existing static content, swap when ready
- Sanity Studio deployable at studio route or subdomain

## CONTACT FORMS
Replace email addresses with forms:
1. General Enquiry: Name, Email, Phone, Message
2. Training Enquiry: Name, Email, Phone, Player's age, Club/team, Message
3. Coaching Role Application: Name, Email, Phone, Experience, Qualifications, Why JF?
All POST to Brevo webhooks.

## COACHABILITY BLOG POST
Already created at: src/pages/blog/coachability-most-important-trait-football.astro
Already added to blog index.
