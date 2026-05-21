# Real-Telegram round-trip suite

Drives the bot through the actual `grammY → Bot API → user's phone` path.
Every other e2e suite uses `cli-inject` for synthetic injection; this one
plugs the rendering / network gap.

## Opt-in (skipped by default)

```sh
MVPCLAW_REAL_TELEGRAM=1 pnpm test:real-telegram
```

`pnpm check` does NOT run this suite — it requires real Telegram credentials
and sends ~10 real messages to a real chat.

## What it sends to

Default chat id: `1234567890` (the owner's DM with the bot). Override with
`MVPCLAW_TEST_CHAT_ID` if you want it pointed somewhere else. Expect ~10
messages and possibly one photo to land on the receiving end during a run.

## Reading a failure

1. Note the `runId` in the test output.
2. `mvpclaw trace show <runId>` — the full per-run JSONL trace.
3. `mvpclaw db query "SELECT * FROM outbox WHERE run_id='<runId>'"` — what
   left the bot.
4. `mvpclaw db query "SELECT * FROM tool_calls WHERE run_id='<runId>'"` —
   whether any tools fired.
5. Reproduce manually: `mvpclaw send --channel telegram --chat-id 1234567890
   --user-id 1234567890 --text "..." --json --wait 90`.

See the `mvpclaw-debug` skill at `~/.claude/skills/mvpclaw-debug/` for the
end-to-end debug recipe.
