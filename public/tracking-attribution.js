(function (root) {
  'use strict';

  var MARKER = '__jfa1__';
  var LEDGER_JOURNEY_KEY = 'joner_attribution_ledger_journey_id';
  var SIGNED_JOURNEY_STORAGE_KEY = 'joner_journey_id';
  var SIGNED_JOURNEY_COOKIE = 'jf_journey_id';
  var SIGNED_JOURNEY_RE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{32,64}$/;
  var TRACKING_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'gclid', 'ttclid', 'msclkid', 'ga_client_id', 'ga_session_id', 'source_detail', 'link_token', 'source_taxonomy',
    'campaign_id', 'adset_id', 'ad_id', 'placement', 'fbclid', 'fbp', 'fbc',
    'first_utm_source', 'first_utm_medium', 'first_utm_campaign', 'first_utm_content',
    'first_utm_term', 'first_utm_id', 'first_campaign_id', 'first_adset_id',
    'first_ad_id', 'first_placement', 'jf_journey_id'
  ];

  function clean(value, max) {
    return String(value || '').trim().slice(0, max || 240);
  }

  function readCookie(name) {
    try {
      var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : '';
    } catch (e) { return ''; }
  }

  function signedJourneyToken() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(SIGNED_JOURNEY_STORAGE_KEY);
      if (raw) {
        var record = JSON.parse(raw);
        var stored = clean(record && record.token, 160);
        if (SIGNED_JOURNEY_RE.test(stored)) return stored;
      }
    } catch (e) {}
    var cookieToken = clean(readCookie(SIGNED_JOURNEY_COOKIE), 160);
    return SIGNED_JOURNEY_RE.test(cookieToken) ? cookieToken : '';
  }

  function saveSignedJourneyToken(token) {
    var safeToken = clean(token, 160);
    if (!SIGNED_JOURNEY_RE.test(safeToken)) return false;
    try {
      if (root.localStorage) root.localStorage.setItem(SIGNED_JOURNEY_STORAGE_KEY, JSON.stringify({ token: safeToken, saved_at: Date.now() }));
    } catch (e) {}
    try {
      document.cookie = SIGNED_JOURNEY_COOKIE + '=' + encodeURIComponent(safeToken) + '; Max-Age=15552000; Path=/; Domain=.jonerfootball.com; SameSite=Lax; Secure';
    } catch (e) {}
    return true;
  }

  function ledgerJourneyId() {
    try {
      var existing = clean(root.localStorage && root.localStorage.getItem(LEDGER_JOURNEY_KEY), 80);
      if (/^jfy_[A-Za-z0-9_-]{20,80}$/.test(existing)) return existing;
      var bytes = new Uint8Array(18);
      root.crypto.getRandomValues(bytes);
      var raw = '';
      for (var i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
      var id = 'jfy_' + btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      root.localStorage.setItem(LEDGER_JOURNEY_KEY, id);
      document.cookie = 'jfa_journey=' + encodeURIComponent(id) + '; Max-Age=7776000; Path=/; Domain=.jonerfootball.com; SameSite=Lax; Secure';
      return id;
    } catch (e) { return ''; }
  }

  function recordEvent(eventName, data) {
    var id = ledgerJourneyId();
    if (!id || !root.fetch) return id;
    try {
      root.fetch('/api/attribution-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({}, data || {}, { event_name: eventName, journey_id: id })),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
    return id;
  }

  function encodeForUscreen(input) {
    var params = input instanceof URLSearchParams
      ? new URLSearchParams(input.toString())
      : new URLSearchParams(input || '');
    var rawSource = String(params.get('utm_source') || 'direct').trim();
    // Checkout links are decorated repeatedly as the signed journey and Meta
    // cookies become available. Preserve an existing packed source in full.
    var source = clean(rawSource, rawSource.indexOf(MARKER) !== -1 ? 1200 : 120);
    var medium = clean(params.get('utm_medium'), 180);
    var campaign = clean(params.get('utm_campaign'), 240);
    var content = clean(params.get('utm_content'), 240);
    var term = clean(params.get('utm_term'), 180);
    var campaignId = clean(params.get('utm_id') || params.get('campaign_id'), 180);
    var adsetId = clean(params.get('adset_id'), 180);
    var adId = clean(params.get('ad_id'), 180);
    var placement = clean(params.get('placement'), 120);
    var fbclid = clean(params.get('fbclid'), 500);
    var fbp = clean(params.get('fbp'), 240);
    var fbc = clean(params.get('fbc'), 500);
    var ttclid = clean(params.get('ttclid'), 500);
    var msclkid = clean(params.get('msclkid'), 500);
    var firstSource = clean(params.get('first_utm_source'), 120);
    var firstMedium = clean(params.get('first_utm_medium'), 180);
    var firstCampaign = clean(params.get('first_utm_campaign'), 240);
    var firstContent = clean(params.get('first_utm_content'), 240);
    var firstTerm = clean(params.get('first_utm_term'), 180);
    var firstCampaignId = clean(params.get('first_utm_id') || params.get('first_campaign_id'), 180);
    var firstAdsetId = clean(params.get('first_adset_id'), 180);
    var firstAdId = clean(params.get('first_ad_id'), 180);
    var firstPlacement = clean(params.get('first_placement'), 120);
    var journeyId = clean(params.get('jf_journey_id'), 160);

    if (source.indexOf(MARKER) !== -1) {
      var markerIndex = source.indexOf(MARKER);
      var existingPacked = new URLSearchParams(source.slice(markerIndex + MARKER.length));
      var sourcePrefix = clean(source.slice(0, markerIndex), 120);
      if (sourcePrefix && !existingPacked.get('s')) existingPacked.set('s', sourcePrefix);
      var refresh = [
        ['m', medium], ['c', campaign], ['k', content], ['t', term],
        ['i', campaignId], ['a', adsetId], ['d', adId], ['p', placement],
        ['b', fbp], ['x', ttclid], ['y', msclkid],
        ['S', firstSource], ['M', firstMedium], ['C', firstCampaign],
        ['K', firstContent], ['T', firstTerm], ['I', firstCampaignId],
        ['A', firstAdsetId], ['D', firstAdId], ['P', firstPlacement], ['j', journeyId]
      ];
      for (var r = 0; r < refresh.length; r++) {
        if (refresh[r][1]) existingPacked.set(refresh[r][0], refresh[r][1]);
      }
      if (fbc) {
        existingPacked.set('q', fbc);
        existingPacked.delete('f');
      } else if (fbclid && !existingPacked.get('q')) {
        existingPacked.set('f', fbclid);
      }
      params.set('utm_source', sourcePrefix + MARKER + existingPacked.toString());
      return params;
    }
    // A click ID alone is attribution evidence. Pack it even when a platform
    // did not provide campaign metadata and no signed journey exists yet.
    if (!campaign && !journeyId && !ttclid && !msclkid && !fbclid && !fbc) return params;

    var packed = new URLSearchParams();
    packed.set('s', source);
    if (medium) packed.set('m', medium);
    if (campaign) packed.set('c', campaign);
    if (content) packed.set('k', content);
    if (term) packed.set('t', term);
    if (campaignId) packed.set('i', campaignId);
    if (adsetId) packed.set('a', adsetId);
    if (adId) packed.set('d', adId);
    if (placement) packed.set('p', placement);
    if (fbp) packed.set('b', fbp);
    if (fbc) packed.set('q', fbc);
    else if (fbclid) packed.set('f', fbclid);
    if (ttclid) packed.set('x', ttclid);
    if (msclkid) packed.set('y', msclkid);
    if (firstSource) packed.set('S', firstSource);
    if (firstMedium) packed.set('M', firstMedium);
    if (firstCampaign) packed.set('C', firstCampaign);
    if (firstContent) packed.set('K', firstContent);
    if (firstTerm) packed.set('T', firstTerm);
    if (firstCampaignId) packed.set('I', firstCampaignId);
    if (firstAdsetId) packed.set('A', firstAdsetId);
    if (firstAdId) packed.set('D', firstAdId);
    if (firstPlacement) packed.set('P', firstPlacement);
    if (journeyId) packed.set('j', journeyId);
    params.set('utm_source', source + MARKER + packed.toString());
    return params;
  }

  function decodeUscreenSource(value) {
    var raw = clean(value, 1200);
    var markerIndex = raw.indexOf(MARKER);
    if (markerIndex === -1) return { utm_source: raw || undefined };

    var prefix = clean(raw.slice(0, markerIndex), 120);
    var packed = new URLSearchParams(raw.slice(markerIndex + MARKER.length));
    return {
      utm_source: clean(packed.get('s') || prefix, 180) || undefined,
      utm_medium: clean(packed.get('m'), 180) || undefined,
      utm_campaign: clean(packed.get('c'), 240) || undefined,
      utm_content: clean(packed.get('k'), 240) || undefined,
      utm_term: clean(packed.get('t'), 180) || undefined,
      utm_id: clean(packed.get('i'), 180) || undefined,
      campaign_id: clean(packed.get('i'), 180) || undefined,
      adset_id: clean(packed.get('a'), 180) || undefined,
      ad_id: clean(packed.get('d'), 180) || undefined,
      placement: clean(packed.get('p'), 120) || undefined,
      fbclid: clean(packed.get('f'), 500) || undefined,
      fbp: clean(packed.get('b'), 240) || undefined,
      fbc: clean(packed.get('q'), 500) || undefined,
      ttclid: clean(packed.get('x'), 500) || undefined,
      msclkid: clean(packed.get('y'), 500) || undefined,
      first_utm_source: clean(packed.get('S'), 180) || undefined,
      first_utm_medium: clean(packed.get('M'), 180) || undefined,
      first_utm_campaign: clean(packed.get('C'), 240) || undefined,
      first_utm_content: clean(packed.get('K'), 240) || undefined,
      first_utm_term: clean(packed.get('T'), 180) || undefined,
      first_utm_id: clean(packed.get('I'), 180) || undefined,
      first_campaign_id: clean(packed.get('I'), 180) || undefined,
      first_adset_id: clean(packed.get('A'), 180) || undefined,
      first_ad_id: clean(packed.get('D'), 180) || undefined,
      first_placement: clean(packed.get('P'), 120) || undefined,
      jf_journey_id: clean(packed.get('j'), 160) || undefined,
      encoded_source: raw,
    };
  }

  root.JonerAttribution = {
    marker: MARKER,
    trackingKeys: TRACKING_KEYS.slice(),
    encodeForUscreen: encodeForUscreen,
    decodeUscreenSource: decodeUscreenSource,
    journeyId: ledgerJourneyId,
    journeyToken: signedJourneyToken,
    saveJourneyToken: saveSignedJourneyToken,
    recordEvent: recordEvent,
  };
})(typeof window !== 'undefined' ? window : globalThis);
