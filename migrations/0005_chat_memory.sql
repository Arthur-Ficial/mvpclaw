-- Per-chat memory tables (spec §31.2).

CREATE TABLE chat_memory (
  chat_id     TEXT PRIMARY KEY REFERENCES chats(id),
  body        TEXT NOT NULL DEFAULT '',
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE chat_memory_archive (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     TEXT NOT NULL REFERENCES chats(id),
  body        TEXT NOT NULL,
  archived_at INTEGER NOT NULL
);

CREATE INDEX idx_chat_memory_archive_chat ON chat_memory_archive(chat_id, archived_at);
