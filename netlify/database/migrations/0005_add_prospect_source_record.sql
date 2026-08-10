-- Real business records for the ApexVoice lead finder.
--
-- Until now the lead finder wrote model-generated sample profiles, so the only
-- fields a prospect needed were the ones a simulator consumes. Real directory
-- records carry more, and two of those extras are load-bearing rather than
-- cosmetic:
--
--   `address`  — a street address is how an operator confirms they are calling
--                the business they think they are calling. Sample profiles had
--                nothing to confirm, so the column was never needed.
--   `osm_id`   — the upstream record's stable identifier ("node/12345"). It is
--                what makes repeat searches idempotent: the same street can be
--                searched twice a week apart, and without a durable key every
--                run would re-insert the same businesses. Matching on
--                business_name instead would be wrong in both directions — two
--                genuine branches of the same chain would collide, and a
--                renamed shop would duplicate.
ALTER TABLE apexvoice_prospects
  ADD COLUMN address TEXT NOT NULL DEFAULT '',
  ADD COLUMN osm_id TEXT NOT NULL DEFAULT '';

-- Enforce the idempotency in the database rather than trusting the application
-- to always pre-check: a partial index so the many rows that legitimately have
-- no upstream id (manually added prospects, and the AI samples already stored)
-- are not forced to collide on an empty string.
CREATE UNIQUE INDEX apexvoice_prospects_osm_id_idx
  ON apexvoice_prospects (osm_id)
  WHERE osm_id <> '';
