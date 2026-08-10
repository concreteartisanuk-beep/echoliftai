-- Nurture tracking for captured leads. Each lead moves through a small email
-- sequence: step 1 = report/welcome email (sent at capture), then scheduled
-- follow-ups advance the step. Tracking columns let the scheduled job know who
-- to email next without ever sending the same step twice.
ALTER TABLE leads
  ADD COLUMN welcome_sent_at TIMESTAMP,
  ADD COLUMN nurture_step INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_email_at TIMESTAMP;

-- The scheduled nurture job scans by step + age, so index those.
CREATE INDEX leads_nurture_idx ON leads (nurture_step, created_at);
