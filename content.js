// content.js — YouTube Cinema
// Injects download button on video pages + cosmetic ad cleanup + settings toggles
//
// Video ads are blocked upstream by inject.js (MAIN world) and rules.json.
// What remains here only covers surfaces those layers can't reach: banner,
// companion and in-feed ad cards, plus a Skip-button fallback for the rare
// server-stitched ad that still reaches the player.

'use strict';

// ─────────────────────────────────────────────────────────
// SETTINGS — applied via body classes driven by popup
// ─────────────────────────────────────────────────────────
// The popup sends only the key the user changed, so settings are merged into
// this cache rather than replacing it — otherwise flipping one toggle would
// reset the other three.
const settings = {
  hideComments: true,
  hideSidebar: false,
  customProgress: true,
  adBlocker: true
};

const applySettings = (update) => {
  Object.assign(settings, update);
  const b = document.body;
  b.classList.toggle('ytc-hide-comments', !!settings.hideComments);
  b.classList.toggle('ytc-hide-sidebar', !!settings.hideSidebar);
  b.classList.toggle('ytc-custom-progress', !!settings.customProgress);
  // Gates the CSS ad rules in content.css.
  b.classList.toggle('ytc-adblock', !!settings.adBlocker);
  // inject.js runs at document_start, long before chrome.storage resolves, so
  // the flag is mirrored into the page's localStorage where it can read it
  // synchronously on the next page load.
  try {
    localStorage.setItem('ytc_adblock', settings.adBlocker ? 'on' : 'off');
  } catch (e) { }
};

chrome.storage.sync.get(
  { hideComments: true, hideSidebar: false, customProgress: true, adBlocker: true },
  applySettings
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const update = {};
  Object.keys(settings).forEach((key) => {
    if (changes[key]) update[key] = changes[key].newValue;
  });
  if (Object.keys(update).length) applySettings(update);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'settingsUpdate') applySettings(msg.settings);
});

// ─────────────────────────────────────────────────────────
// AD SURFACE CLEANUP — banner / companion / in-feed cards
// ─────────────────────────────────────────────────────────

const AD_SURFACE_SELECTORS = [
  // Page-level companion / in-feed ad renderers
  'ytd-player-legacy-desktop-watch-ads-renderer',
  'ytd-companion-slot-renderer',
  'ytd-companion-ad-renderer',
  'ytd-display-ad-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-video-renderer',
  'ytd-ad-slot-renderer',
  // In-player overlay containers (current + likely new class names)
  '#player-ads',
  '.ytp-ad-player-overlay',
  '.ytp-ad-player-overlay-layout',
  '.ytp-ad-player-overlay-layout__ad-info-container',
  '.ytp-ad-player-overlay-layout__player-container',
  '.ytp-ad-end-screen',
  '.ytp-ad-end-screen-replay',
  '.ytp-ad-end-screen-content',
  '.ytp-ad-end-screen-headline',
  '.ytp-ad-overlay-slot',
  '.ytp-ad-overlay-container',
  '.ytp-ad-action-interstitial',
  '.ytp-ad-action-interstitial-background',
  '.ytp-ad-preview-container',
  '.ytp-ad-image-overlay',
  '.ytp-ad-text-overlay',
  '.ytp-ad-feedback-dialog',
  '.ytp-ad-info-dialog',
  '.ytp-ad-overlay',
  '.ytp-ad-visit-advertiser-link',
  '.ytp-ad-replay-button',
  '.ytp-ad-duration-remaining',
  '.ytp-ad-badge-container',
  '.ytp-ad-badge',
  // Ad iframes
  '#movie_player iframe[src*="doubleclick.net"]',
  '#movie_player iframe[src*="googlesyndication.com"]',
  '#movie_player iframe[src*="googleadservices.com"]'
];

// Surfaces that only appear after an ad has ended / been skipped.
const POST_AD_SURFACE_SELECTORS = new Set([
  'ytd-player-legacy-desktop-watch-ads-renderer',
  '.ytp-ad-end-screen',
  '.ytp-ad-player-overlay',
  '.ytp-ad-player-overlay-layout'
]);

