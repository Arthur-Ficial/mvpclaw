-- Explicit `is_proactive` flag on outbox rows. Replaces the implicit
-- "run_id IS NULL → proactive" heuristic in `drainOutbox`, which mis-gated
-- /help slash-command replies (they have run_id=null but are reactive,
-- not proactive). Scheduler-enqueued proactive rows will set this to 1
-- when that path lands; for now everything is 0 by default.

ALTER TABLE outbox ADD COLUMN is_proactive INTEGER NOT NULL DEFAULT 0;
