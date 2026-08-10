-- ApexVoice sales-agent portal (/portal/).
--
-- These tables are deliberately separate from the `leads` table created in
-- 0001: that one holds marketing-site signups from the growth-report lead
-- magnet, keyed by email. ApexVoice prospects are outbound targets with a
-- phone number, a warmth score and a call/SMS history, so they get their own
-- namespace rather than being forced into a shared table.

CREATE TABLE apexvoice_prospects (
  id SERIAL PRIMARY KEY,
  business_name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  pain_points TEXT NOT NULL DEFAULT '',
  warmth_score INTEGER NOT NULL DEFAULT 50,
  -- New | In Progress | Qualified | Rejected, driven by call/SMS outcomes.
  status TEXT NOT NULL DEFAULT 'New',
  last_interaction TEXT,
  -- 'manual' for hand-entered rows, 'ai-sample' for generated demo prospects.
  -- Kept so generated records are never mistaken for verified business data.
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT NOW()
);

-- The prospects table is listed newest-first on every portal page load.
CREATE INDEX apexvoice_prospects_created_at_idx ON apexvoice_prospects (created_at DESC);

-- Campaign configuration is a single shared row: one agency, one pitch. The
-- CHECK constraint enforces that rather than relying on application code.
CREATE TABLE apexvoice_campaign (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT '',
  service_name TEXT NOT NULL DEFAULT '',
  pricing TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  product_description TEXT NOT NULL DEFAULT '',
  primary_hook TEXT NOT NULL DEFAULT '',
  objection_pricing TEXT NOT NULL DEFAULT '',
  objection_trust TEXT NOT NULL DEFAULT '',
  objection_complexity TEXT NOT NULL DEFAULT '',
  -- Write-only from the browser's point of view: the API accepts a key here
  -- but never returns it, so a saved key cannot be read back out of the page.
  -- The ELEVENLABS_API_KEY env var takes precedence over this column.
  elevenlabs_key TEXT NOT NULL DEFAULT '',
  elevenlabs_agent_voice TEXT NOT NULL DEFAULT 'Xb7hH2yqWyRel9GQ555e',
  elevenlabs_customer_voice TEXT NOT NULL DEFAULT 'JBF2rCBphFnJZjxrOi8j',
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed the shared row with the portal's documented defaults so the dashboard
-- has a campaign to show before anyone opens the settings tab.
INSERT INTO apexvoice_campaign (
  id, company_name, service_name, pricing, agent_name, personality,
  product_description, primary_hook,
  objection_pricing, objection_trust, objection_complexity
) VALUES (
  1,
  'OmniFlow Automation',
  'AI Customer Receptionist & SMS Lead Booker',
  '$199/month',
  'Alex',
  'Friendly, consultative, and highly professional',
  'We install custom AI voice receptionists that answer missed calls 24/7, book appointments directly into calendars, and send instant follow-up texts so local businesses never lose a lead to voicemail.',
  'Did you know that 62% of incoming calls to small businesses go unanswered? We prevent that by deploying a custom AI receptionist that picks up in 2 seconds, answers customer questions, and books bookings right into your system.',
  'At just $199/month, it pays for itself if it saves just one single customer booking. Plus, there is no long-term contract and we offer a 14-day free trial to prove it works.',
  'We build a fully custom prototype for your business first. You can call and test it yourself before you pay a single penny.',
  'Our team handles 100% of the setup. It takes under 15 minutes of your time to link your calendar, and we handle the rest.'
) ON CONFLICT (id) DO NOTHING;

-- One row per completed call or SMS run. `outcome` is the human-readable
-- status shown in the dashboard activity feed ("Demo Booked", "Rejected", …).
CREATE TABLE apexvoice_activity (
  id SERIAL PRIMARY KEY,
  -- SET NULL rather than CASCADE: deleting a prospect should not silently
  -- reduce the dashboard's call and conversion totals.
  prospect_id INTEGER REFERENCES apexvoice_prospects (id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  -- Denormalised so the feed still names the business after the prospect row
  -- is gone, and so reading it needs no join.
  business_name TEXT NOT NULL DEFAULT '',
  contact_person TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX apexvoice_activity_created_at_idx ON apexvoice_activity (created_at DESC);

-- SMS threads are stored one message per row rather than as a single blob of
-- text. The previous implementation concatenated lines like
-- "AGENT (10:01 AM): ..." and re-split them on the first colon in the browser,
-- which cut every message apart inside its own timestamp.
CREATE TABLE apexvoice_messages (
  id SERIAL PRIMARY KEY,
  prospect_id INTEGER NOT NULL REFERENCES apexvoice_prospects (id) ON DELETE CASCADE,
  -- 'agent' (the AI, or a human taking over) or 'customer' (the prospect).
  sender TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TIMESTAMP DEFAULT NOW()
);

-- Threads are read per prospect in send order.
CREATE INDEX apexvoice_messages_thread_idx ON apexvoice_messages (prospect_id, sent_at);