// Renderers that must stay hidden-but-present (removing them can break YouTube).
const KEEP_HIDDEN_SELECTORS = new Set([
  '#player-ads',
  'ytd-player-legacy-desktop-watch-ads-renderer',
  'ytd-companion-slot-renderer',
  'ytd-companion-ad-renderer',
  'ytd-display-ad-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-video-renderer',
  'ytd-ad-slot-renderer'
]);

const handledPostAdSurfaces = new WeakSet();
let lastPostAdCardCheck = 0;
let lastSponsoredSidebarCheck = 0;
let lastAdEndTime = 0;
let wasAdShowing = false;

function hideAdSurface(el) {
  el.style.setProperty('display', 'none', 'important');
  el.style.setProperty('visibility', 'hidden', 'important');
  el.style.setProperty('opacity', '0', 'important');
  el.style.setProperty('pointer-events', 'none', 'important');
}

function removeAdSurfaceIfSafe(el, selector) {
  // Only physically remove lightweight overlay elements that the player
  // re-creates anyway.
  if (
    KEEP_HIDDEN_SELECTORS.has(selector) ||
    selector.includes('iframe') ||
    !el.parentElement ||
    !(
      el.parentElement.classList.contains('html5-video-player') ||
      el.parentElement.id === 'movie_player'
    )
  ) return;
  el.remove();
}

