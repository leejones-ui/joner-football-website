(function (root) {
  'use strict';

  var MARKER = '__jfa1__';
  var TRACKING_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
    'campaign_id', 'adset_id', 'ad_id', 'placement', 'fbclid', 'fbp', 'fbc',
    'first_utm_source', 'first_utm_medium', 'first_utm_campaign', 'first_utm_content',
    'first_utm_term', 'first_utm_id', 'first_campaign_id', 'first_adset_id',
    'first_ad_id', 'first_placement'
  ];

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
    var term = clean(params.get('utm_term'), 180);
    var campaignId = clean(params.get('utm_id') || params.get('campaign_id'), 180);
    var adsetId = clean(params.get('adset_id'), 180);
    var adId = clean(params.get('ad_id'), 180);
    var placement = clean(params.get('placement'), 120);
    var fbclid = clean(params.get('fbclid'), 500);
    var fbp = clean(params.get('fbp'), 240);
    var fbc = clean(params.get('fbc'), 500);
    var firstSource = clean(params.get('first_utm_source'), 120);
    var firstMedium = clean(params.get('first_utm_medium'), 180);
    var firstCampaign = clean(params.get('first_utm_campaign'), 240);
    var firstContent = clean(params.get('first_utm_content'), 240);
    var firstTerm = clean(params.get('first_utm_term'), 180);
    var firstCampaignId = clean(params.get('first_utm_id') || params.get('first_campaign_id'), 180);
    var firstAdsetId = clean(params.get('first_adset_id'), 180);
    var firstAdId = clean(params.get('first_ad_id'), 180);
    var firstPlacement = clean(params.get('first_placement'), 120);

    if (!campaign || source.indexOf(MARKER) !== -1) return params;

    var packed = new URLSearchParams();
    packed.set('s', source);
    if (medium) packed.set('m', medium);
    packed.set('c', campaign);
    if (content) packed.set('k', content);
    if (term) packed.set('t', term);
    if (campaignId) packed.set('i', campaignId);
    if (adsetId) packed.set('a', adsetId);
    if (adId) packed.set('d', adId);
    if (placement) packed.set('p', placement);
    if (fbp) packed.set('b', fbp);
    if (fbc) packed.set('q', fbc);
    else if (fbclid) packed.set('f', fbclid);
    if (firstSource) packed.set('S', firstSource);
    if (firstMedium) packed.set('M', firstMedium);
    if (firstCampaign) packed.set('C', firstCampaign);
    if (firstContent) packed.set('K', firstContent);
    if (firstTerm) packed.set('T', firstTerm);
    if (firstCampaignId) packed.set('I', firstCampaignId);
    if (firstAdsetId) packed.set('A', firstAdsetId);
    if (firstAdId) packed.set('D', firstAdId);
    if (firstPlacement) packed.set('P', firstPlacement);
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
