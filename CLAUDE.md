# Joner Football Website: Project Rules

## Stack
- **Framework**: Astro 6 (island architecture, SSG)
- **Styling**: Tailwind CSS v4 (via @tailwindcss/vite)
- **CMS**: Sanity (client in src/sanity/)
- **Deployment**: Vercel
- **Node**: >=22.12.0
- **Staging**: https://joner-football-website.vercel.app
- **Production**: jonerfootball.com (not yet live, do not break staging)

## Project Structure
```
src/
  components/    Reusable .astro components
  layouts/       Page layout wrappers
  lib/           Utility functions, Sanity queries
  pages/         One file = one route
  sanity/        Sanity schema and client config
  styles/        Global CSS
```

## Key Pages
- `/` Homepage (index.astro)
- `/technique-test` Technique scoring tool (forms must send to Brevo)
- `/app` App landing page
- `/hub` Content hub
- `/camps` Camps info
- `/blog` Blog (Sanity-backed)
- `/shop` Merch (jonerfootball.com/shop/)

## Component Conventions
- One component per file, named clearly (HeroSection.astro not Hero.astro)
- Props typed at the top with TypeScript interfaces
- No inline styles. Tailwind only
- Images: use Astro's built-in Image component for optimisation
- Icons: inline SVG preferred, keep them small

## Forms: CRITICAL PATTERN
All forms MUST use a Vercel API route for server-side Brevo integration.
NEVER put the Brevo API key in client-side code.

Pattern (copy from technique-test-five.vercel.app/api/submit-email.js):
- Create `api/[form-name].js` in project root (NOT in src/)
- Read BREVO_API_KEY from environment variable
- POST to Brevo contacts API: https://api.brevo.com/v3/contacts
- Return JSON {success: true} or {error: message}
- Set BREVO_API_KEY in Vercel environment variables (not in code)

Existing working example: technique-test-five.vercel.app (live, confirmed working)

## Brevo List IDs
- Hot APP Leads: list 2
- USA Camps: list 5
- Upgrade sequence: list 22
(Do not hardcode these. Use environment variables or a config file)

## Deployment
- Push to main = auto-deploys to Vercel staging
- `npm run build` to test locally before pushing
- Check Vercel build logs if deployment fails
- No secrets in git. Use Vercel environment variables dashboard

## Known Issues / Watch Out For
- `JF assets /` folder has a trailing space in the name. Use exact path with space
- Instagram API cannot set custom reel covers. Thumbnail must be prepended to video
- Homepage carousel uses absolute positioning. Slides overlap intentionally

## What NOT To Do
- Do not install new npm packages without checking if the functionality already exists
- Do not create new pages without checking src/pages/ first
- Do not add custom CSS if Tailwind can handle it
- Do not commit .env files or any file with API keys
