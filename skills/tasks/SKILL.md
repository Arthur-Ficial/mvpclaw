---
name: tasks
description: Maintain a durable TODO list (TODO.md / DONE-TASKS.md) for work that cannot finish in the current turn. Use to capture follow-ups for emails that need a human decision, scheduler-originated tasks that produced action items, example-project-VET verdicts that need Owner's call, and any "I'll do this later" intent. The list survives daemon restarts.
enabled: true
---

# tasks

A simple, durable TODO surface. Two plain-markdown files at the bot's runtime workspace root:

- `~/.mvpclaw/workspaces/default/TODO.md` — open items
- `~/.mvpclaw/workspaces/default/DONE-TASKS.md` — closed items, kept forever

Both files are append-only (closing a todo MOVES it; it never disappears). Owner can `cat` them from any terminal; you can read them via `bash_exec` from your workspace pwd.

## When to call `todo_add`

Add a todo whenever something needs follow-up but cannot finish now:

- **Email** needs a human decision and you've already used today's ask quota → todo with `source: 'email'`
- **Scheduler** ran a routine that produced a deferred action → `source: 'scheduler'`
- **example-project VET** flagged an issue as "proceed" and now needs code work → `source: 'example-project'`
- **Chat** — the user said "later" or you promised to circle back → `source: 'chat'`
- **Anywhere else** — `source: 'manual'`

Text must be ONE LINE, ≤ 280 chars, action-verb first. Bad: "the report". Good: "Send weekly report to Patrick (CC Owner)".

## When to call `todo_list`

**Before adding** — to avoid duplicates. **At the start of an idle/scheduled turn** — to see whether you already owe Owner something. **When asked "what's open"** — return the list.

## When to call `todo_done`

When you (or a follow-up turn) actually finish the task. Pass the ULID from `todo_list` plus an optional one-line note describing what was done. The row moves to DONE-TASKS.md with a `done@<timestamp>` marker.

## Do not

- Don't use todos for ephemeral within-turn state — those live in the conversation.
- Don't add a duplicate todo if one already exists for the same intent. Update the existing one mentally and proceed.
- Don't close a todo without doing the work. The done list is a record of completion, not a hiding place.
- Don't put secrets, API keys, or anything sensitive in todo text — it's plain text on disk.

## Examples

```text
- [01KRJK7A8M00000000000000] 2026-05-15T07:31:22Z [email] Reply to Patrick re Q2 invoice (await Owner approval)
- [01KRJK7A8M00000000000001] 2026-05-15T08:00:01Z [example-project] Open draft PR for issue #142 (validate Apple Intelligence gating)
- [01KRJK7A8M00000000000002] 2026-05-15T08:00:02Z [scheduler] Resend the weekly status to example.com team
```
