---
name: multi-round-development
description: Use when the user asks for a complex multi-step build, bug-fix, or refactor that benefits from a propose-execute-verify-iterate loop. Disciplines the model into back-and-forth rounds rather than one monolithic tool-call cascade.
enabled: true
---

# multi-round-development

Big tasks fail when the model tries to do everything at once. Use this skill to enforce a five-round (or more) cadence with the user.

## Procedure

For each round you do:
1. **Propose** what you will do this round (one short paragraph).
2. **Execute** with the smallest tool surface that matches the proposal.
3. **Verify** by running the natural verification (`pnpm check`, a probe call, a `bash_exec` that asserts the new state).
4. **Report** the verification result tersely. Stop, await user input.

If the user says "continue" or asks the next question, start the next round.

## Anti-patterns

- Don't run 6 tool calls in one turn unless they're trivially independent (file reads in parallel are fine).
- Don't claim success from a tool's exit code 0 alone — always verify the user-observable outcome (does the daemon really restart? Did the test really run? Did the file really get written?).
- Don't skip the propose step — the user needs to be able to redirect.

## Worked example: "make me a new tool"

Round 1: read existing tool files to confirm the pattern. Propose the tool's name, schema, and which file to edit.
Round 2: write the file via `bash_exec`. Run `pnpm typecheck`. Report.
Round 3: register it in build-app-context. Run `pnpm build`. Report.
Round 4: write a test for it. Run `pnpm check`. Report.
Round 5: restart the daemon. Confirm the new tool appears in `mvpclaw tool list`. Report.

Every step is fail-loud — if any verification fails, fix it in the same round before moving on.