function getNormalizedText(el) {
  return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// The post-ad card ("Advertisement · 0:30 · Replay") has no stable class name,
// so identify it by the text YouTube writes into it. It is only checked while
// an ad is, or just was, active to avoid false positives on normal content.
const POST_AD_COPY_RE =
  /(^|\s)(ad(?:s)?|advertisement|sponsored)(\s|$|[:\u2014\u2013\-,])|brought to you by/i;
const POST_AD_ACTION_RE =
  /\b(replay|play again|download|book now|learn more|shop now|visit (?:site|advertiser)|watch (?:on youtube|now)|stay on youtube)\b|\b\d+:\d{2}\b/i;

function findPostAdCardIn(player) {
  if (!player) return null;

  const candidates = [...player.querySelectorAll('*')].filter((el) => {
    // Never treat legitimate player chrome / end-of-video UI as an ad card.
    if (
      el.closest(
        '.ytp-replay-button, .ytp-videowall, .ytp-ce-element, .ytp-cards-teaser, ' +
        '.ytp-chapter-container, .ytp-share-button, .ytp-title, .ytp-tooltip, ' +
        '.ytp-menuitem, .ytp-share-panel, .ytp-settings-menu'
      )
    ) return false;
    const text = getNormalizedText(el);
    if (!text || text.length > 300) return false;
    return POST_AD_COPY_RE.test(text) && POST_AD_ACTION_RE.test(text);
  });
  if (!candidates.length) return null;

  const depthOf = (el) => {
    let d = 0;
    for (let p = el.parentElement; p; p = p.parentElement) d++;
    return d;
  };
  let surface = candidates.reduce((deepest, node) =>
    depthOf(node) > depthOf(deepest) ? node : deepest
  );

  // Climb to the topmost card that is separate from the real video.
  while (
    surface.parentElement &&
    surface.parentElement !== player &&
    !surface.parentElement.querySelector('video.html5-main-video')
  ) {
    surface = surface.parentElement;
  }

  if (surface === player) return null;
  if (surface.querySelector('video.html5-main-video')) return null;
  return surface;
}

function hideTextIdentifiedPostAdCard() {
  const player = document.querySelector('#movie_player, .html5-video-player');
  const surface = findPostAdCardIn(player);
  if (!surface) return false;

  hideAdSurface(surface);
  if (
    surface.parentElement &&
    (
      surface.parentElement.classList.contains('html5-video-player') ||
      surface.parentElement.id === 'movie_player'
    )
  ) {
    surface.remove();
  }
  return true;
}

function hideSponsoredSidebarCards() {
  // Companion ads sit beside the player, outside #movie_player, and are not
  // removed by the video-ad handler. Cover YouTube's known companion hosts
  // first, then remove a sponsored recommendation card if it uses a new host.
  const now = Date.now();
  if (now - lastSponsoredSidebarCheck < 500) return;
  lastSponsoredSidebarCheck = now;

  document.querySelectorAll(
    'ytd-companion-slot-renderer, ytd-companion-ad-renderer, ' +
    'ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, ' +
    'ytd-promoted-video-renderer, ytd-ad-slot-renderer'
  ).forEach(hideAdSurface);

  document.querySelectorAll('#secondary, #related').forEach((sidebar) => {
    const sponsoredCardNode = [...sidebar.querySelectorAll('*')].find((el) => {
      const text = getNormalizedText(el);
      const card = el.closest(
        'ytd-compact-video-renderer, ytd-video-renderer, ytd-rich-item-renderer, ytd-item-section-renderer'
      );
      return !!card && text.includes('sponsored') &&
        /\b(visit site|learn more|shop now|download|book now)\b/.test(text);
    });
    if (!sponsoredCardNode) return;

    const card = sponsoredCardNode.closest(
      'ytd-compact-video-renderer, ytd-video-renderer, ytd-rich-item-renderer, ytd-item-section-renderer'
    );
    if (card) hideAdSurface(card);
  });
}

function isAdStateOrPostAdWindow() {
  if (document.querySelector('.ad-showing')) return true;
  return lastAdEndTime !== 0 && Date.now() - lastAdEndTime < 8000;
}

function resumeMainVideoIfPaused() {
  const mainVideo = document.querySelector('video.html5-main-video');
  if (mainVideo && mainVideo.paused && !document.querySelector('.ad-showing')) {
    mainVideo.play().catch(() => { });
  }
}

// Fallback timing for a server-stitched ad that slips past the blocker.
let adFallbackSince = 0;
let lastSkipApiAt = 0;

// ── Instant hiding — kills the "post-ad card flashes for a second" flicker ──
let adObserver = null;
let adObserverTarget = null;

function startAdObserver() {
  const player = document.querySelector('#movie_player, .html5-video-player');
  if (!player || adObserver) return;

  adObserverTarget = player;
  adObserver = new MutationObserver((mutations) => {
    if (!settings.adBlocker) return;
    let shouldResume = false;

    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node;
        const classes = typeof el.className === 'string' ? el.className : '';
        const hinted =
          /ytp-ad|ytd-(?:ad|companion|promoted)/i.test(classes + ' ' + el.tagName);
        if (!hinted) continue;

        for (const sel of AD_SURFACE_SELECTORS) {
          const matched = [];
          if (el.matches && el.matches(sel)) matched.push(el);
          if (el.querySelectorAll) matched.push(...el.querySelectorAll(sel));

          for (const target of matched) {
            const wasVisible = target.getClientRects().length > 0;
            hideAdSurface(target);
            removeAdSurfaceIfSafe(target, sel);
            if (
              POST_AD_SURFACE_SELECTORS.has(sel) &&
              wasVisible &&
              !document.querySelector('.ad-showing')
            ) shouldResume = true;
          }
        }
      }
    }

    if (isAdStateOrPostAdWindow() && Date.now() - lastPostAdCardCheck >= 250) {
      lastPostAdCardCheck = Date.now();
      if (hideTextIdentifiedPostAdCard()) shouldResume = true;
    }

    if (shouldResume) resumeMainVideoIfPaused();
  });

  adObserver.observe(player, { subtree: true, childList: true });
}

// ── Native skip / ad-state clearing helpers ────────────────

