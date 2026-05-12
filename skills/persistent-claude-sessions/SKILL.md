---
name: persistent-claude-sessions
description: Use when the user asks you to spin up a Claude Code instance that survives multiple turns, or to delegate a long-running coding task to a fresh Claude with a memorable session id. Wraps the `claude` CLI's --session-id / --resume flags.
enabled: true
---

# persistent-claude-sessions

The host's `claude` binary supports persistent conversation state via UUID session ids. Sessions live at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` and can be resumed any time.

## Start a new persistent session

1. Generate a UUID v4 (use `bash_exec`: `uuidgen | tr '[:upper:]' '[:lower:]'`).
2. Use `claude_spawn` with a prompt that begins with `cd <cwd> &&`-style implicit context. The tool already passes `cwd` through.
3. Override the spawn shell command if needed via `bash_exec` directly:
   `claude --session-id <uuid> --print --dangerously-skip-permissions -p "<prompt>"` in the target `cwd`.
4. Save the UUID via `memory_append --scope runtime --text "session <name> -> <uuid> in <cwd>"` so future turns can resume it.

## Resume an existing session

1. Recall the UUID from runtime memory (`memory_read --scope runtime`).
2. `bash_exec`: `claude --resume <uuid> --print --dangerously-skip-permissions -p "<follow-up prompt>"` in the same `cwd`.

## List sessions for a directory

1. Encode the cwd: `python3 -c "import sys,os;p=sys.argv[1];print('-'+p[1:].replace('/','-'))" <cwd>` (Claude's encoding rule: prefix `-`, replace `/` with `-`).
2. `bash_exec`: `ls -t ~/.claude/projects/<encoded>/*.jsonl 2>/dev/null | head -10`
3. Each file's name (without `.jsonl`) IS the session UUID.

## When to use vs. one-shot claude_spawn

- `claude_spawn` (one-shot) — single isolated task, no follow-up.
- Persistent sessions — when the user says "keep working on X" or "continue from earlier" or you anticipate a follow-up.

## Keep code clean

When the user wants to formalise this skill into proper tools (`claude_session_start`, `claude_session_resume`, `claude_session_list`), follow the `self-modification` skill's "Add a new tool" procedure. Each tool stays under 50 lines; full TSDoc; no `any`.
