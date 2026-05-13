---
name: email
description: Read, list, search, and manage emails via Himalaya CLI. Supports Gmail and other IMAP accounts. Use when the user asks to check inbox, read a message, search by sender/subject, summarise recent mail, mark messages read, archive, or delete.
enabled: true
---

# email

Email access via the `himalaya` CLI. Configured accounts (IMAP/SMTP) are managed outside the bot; this skill only invokes `himalaya` and formats the result.

## Procedure

1. Parse the user's intent into one of:
   - **list**: "show inbox", "list emails", "what's new" → list the most recent envelopes.
   - **read**: "read email 573", "open message X" → show one full message.
   - **search**: "find emails from Patrick", "search for invoice" → filter envelopes by query.
   - **mark-read**: "/email mark-read <id>", "mark 573 read" → clear unseen flag on one message.
   - **archive**: "/email archive <id>", "archive 573" → move one message out of INBOX into the archive (`[Gmail]/All Mail` on Gmail).
   - **delete**: "/email delete <id>", "delete 573" → move one message to Trash (recoverable; auto-purges after ~30 days on Gmail).
   - **archive-all**: "/email archive-all" → move every message currently in INBOX into the archive. High blast radius — see Safety.
2. Translate to one `himalaya` invocation. Run it via `bash_exec` with `timeoutMs: 15000` (mutations: `30000`):
   - list: `himalaya envelope list --page-size <N>` (default `<N>` = 10)
   - read: `himalaya message read <ID>` (ID is the integer in the first column of `envelope list`)
   - search: `himalaya envelope list --query "<imap-query>"` — e.g. `from:patrick`, `subject:invoice`, `since:1d`.
   - mark-read: `himalaya flag add <ID> seen`
   - archive: `himalaya message move "[Gmail]/All Mail" <ID>` (Gmail). Argument order is `<TARGET> <ID>...` — folder first. For non-Gmail, use the account's configured `Archive` folder.
   - delete: `himalaya message move "[Gmail]/Trash" <ID>` (Gmail) — explicit move beats `himalaya message delete`, which only sets the `\Deleted` flag without expunging and can leave the message visible.
   - archive-all: first `himalaya envelope list --page-size 200 -o json` → parse IDs → batch `himalaya message move "[Gmail]/All Mail" <ID1> <ID2> ...`. Space-separated IDs in one call, not a loop.
3. Strip the `WARN imap_codec` line if present — it's noise from the IMAP server, not an error.
4. Format the reply for chat:
   - List/search → keep the table but trim long subjects to ~40 chars; cap at the page size.
   - Read → show `From`, `Date`, `Subject` on three lines, then a blank line, then the plain-text body. Truncate body to ~2000 chars and append `… [truncated]` if longer.
   - mark-read/archive/delete → confirm with one line: `Marked <ID> as read.` / `Archived <ID>.` / `Deleted <ID> (in Trash, recoverable for 30 days).`
   - archive-all → confirm with `Archived <N> messages from INBOX.`
5. Report exit-code != 0 verbatim (stderr summary) — do not retry blindly.

## Output shape

List/search:
```
Inbox (most recent 10):
  573  Patrick Dainese       Re: Dr. Guru — kurzer …    2026-05-13
  570  GitHub                Actions: Windows hosted …  2026-05-12
  ...
```

Read:
```
From:    Patrick Dainese <patrick@example.com>
Date:    2026-05-13 09:57
Subject: Re: Dr. Guru — kurzer Termin

<body>
```

Mutations (mark-read / archive / delete / archive-all): one confirmation line, no table.

## Safety

Sending, replying, and forwarding remain off-limits — those have their own approval rules. If the user asks to send/reply/forward, respond: "Sending email is not available through this skill — ask the human operator."

Mutating operations (`mark-read`, `archive`, `delete`, `archive-all`) are allowed but follow these rules:

- **Always operate by explicit ID.** Never guess IDs from context like "the latest one" — require the user to give the number, or first run `envelope list` and have them pick.
- **`delete` is reversible for ~30 days** on Gmail (Trash auto-purges). State this in the confirmation message.
- **`archive-all` requires a confirmation step in the same turn.** First time the user asks, reply with the count: `INBOX has <N> messages. Reply 'archive-all confirm' to move all of them to [Gmail]/All Mail.` Only proceed on the explicit `confirm` token.
- **Never call `folder expunge` or `folder purge`** — those are permanent and not exposed through this skill.
- **Never act on more than one message** without an explicit `archive-all` (or future `delete-all`, if added) command from the user.

## Setup (if `himalaya envelope list` fails)

If the CLI is not configured on this host, print these instructions to the user and stop:

1. `brew install himalaya` (macOS) or see https://pimalaya.org/himalaya/cli/latest/installation.html for Linux.
2. `himalaya account configure <name>` — interactive wizard for IMAP/SMTP or OAuth2.
3. For Gmail: use an App Password (Account → Security → 2-Step Verification → App passwords) or OAuth2 via `himalaya account configure` and follow the browser flow.
4. Verify with `himalaya envelope list --page-size 1`.

Do not attempt to run the wizard yourself — it requires interactive input the bot cannot provide.
