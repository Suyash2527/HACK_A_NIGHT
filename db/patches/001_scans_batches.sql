-- Patch 001 (idempotent; safe to re-run on an existing database): integrity-scan history and audit-head binding for anchored batches.
SET check_function_bodies = off;
SET ROLE app_owner;
SET search_path = app, pg_catalog;

-- A batch also commits to the audit log head at the moment it was built, so rolling the log back is detectable.
ALTER TABLE merkle_batches ADD COLUMN IF NOT EXISTS audit_seq bigint;
ALTER TABLE merkle_batches ADD COLUMN IF NOT EXISTS audit_head text;

CREATE OR REPLACE FUNCTION audit_head() RETURNS TABLE (seq bigint, entry_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS
$$ SELECT a.seq, a.entry_hash FROM app.audit_log a ORDER BY a.seq DESC LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION audit_head() TO app_anchor, app_user;

-- Completed integrity scans (court roles only; append-only).
CREATE TABLE IF NOT EXISTS integrity_scans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES users(id),
  case_id      uuid REFERENCES cases(id),
  total        int  NOT NULL,
  started_at   timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  results      jsonb NOT NULL                       -- [{documentId, verification}] ; summaries are rebuilt from live rows
);
ALTER TABLE integrity_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrity_scans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all ON integrity_scans;
CREATE POLICY owner_all ON integrity_scans TO app_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS scans_select ON integrity_scans;
CREATE POLICY scans_select ON integrity_scans FOR SELECT TO app_user USING (app.is_court());
DROP POLICY IF EXISTS scans_insert ON integrity_scans;
CREATE POLICY scans_insert ON integrity_scans FOR INSERT TO app_user WITH CHECK (requested_by = app.app_uid() AND app.is_court());
DROP TRIGGER IF EXISTS scans_append_only ON integrity_scans;
CREATE TRIGGER scans_append_only BEFORE UPDATE OR DELETE ON integrity_scans FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
GRANT SELECT, INSERT ON integrity_scans TO app_user;

-- Court-order workflow helpers for advocates, who cannot read cases or documents directly (RLS) until a judge grants access.
CREATE OR REPLACE FUNCTION request_case_fir(p_case uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS
$$ SELECT c.fir_no FROM app.cases c
   WHERE c.id = p_case AND (app.is_court() OR EXISTS (SELECT 1 FROM app.document_requests r WHERE r.case_id = p_case AND r.requester_id = app.app_uid())) $$;

-- True when every listed document exists and belongs to the case (callable by advocates and the court only).
CREATE OR REPLACE FUNCTION request_validate(p_case uuid, p_docs uuid[]) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
BEGIN
  IF app.app_role() NOT IN ('DEFENCE_ADVOCATE','JUDGE','ADMIN') THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT count(*) FROM app.documents d WHERE d.case_id = p_case AND d.id = ANY (p_docs)) = (SELECT count(DISTINCT x) FROM unnest(p_docs) x);
END $$;
GRANT EXECUTE ON FUNCTION request_case_fir(uuid), request_validate(uuid, uuid[]) TO app_user;

-- The live feed of blockchain transactions (older databases were created before this table existed).
CREATE TABLE IF NOT EXISTS chain_txs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('REGISTER_RECORD','ATTEST_SIGNATURE','SEAL_MANIFEST','AUDIT_EVENT','ANCHOR_BATCH')),
  tx_hash      text NOT NULL UNIQUE CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  chain_id     bigint NOT NULL,
  doc_id       uuid REFERENCES documents(id),
  case_id      uuid REFERENCES cases(id),
  label        text NOT NULL,
  status       text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','confirmed','failed')),
  block_number bigint,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE INDEX IF NOT EXISTS chain_txs_doc_idx ON chain_txs(doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chain_txs_case_idx ON chain_txs(case_id, created_at DESC);
ALTER TABLE chain_txs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_txs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all ON chain_txs;
CREATE POLICY owner_all ON chain_txs TO app_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS chain_txs_select ON chain_txs;
CREATE POLICY chain_txs_select ON chain_txs FOR SELECT TO app_user
  USING (app.is_court() OR (doc_id IS NOT NULL AND app.can_read_doc(doc_id)) OR (doc_id IS NULL AND case_id IS NOT NULL AND app.is_assigned(case_id)));
DROP POLICY IF EXISTS chain_txs_anchor ON chain_txs;
CREATE POLICY chain_txs_anchor ON chain_txs FOR ALL TO app_anchor USING (true) WITH CHECK (true);
GRANT SELECT ON chain_txs TO app_user;
GRANT SELECT, INSERT ON chain_txs TO app_anchor;
GRANT UPDATE (status, block_number, error, confirmed_at) ON chain_txs TO app_anchor;

RESET ROLE;
