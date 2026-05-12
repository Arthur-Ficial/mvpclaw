-- Proactive-policy columns on `chats` (per spec §33.1).

ALTER TABLE chats ADD COLUMN chat_blocked          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN last_proactive_send   INTEGER;
ALTER TABLE chats ADD COLUMN proactive_count_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN proactive_count_date  TEXT;
