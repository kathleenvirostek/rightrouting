-- Security hardening for RouteRight.
-- Rolls forward from 20261028214449_create_routeright_tables (which is immutable).
--
-- 1. Access control: row-level security on every application table, no PUBLIC
--    grants, and PHI tables hidden from the read-only troubleshooting role.
-- 2. Human-in-the-loop: AI-drafted patient replies must be approved by a staff
--    member before they can be marked as sent. Enforced in the database.
-- 3. Retention: a purge routine that deletes or scrubs copies of patient text
--    in log/trace tables after a configurable number of days.
-- 4. PHI classification: column comments marking which fields hold PHI.

-- ---------------------------------------------------------------------------
-- 1. Access control
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE
  agent_runs, agent_steps, audit_log, automation_runs, corrections, eval_runs,
  messages, notifications, patients, routing_rules, settings, staff, tasks
FROM PUBLIC;
--> statement-breakpoint

-- Tables containing PHI or copies of patient message text: the read-only role
-- loses all access. Only the application (owner) role can read them.
REVOKE ALL ON TABLE
  agent_runs, agent_steps, audit_log, automation_runs, corrections, eval_runs,
  messages, notifications, patients, tasks
FROM netlifydb_readonly;
--> statement-breakpoint

-- Enable RLS everywhere. With no permissive policy, any role that does not
-- bypass RLS sees zero rows (deny by default).
ALTER TABLE agent_runs      ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_steps     ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE corrections     ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE eval_runs       ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE messages        ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications   ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE patients        ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE routing_rules   ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE settings        ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff           ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tasks           ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Non-PHI configuration tables stay readable for troubleshooting.
CREATE POLICY routing_rules_readonly_select ON routing_rules FOR SELECT TO netlifydb_readonly USING (true);
--> statement-breakpoint
CREATE POLICY settings_readonly_select ON settings FOR SELECT TO netlifydb_readonly USING (true);
--> statement-breakpoint
CREATE POLICY staff_readonly_select ON staff FOR SELECT TO netlifydb_readonly USING (true);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Staff approval for AI-drafted patient replies
-- ---------------------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN auto_reply_status text DEFAULT 'none' NOT NULL,
  ADD COLUMN auto_reply_reviewed_by text REFERENCES staff(id),
  ADD COLUMN auto_reply_reviewed_at timestamp with time zone,
  ADD COLUMN auto_reply_sent_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE messages
  ADD CONSTRAINT messages_auto_reply_status_chk
    CHECK (auto_reply_status IN ('none', 'pending_review', 'approved', 'rejected', 'sent')),
  ADD CONSTRAINT messages_auto_reply_draft_chk
    CHECK ((patient_auto_reply IS NULL) = (auto_reply_status = 'none')),
  ADD CONSTRAINT messages_auto_reply_reviewed_chk
    CHECK (auto_reply_status NOT IN ('approved', 'rejected', 'sent')
           OR (auto_reply_reviewed_by IS NOT NULL AND auto_reply_reviewed_at IS NOT NULL)),
  ADD CONSTRAINT messages_auto_reply_sent_chk
    CHECK ((auto_reply_sent_at IS NOT NULL) = (auto_reply_status = 'sent'));
--> statement-breakpoint
CREATE INDEX messages_auto_reply_pending_idx ON messages (created_at) WHERE auto_reply_status = 'pending_review';
--> statement-breakpoint

-- Enforces the review workflow:
--   * a new draft always starts as 'pending_review' (never pre-approved/sent)
--   * editing the draft text resets approval, unless the same update records a
--     fresh staff review (edit-and-approve in one step)
--   * a reply can only become 'sent' from 'approved'
--   * a sent reply cannot be edited
CREATE FUNCTION enforce_auto_reply_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.patient_auto_reply IS NULL THEN
      NEW.auto_reply_status := 'none';
    ELSE
      NEW.auto_reply_status := 'pending_review';
    END IF;
    NEW.auto_reply_reviewed_by := NULL;
    NEW.auto_reply_reviewed_at := NULL;
    NEW.auto_reply_sent_at := NULL;
    RETURN NEW;
  END IF;

  IF OLD.auto_reply_status = 'sent' AND (
       NEW.patient_auto_reply IS DISTINCT FROM OLD.patient_auto_reply
       OR NEW.auto_reply_status <> 'sent'
       OR NEW.auto_reply_reviewed_by IS DISTINCT FROM OLD.auto_reply_reviewed_by
       OR NEW.auto_reply_sent_at IS DISTINCT FROM OLD.auto_reply_sent_at) THEN
    RAISE EXCEPTION 'Patient reply for message % was already sent and cannot be changed', OLD.id;
  END IF;

  IF NEW.patient_auto_reply IS DISTINCT FROM OLD.patient_auto_reply THEN
    IF NEW.patient_auto_reply IS NULL THEN
      NEW.auto_reply_status := 'none';
      NEW.auto_reply_reviewed_by := NULL;
      NEW.auto_reply_reviewed_at := NULL;
    ELSIF NOT (NEW.auto_reply_status = 'approved'
               AND NEW.auto_reply_reviewed_by IS NOT NULL
               AND NEW.auto_reply_reviewed_at IS DISTINCT FROM OLD.auto_reply_reviewed_at) THEN
      NEW.auto_reply_status := 'pending_review';
      NEW.auto_reply_reviewed_by := NULL;
      NEW.auto_reply_reviewed_at := NULL;
    END IF;
  END IF;

  IF NEW.auto_reply_status = 'sent' AND OLD.auto_reply_status <> 'sent'
     AND OLD.auto_reply_status <> 'approved' THEN
    RAISE EXCEPTION 'Patient reply for message % must be approved by staff before it is sent', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER messages_auto_reply_review
  BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION enforce_auto_reply_review();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Retention for copies of patient text in log / trace tables
