---
name: email
description: Read, list, search, send, reply, and manage emails via Himalaya CLI. Supports Gmail and other IMAP accounts. Use when the user asks to check inbox, read a message, search by sender/subject, summarise recent mail, mark messages read, archive, delete, compose a new email, or reply to one.
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
   - **compose**: `/email compose to:<recipient> subject:"<subject>" body:"<body>"` → send a new email. Body may contain newlines; pass through as-is.
   - **reply**: `/email reply <id> body:"<message>"` → reply to the sender of message `<id>`. Himalaya auto-fills `In-Reply-To`, `References`, `Subject` (with `Re:`), and `To` from the original.
   - **reply-all**: `/email reply-all <id> body:"<message>"` → same as reply but also keeps everyone on the original `To` + `Cc`.
2. Translate to one `himalaya` invocation. Run it via `bash_exec` with `timeoutMs: 15000` (mutations + sends: `30000`):
   - list: `himalaya envelope list --page-size <N>` (default `<N>` = 10)
   - read: `himalaya message read <ID>` (ID is the integer in the first column of `envelope list`)
   - search: `himalaya envelope list --query "<imap-query>"` — e.g. `from:patrick`, `subject:invoice`, `since:1d`.
   - mark-read: `himalaya flag add <ID> seen`
   - archive: `himalaya message move "[Gmail]/All Mail" <ID>` (Gmail). Argument order is `<TARGET> <ID>...` — folder first. For non-Gmail, use the account's configured `Archive` folder.
   - delete: `himalaya message move "[Gmail]/Trash" <ID>` (Gmail) — explicit move beats `himalaya message delete`, which only sets the `\Deleted` flag without expunging and can leave the message visible.
   - archive-all: first `himalaya envelope list --page-size 200 -o json` → parse IDs → batch `himalaya message move "[Gmail]/All Mail" <ID1> <ID2> ...`. Space-separated IDs in one call, not a loop.
   - compose: `himalaya template write -H "To:<recipient>" -H "Subject:<subject>" "<body>" | himalaya message send` — the `template write` step prepends a correct `From:` header from the active account; piping to `message send` performs the SMTP send.
   - reply: `himalaya template reply <ID> "<body>" | himalaya message send` — `template reply` extracts `From`, `Subject`, `In-Reply-To`, and `References` from the original.
   - reply-all: `himalaya template reply --all <ID> "<body>" | himalaya message send` — same plus all original `To`/`Cc` recipients.
3. Strip the `WARN imap_codec` line if present — it's noise from the IMAP server, not an error.
4. Format the reply for chat:
   - List/search → keep the table but trim long subjects to ~40 chars; cap at the page size.
   - Read → show `From`, `Date`, `Subject` on three lines, then a blank line, then the plain-text body. Truncate body to ~2000 chars and append `… [truncated]` if longer.
   - mark-read/archive/delete → confirm with one line: `Marked <ID> as read.` / `Archived <ID>.` / `Deleted <ID> (in Trash, recoverable for 30 days).`
   - archive-all → confirm with `Archived <N> messages from INBOX.`
   - compose → confirm with `Sent to <recipient>. Subject: "<subject>". (<ISO timestamp>)`.
   - reply → confirm with `Replied to <ID>. (<ISO timestamp>)`.
   - reply-all → confirm with `Replied-all to <ID>. (<ISO timestamp>)`.
5. Report exit-code != 0 verbatim (stderr summary) — do not retry blindly. A non-zero exit on a send means **no message left the server**; never claim success without a clean exit.

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

Sends (compose / reply / reply-all):
```
Sent to patrick@example.com. Subject: "Re: Dr. Guru". (2026-05-13T14:22:01Z)
```

## Safety

Mutating operations (`mark-read`, `archive`, `delete`, `archive-all`) and outgoing operations (`compose`, `reply`, `reply-all`) follow these rules:

- **Always operate by explicit ID.** Never guess IDs from context like "the latest one" — require the user to give the number, or first run `envelope list` and have them pick.
- **`delete` is reversible for ~30 days** on Gmail (Trash auto-purges). State this in the confirmation message.
- **`archive-all` requires a confirmation step in the same turn.** First time the user asks, reply with the count: `INBOX has <N> messages. Reply 'archive-all confirm' to move all of them to [Gmail]/All Mail.` Only proceed on the explicit `confirm` token.
- **Never call `folder expunge` or `folder purge`** — those are permanent and not exposed through this skill.
- **Never act on more than one message** without an explicit `archive-all` (or future `delete-all`, if added) command from the user.
- **External sends require a two-step confirm.** If the `compose` recipient — or the resolved `To`/`Cc` of a `reply-all` — includes any address whose domain is **not** `example.com`, do not send on the first turn. Instead reply with a draft preview:
  ```
  Draft (external — needs confirm):
    To: patrick@example.com
    Subject: Quick question
    Body: ...
  Reply 'send confirm' to send.
  ```
  Only proceed on the explicit `send confirm` token in the next user message.
- **Internal sends go through directly.** If every recipient is `@example.com`, run the himalaya pipeline immediately and confirm with the one-line `Sent to ...` format.
- **Never fabricate a recipient.** If the user's intent does not contain a complete `to:` (for `compose`) or a valid integer `<id>` (for `reply`/`reply-all`), exit with a one-line usage error — do not invent an address.
- **A non-zero himalaya exit on a send means no message was sent.** Forward the stderr verbatim; do not retry; do not claim success.
- **Empty `To:` on a reply.** `himalaya template reply` strips the account's own address from the recipient list (you don't reply to yourself) and may also blank out `noreply@` senders. If a dry-run inspection of the template shows an empty `To:`, the subsequent send fails with `cannot send message without a recipient`. The bot must detect this and reply: `Original sender produced no valid reply recipient (self-send or noreply). Pass an explicit To via 'reply <id> to:<addr> body:"..."' or skip.` — never silently call `message send` on a recipient-less template.

## Setup (if `himalaya envelope list` fails)

If the CLI is not configured on this host, print these instructions to the user and stop:

1. `brew install himalaya` (macOS) or see https://pimalaya.org/himalaya/cli/latest/installation.html for Linux.
2. `himalaya account configure <name>` — interactive wizard for IMAP/SMTP or OAuth2.
3. For Gmail: use an App Password (Account → Security → 2-Step Verification → App passwords) or OAuth2 via `himalaya account configure` and follow the browser flow.
4. Verify with `himalaya envelope list --page-size 1`.

Do not attempt to run the wizard yourself — it requires interactive input the bot cannot provide.
