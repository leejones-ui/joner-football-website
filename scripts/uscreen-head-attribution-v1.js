/* Joner Football / Uscreen Head Code v1.0.0
 * Paste into Uscreen Head Code. Uses only browser-standard APIs and documented DOM.
 */
(function () {
  'use strict';
  var cookieName = 'jfa_journey';
  function readCookie() { var m = document.cookie.match(new RegExp('(?:^|; )' + cookieName + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
  function journey() { var id = readCookie(); return /^jfy_[A-Za-z0-9_-]{20,80}$/.test(id) ? id : ''; }
  function post(data) { var id = journey(); if (!id || !window.fetch) return; data.journey_id = id; window.fetch('https://jonerfootball.com/api/checkout-bridge', { method: 'POST', mode: 'cors', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), keepalive: true }).catch(function () {}); }
  function observe() { var inputs = document.querySelectorAll('input[type="email"], input[name*="email" i]'); for (var i = 0; i < inputs.length; i++) { if (inputs[i].__jfaObserved) continue; inputs[i].__jfaObserved = true; inputs[i].addEventListener('change', function () { if (this.value && this.value.indexOf('@') > 0) post({ event_name: 'checkout_identity', email: this.value, identity_source: 'uscreen_head', checkout_id: location.pathname }); }); } }
  post({ event_name: 'checkout_bridge', checkout_id: location.pathname, checkout_url: location.href });
  observe(); new MutationObserver(observe).observe(document.documentElement, { childList: true, subtree: true });
})();
