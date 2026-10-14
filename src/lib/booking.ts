// The JFP booking page. This exact path has been sent to a lot of families,
// so never rename it or put a redirect in front of it. Every "Book now"
// button on the site reads it from here (BookNowButton.astro).
export const BOOKING_URL = '/jfp-booking'
export const BOOKING_LABEL = 'Book now'

// Web sign-up for the Joner Football App. Lee's routing rule: app buttons go
// to jonerfootball.com/join or app.jonerfootball.com, never the app stores.
export const APP_JOIN_URL = '/join'

// Family account (sign in or create one). Linked from the booking, JFP
// program and contact pages.
export const ACCOUNT_URL = '/jfp-account/'
