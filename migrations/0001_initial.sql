-- MVPClaw initial schema.
--
-- Eight core tables that are the single source of runtime truth. Per the
-- spec (ARCHITECTURE.md §9), SQLite is opened in WAL mode with
-- synchronous=NORMAL and foreign_keys=ON. Timestamps are ISO 8601 strings
-- unless explicitly INTEGER (unix ms UTC).
--
-- The `schema_migrations` table is owned by the migration runner
-- (src/db/migrate.ts) — it's created on the fly and is NOT declared here.

CREATE TABLE chats (
  id                TEXT PRIMARY KEY,
  provider          TEXT NOT NULL,
  provider_chat_id  TEXT NOT NULL,
  thread_id         TEXT,
  type              TEXT NOT NULL,
  title             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(provider, provider_chat_id, thread_id)
);

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  username          TEXT,
  display_name      TEXT,
  approved          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL REFERENCES chats(id),
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE messages (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id),
  direction             TEXT NOT NULL,     -- 'inbound' | 'outbound'
  provider              TEXT NOT NULL,
  provider_message_id   TEXT,
  provider_update_id    TEXT,
  sender_id             TEXT,
  text                  TEXT NOT NULL,
  raw_json              TEXT,
  created_at            TEXT NOT NULL,
  UNIQUE(provider, provider_update_id)
);

CREATE TABLE agent_runs (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  input_message_id  TEXT NOT NULL REFERENCES messages(id),
  provider          TEXT NOT NULL,
  status            TEXT NOT NULL,        -- 'queued' | 'running' | 'succeeded' | 'failed'
  trace_path        TEXT NOT NULL,
  started_at        TEXT,
  finished_at       TEXT,
  error             TEXT
);

CREATE TABLE tool_calls (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES agent_runs(id),
  tool_name     TEXT NOT NULL,
  source        TEXT NOT NULL,            -- 'builtin' | 'mcp' | 'openrouter-server' | 'anthropic' | 'gemini'
  input_json    TEXT NOT NULL,
  result_json   TEXT,
  error         TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT
);

CREATE TABLE outbox (
  id                    TEXT PRIMARY KEY,
  chat_id               TEXT NOT NULL REFERENCES chats(id),
  run_id                TEXT REFERENCES agent_runs(id),
  provider              TEXT NOT NULL,
  provider_chat_id      TEXT NOT NULL,
  provider_thread_id    TEXT,
  kind                  TEXT NOT NULL,
  text                  TEXT NOT NULL,
  status                TEXT NOT NULL,    -- 'pending' | 'sending' | 'sent' | 'failed' | 'retrying' | 'cancelled'
  attempts              INTEGER NOT NULL DEFAULT 0,
  provider_message_id   TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  sent_at               TEXT,
  error                 TEXT
);

CREATE TABLE skills (
  name        TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  description TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL
);
