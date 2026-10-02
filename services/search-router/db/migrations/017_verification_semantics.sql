-- 017_verification_semantics — P-DATA-1A trust-layer hardening.
--
-- Splits "observed" from "verified". canonical_places.first_seen /
-- last_seen stay pure observation timestamps; verification now lives in
-- its own columns — verified_at only exists when the evidence actually
-- earned it (see resolution/verification.py). The old read projection
-- aliased last_seen → last_verified_at, which let any fresh
-- single-source place pass the verified gate.

ALTER TABLE canonical_places
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verification_level TEXT NOT NULL DEFAULT 'observed',
    ADD COLUMN IF NOT EXISTS verification_method TEXT;

ALTER TABLE canonical_places
    DROP CONSTRAINT IF EXISTS cplaces_verification_level_check;
ALTER TABLE canonical_places
    ADD CONSTRAINT cplaces_verification_level_check
    CHECK (verification_level IN ('observed', 'corroborated', 'verified', 'authoritative'));

-- Structured operator-review columns on raw staging. A record claiming
-- review_status='verified' without the full evidence tuple
-- (source_url + reviewed_at + verification_method) is rejected at the
-- ingest validation gate — reviewed fields that land here are complete.
ALTER TABLE place_source_records
    ADD COLUMN IF NOT EXISTS review_status TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verification_method TEXT;

ALTER TABLE place_source_records
    DROP CONSTRAINT IF EXISTS psr_review_status_check;
ALTER TABLE place_source_records
    ADD CONSTRAINT psr_review_status_check
    CHECK (review_status IS NULL OR review_status IN ('verified', 'rejected'));

-- Backfill: every existing place was only ever observed — the inflated
-- verified state was a projection bug, not real evidence. Places earn
-- their level back on the next resolution run.
UPDATE canonical_places SET verification_level = 'observed'
WHERE verification_level IS NULL;
UPDATE canonical_places SET verified_at = NULL
WHERE verified_at IS NOT NULL AND verification_level = 'observed';

CREATE INDEX IF NOT EXISTS idx_cplaces_verified
    ON canonical_places (verification_level) WHERE verification_level <> 'observed';

-- operator_pilot is a *discovery* source: trust comes from per-record
-- review evidence, never from the provider label alone.
INSERT INTO source_policies (provider, kind, authority, refresh, usage)
VALUES
    ('operator_pilot', 'discovery',
     '{"location":0.70,"opening_hours":0.60,"legal_status":0.30}',
     '{"default_days":60}',
     '{"realtime":false,"batch":true}')
ON CONFLICT (provider) DO NOTHING;
