(function (root) {
  'use strict';

  var MARKER = '__jfa1__';
  var TRACKING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];

  function clean(value, max) {
    return String(value || '').trim().slice(0, max || 240);
  }

  function encodeForUscreen(input) {
    var params = input instanceof URLSearchParams
      ? new URLSearchParams(input.toString())
      : new URLSearchParams(input || '');
    var source = clean(params.get('utm_source') || 'direct', 120);
    var medium = clean(params.get('utm_medium'), 180);
    var campaign = clean(params.get('utm_campaign'), 240);
    var content = clean(params.get('utm_content'), 240);

    if (!campaign || source.indexOf(MARKER) !== -1) return params;

    var packed = new URLSearchParams();
    packed.set('s', source);
    if (medium) packed.set('m', medium);
    packed.set('c', campaign);
    if (content) packed.set('k', content);
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
      encoded_source: raw,
    };
  }

  root.JonerAttribution = {
    marker: MARKER,
    trackingKeys: TRACKING_KEYS.slice(),
    encodeForUscreen: encodeForUscreen,
    decodeUscreenSource: decodeUscreenSource,
  };
})(typeof window !== 'undefined' ? window : globalThis);
