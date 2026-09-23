# JFP term booking build — 23 September 2026

## Approved direction
Lee requested a website build for ten-week JFP enrolments. Existing dashboard families have verbally confirmed their Term 4 places; some have paid. Preserve those reservations. Existing families claim their reserved place, complete applicable waiver requirements and settle only the verified outstanding balance. New families book only explicitly released vacancies in suitable groups. Never expose other players to parents. No publishing or parent messages performed.

## First increment
Local route `/training/jfp-timetable/`: filters and booking-journey preview using 24 distinct day/time/location combinations from a fresh, paginated Airtable Term 4 read (106 records). This is not 24 verified groups: concurrent coaches and mixed programme types can share a time/location. Snapshot contains only day, time and location; no player identifiers, contacts, medical information, payment data or roster counts. No forms collect personal data and no checkout is enabled.

## Verified integration gaps
Dashboard source `src/app/api/jfp-sessions/route.ts` filters Term 4 to Confirmed. Its UI assumes six places at Belrose and has no explicit capacity for other locations. These are not sufficient rules to sell vacancies. Live base schema contains per-term rosters, payment ledger, waiver and attendance tables, but no dedicated session-capacity table among the 20 returned tables. Many Term 4 session fields retain Term 3 labels. Resolve exact groups, coaches and eligibility with staff before release; never infer availability simply from displayed counts.

## Next implementation
- Staff-controlled term groups: stable group ID, coach, day/start/end, location, ten session dates, capacity, explicit ages/ability, programme, verified fee, release state. Keep existing reservations and roster references private.
- Existing-family claim invitation: scoped, expiring, revocable invitation plus recipient verification; a shared page password is not authority to access a child's enrolment. Match exact enrolment; do not merge by email/name alone. Account for siblings and shared invoices.
- Public API must project an allowlist of group fields only, never return raw Airtable records. Fail closed on stale/unavailable source data.
- Atomic seat holds across simultaneous checkouts; include protected reservations and offline changes in capacity. Airtable remains the roster/payment source of truth, but requires transactional reservation coordination. Staff enrolment changes must participate before self-service opens.
- Capture current approved waiver version, signature and timestamp privately before checkout. Do not invent legal terms or carry historic waiver consent forward automatically.
- Stripe Sydney JFP account: dynamic checkout for exact verified balance and group. No card charge for already paid enrolments. Payment ledger deduplication, signed webhooks, idempotent enrolment finalisation, reconciliation after failures. Success redirect alone never confirms payment. Never substitute static payment links for seat locking.
- Private confirmation/recovery and admin controls, tested without live charges or customer messages.

## Required verification before release
### Additional scope confirmed by Lee, 23 September
- Airtable-backed financial reporting and private website administration. Reuse the existing JFP Payment Ledger; distinguish invoiced, paid, refunded, net collected and outstanding. Count actual transactions once, including shared family invoices and verified bank/cash receipts. Display sync freshness and reconciliation failures; do not label collections as profit.
- Only Lee and Ligia may see revenue. Lee confirmed Ligia's identity on 23 September. No account created or invited yet.
- Individual accounts with strong passwords, MFA support, secure server sessions, login throttling and revocation; no shared holiday admin secret. Every financial endpoint/export requires server-side authorisation.
- Separate coach area scoped by immutable coach identity. Coaches see only their own sessions and hours; scheduled, cancelled and approved worked hours remain distinct. No automatic wages/payroll calculation or financial access.
- `_jfp-access.js` is a tested policy foundation only, not an operational authentication system. Connect to a verified identity provider before exposing any private data.

### Actual fee reporting — live schema change authorised by Lee
On 23 September added and read back four fields in Term 4 Players: Stripe Fee AUD (fld8ZLJNwzXufAxwK), Net Collected AUD (fldwkwHTf8SCFONjs), Fee Reconciliation (fldcW1qrB2Gzf7Z75), Payment Evidence (fldGhUVW33t4exII3). Existing gross paid and balances are unchanged. New values remain blank until actual fees and exact enrolment matches are verified; blank is not zero.
Stripe MCP account listing returned reauthentication required (oauth_token_invalid_grant). No transaction amounts or fees could be retrieved. Automatic sync and dashboard display are not implemented. The JFP Payment Ledger Term field currently exposes only Term 3 2026; Term 4 ledger integration requires reconciliation, not an assumption of completed payment history. Shared payments need explicit allocations that sum to actual fee/net once. Refunds, disputes and currency conversion must reconcile from actual balance transactions; bank payouts are separate from net collected.

Two parents racing for the last seat; an existing paid family; partial payment; sibling/shared invoice; expired invitation; wrong-family access; failed/expired checkout; late/duplicate webhook; Airtable outage; offline roster changes; full and unsuitable groups; waiver-version change; privacy inspection of HTML, API and logs.

Lee explicitly authorised building and publishing the completed password-protected system on 23 September. No additional blanket deployment approval is needed. Release still depends on verified group configuration, current waiver/pricing, working authentication, privacy and payment verification; approval is not evidence those checks have passed. Only the four reporting fields described above have been added live; no enrolments or payments changed.

## Portal access confirmed by Lee
- Parent entry: unlisted, noindex route with a password gate similar to holiday bookings. Unlisted URLs are not an access control. No private roster in static HTML or public APIs. Existing family claims require separate identity verification.
- Lee and Ligia: individual logins, whole programme overview and finances.
- Coaches: individual logins restricted to their own hours. Do not grant roster/medical/financial access merely because the role is coach.
- Lee explicitly chose separate JFP portal accounts on 23 September: individual accounts for Lee, Ligia and each coach, independent of Joner Dashboard credentials and sessions. Do not copy plaintext passwords or existing session cookies into the new service. Provision roles server-side; parents cannot select staff roles. Account creation and secure credential delivery are not completed yet.
- Stripe MCP requires reauthentication before actual fee reconciliation or live payment verification can finish. The new fee/net fields exist but are blank; no automatic sync is running.

## Implementation checkpoint
Built locally: `api/_jfp-auth.js` separate password/session implementation (salted scrypt, 8-hour opaque server sessions, Secure HttpOnly SameSite cookies, persistent login throttle, immediate account/session revocation), `api/jfp-session.js`, staff login page `/jfp-portal/`, owner/Ligia financial projection from live Airtable with unknown values preserved, coach-owned hours projection, and 11 passing Node checks. All private APIs fail closed unless `JFP_PORTAL_ENABLED=true`; origin must be set explicitly in `JFP_PORTAL_ORIGIN`. The scoped Airtable credential is `JFP_AIRTABLE_TOKEN`. Storage reuses the existing KV transport with separate `jfp:` keys. No credentials copied or accounts provisioned. No MFA or self-service password reset implemented yet.

Coach hours require a verified session source at `jfp:approved-coach-sessions`; this has not been populated. Roster time strings alone do not prove actual worked hours. Financial API intentionally withholds programme totals until transaction-level reconciliation is complete.

Browser verified: timetable shows 24 entries; choosing NTRA reduces to two; selecting Wednesday shows the correct booking preview. Build succeeds with 71 routes. Local Astro server serves only page previews, not the Vercel API endpoints; staff login must be exercised using an API-capable local harness or deployment before claiming end-to-end verification.

Remaining implementation: parent password gate, verified family-claim flow, group management and approved eligibility/capacities, atomic seat reservations, current waiver form integration, Stripe checkout/webhook/reconciliation, account provisioning/reset, and full end-to-end privacy/concurrency tests. This is a foundation, not a completed live booking system. No production deployment has been made.
