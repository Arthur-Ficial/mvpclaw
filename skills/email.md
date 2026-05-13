# email

Read, list, search, and manage emails via Himalaya CLI (IMAP). Supports Gmail and other IMAP accounts.

## Procedure

When the user asks to:
- **list emails** → run `himalaya envelope list` and format as a table with ID, FROM, SUBJECT, DATE
- **read email N** → run `himalaya envelope read <id>` and display full body + headers
- **search for keyword** → run `himalaya envelope list 'subject:<keyword>'` or `himalaya envelope list 'body:<keyword>'`
- **check unread** → run `himalaya envelope list 'flag:unseen'`
- **mark read** (`/email mark-read <id>`) → run `himalaya flag add <id> seen`
- **archive** (`/email archive <id>`) → run `himalaya message move "[Gmail]/All Mail" <id>` (folder first, then id)
- **delete** (`/email delete <id>`) → run `himalaya message move "[Gmail]/Trash" <id>` (goes to Trash, recoverable for ~30 days on Gmail)
- **archive-all** (`/email archive-all`) → list INBOX, parse IDs, then `himalaya message move "[Gmail]/All Mail" <id1> <id2> ...` (space-separated). Require explicit `confirm` token from the user before executing — show the count first.

Parse user intent carefully. If they say "my emails" or "inbox", list the latest 10. If they say "read the first one", read ID 573 (or whatever is top). If they ask "any from Owner?", search `from:owner`.

Format output as readable text: one email per line, or full message body if reading a single email. Strip ANSI color codes from Himalaya output. For mutations, reply with one confirmation line (e.g. `Marked 574 as read.`, `Archived 574.`, `Deleted 574 (in Trash, recoverable for 30 days).`).

If Himalaya is not configured, print: "Himalaya not configured. Run `himalaya account setup` to add a Gmail account."

## Safety

- Always operate by explicit ID. Don't guess "the latest" — ask the user.
- `delete` moves to Trash (Gmail auto-purges after ~30 days). State this in the confirmation.
- `archive-all` requires a two-step confirm in the same turn (`archive-all confirm`).
- Never run `folder expunge` / `folder purge`.
- Sending / replying / forwarding still off-limits — separate approval rules.

## Tool

None required—shell execution only. Use `bash_exec` to run `himalaya` commands.
