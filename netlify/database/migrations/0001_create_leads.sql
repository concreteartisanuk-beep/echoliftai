-- Captured leads from the free "Instant AI Growth Report".
-- Every visitor who generates a report leaves their email and business profile
-- here, turning the site's main lead magnet into an owned, followable pipeline.
CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  usp TEXT NOT NULL DEFAULT '',
  report_headline TEXT NOT NULL DEFAULT '',
  estimated_monthly_loss TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'growth-report',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Fast lookups and de-dup checks by email, newest-first listing for exports.
CREATE INDEX leads_email_idx ON leads (email);
CREATE INDEX leads_created_at_idx ON leads (created_at DESC);
