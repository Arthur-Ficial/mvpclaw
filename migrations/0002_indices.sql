-- Secondary indices on hot query paths.

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

CREATE INDEX idx_agent_runs_session_id ON agent_runs(session_id);
CREATE INDEX idx_agent_runs_status    ON agent_runs(status);

CREATE INDEX idx_outbox_status     ON outbox(status);
CREATE INDEX idx_outbox_chat_id    ON outbox(chat_id);
CREATE INDEX idx_outbox_created_at ON outbox(created_at);

CREATE INDEX idx_tool_calls_run_id ON tool_calls(run_id);

CREATE INDEX idx_sessions_chat_id ON sessions(chat_id);
