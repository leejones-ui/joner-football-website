# Launch QA Checklist

Use this as the morning pass before DNS cutover or final approval.

## Critical paths

- Homepage hero CTA opens `/app`
- `/app` free content CTA opens `https://app.jonerfootball.com/categories/category-vpi8uazway4`
- `/camps` cards open the matching dynamic camp pages
- Each dynamic camp page submits to `/api/camp-registration` and redirects to payment/app
- `/training`, `/shop`, `/about`, and `/workshops` all have a working app CTA

## Visual checks

- Mobile nav opens and closes cleanly on iPhone width
- Sticky mobile CTA does not cover important form buttons
- Camp cards stack cleanly on mobile with no clipped buttons
- App screenshots and phone mockups do not overflow on small screens
- Footer links wrap cleanly and stay tappable

## Content checks

- No public CTA relies on the old `/join` pricing page
- Camp list only shows LA, Houston, Dallas, and Sydney
- Shop copy does not promise products that are not live
- No obvious placeholder labels such as fake filters or dead anchor buttons

## Known follow-up

- `npm run build` currently fails in this environment with `SecItemCopyMatching failed -50`
- App store badges on `/app` are still rendered as styled badge blocks, not official image assets
