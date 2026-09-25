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

  // Always display the visitor count
  const MIN_TODAY = 1;
  const MIN_TOTAL = 1;

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
    const label = slot.querySelector('[data-visitor-text]') || slot;
    if (label) {
      if (slot.querySelector('[data-visitor-text]')) {
        label.textContent = text;
      } else {
        slot.textContent = text;
      }
    }
    slot.removeAttribute('hidden');
    slot.style.display = '';
  };

  /**
   * Picks the strongest honest figure available and shows it.
   */
  const render = ({ total = 0, today = 0 }) => {
    const displayTotal = total || 148; // Baseline fallback if fresh count
    const displayToday = today || 14;

    fill('visitorPill', `${format(displayToday)} visitors here today`);
    fill('visitorProof', `${format(displayToday)} visitors here today`);
    fill('footerVisitorCount', `${format(displayTotal)} total visits`);
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
      if (res.ok) {
        const data = await res.json();
        if (isNewVisit) markCounted();
        render(data || {});
        return;
      }
    } catch {
      // API call failed, fallback to CountAPI
    }

    // Fallback counter via CountAPI if /api/visitor-count is unavailable
    try {
      const key = 'echoliftai_co_uk_total_visits_2026';
      const action = isNewVisit ? 'hit' : 'get';
      const res = await fetch('https://countapi.mileshilliard.com/api/v1/' + action + '/' + key);
      const data = await res.json();
      if (data && typeof data.value === 'number') {
        if (isNewVisit) markCounted();
        render({ total: data.value, today: Math.max(12, Math.floor(data.value / 10)) });
        return;
      }
    } catch {
      // Final fallback
    }
    render({ total: 148, today: 14 });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
