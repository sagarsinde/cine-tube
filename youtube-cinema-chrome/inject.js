// inject.js — YouTube Cinema
// Runs in the MAIN world at document_start, before YouTube's player boots.
//
// Ads are not hidden or skipped here. The metadata that tells the player an ad
// break exists is removed before the player ever reads it, so no ad stream is
// ever requested. This is the same technique uBlock Origin / Brave use
// ("json-prune"): hook the JSON entry points, drop the ad keys, pass the rest
// through untouched.

(function () {
  'use strict';

  // Keys YouTube uses to describe ad breaks. Removing them leaves the player
  // with a video that simply has no ads scheduled.
  const AD_KEYS = [
    'adPlacements',
    'adSlots',
    'playerAds',
    'adBreakHeartbeatParams',
    'adParams',
    'adBreakParams',
    'adServerData',
    'importantForAds'
  ];

  // Cheap pre-filter: only payloads whose raw text mentions one of these are
  // worth walking. YouTube calls JSON.parse constantly, so this string check is
  // what keeps the hook lightweight.
  const AD_HINT = /"(?:adPlacements|adSlots|playerAds|adBreakHeartbeatParams|adServerData)"/;

  const MAX_DEPTH = 12;

  function isEnabled() {
    // Shared with content.js via the page's own localStorage (same origin), so
    // the setting is readable synchronously at document_start.
    try {
      return localStorage.getItem('ytc_adblock') !== 'off';
    } catch (e) {
      return true;
    }
  }

  function strip(node, depth) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;

    if (Array.isArray(node)) {
      for (const item of node) strip(item, depth + 1);
      return;
    }

    for (const key of AD_KEYS) {
      if (key in node) delete node[key];
    }
    // Server-side stitched ads (dynamic ad insertion).
    if (node.playerConfig && node.playerConfig.daiConfig) {
      delete node.playerConfig.daiConfig;
    }

    for (const key in node) {
      const value = node[key];
      if (value && typeof value === 'object') strip(value, depth + 1);
    }
  }

  function sanitize(data) {
    try {
      if (isEnabled()) strip(data, 0);
    } catch (e) { /* never let sanitizing break playback */ }
    return data;
  }

  // ── 1) JSON.parse — the main path ──────────────────────────
  // YouTube parses every player/next response through here, whether it arrived
  // via fetch, XHR, or an inline <script>. Hooking this one function covers
  // all of them, so no fetch/XHR wrapping is needed.
  const originalParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const data = originalParse.call(this, text, reviver);
    if (typeof text === 'string' && text.length > 1000 && AD_HINT.test(text)) {
      sanitize(data);
    }
    return data;
  };

  // ── 2) Response.prototype.json — for code that skips JSON.parse ─────
  const originalJson = Response.prototype.json;
  Response.prototype.json = function () {
    return originalJson.call(this).then((data) => sanitize(data));
  };

  // ── 3) ytInitialPlayerResponse — the first page load ───────
  // Set by an inline <script> in the HTML. Sanitized on read so the player
  // always sees an ad-free object regardless of assignment order.
  try {
    let raw;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() {
        return sanitize(raw);
      },
      set(value) {
        raw = value;
      }
    });
  } catch (e) { }
})();
