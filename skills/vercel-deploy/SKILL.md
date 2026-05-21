---
name: vercel-deploy
description: Deploy a project to Vercel (preview or production) and manage its env vars via the `vercel` CLI. Use when the user asks to deploy a site/app, push to Vercel, get a preview URL, ship to production, or set a Vercel environment variable. Drives `vercel` end to end through bash_exec.
enabled: true
---

# vercel-deploy

Deploy web projects to Vercel by driving the `vercel` CLI. This skill only
invokes `vercel` through `bash_exec` and formats the result; it never stores
credentials — the `vercel` CLI owns auth on the host.

## Configuration (SSOT: `mvpclaw.config.json` → `deploys.vercel`)

- `deploys.vercel.enabled` (default `true`) — master flag. When `false`, decline
  Vercel-deploy requests with a one-line note that it is disabled in config.
- `deploys.vercel.defaultTarget` (default `"preview"`) — `preview` or `production`.
  Used when the user does not say which.
- `deploys.vercel.scope` (default `""`) — Vercel team/scope slug. When non-empty,
  pass `--scope <scope>` on every `vercel` call.

## Preconditions (check FIRST, every run)

1. `bash_exec`: `command -v vercel` — if missing, tell the user to
   `npm i -g vercel` (or see https://vercel.com/docs/cli) and stop.
2. `bash_exec`: `vercel whoami` — if not authenticated, tell the user to run
   `vercel login` themselves (interactive; the bot cannot do it) and stop.

Run every `vercel` call via `bash_exec` from the project directory (`cwd`) with
`timeoutMs: 120000`. Append `--scope <scope>` when `deploys.vercel.scope` is set.

## Procedure

Parse the user's intent into one of:

- **link the project** (first time): `vercel link --yes` — links the current
  directory to a Vercel project non-interactively.
- **deploy a preview** (default target): `vercel --yes` — builds and deploys a
  preview. Report the preview URL from stdout (the last `https://…vercel.app`).
- **deploy to production**: `vercel --prod --yes` — ONLY when the user explicitly
  asks for production, or `deploys.vercel.defaultTarget` is `production` AND the
  user asked to "deploy" without qualification. Report the production URL.
- **set an env var**: `vercel env add <NAME> <target>` where `<target>` is
  `production` / `preview` / `development`. The value is read from stdin — pipe it
  in (`printf %s "$VALUE" | vercel env add <NAME> <target>`); **never echo a
  secret value into the chat or logs**.

## Safety

- Production deploys require explicit user intent — when in doubt, deploy a
  preview and share that URL.
- A non-zero `vercel` exit means the deploy did not happen — forward stderr
  verbatim, do not retry blindly, do not claim success.
- Never print env-var values; confirm with the name + target only
  (`Set <NAME> for <target>.`).
