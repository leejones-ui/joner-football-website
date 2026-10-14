# JFP players: own contact, detailed Add, Pro sessions, email checks

Lee, 13 Oct 2026. What the portal does now, and where it keeps things.

## Player is their own contact

- Stored on the Term 4 Players row's `Term 4 Notes` as `[CONTACT:self]`, next
  to `[PERSESSION:<cents>]`. No new Airtable column. Read as `row.ownContact`
  (`api/_jfp-airtable.js`). Helpers: `api/_jfp-contact.js`
  (`withOwnContact`, `isOwnContactNotes`, `isAdult`, `contactWords`).
- Rows without the tag stay parent + player, as before.
- Add (both forms) and Edit have a "Player is their own contact" tick. A date
  of birth 18 or over ticks it for you (staff can untick).
- When on: no parent name is asked for or written, the email and mobile are
  labelled the player's, and every email, text and family page talks to the
  player ("Hi Kai, you have a place", "Your sessions", "Sign your waiver").
  Edit keeps any parent name already in Airtable.
- One wording helper, `contactWords({ self, players, parent })`, is used by
  the server emails, the portal and the family page.

## Add a player = as detailed as Edit

- Both Add forms (Timetable `addPlayer`, Players tab `addPlayerNoGroup`) use
  the same form as Edit (`src/scripts/jfp-portal-player-form.js`): player,
  date of birth, own contact, contact, second parent, football, emergency and
  medical, a note, and the payment.
- Player information goes to JFP Player Profiles (`saveProfile`) in the same
  request (`body.profile`). If that save fails the player is still added and
  the answer says so (`profileError`).
- Player information accepts adult dates of birth (1940 to today).

## Payment for any player

- Payment choices: payment link, paid offline, session by session (own price),
  Pro session (own price), trial (Timetable only), decide later.
- "Paying for" lists the JFP price list and Lee's own prices from Money >
  Prices, by programme (`priceId`). A per-session price from the list turns
  the player into session by session (or Pro) at that price.
- Edit has a Payment section: payment type (including `JFP Pro sessions`),
  price per session, the fee, and "Set the fee from a price".

## Pro sessions

- Programme key `pro`, label "Pro sessions" (`api/_jfp-prices.js`).
- Term 4 Payment Type `JFP Pro sessions` (`PRO_TYPE`, `isProType`). It is
  session by session: nothing owing until sessions are billed.
- Payment requests for Pro rows carry `programme: 'pro'`; their Stripe
  Checkout carries `metadata.jfpProduct = 'pro'` (not jfpProgramme, so the
  webhook, reconcile and Money behave exactly as before). Pro quick links
  carry `metadata.jfpProgramme = 'pro'` like any quick link.
- Decision (default): Pro sessions has its own Money view and is not JFP term
  income. The Money split itself is the Money engineer's (classifySession and
  moneyData totals are unchanged here).

## Emails reach players and parents

- Every JFP email (`api/_jfp-email.js` send, and `sendEmailExact` in
  `api/_jfp-messages.js`) is logged in KV list `jfp:email-log` (newest first,
  last 3000): to, subject, kind, status sent or failed, Brevo message id, the
  error. No bodies, no names.
- Brevo never gets an empty `to` name (both send paths).
- Sends after a row or link is saved never fail the action: the answer carries
  `emailed`, `emailTo` and `emailError` (plain words), and the portal shows it.
- Player record: an "Account invite" button (`inviteAccount`, any row with an
  email, holding a place or not) and an "Emails" list (`emailLog`).
- Account invites page: every family ticked gets sent, failed (why) or
  skipped (why).

## Double-add safety

- Both Add buttons go off while saving and stay off until the server answers.
- `addPlayer` refuses the same player twice in one group (unchanged).
- `addPlayerNoGroup` refuses the same name + email already holding a row with
  no group (409 `duplicate` with `rowId`); a twin in a group needs "Add
  another row anyway" (`force`).

## New actions and keys

- Portal actions: `inviteAccount { rowId }`, `emailLog { rowId }`.
- Changed answers (additive): `addPlayer` / `addPlayerNoGroup` return
  `emailTo, emailError, ownContact, words, profileSaved, profileError`;
  `familyInvites` (account mode) returns `errors` and `skipped`;
  `sendPaymentLink`, `familyInvoice`, `sessionInvoice`, `changePayreqAmount`,
  `decideRequest` return `emailTo` and `emailError`; `nextTermInvite` returns
  `failed: [{ email, error }]`.
- KV: `jfp:email-log` (list), `jfp:acct-one-lock:<email>` (60 s).
- Tests: `scripts/test-jfp-players-own.mjs` (in `npm run test:jfp`) and
  `scripts/test-jfp-players-flow.mjs` (harness, `npm run test:jfp-players-flow`).

## Pay from My account, with no link from staff (13 Oct 2026)

Every place with something to pay and no open payment request gets a Pay
step on Home (`overview.owed`, `api/_jfp-account-pay.js`):

