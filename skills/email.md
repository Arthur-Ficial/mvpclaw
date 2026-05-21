# email

Read, list, search, manage, and reply to emails via Himalaya CLI (IMAP). Supports Gmail and other IMAP accounts.

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
- **compose** (`/email compose to:<recipient> subject:"<title>" body:"<message>"`) → use `himalaya message write --to <recipient> --subject "<title>"` with body piped via stdin, then send. Return message ID / timestamp on success.
- **reply** (`/email reply <id> body:"<message>"`) → read email <id>, extract From + Message-ID, compose reply with In-Reply-To header, send. Confirm with original sender + subject line.
- **reply-all** (`/email reply-all <id> body:"<message>"`) → same as reply but include all original recipients (To + Cc). Warn if Cc list is large.

Parse user intent carefully. If they say "my emails" or "inbox", list the latest 10. If they say "read the first one", read ID 573 (or whatever is top). If they ask "any from Owner?", search `from:owner`.

Format output as readable text: one email per line, or full message body if reading a single email. Strip ANSI color codes from Himalaya output. For mutations, reply with one confirmation line (e.g. `Marked 574 as read.`, `Archived 574.`, `Replied to Patrick.`).

If Himalaya is not configured, print: "Himalaya not configured. Run `himalaya account setup` to add a Gmail account."

## Safety

- Always operate by explicit ID. Don't guess "the latest" — ask the user.
- `delete` moves to Trash (Gmail auto-purges after ~30 days). State this in the confirmation.
- `archive-all` requires a two-step confirm in the same turn (`archive-all confirm`).
- Never run `folder expunge` / `folder purge`.
- **Compose / reply:** before sending, show draft preview (To, Subject, first 100 chars of body). Ask "Send? (yes/no)" and wait for explicit `yes` before executing `himalaya message send`.
- Never compose / reply with sensitive data without explicit user approval.

## Tool

None required—shell execution only. Use `bash_exec` to run `himalaya` commands.
