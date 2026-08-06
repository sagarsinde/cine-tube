// global-ads.js — cross-site ad container cleanup
// Runs on every site except YouTube (which has its own pipeline in
// content.js/inject.js). rules.json blocks the ad network requests; this
// script removes the empty containers those blocked requests leave behind,
// which is what collapses the gaps at the top of news articles.

'use strict';

let enabled = true;

// ── Anti-anti-adblock ────────────────────────────────────────
// Detectors check two things: whether the adsbygoogle global exists, and
// whether a bait element they plant gets hidden. Neutralize both.
// This runs at document_idle, so also define the globals sites probe for.
try {
  if (typeof window.adsbygoogle === 'undefined') {
    window.adsbygoogle = { loaded: true, push: function () {} };
  }
} catch (e) { }

chrome.storage.sync.get({ globalAdBlock: true }, (s) => {
  enabled = !!s.globalAdBlock;
  if (enabled) init();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.globalAdBlock) {
    enabled = !!changes.globalAdBlock.newValue;
    if (enabled) init();
    else restore();
  }
});

// Selectors for containers that exist only to hold an ad. Kept conservative:
// each must be unambiguous (ad network iframes, data attributes, ids/classes
// that are always ads) so real content is never hidden.
const AD_SELECTORS = [
  'iframe[id^="google_ads_iframe_"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'div[id^="div-gpt-ad"]',
  'div[id^="google_ads_iframe_"]',
  '[data-ad-slot]',
  '[data-ad-unit]',
  '[data-advertisement]',
  '[data-ad]',
  '.adsbygoogle',
  'ins.adsbygoogle',
  '[id^="taboola-"]',
  '[class*="taboola"]',
  '[id^="outbrain-"]',
  '.OUTBRAIN',
  '[data-outbrain]',
  'amp-ad',
  'amp-embed[type="taboola"]',
  'amp-embed[type="outbrain"]'
];

// Generic wrappers many CMSs use around ad slots. These are only hidden when
// they ended up empty (the blocked request never filled them).
const WRAPPER_SELECTORS = [
  '[class*="ad-container"]',
  '[class*="ad-wrapper"]',
  '[class*="ad-slot"]',
  '[class*="ad-banner"]',
  '[class*="ad-leaderboard"]',
  '[class*="advert-container"]',
  '[id*="ad-container"]',
  '[id*="ad-slot"]',
  '[id*="ad-banner"]'
];

const HIDE_ATTR = 'data-ytc-hidden';

// Bait class names detectors plant to test if an adblocker is hiding things.
// We must NOT hide these — hiding them is exactly what trips the detector.
const BAIT_PATTERN = /\b(ad-banner|adBanner|adsbox|ad-placeholder|ad-test|textads|sponsor-ad|adframe)\b/i;

function isBait(el) {
  return BAIT_PATTERN.test(el.className) || BAIT_PATTERN.test(el.id);
}

function hideEl(el) {
  if (el.hasAttribute(HIDE_ATTR) || isBait(el)) return;
  el.setAttribute(HIDE_ATTR, '');
  el.style.setProperty('display', 'none', 'important');
}

function isVisuallyEmpty(el) {
  // A wrapper is safe to collapse when it has no visible media/iframe content
  // and no meaningful text — i.e. the ad never loaded into it.
  if (el.querySelector('img, video, iframe, canvas, svg')) return false;
  return el.textContent.trim().length < 20;
}

// Walk up from a hidden ad through every ancestor that is itself empty, hiding
// each one. News CMSs nest ad slots several divs deep; collapsing only the
// innermost leaves the outer wrappers' height/margins behind as a gap.
function collapseChain(el) {
  let node = el;
  while (node && node !== document.body && node !== document.documentElement) {
    if (isBait(node)) break;
    if (node !== el && !isVisuallyEmpty(node)) break;
    hideEl(node);
    node = node.parentElement;
  }
}

// Some containers reserve space with min-height before the ad ever loads, so
// even an "empty" one still holds a gap. Clamp those instead of only hiding.
function clampReserved(el) {
  if (isBait(el) || el.hasAttribute(HIDE_ATTR)) return;
  const style = getComputedStyle(el);
  const minH = parseFloat(style.minHeight) || 0;
  if (minH > 100 && isVisuallyEmpty(el)) {
    el.setAttribute(HIDE_ATTR, '');
    el.style.setProperty('min-height', '0', 'important');
    el.style.setProperty('height', '0', 'important');
    el.style.setProperty('margin-top', '0', 'important');
    el.style.setProperty('margin-bottom', '0', 'important');
    el.style.setProperty('padding-top', '0', 'important');
    el.style.setProperty('padding-bottom', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
  }
}

function sweep() {
  if (!enabled || !document.body) return;

  for (const sel of AD_SELECTORS) {
    document.querySelectorAll(sel).forEach((el) => {
      hideEl(el);
      collapseChain(el);
    });
  }

  for (const sel of WRAPPER_SELECTORS) {
    document.querySelectorAll(sel).forEach((el) => {
      if (isVisuallyEmpty(el)) {
        collapseChain(el);
      } else {
        clampReserved(el);
      }
    });
  }
}

function restore() {
  document.querySelectorAll('[' + HIDE_ATTR + ']').forEach((el) => {
    el.style.removeProperty('display');
    el.style.removeProperty('min-height');
    el.style.removeProperty('height');
    el.style.removeProperty('margin-top');
    el.style.removeProperty('margin-bottom');
    el.style.removeProperty('padding-top');
    el.style.removeProperty('padding-bottom');
    el.style.removeProperty('overflow');
    el.removeAttribute(HIDE_ATTR);
  });
}

let observer = null;
let scheduled = false;

function scheduleSweep() {
  if (scheduled) return;
  scheduled = true;
  // Batch mutations: ads hydrate in bursts, one sweep per frame is enough.
  requestAnimationFrame(() => {
    scheduled = false;
    sweep();
  });
}

function init() {
  if (observer) return; // already running
  sweep();
  observer = new MutationObserver(scheduleSweep);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Stop observing after the page settles — late-loading ads are handled by
  // the first minutes of observation; watching forever is wasted work.
  setTimeout(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }, 60000);
}
