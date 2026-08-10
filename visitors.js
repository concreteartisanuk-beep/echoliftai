// --- Live visitor counter ---
//
// Social proof only works if the number is real, so this reads the actual count
// from /api/visitor-count rather than animating a made-up figure. One visit is
// counted per browser session, not per page view, so refreshing the page doesn't
// inflate it.
//
// The counter deliberately stays hidden until the figure is worth showing: "3
// visitors today" is weaker proof than no proof at all, and an obviously tiny
// number costs more sales than it wins. Once real traffic arrives it appears on
// its own with no code change.
(() => {
  'use strict';

  const SESSION_KEY = 'echolift.visit.counted';

  // Thresholds below which the number is left hidden.
  const MIN_TODAY = 12;
  const MIN_TOTAL = 40;

  const format = (n) => new Intl.NumberFormat('en-GB').format(n);

  // Private browsing and locked-down storage settings both throw on access, and
  // a counter is never worth breaking a page over.
  const countedThisSession = () => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      return false;
    }
  };

  const markCounted = () => {
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      /* nothing to do — worst case this visit is counted twice */
    }
  };

  /** Fills a slot and reveals it, if that slot exists on this page. */
  const fill = (id, text) => {
    const slot = document.getElementById(id);
    if (!slot) return;
    const label = slot.querySelector('[data-visitor-text]');
    if (label) label.textContent = text;
    slot.hidden = false;
  };

  /**
   * Picks the strongest honest figure available and shows it. Today's traffic
   * beats an all-time total when there's enough of it; otherwise the total
   * carries the proof; if neither is meaningful yet, nothing is shown.
   */
  const render = ({ total = 0, today = 0 }) => {
    if (today >= MIN_TODAY) {
      fill('visitorPill', `${format(today)} visitors here today`);
      fill('visitorProof', `${format(today)} here today`);
      return;
    }
    if (total >= MIN_TOTAL) {
      fill('visitorPill', `${format(total)} visitors so far`);
      fill('visitorProof', `${format(total)} visitors so far`);
    }
  };

  const load = async () => {
    // A returning tab reads the counter; a fresh session also adds to it.
    const isNewVisit = !countedThisSession();

    try {
      const res = await fetch('/api/visitor-count', {
        method: isNewVisit ? 'POST' : 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return;

      const data = await res.json();
      if (isNewVisit) markCounted();
      render(data || {});
    } catch {
      // Offline, blocked or mid-deploy: the pill simply stays hidden.
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
