-- Paid "Premium AI Growth Report" orders.
--
-- The premium report is a one-time purchase, so the generated document is the
-- thing the customer actually paid for: it has to survive a page refresh, a
-- closed tab and a return visit weeks later. Storing it here makes the delivery
-- link permanent and makes generation idempotent — we never re-bill AI tokens
-- for a report we have already produced, and the customer never sees a
-- different report than the one they were originally given.
--
-- Rows are keyed by the Stripe Checkout session so the delivery page can look an
-- order up from the URL Stripe redirects to, and so a double-submit can only
-- ever create one order.
CREATE TABLE premium_report_orders (
  id SERIAL PRIMARY KEY,
  stripe_session_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  business_name TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  usp TEXT NOT NULL DEFAULT '',
  amount_paid INTEGER,
  currency TEXT NOT NULL DEFAULT 'gbp',
  -- pending = paid, generation not finished yet; ready = report available;
  -- failed = generation gave up after repeated attempts.
  status TEXT NOT NULL DEFAULT 'pending',
  report JSONB,
  -- Generation runs in a background function, so these two columns act as the
  -- lock: only the poll that successfully stamps generation_started_at gets to
  -- kick off a run, and attempts caps how many times we retry a bad session.
  attempts INTEGER NOT NULL DEFAULT 0,
  generation_started_at TIMESTAMP,
  generated_at TIMESTAMP,
  delivery_email_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Look a customer's purchases up by email, and list newest-first for the owner.
CREATE INDEX premium_report_orders_email_idx ON premium_report_orders (email);
CREATE INDEX premium_report_orders_created_at_idx ON premium_report_orders (created_at DESC);