- `term`: a term fee owing (fee less paid, not session by session, not a
  trial, not marked Paid or N/A, no plan/scholarship/sponsor/free type):
  "Pay A$850 for Term 4, <group>". Made as a `balance` request, so the kit
  step applies as for any term link.
- `sessions`: session by session with sessions billed and owing but no open
  link: pay what is owing.
- `prepay`: session by session with nothing owing: the next 1 to N sessions
  this term (N = dates left, at most 20) at `[PERSESSION:]`, or the price
  list's default (a Pro per-session price, the 1 to 1 price, a JFP
  per-session price, else the group's term price over the weeks). Dates told
  "can't make it", past, or already on a paid or open prepay link are left out.

`payOwed { rowId, sessions? }` (family action) works the amount out from
Airtable (never the page), keeps one request per place (a lock, then any open
request for the row is handed back), needs the waiver first, then runs the
usual `pay()` checkout. Requests carry `fromAccount: true`.

Prepaid sessions and staff billing: a prepay link adds the sessions to the
row's fee when it is made (as `sessionInvoice` does), with `restoreFields` so
a cancelled link takes them off. When paid, `runPayreqEffects` adds the count
to `[PREPAID:<n>]` in the row's notes. `sessionInvoice` takes that many off
the sessions it bills (and lowers the tag); if all of them were prepaid it
bills nothing and answers `{ payreq: null, covered, message }`. Money (and
Money > Pro sessions) show `prepaidSessions`. Not yet handled: a refund of a
prepay payment does not lower `[PREPAID:]` (staff adjust the note).

