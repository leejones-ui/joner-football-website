/* Joner Football / Uscreen Head Code v1.0.0
 * Paste into Uscreen Head Code. Uses only browser-standard APIs and documented DOM.
 */
(function () {
  'use strict';
  var cookieName = 'jf_journey_id';
  function readCookie() { var m = document.cookie.match(new RegExp('(?:^|; )' + cookieName + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
  function journey() { var id = readCookie(); return /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{32,64}$/.test(id) ? id : ''; }
  var sent = {};
  function post(data) {
    var id = journey(); if (!id || !window.fetch) return;
    data.jf_journey_id = id;
    var key = data.email ? String(data.email).trim().toLowerCase() : data.event_name;
    if (sent[key]) return; sent[key] = true;
    // Keep identity in the HTTPS request body; never put email in a URL/log.
    window.fetch('https://jonerfootball.com/api/checkout-bridge', { method: 'POST', mode: 'cors', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), keepalive: true }).catch(function () { delete sent[key]; });
  }
  function emailInput(target) { return target && ((target.matches && target.matches('input[type="email"], input[name*="email" i]')) ? target : target.querySelector && target.querySelector('input[type="email"], input[name*="email" i]')); }
  function capture(input) { var value = input && String(input.value || '').trim(); if (value && value.indexOf('@') > 0) post({ event_name: 'checkout_identity', email: value, identity_source: 'uscreen_head', checkout_id: location.pathname }); }
  function observe() {
    var inputs = document.querySelectorAll('input[type="email"], input[name*="email" i]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].__jfaObserved) continue; inputs[i].__jfaObserved = true;
      ['input', 'change', 'blur'].forEach(function (eventName) { inputs[i].addEventListener(eventName, function () { capture(this); }); });
    }
  }
  document.addEventListener('submit', function (event) { var input = emailInput(event.target); if (input) capture(input); }, true);
  post({ event_name: 'checkout_bridge', checkout_id: location.pathname, checkout_url: location.href });
  observe(); new MutationObserver(observe).observe(document.documentElement, { childList: true, subtree: true });
})();
