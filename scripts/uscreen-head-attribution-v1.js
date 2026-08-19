/* Joner Football / Uscreen Head Code v1.4.0
 * Paste into Uscreen Head Code. Uses only browser-standard APIs and documented DOM.
 * v1.4: reads the journey token out of the packed utm_source (cookie-free
 * fallback) and posts the checkout page's own click identity (fbc/fbp/fbclid)
 * with every bridge event.
 */
(function () {
  'use strict';
  var cookieName = 'jf_journey_id';
  var tokenSavedAtKey = cookieName + '_saved_at';
  var tokenMaxAgeMs = 90 * 24 * 60 * 60 * 1000;
  var tokenPattern = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{32,64}$/;
  var pending = [];
  var bootstrapping = false;
  var sent = {};

  function readCookie() {
    var match = document.cookie.match(new RegExp('(?:^|; )' + cookieName + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }
  function packedJourneyToken() {
    // The website packs the journey token as j= inside utm_source using the
    // __jfa1__ marker. When third-party storage fails, the URL itself still
    // carries the identity into this page.
    try {
      var source = new URLSearchParams(location.search).get('utm_source') || '';
      var markerAt = source.indexOf('__jfa1__');
      if (markerAt === -1) return '';
      var packed = new URLSearchParams(source.slice(markerAt + '__jfa1__'.length));
      return packed.get('j') || '';
    } catch (_) { return ''; }
  }
  function journey() {
    var token = readCookie();
    if (!token) {
      try {
        token = window.localStorage.getItem(cookieName) || '';
        var savedAt = Number(window.localStorage.getItem(tokenSavedAtKey) || 0);
        if (!savedAt || Date.now() - savedAt > tokenMaxAgeMs) token = '';
      } catch (_) {}
    }
    if (!tokenPattern.test(token)) {
      var fromUrl = packedJourneyToken();
      if (tokenPattern.test(fromUrl)) return saveJourney(fromUrl);
    }
    return tokenPattern.test(token) ? token : '';
  }
  function metaCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }
  function saveJourney(token) {
    if (!tokenPattern.test(String(token || ''))) return '';
    document.cookie = cookieName + '=' + encodeURIComponent(token) + '; Max-Age=7776000; Path=/; Domain=.jonerfootball.com; Secure; SameSite=Lax';
    try { window.localStorage.setItem(cookieName, token); } catch (_) {}
    try { window.localStorage.setItem(tokenSavedAtKey, String(Date.now())); } catch (_) {}
    return token;
  }
  function referrerHost() {
    var host = '';
    try { host = new URL(document.referrer).hostname.toLowerCase(); } catch (_) {}
    return host;
  }
  function referrerSource(host) {
    if (/^(l\.)?instagram\.com$/.test(host)) return 'app_instagram';
    if (host === 'linktr.ee' || host.endsWith('.linktr.ee')) return 'main_instagram_linktree';
    if (host === 'l.facebook.com' || host === 'facebook.com' || host.endsWith('.facebook.com')) return 'facebook';
    if (host === 't.co' || host === 'x.com' || host.endsWith('.twitter.com')) return 'x';
    if (host === 'threads.net' || host.endsWith('.threads.net')) return 'threads';
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
    if (['google.com', 'google.com.au', 'google.co.uk', 'google.ca', 'google.co.nz'].indexOf(host.replace(/^www\./, '')) !== -1) return 'google';
    if (host && !/(^|\.)jonerfootball\.com$/.test(host)) return 'referral';
    return '';
  }
  function attribution() {
    var params = new URLSearchParams(location.search);
    var source = String(params.get('utm_source') || '').trim();
    var host = referrerHost();
    var referred = referrerSource(host);
    if (source.toLowerCase() === 'youtube-es' && (referred === 'app_instagram' || referred === 'main_instagram_linktree')) source = referred;
    if (!source) source = referred || 'direct';
    var social = ['app_instagram', 'main_instagram_linktree', 'facebook', 'x', 'threads', 'tiktok', 'youtube'].indexOf(source) !== -1;
    var medium = params.get('utm_medium') || (source === 'google' ? 'organic' : source === 'direct' ? 'direct' : source === 'referral' ? 'referral' : social ? 'organic_social' : 'social');
    return {
      utm_source: source,
      utm_medium: medium,
      utm_campaign: params.get('utm_campaign') || (referred ? 'legacy-profile-link' : ''),
      utm_content: params.get('utm_content') || '',
      utm_term: params.get('utm_term') || '',
      campaign_id: params.get('campaign_id') || params.get('utm_id') || '',
      adset_id: params.get('adset_id') || '',
      ad_id: params.get('ad_id') || '',
      fbclid: params.get('fbclid') || '',
      fbc: metaCookie('_fbc') || params.get('fbc') || '',
      fbp: metaCookie('_fbp') || params.get('fbp') || '',
      gclid: params.get('gclid') || '',
      ttclid: params.get('ttclid') || '',
      msclkid: params.get('msclkid') || '',
      source_taxonomy: source === 'referral' ? 'referral' : source === 'direct' ? 'direct' : source === 'google' && medium === 'organic' ? 'google_organic' : source,
      source_detail: source === 'referral' ? host.slice(0, 180) : ''
    };
  }
  function flush(token) {
    var callbacks = pending.slice(); pending = []; bootstrapping = false;
    for (var i = 0; i < callbacks.length; i++) callbacks[i](token || '');
  }
  function ensureJourney(callback) {
    var existing = journey();
    if (existing) return callback(existing);
    pending.push(callback);
    if (bootstrapping) return;
    var touch = attribution();
    if (!touch || !window.fetch) return flush('');
    bootstrapping = true;
    window.fetch('https://jonerfootball.com/api/journey', {
      method: 'POST', mode: 'cors', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attribution: touch, page_path: location.pathname, referrer: document.referrer }),
      keepalive: true
    }).then(function (response) { return response.ok ? response.json() : {}; })
      .then(function (data) { flush(saveJourney(data.jf_journey_id)); })
      .catch(function () { flush(''); });
  }
  function post(data) {
    if (!window.fetch) return;
    ensureJourney(function (token) {
      if (!token) return;
      data.jf_journey_id = token;
      // Click identity captured on this page rides along so the journey's
      // latest touch gains fbc/fbp even when the pixel set them app-side only.
      data.attribution = attribution();
      var key = data.email ? String(data.email).trim().toLowerCase() : data.event_name;
      if (sent[key]) return; sent[key] = true;
      // Keep identity in the HTTPS request body; never put email in a URL/log.
      window.fetch('https://jonerfootball.com/api/checkout-bridge', {
        method: 'POST', mode: 'cors', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data), keepalive: true
      }).catch(function () { delete sent[key]; });
    });
  }
  function emailInput(target) {
    return target && ((target.matches && target.matches('input[type="email"], input[name*="email" i]'))
      ? target : target.querySelector && target.querySelector('input[type="email"], input[name*="email" i]'));
  }
  function capture(input) {
    var value = input && String(input.value || '').trim();
    if (value && value.indexOf('@') > 0) post({ event_name: 'checkout_identity', email: value, identity_source: 'uscreen_head', checkout_id: location.pathname });
  }
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
