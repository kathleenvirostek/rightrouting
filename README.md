# rightrouting

RouteRight triages patient portal messages and routes them to the right clinical staff.

## Data protection

This project handles protected health information (PHI). The database enforces:

- **Access control** – row-level security is enabled on every table and PUBLIC grants are revoked. Tables holding
  PHI (`patients`, `messages`, `tasks`, `notifications`, `corrections`, agent/automation/eval logs, `audit_log`) are
  not readable by the read-only troubleshooting role.
- **Staff approval of AI replies** – `messages.patient_auto_reply` is a draft. It can only be marked `sent` after a
  staff member sets `auto_reply_status = 'approved'` with `auto_reply_reviewed_by` / `auto_reply_reviewed_at`.
  Editing an approved draft sends it back to `pending_review`. A database trigger enforces this.
- **Retention** – the `purge-expired-records` scheduled function runs `purge_expired_records()` daily. Retention
  periods (days) are in the `retention_days` row of `settings`.

Never commit real patient data, exports, or seed files containing PHI to this repository. Use synthetic data for
development and evaluation.
