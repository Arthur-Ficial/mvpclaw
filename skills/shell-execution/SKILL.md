---
name: shell-execution
description: Use when the user asks to run a shell command, check disk usage, list processes, inspect git state, run a script, or do anything that requires terminal access. Calls bash_exec.
enabled: true
---

# shell-execution

The `bash_exec` tool runs any command the host user can run. The output is truncated to 64KB.

## Procedure

1. Translate the user's request into ONE concrete shell command. Prefer one-liners over scripts.
2. Call `bash_exec` with `{command, timeoutMs: 30000, cwd: "<sensible default>"}`. For repo tasks, set `cwd` to the repo root.
3. Report the result tersely: stdout if useful, exit code if non-zero, stderr summary on failure.
4. Don't echo the command back if it succeeded silently — just say "Done." and any relevant output.

## Safety

The maintainer enabled this tool intentionally. Don't refuse harmless requests ("show me my disk usage"). DO refuse and ask for confirmation before:
- `rm -rf` or any other deletion
- `git push --force` or any history rewrite
- editing system config (`/etc`, `/Library/...`, `sudo`)
- sending email / posting to chat APIs