-- ---------------------------------------------------------------------------
-- Defaults (days). Override by updating the 'retention_days' row in settings.
INSERT INTO settings (key, value) VALUES (
  'retention_days',
  '{"agent_traces": 30, "automation_runs": 30, "eval_runs": 90, "audit_detail": 30, "notifications": 90, "corrections": 365}'::jsonb
) ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

-- Deletes agent/automation traces, eval results and old notifications, scrubs
-- free-text detail from audit entries (the who/what/when rows are kept), and
-- removes old routing corrections. Returns the number of rows affected per table.
CREATE FUNCTION purge_expired_records() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  cfg jsonb := COALESCE((SELECT value FROM settings WHERE key = 'retention_days'), '{}'::jsonb);
  d_traces int := COALESCE((cfg->>'agent_traces')::int, 30);
  d_auto   int := COALESCE((cfg->>'automation_runs')::int, 30);
  d_eval   int := COALESCE((cfg->>'eval_runs')::int, 90);
  d_audit  int := COALESCE((cfg->>'audit_detail')::int, 30);
  d_notif  int := COALESCE((cfg->>'notifications')::int, 90);
  d_corr   int := COALESCE((cfg->>'corrections')::int, 365);
  n_steps int; n_runs int; n_auto int; n_eval int; n_audit int; n_notif int; n_corr int;
BEGIN
  DELETE FROM agent_steps
   WHERE created_at < now() - make_interval(days => d_traces)
      OR run_id IN (SELECT id FROM agent_runs WHERE started_at < now() - make_interval(days => d_traces));
  GET DIAGNOSTICS n_steps = ROW_COUNT;

  DELETE FROM agent_runs WHERE started_at < now() - make_interval(days => d_traces);
  GET DIAGNOSTICS n_runs = ROW_COUNT;

  DELETE FROM automation_runs WHERE started_at < now() - make_interval(days => d_auto);
  GET DIAGNOSTICS n_auto = ROW_COUNT;

  DELETE FROM eval_runs WHERE started_at < now() - make_interval(days => d_eval);
  GET DIAGNOSTICS n_eval = ROW_COUNT;

  UPDATE audit_log SET detail = NULL
   WHERE detail IS NOT NULL AND created_at < now() - make_interval(days => d_audit);
  GET DIAGNOSTICS n_audit = ROW_COUNT;

  DELETE FROM notifications WHERE created_at < now() - make_interval(days => d_notif);
  GET DIAGNOSTICS n_notif = ROW_COUNT;

  DELETE FROM corrections WHERE created_at < now() - make_interval(days => d_corr);
  GET DIAGNOSTICS n_corr = ROW_COUNT;

  RETURN jsonb_build_object(
    'agent_steps', n_steps, 'agent_runs', n_runs, 'automation_runs', n_auto,
    'eval_runs', n_eval, 'audit_log_scrubbed', n_audit,
    'notifications', n_notif, 'corrections', n_corr);
END;
$$;
--> statement-breakpoint
CREATE INDEX agent_runs_started_idx ON agent_runs (started_at);
--> statement-breakpoint
CREATE INDEX automation_runs_started_idx ON automation_runs (started_at);
--> statement-breakpoint
CREATE INDEX audit_log_created_idx ON audit_log (created_at);
--> statement-breakpoint
CREATE INDEX notifications_created_idx ON notifications (created_at);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. PHI classification
-- ---------------------------------------------------------------------------
COMMENT ON TABLE patients IS 'PHI. Owner role only; hidden from read-only role via RLS and revoked grants.';
--> statement-breakpoint
COMMENT ON COLUMN patients.name  IS 'PHI: direct identifier';
--> statement-breakpoint
COMMENT ON COLUMN patients.dob   IS 'PHI: direct identifier';
--> statement-breakpoint
COMMENT ON COLUMN patients.mrn   IS 'PHI: direct identifier';
--> statement-breakpoint
COMMENT ON COLUMN patients.phone IS 'PHI: direct identifier';
--> statement-breakpoint
COMMENT ON COLUMN patients.chart IS 'PHI: clinical record';
--> statement-breakpoint
COMMENT ON COLUMN messages.body IS 'PHI: patient-authored message text';
--> statement-breakpoint
COMMENT ON COLUMN messages.patient_auto_reply IS 'AI draft. Must reach auto_reply_status = approved (staff review) before it can be sent.';
--> statement-breakpoint
COMMENT ON COLUMN corrections.message_text IS 'PHI copy of patient text; purged by purge_expired_records()';
--> statement-breakpoint
COMMENT ON COLUMN agent_runs.output IS 'May contain PHI; purged by purge_expired_records()';
--> statement-breakpoint
COMMENT ON COLUMN agent_steps.detail IS 'May contain PHI; purged by purge_expired_records()';
--> statement-breakpoint
COMMENT ON COLUMN audit_log.detail IS 'May contain PHI; scrubbed by purge_expired_records()';
