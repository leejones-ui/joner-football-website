# Coaching Pros YouTube landing page

## Scope

- Public but unlisted route: `/coaching-pros-free/`
- `noindex, nofollow` and excluded from the generated sitemap
- No navigation entry or changes to existing pages
- Successful form submissions redirect to:
  `https://app.jonerfootball.com/programs/coaching-pros-ep-1-e5a655`

## Consent behavior

The free episode is not conditional on marketing consent.

- Marketing checkbox not selected: no Brevo request or contact write; the visitor gets the episode.
- Marketing checkbox selected: the server connector must be explicitly enabled and configured. It checks for an existing contact, preserves email blacklists and an existing `NEWS_OPT_IN=false`, then adds only eligible contacts to the configured list.
- Existing contacts and duplicate-creation races are handled without replacing unrelated attributes or lists.
- Brevo errors fail closed and are shown as a retryable form error; the endpoint never reports a save it did not complete.

## Staged Brevo activation contract

Do not activate until the exact list and consent schema have been reviewed in Brevo.

Required server-only environment values:

- `COACHING_PROS_BREVO_ENABLED=true`
- `BREVO_API_KEY`
- `BREVO_COACHING_PROS_LIST_ID` — the numeric ID for exact list name `Dribbling YT video leads`

The connector uses the existing boolean contact attribute `NEWS_OPT_IN`. Dedicated consent timestamp/version/event attributes were not available at implementation time, so none are invented or sent.

No browser bundle receives the API key or list ID. This release does not create a list, create attributes, activate an automation, send email, or alter subscription webhooks.

## Verification

Run:

```sh
npm run test:coaching-pros
npm test
npm run build
```

The focused suite covers nonconsent access, affirmative consent, existing opt-outs, blacklists, duplicate contacts, duplicate-creation races, upstream errors, same-origin enforcement, payload limits, route isolation, noindex, sitemap exclusion, CTA copy, and exact redirect destination.
