// --- Premium AI Growth Report (paid, £47) ---
//
// The report is the paid entry product, not a giveaway: the brief on the page is
// an order form, so nothing is generated until Stripe confirms the payment. The
// same brief drives both buy buttons (the one under the form and the one in the
// "what's inside" section further down) so a visitor never types their details
// twice, and it is posted to the lead endpoint before checkout opens — someone
// who abandons the payment page is still a lead we can follow up.
//
// The brief is also kept in this browser. Typing business details is the main
// cost of buying, so nobody should ever pay it twice: a visitor who leaves and
// comes back, or who bails out of Stripe and lands back here, finds their brief
// already filled in and one click from checkout.
(() => {
  'use strict';

  const PRICE_LABEL = '£25';
  const BUY_LABEL = `Get my report — ${PRICE_LABEL}`;
  const STORAGE_KEY = 'echolift.reportBrief';

  const escapeHtml = (str) => String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const el = (id) => document.getElementById(id);
  const value = (id) => ((el(id) && el(id).value) || '').trim();

  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // ------------------------------------------------------------------- the brief
  const FIELDS = {
    email: 'reportEmail',
    businessName: 'reportBizName',
    industry: 'reportIndustry',
    city: 'reportCity',
    usp: 'reportUsp'
  };

  /** The details the report is written from, straight off the form. */
  const collectBrief = () => ({
    email: value(FIELDS.email),
    businessName: value(FIELDS.businessName),
    industry: value(FIELDS.industry),
    city: value(FIELDS.city),
    usp: value(FIELDS.usp)
  });

  /**
   * Returns the id of the first field that isn't usable, or null when the brief
   * is good enough to write a £47 report from. Business name and email are the
   * only hard requirements: the name is what the report is about, the email is
   * where it gets delivered.
   */
  const firstProblemField = (brief) => {
    if (!brief.businessName) return FIELDS.businessName;
    if (!isValidEmail(brief.email)) return FIELDS.email;
    return null;
  };

  const problemMessage = (fieldId) =>
    fieldId === FIELDS.businessName
      ? 'Please tell us your business name — the report is written about it.'
      : 'Please enter a valid work email so we can send your report.';

  // --------------------------------------------------- keeping the brief around
  /** Stores the brief locally. Storage failures are never worth surfacing. */
  const rememberBrief = (brief) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(brief));
    } catch (err) {
      /* private mode or a full quota — the form simply won't prefill */
    }
  };

  const recallBrief = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return saved && typeof saved === 'object' ? saved : null;
    } catch (err) {
      return null;
    }
  };

  /**
   * Puts a saved brief back into any field the visitor hasn't already filled in.
   *
   * @returns {boolean} true if anything was actually restored
   */
  const restoreBrief = () => {
    const saved = recallBrief();
    if (!saved) return false;

    let restored = false;
    Object.entries(FIELDS).forEach(([key, id]) => {
      const field = el(id);
      const stored = typeof saved[key] === 'string' ? saved[key].trim() : '';
      if (!field || field.value.trim() || !stored) return;
      field.value = stored;
      restored = true;
    });
    return restored;
  };

  // ------------------------------------------------------------------- panels
  const idle = el('reportIdle');
  const loading = el('reportLoading');
  const loadingText = el('reportLoadingText');
  const errorBox = el('reportError');
  const errorText = el('reportErrorText');

  const setPanel = (state) => {
    if (!idle || !loading || !errorBox) return;
    idle.style.display = state === 'idle' ? 'flex' : 'none';
    loading.style.display = state === 'loading' ? 'flex' : 'none';
    errorBox.style.display = state === 'error' ? 'flex' : 'none';
  };

  const showPanelError = (message) => {
    if (errorText) errorText.textContent = message;
    setPanel('error');
  };

  const resumeBox = el('reportResume');
  const resumeText = el('reportResumeText');

  /** The "we kept your details" note above the form. */
  const showResume = (html) => {
    if (!resumeBox || !resumeText) return;
    resumeText.innerHTML = html;
    resumeBox.hidden = false;
  };

  // ----------------------------------------------------------- field-level errors
  /** Marks the offending field so the fix is obvious without reading a panel. */
  const markProblemField = (fieldId) => {
    const field = el(fieldId);
    if (!field) return;
    field.classList.add('field-invalid');
    field.setAttribute('aria-invalid', 'true');
    const clear = () => {
      field.classList.remove('field-invalid');
      field.removeAttribute('aria-invalid');
      field.removeEventListener('input', clear);
    };
    field.addEventListener('input', clear);
  };

  // ----------------------------------------------------------------- checkout
  /** Records the brief so an abandoned checkout is still a followable lead. */
  const captureLead = async (brief) => {
    try {
      await fetch('/api/report-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brief),
        keepalive: true
      });
    } catch (err) {
      // Never block a sale on our own bookkeeping.
    }
  };

  /** True when the node is already near the top of the viewport. */
  const isInView = (node) => {
    const box = node.getBoundingClientRect();
    return box.top >= 0 && box.top < window.innerHeight * 0.5;
  };

  /**
   * Validates the brief and sends the visitor to Stripe for the report.
   *
   * @param {object} ui
   * @param {HTMLElement} ui.button      button that was pressed
   * @param {HTMLElement} [ui.label]     span holding its label text
   * @param {function} ui.onProblem      shows a validation/availability message
   * @param {function} [ui.onStart]      called once checkout is being opened
   */
  const buyReport = async (ui) => {
    const brief = collectBrief();
    const problem = firstProblemField(brief);

    if (problem) {
      ui.onProblem(problemMessage(problem));
      markProblemField(problem);
      const section = el('growth-report');
      if (section && !isInView(section)) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      const field = el(problem);
      if (field) setTimeout(() => field.focus({ preventScroll: true }), 400);
      return;
    }

    // Saved before leaving the page, so an abandoned checkout costs the visitor
    // nothing to retry.
    rememberBrief(brief);

    if (!window.echoliftCheckout) {
      ui.onProblem("Checkout isn't available right now. Email info@echoliftai.co.uk and we'll send your report over personally.");
      return;
    }

    const originalLabel = ui.label ? ui.label.textContent : '';
    ui.button.disabled = true;
    if (ui.label) ui.label.textContent = 'Opening secure checkout…';
    if (ui.onStart) ui.onStart();

    await captureLead(brief);

    const redirecting = await window.echoliftCheckout('premium-report', {
      business: brief,
      onUnavailable: (msg) => ui.onProblem(msg)
    });

    // On success the browser is already navigating to Stripe; only put the page
    // back together when it isn't.
    if (!redirecting) {
      ui.button.disabled = false;
      if (ui.label) ui.label.textContent = originalLabel || BUY_LABEL;
    }
  };

  // ------------------------------------------------- buy button under the brief
  const formBtn = el('btnGenerateReport');
  const formBtnLabel = el('reportBtnText');

  if (formBtn) {
    formBtn.addEventListener('click', () => {
      if (formBtn.disabled) return;
      buyReport({
        button: formBtn,
        label: formBtnLabel,
        onProblem: showPanelError,
        onStart: () => {
          if (loadingText) loadingText.textContent = 'Opening secure checkout…';
          setPanel('loading');
        }
      });
    });
  }

  // --------------------------------------- buy button in the "what's inside" panel
  const detailBtn = el('btnBuyPremium');
  const detailBtnLabel = el('btnBuyPremiumText');
  const detailNote = el('premiumBuyNote');

  const noteProblem = (message) => {
    if (!detailNote) return;
    detailNote.classList.add('premium-note-warn');
    detailNote.textContent = message;
  };

  if (detailBtn) {
    detailBtn.addEventListener('click', () => {
      if (detailBtn.disabled) return;
      buyReport({
        button: detailBtn,
        label: detailBtnLabel,
        onProblem: noteProblem
      });
    });
  }

  // Confirm, in the lower panel, that we already have a business to write about.
  const bizField = el(FIELDS.businessName);
  if (bizField && detailNote) {
    const reflectBusiness = () => {
      const name = bizField.value.trim();
      if (!name) return;
      detailNote.classList.remove('premium-note-warn');
      detailNote.innerHTML = `We'll write your report for <strong>${escapeHtml(name)}</strong> using the brief above.`;
    };
    bizField.addEventListener('change', reflectBusiness);
    bizField.addEventListener('blur', reflectBusiness);
    reflectBusiness();
  }

  // ------------------------------------------------------ restore, then keep saving
  // Stripe's cancel URL comes back here flagged, so a visitor who got as far as
  // the payment page is met with their brief intact and an explanation rather
  // than the top of a marketing site.
  const params = new URLSearchParams(window.location.search);
  const cancelled = params.get('checkout') === 'cancelled';

  const restored = restoreBrief();

  if (cancelled) {
    const name = value(FIELDS.businessName);
    showResume(
      name
        ? `Nothing was charged. Your brief for <strong>${escapeHtml(name)}</strong> is exactly as you left it — order again whenever you're ready.`
        : 'Nothing was charged. Add your details below and you can pick the order back up in a couple of clicks.'
    );

    // Leave the address bar clean so a refresh or a shared link isn't stuck in
    // the "you cancelled" state.
    params.delete('checkout');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}#growth-report`);

    const section = el('growth-report');
    if (section) {
      requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  } else if (restored) {
    showResume('Welcome back — we kept the brief you started, so you can pick up where you left off.');
  }

  // Every edit is kept, so nothing is lost to a closed tab or a stray refresh.
  Object.values(FIELDS).forEach((id) => {
    const field = el(id);
    if (field) field.addEventListener('change', () => rememberBrief(collectBrief()));
  });
})();
