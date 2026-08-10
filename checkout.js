// --- Shared Stripe checkout launcher ---
//
// Prices are never sent from the browser: this only names a product and the
// create-checkout function looks the real amount up server-side, so nothing here
// can change what a customer is charged.
//
// When Stripe isn't configured yet the function replies `{configured:false}`
// rather than erroring, and we surface that honestly instead of leaving a button
// spinning forever.
(() => {
  'use strict';

  /**
   * Starts Stripe Checkout for a product.
   *
   * @param {string} product           catalog key, e.g. 'premium-report'
   * @param {object} [opts]
   * @param {string} [opts.billing]    'monthly' | 'annual' (subscriptions only)
   * @param {object} [opts.business]   details carried into the report metadata
   * @param {function} [opts.onUnavailable] called with a message when checkout
   *                                   can't run, so the caller can show it in
   *                                   context rather than firing an alert
   * @returns {Promise<boolean>} true if the browser is being redirected to Stripe
   */
  window.echoliftCheckout = async (product, opts = {}) => {
    const unavailable = (msg) => {
      if (typeof opts.onUnavailable === 'function') opts.onUnavailable(msg);
      return false;
    };

    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product,
          billing: opts.billing || 'monthly',
          business: opts.business
        })
      });
      const data = await res.json().catch(() => ({}));

      if (data.configured === false) {
        return unavailable(
          "Card payments are being switched on right now. Email info@echoliftai.co.uk and we'll send your report over personally."
        );
      }
      if (data.url) {
        window.location.href = data.url;
        return true;
      }
      return unavailable(data.error || "We couldn't start checkout. Please try again in a moment.");
    } catch (err) {
      return unavailable("We couldn't reach the payment service. Please check your connection and try again.");
    }
  };
})();
