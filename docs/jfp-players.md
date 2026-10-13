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
