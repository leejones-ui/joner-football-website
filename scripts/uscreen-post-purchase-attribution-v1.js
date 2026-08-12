/* Joner Football / Uscreen Post-purchase Code v1.0.0
 * This is a purchase signal only; the Uscreen webhook is payment truth.
 */
(function () {
  'use strict';
  var m = document.cookie.match(/(?:^|; )jfa_journey=([^;]*)/);
  var journeyId = m ? decodeURIComponent(m[1]) : '';
  if (!/^jfy_[A-Za-z0-9_-]{20,80}$/.test(journeyId) || !window.fetch) return;
  window.fetch('https://jonerfootball.com/api/attribution-event', { method: 'POST', mode: 'cors', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event_name: 'purchase', journey_id: journeyId, path: location.pathname, destination_url: location.href }), keepalive: true }).catch(function () {});
})();
