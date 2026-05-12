-- Tasks table — scheduled (one-shot + recurring) agent runs.
-- Per spec §27.1.

CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  chat_id         TEXT NOT NULL REFERENCES chats(id),
  created_by      TEXT NOT NULL,                    -- 'user' | 'agent' | 'system'
  kind            TEXT NOT NULL,                    -- 'one_shot' | 'recurring'

  cron_expr       TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Europe/Vienna',
  next_run_at     INTEGER NOT NULL,                 -- unix ms UTC
  last_run_at     INTEGER,

  prompt          TEXT NOT NULL,
  skill           TEXT,

  state           TEXT NOT NULL DEFAULT 'scheduled',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  last_error      TEXT,
  catchup_policy  TEXT NOT NULL DEFAULT 'run_once',

  lease_owner     TEXT,
  lease_until     INTEGER,

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_tasks_due  ON tasks(state, next_run_at);
CREATE INDEX idx_tasks_chat ON tasks(chat_id, state);