Order on sign in: 1 waiver, 2 pay, 3 player details, on Home and in the
emails (`sendFamilyInvite` `needs.sessions` / `needs.owingCents`, the account
invite's numbered list).

## Adult waiver

- Adult (18 or over by date of birth on the day they sign; with no date of
  birth, `isSelf()`): "Adult waiver and agreement", the same terms in the
  first person, a required "I am 18 or over and I'm signing for myself" tick
  (`accepted.adult`), their own signature, no parent or guardian name.
- Under 18 (and every Joners Juniors child): the parent or guardian waiver.
- Saved in Internal Notes as `[WAIVER:adult]` or `[WAIVER:guardian]`, and in
  the agreement text. `waiverFor()` returns `kind`; the board has
  `waiverKind`, the Players tab `waiver.kind`; staff see "adult waiver,
  signed by the player" or "parent or guardian waiver".
- Tests: `scripts/test-jfp-pay-waiver-flow.mjs` (harness,
  `npm run test:jfp-pay-waiver-flow`).

## Pro session quotes and the Fees tab (14 Oct 2026)

Quotes (`api/_jfp-quote.js`, staff side `api/_jfp-quote-staff.js`):

- Each Pro (or session by session) player's own quote, on the Term 4 row's
  notes: the price per session `[PERSESSION:<cents>]` plus commitment tiers
  `[QUOTE:6x9500,10x9000]` ("6 sessions in a row at A$95 each"). 2 to 20
  sessions a tier, at most 4 tiers, each price lower than a session.
- Only staff (portal admins) change it: Add a player (`addPlayer` /
  `addPlayerNoGroup` take `quote: { tiers }`), Edit player (Players tab and
  Money) through `saveQuote { rowId, perCents, tiers }` (`tiers: []` removes
  the options). `playerQuote { rowId }` returns the quote, the commitment and
  the default. Audited as `player.quote` (and in `player.add`).
- Default Pro quote: Money > Prices, `saveDefaultQuote { quote | null }`,
  kept as `config.proQuote`, returned by `pricing` as `defaultQuote`. It
  only fills in Add a player when Pro is chosen; Edit offers a "Use the
  default" button. Changing it changes nobody's quote.

My account (`_jfp-account-pay.js`): a quoted row's `prepay` item carries
`quote.options` (the next session at the per-session price, and each tier
that fits the dates left) and `quote.commitment`. `payOwed { rowId, option }`
(`'one'` or `'commit:<n>'`) prices it from the stored quote only; an option
staff did not set is refused (`code: 'option'`). A commitment link carries
`prepay.commit: true`. The family can close a pay-ahead link they made and
choose again: `cancelOwed { payreqId }` (their own `fromAccount` prepay
links only; the fee goes back via `restoreFields`). Todo items for those
links have `canChoose: true`.

Paid commitment (finalise): `[PREPAID:n]` as any prepay, plus the dates in
`[COVERED:<iso>,...]`. Staff session billing (`sessionInvoice`, `billPlan`):
covered dates on or before today are used first; a covered date the player
missed is still counted as paid (no automatic refund) and the billing note
says so; covered dates still to come stay prepaid; anything prepaid beyond the
commitment comes off as before. With no covered dates the rule is unchanged.

Fees tab (`api/_jfp-account-fees.js`, family action `fees`, read only): what
is owing now (from the overview: payment requests, owed places, Joners
Juniors, each with Pay), this term's places (fee, paid, prepaid, commitment),
totals by programme, and every payment record newest first: their paid JFP
and Juniors requests, Stripe payments under their addresses not otherwise
explained (Money's cached read, never a long Stripe read), cash and bank
ledger lines whose rows are all theirs, and paid holiday bookings. Stripe
receipts are looked up per payment intent (8 a read, kept in
`jfp:receipt:<pi>`). The bottom tab bar now has Fees in place of Videos
(Videos stays in the menu).

Tests: `scripts/test-jfp-pro-quotes.mjs` (in `npm run test:jfp`) and
`scripts/test-jfp-pro-quotes-flow.mjs` (harness, `npm run test:jfp-pro-quotes-flow`).

## Round 2 (14 Oct 2026)

Quote runs (`_jfp-quote.js`, `_jfp-quote-staff.js`, `jfp-portal-quote.js`):
the quote editor has quick buttons "Rest of term (N sessions)" (N = the
sessions this player, or this group, still has: `termRun(config, row,
group)`) and "Whole term (W sessions)" (off once the term has started), and
any run from 2 up to N can be typed. The server checks the same: a new tier
longer than the sessions left is refused (`cleanQuote(..., { maxN, fresh })`;
a saved tier that no longer fits does not block other changes, it is just not
offered). `pricing` returns `runs: { byGroup, noGroup }`; `playerQuote`
returns `termLeft` and `termWhole`.

Session by session in My account (`_jfp-account-pay.js`): every `prepay`
item has `left`, `leftCents`/`leftLabel` and `rest` ("Pay for the rest of the
term": every date left at the price per session, or staff's tier when it is
exactly that run). `payOwed { option: 'rest' }` works with or without a quote.
Home and Fees show "Upcoming sessions: N left this term at A$X" with the
options and "Sessions you do not pay ahead are billed after they happen."
Fees says "Nothing owing" only when nothing is billed and no session is left
to pay for. My sessions marks each date Paid / Payment started / Not paid yet
(`sessionMarks`: [COVERED:] dates, dates on paid pay-ahead links, then any
undated [PREPAID:n]) and has "Pay for sessions", which opens Fees there.

No coach names for families (Lee: morning groups rotate coaches): family
emails (`groupRows`, the account invite), the Stripe item name, the payment
success page (`jfp-confirm`), and My account (no `coach` on enrolments or
Keep my spot; "Your coach" when a cancellation is sent, "Coach" next to a
coach's mobile). Staff and coach views are unchanged. Holiday 1 to 1 bookings
keep their coach.

"Program", not "programme", in every display string (portal, account, public
pages, emails). Code names, KV and metadata keys, Airtable fields, URLs
(`/programmes`) and image paths are unchanged.

Phone bar: Home, Sessions, Fees, Contact, More. More is a sheet of tiles in
the side bar's groups (My JFP, Program, Train) with only what is not on the
bar, and a "To do" tile first when a waiver is still to sign.

Add a family (`addFamily`, `jfp-portal-family-add.js`): Timetable > Add a
player > "+ Add another child (same family)", or Players tab > "+ Add a
family" (no group needed). Each child: group (or none), name, date of birth,
payment (a price, session by session, Pro with a quote, free trial, paid
offline, decide later). One shared parent contact. Every child is checked
before anything is written (duplicates, places, prices; the sibling rate is
allowed because the others are the siblings), then a row each
(`noteNewPlayer` for every child in a group), ONE `family` payment request for
every child with a price (`places` per child, split onto each row when paid,
as a family invoice), and ONE email to the parent (`sendFamilyWelcome`: every
child, a waiver for each, one payment, then details). Audited as `player.add`
per row (with `family`) and `family.add`.

Tests: `scripts/test-jfp-round2.mjs` (in `npm run test:jfp`) and
`scripts/test-jfp-round2-flow.mjs` (harness, `npm run test:jfp-round2-flow`).

## Open accounts (round 2 item 8, 14 Oct 2026)

Anyone can make an account at /jfp-account/ (`api/_jfp-account-open.js`):

- First sign-in with a code makes an account record (KV `jfp:accounts`,
  email -> `{ createdAt, kind, players }`). A new address with nothing on file
  is limited to 10 sign-ups a connection a day and 200 an hour overall
  (`code: 'signup'`, 429); a family already on a row or waiver never is.
- My account "Add a player" (`addPlayer { name, dob, self, values }`): a
  profile row only (`saveProfile`), never Term 4 and never a place. First and
  last name and a date of birth; "I am the player" (18 or over) or a parent;
  at most 8 such players an account and 12 adds a day; the same name twice is
  refused. Player information, photo and the waiver work for these players
  (`openPlayers`); Home says "You're not booked into a session yet" with Book
  a session (`/jfp-booking/`).
- Staff: Players tab > "Accounts with no session" (`playersList.accounts`,
  profiles with no Term 4 row holding a place) with Add to a group, the
  normal Add a player filled in from the profile (`noteNewPlayer` as always).
  Every staff add now links an existing profile by email and name
  (`linkProfile`) instead of making a second one, so a returning player's
  profile shows straight away (`profileLinked` in the answer).

Tests: `scripts/test-jfp-open-accounts-flow.mjs` (harness) and the open
account checks in `scripts/test-jfp-round2.mjs`.
