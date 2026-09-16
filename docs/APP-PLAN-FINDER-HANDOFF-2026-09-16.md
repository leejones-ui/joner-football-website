# App plan finder — preview handoff, 16 September 2026

## Scope and approval
Lee approved building the three-question, multi-select finder discussed in Main Agent GPT. Production deployment was not requested. This isolated checkout starts from website origin/main 49421ac and preserves the other dirty checkout. No prices, checkout URLs, account entitlements, live content or production services were changed. No jobs were created.

## Experience
- Charcoal/red invitation above plans, with a clear skip-to-plans link. Opens only on an explicit click; never on page load or a timer.
- Multi-select roles, goals and grouped content wishlist. All options initially unselected. Full-library shortcut replaces individual content selections; selecting individual content clears that shortcut.
- Desktop two-panel design with existing Lee coaching photo; full-height mobile layout with independently scrolling questions and fixed controls.
- Selections and current step survive closing/reopening during this page visit. Edit answers revisits the same selections. No localStorage or customer data is collected.
- Native dialog, keyboard-operable checkboxes/radio buttons, focus restoration, Escape support, reduced motion and selection feedback.
- One recommendation with selected benefits, existing localised billing values, trial clarity and optional Max comparison for Starter/Plus.

## Routing
The content schema and engine are in src/lib/app-plan-recommendation.js. No scoring: use the highest required content tier. Role alone cannot raise the price. Explicit structured-programme goal sets Plus as minimum; vague ambitions and parent identity do not.

Starter: solo follow-alongs.
Plus: programmes, advanced training, goalkeeper, mindset, live training/replays.
Max: position-specific breadth, full raw coaching sessions, voice-over series, professional/tactical study, team-training ideas, session plans, coaching education, full-library shortcut.

For team/small-group coaches, organisers or a team-development goal, ask whether they need individual resources, separate group accounts or both. Only the latter two route to Teams. Teams result does not promise full Max for every role; it tells buyers to compare allowances and App access.

Coaching/planning goals combined with only lower-tier content ask a clarification rather than silently upselling. A changed upstream answer invalidates dependent access/coaching responses.

## Entitlement evidence
Read Uscreen public monthly offers 183083 (Starter), 230699 (Plus), 230698 (Max) on 16 September. All four goalkeeper collections are in Plus and Max, not Starter. Full Training Sessions, Coaching the Coaches, Session Planning, Voice Over Series, Team Training - Coaches Only and Pro Training Series collections are in Max, not Plus. Recorded LIVE Sessions and Mindset are in Plus.

Category/collection membership and enumerated individual-video access are not interchangeable; mixed categories include lower-tier samples. Keep the current public plan contract for broad Position Specific and Study the Game promises. This was not a per-video playback or exhaustive entitlement audit. No access configuration changes are authorised by this handoff.

## Tracking
Existing consent-aware JonerTracking transport retained. Events: JoinPlanFinderOpen, JoinPlanFinderComplete (deduplicated for unchanged answers), JoinPlanFinderUpgradeClick and JoinPlanFinderSkip. Only plan, page and finder-version are emitted; no role/goal/content answers. Existing result anchor events and checkout attribution retained. No A/B experiment enabled.

## Verification
- node scripts/test-app-plan-finder.mjs: passed 8,191 non-empty content subsets, role/goal combinations, invalid inputs and routing guardrails.
- npm run build: passed, 65 pages.
- node scripts/test-app-plan-finder-interaction.mjs: passed DOM-level journeys for all recommendation routes, multi-select, close/resume, billing, exclusive full-library choice, editing, dependent-answer invalidation and event deduplication. Uses existing jsdom/esbuild dependencies; browser primitives are stubbed. Not a real-browser visual audit.
- Preview and reused image return HTTP 200; git diff --check clean.

## Review and rollout
Local preview: http://127.0.0.1:4326/join/ on the home Mac. Server left running for Lee to review. Codex panel opening was queued, not confirmed visible. Desktop/mobile CSS implemented; real-browser visual QA and final Lee approval remain before production promotion. Use the existing website deployment workflow, not a new Sites project. Keep the original unrelated edits untouched. No remote push or deployment performed.
# Design revision — 16 September, after live review

- Restored the original compact “Not sure which plan?” banner and outlined button.
- Removed the questionnaire sidebar; reduced the dialog width from 1,020px to 680px.
- Shortened roles, goals and content choices to single labels; retained all option IDs and tier mappings.
- Main-question hint: “Select more than one if needed.”
- Readable body-font section headings: Player training, Learn from Lee, Coaching resources.
- Moved the existing coaching photo below the answers; hidden it on the recommendation screen.
- Kept multi-select, conditional clarification, billing, plan targeting and explicit-click opening.
# Follow-up revision — 16 September, photo-free questionnaire

- Removed all questionnaire photos following Lee’s live review; other join-page photos are unchanged.
- Added eighth goal: “Learn how Lee coaches sessions”. Uses the existing coaching clarification when selected content does not already require Max.
- Added fourth coaching-resource option: “Message Lee directly”. Minimum tier is Plus, matching the live join-page feature list (also included in Max).
- Preserved pricing, checkout links, existing answer IDs and multi-select behaviour.