// Click whatever native skip control YouTube currently renders
// (.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, …).
function clickNativeSkipButton() {
  const explicitAdControls = document.querySelectorAll(
    '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-modern-variant, ' +
    '.ytp-skip-ad-button, .ytp-ad-skip-button-slot, .ytp-ad-skip-button-container, ' +
    '.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container, ' +
    '.ytp-ad-end-screen .ytp-ad-skip-button, .ytp-ad-action-interstitial .ytp-ad-skip-button'
  );

  // YouTube periodically changes the class names on its Skip button. Keep the
  // class selectors above for the normal case, then fall back to the control's
  // visible/accessibility text only while an ad is being shown in the player.
  const labelledSkipControls = document.querySelectorAll(
    '#movie_player button, #movie_player [role="button"], ' +
    '.html5-video-player button, .html5-video-player [role="button"]'
  );

  const explicitAdControlSet = new Set(explicitAdControls);
  let clicked = false;

  new Set([...explicitAdControls, ...labelledSkipControls]).forEach((btn) => {
    const label = [
      btn.getAttribute('aria-label'),
      btn.getAttribute('title'),
      btn.textContent
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const isSkipControl = explicitAdControlSet.has(btn);
    // New YouTube ad UIs can omit .ad-showing and the historical ad wrapper.
    // A visible Skip control inside the video player is still safe to trigger.
    const isLabelledAdSkip = /(^|\s)skip(?:\s+(?:ad|ads|advertisement))?(?:\s|$)/.test(label);

    if (!isSkipControl && !isLabelledAdSkip) return;
    if (btn.getClientRects().length === 0) return;

    // Some of YouTube's redesigned controls listen for a pointer sequence
    // before the click handler, so provide both before calling click().
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((type) => {
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    btn.click();
    clicked = true;
  });

  return clicked;
}

// Call the player's internal skip API when the on-screen button is gone.
function callPlayerSkipApi() {
  const player = document.querySelector('#movie_player, .html5-video-player');
  if (!player) return false;
  try {
    if (typeof player.skipAd === 'function') {
      player.skipAd();
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    if (typeof player.cancelAd === 'function') {
      player.cancelAd();
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    if (typeof player.hideAdUi === 'function') player.hideAdUi();
  } catch (e) { /* fall through */ }
  return false;
}

setInterval(() => {
  if (!settings.adBlocker) return;

  // (Re)start the observer if it was never started or the player was replaced
  if (!adObserver || (adObserverTarget && !document.body.contains(adObserverTarget))) {
    if (adObserver) adObserver.disconnect();
    adObserver = null;
    startAdObserver();
  }

  // Track when an ad is, or just was, active (used to gate text detection)
  const adShowing = !!document.querySelector('.ad-showing');
  if (adShowing) {
    lastAdEndTime = 0;
  } else if (wasAdShowing) {
    lastAdEndTime = Date.now();
  }
  wasAdShowing = adShowing;

  // ── 1) Click all skip / close / dismiss buttons ──
  clickNativeSkipButton();

  // ── 2) Hide / remove overlay ad containers (blurred end-screen, cards…) ──
  let shouldResumeMainVideo = false;

  AD_SURFACE_SELECTORS.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      const isPostAdSurface = POST_AD_SURFACE_SELECTORS.has(sel);
      const wasVisible = el.getClientRects().length > 0;

      hideAdSurface(el);
      removeAdSurfaceIfSafe(el, sel);

      if (
        isPostAdSurface &&
        wasVisible &&
        !adShowing &&
        !handledPostAdSurfaces.has(el)
      ) {
        handledPostAdSurfaces.add(el);
        shouldResumeMainVideo = true;
      }
    });
  });

  // ── 3) Text-identified post-ad card (only while an ad is/was active) ──
  if (isAdStateOrPostAdWindow() && Date.now() - lastPostAdCardCheck >= 250) {
    lastPostAdCardCheck = Date.now();
    if (hideTextIdentifiedPostAdCard()) shouldResumeMainVideo = true;
  }

  hideSponsoredSidebarCards();

  // ── 4) Resume the main video once the post-ad surface is suppressed ──
  if (shouldResumeMainVideo && !adShowing) resumeMainVideoIfPaused();

  // ── 5) Fallback for a server-stitched ad that reached the player anyway ──
  // No seeking and no playbackRate changes: those make the ad play (just
  // faster) and leave a visible seam. Only ask the player to skip, and only
  // after its own Skip control has had a moment to appear.
  if (adShowing) {
    if (!adFallbackSince) adFallbackSince = Date.now();
    if (
      Date.now() - adFallbackSince >= 1500 &&
      Date.now() - lastSkipApiAt > 1500
    ) {
      lastSkipApiAt = Date.now();
      callPlayerSkipApi();
    }
  } else {
    adFallbackSince = 0;
  }
}, 300);

