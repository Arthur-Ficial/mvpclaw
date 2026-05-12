# Docker deployment

MVPClaw's Docker path is opt-in. The install playbook (`INSTALL.md` Step 14) prompts for it. Everything below assumes you ran the playbook with `deployment = docker`.

## One-shot commands

From the project root:

```sh
# Build + start in the background
docker compose -f docker/docker-compose.yml up -d --build

# Tail logs
docker compose -f docker/docker-compose.yml logs -f

# Stop
docker compose -f docker/docker-compose.yml down
```

## What the container is

- **Base:** `node:24-slim`
- **Package manager:** pnpm via corepack
- **Build:** `pnpm install --frozen-lockfile --prod` → `pnpm build` → run `dist/cli/main.js start`
- **Volumes (bind-mounted from the host):**
  - `../data` → `/app/data` (SQLite + per-run traces)
  - `../workspace` → `/app/workspace` (Claude CLI runtime workspace)
  - `../mvpclaw.config.json` → `/app/mvpclaw.config.json` (read-only)
  - `../prompts` → `/app/prompts` (read-only)
  - `../skills` → `/app/skills` (read-only)
- **`.env`:** loaded from the project root (`env_file: ../.env` in compose).

The bind mounts mean your SQLite + traces survive container rebuilds, and editing `mvpclaw.config.json` / `prompts/` / `skills/` on the host takes effect after a `restart`.

## Provider-specific notes

The Dockerfile installs Claude Code CLI globally so the `claude-cli` provider works out of the box. If you set `agent.provider = "openrouter"` in `mvpclaw.config.json`, you can shave ~150 MB off the image by removing this line from `docker/Dockerfile`:

```Dockerfile
RUN npm install -g @anthropic-ai/claude-code
```

Then rebuild:

```sh
docker compose -f docker/docker-compose.yml up -d --build
```

## Secrets

`.env` is mounted into the container via `env_file`, not copied into the image. Keep it gitignored (`./.gitignore` already excludes it).

## When NOT to use Docker

If you only run MVPClaw locally on the same machine, `pnpm dev` is faster: no build layers, no volume indirection, faster iteration on prompts. Docker is for shipping the same template to a server (Fly, Render, your own VM) without re-installing system dependencies.
