---
name: code-spawning
description: Use when the user asks for a complex code task — refactor a repo, write a full app, audit for bugs, generate tests, build a game. Spawns a fresh Claude Code or Codex sub-agent with the task.
enabled: true
---

# code-spawning

You have two sub-agent tools — `claude_spawn` (Claude Code with `--dangerously-skip-permissions`) and `codex_spawn` (OpenAI Codex with `--dangerously-bypass-approvals-and-sandbox`). They run a one-shot prompt and return the raw text output.

## When to use

- Multi-file refactors ("rename FooBar to BazQux across this repo").
- Greenfield code generation ("build me a Snake game in p5.js").
- Audits ("look at this folder and tell me what's wrong").
- Anything that needs the sub-agent to actually open files, run tests, edit, and re-test.

## Procedure

1. Pick `claude_spawn` for code editing in an existing repo (Claude Code is repo-aware). Pick `codex_spawn` for quick generative tasks where you don't need persistence.
2. Set `cwd` to the relevant working directory (e.g., the repo root). Default is `~`.
3. Write a short imperative prompt — what to do + what success looks like. Don't pad with context the sub-agent can rediscover.
4. Set a generous `timeoutMs` for big tasks (default 120000 = 2 min; bump to 300000 = 5 min for refactors).
5. Stream back the sub-agent's stdout to the user (truncated if huge), or summarise its actions if the output is too long.

## Notes

- Sub-agents inherit the host environment — they have the same API keys.
- Don't recursively spawn more than 1 sub-agent per turn.
