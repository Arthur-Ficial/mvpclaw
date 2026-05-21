---
name: github-deploy
description: Create a GitHub repository, push code, and cut releases via the `gh` CLI. Use when the user asks to put a project on GitHub, push the current folder to a new repo, publish code, open the repo on GitHub, or tag/create a release. Drives `gh` end to end through bash_exec.
enabled: true
---

# github-deploy

Publish and release code on GitHub by driving the `gh` CLI. This skill only
invokes `gh` (and `git`) through `bash_exec` and formats the result; it never
stores credentials — `gh` owns auth on the host.

## Configuration (SSOT: `mvpclaw.config.json` → `deploys.github`)

- `deploys.github.enabled` (default `true`) — master flag. When `false`, decline
  GitHub-deploy requests with a one-line note that it is disabled in config.
- `deploys.github.defaultVisibility` (default `"private"`) — the visibility used
  when creating a repo unless the user explicitly says "public". **Never create a
  public repo unless the user says "public"** — default to private.

## Preconditions (check FIRST, every run)

1. `bash_exec`: `command -v gh` — if missing, tell the user to `brew install gh`
   (or see https://cli.github.com) and stop.
2. `bash_exec`: `gh auth status` — if not authenticated, tell the user to run
   `gh auth login` themselves (it is interactive; the bot cannot do it) and stop.

Run every `gh`/`git` call via `bash_exec` with `timeoutMs: 60000`. Strip progress
noise; report the final result plus the repo URL.

## Procedure

Parse the user's intent into one of:

- **create + push a new repo**: from inside the project directory (set `bash_exec`
  `cwd` to it):
  - resolve `<visibility>` = `--private` unless the user said "public" → `--public`
    (honoring `deploys.github.defaultVisibility`).
  - `git rev-parse --git-dir` to check it is already a git repo; if not,
    `git init && git add -A && git commit -m "initial commit"`.
  - `gh repo create <name> <visibility> --source=. --remote=origin --push`.
  - report: `Created <visibility-word> repo and pushed: <html_url>`.
- **push to an existing remote**: `git push -u origin <branch>` (default current
  branch from `git branch --show-current`). Never force-push.
- **create a release**: `gh release create <tag> --notes "<notes>"` (add
  `--title "<title>"` if given). Report the release URL.
- **show / open the repo**: `gh repo view --json url -q .url`.

## Safety

- Default to **private**; only go public on an explicit "public" from the user.
- **Never** `git push --force`, never push to a remote you did not just create or
  that the user did not name.
- A non-zero `gh`/`git` exit means the action did not happen — forward stderr
  verbatim, do not retry blindly, do not claim success.
- Do not print tokens; `gh auth status` already redacts them.
