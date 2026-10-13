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
