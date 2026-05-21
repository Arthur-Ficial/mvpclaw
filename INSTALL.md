# INSTALL.md — Agent Install Playbook

You are installing MVPClaw. Execute this playbook top to bottom. Each step is numbered. Do not skip steps. If a step fails, stop and surface the error — do not declare success.

Default mode is **automated**: you run the shell commands. Lockdown mode (Step 1) writes a `install-commands.sh` instead — you generate files but never execute.

---

## Step 0 — Check install state

```bash
test -f .mvpclaw-install.json && echo INSTALLED || echo FRESH
```

- `INSTALLED` → **STOP**. Tell the user the project is already installed, summarise `.mvpclaw-install.json`, ask what they actually want. Do NOT re-run this playbook.
- `FRESH` → continue.

---

## Step 1 — Detect lockdown mode

Check both:
- `.mvpclaw-lockdown` file exists in repo root.
- User said "lockdown", "no shell", or "don't run commands" in their request.

If either: **lockdown=true**. Do not execute shell commands; instead append every command to `install-commands.sh` for the user to review and run manually. You still write files normally.

Otherwise: **lockdown=false** (default).

For the rest of this playbook, "Run X" means **execute X in automated mode, OR append X to install-commands.sh in lockdown mode**.

---

## Step 2 — Ask the user the install questions

Ask all six questions in ONE message. Show defaults. Wait for all answers before continuing.

```
I'll set up MVPClaw. Six quick questions:

1. Project name? (default: <current folder basename>)

2. Install mode?
   a) independent — your own repo, no upstream tracking (default)
   b) fork        — keep mvpclaw-upstream remote so you can `git pull` template updates later

3. Deployment target?
   a) local       — run on this machine (default)
   b) docker      — also generate docker-compose setup

4. Agent provider?
   a) openrouter  — direct OpenRouter API (default, recommended)
   b) claude-cli  — Claude Code CLI bridge (routes through OpenRouter)

5. Telegram bot token? (paste it, or say "no" if you need to create one)

6. OpenRouter API key? (paste it, or say "skip" to set it later)
```

Record answers in memory; you'll write them to `.mvpclaw-install.json` at the end.

---

## Step 3 — Rename the project

Let `PROJECT_NAME` = answer to Q1 (default: folder basename).

**In `package.json`:** change `"name": "mvpclaw"` → `"name": "<PROJECT_NAME>"`.

**In `README.md`:** replace the first H1 line with `# <PROJECT_NAME>`. Add a one-line attribution: `Built from MVPClaw — https://github.com/Arthur-Ficial/mvpclaw`.

**Do NOT rename:**
- Internal module identifiers (`mvpclaw-tools`, `mvpclaw-conversations` MCP server names).
- The `mvpclaw.config.json` filename.
- The `MVPCLAW_*` env var prefix.

The project's public name changes; the codebase stays MVPClaw internally so upstream pulls keep working in fork mode.

---

## Step 4 — Git identity

If Q2 = **independent**:

```bash
git remote remove origin
git remote -v   # confirm: no remotes
```

If Q2 = **fork**:

```bash
git remote rename origin mvpclaw-upstream
git remote set-url --push mvpclaw-upstream DISABLED
git remote -v   # confirm: mvpclaw-upstream (fetch only)
```

In both modes, tell the user:

```
Next: on GitHub (or your forge), create a new EMPTY repo named <PROJECT_NAME>.
Then run:
  git remote add origin <your-repo-url>
  git push -u origin main
(You can do this now or later. Not required for the bot to run.)
```

---

## Step 5 — Telegram bot token

If Q5 = "no" (they don't have one):

```
Open Telegram, message @BotFather:
  /newbot
  <follow prompts; pick a display name, then a username ending in "bot">
BotFather will give you a token like 1234567890:AAH...

Paste the token here when you have it.
```

Wait. Validate the pasted token matches `^\d{8,12}:[A-Za-z0-9_-]{30,}$`. Do not log the raw token; refer to it as `TG_BOT_TOKEN`.

If Q5 was a token, validate the same way.

---

## Step 6 — OpenRouter key

If Q6 = "skip": record that the bot won't start successfully until they fill it in. Continue.

Otherwise validate the key starts with `sk-or-` and is at least 40 chars. Do not log it.

---

## Step 7 — Write `.env`

Copy `.env.example` to `.env`, filling in the user's values:

```bash
TELEGRAM_BOT_TOKEN=<token or empty>
OPENROUTER_API_KEY=<key or empty>
MVPCLAW_CONFIG=./mvpclaw.config.json
MVPCLAW_DATA_DIR=./data
MVPCLAW_WORKSPACE_DIR=./workspace
NODE_ENV=production
```

Verify `.env` is in `.gitignore`. If not, add it.

---

## Step 8 — Write `mvpclaw.config.json`

Copy `mvpclaw.config.example.json` → `mvpclaw.config.json`. Adjust based on Q4:

- If `openrouter` (default): leave `agent.provider = "openrouter"`.
- If `claude-cli`: set `agent.provider = "claude-cli"`, ensure `claudeCli.useOpenRouter = true`.

**Never embed secrets** in this file. It only references env vars (e.g. `${OPENROUTER_API_KEY}`).

---

## Step 9 — Install dependencies

```bash
pnpm install
```

If pnpm is missing:
```
Install pnpm first:
  corepack enable && corepack prepare pnpm@latest --activate
(Or: npm install -g pnpm)
```
Then retry.

---

## Step 10 — Verify Claude CLI (only if provider = claude-cli)

```bash
claude --version
```

If not installed, print the install URL from `code.claude.com/docs` and pause until the user installs it. Verify again.

---

## Step 11 — Apply migrations

```bash
mkdir -p data workspace
pnpm migrate
```

This creates `./data/mvpclaw.sqlite` (or whatever the config points at) with all tables.

---

## Step 12 — Run the test gate

```bash
pnpm check
```

If this fails: **STOP**. Show the failure output. Fix forward. Common causes:

- Missing `OPENROUTER_API_KEY` → tests that hit the live API are skipped without it. Verify the test runner respects the `skipIf` pattern.
- Missing `claude` binary → install Claude CLI per Step 10.
- Migration mismatch → check `migrations/` ran cleanly.

Do not proceed past a failing test gate.

---

## Step 13 — Smoke test (live Telegram round-trip)

Skip this step if either key is missing — print a note instead.

Start the bot in background:

```bash
pnpm dev &
BOT_PID=$!
sleep 5
```

Tell the user:

```
Open Telegram. Find your bot (@<botusername>). Send /start.
Tell me what the bot replied.
```

Wait for user confirmation. If they confirm a reply within 60s, kill the bot and proceed:

```bash
kill $BOT_PID
```

If no reply, debug:
- `pnpm dev` foreground output → see what error appeared.
- `data/traces/*.jsonl` → check the latest trace file.
- Verify `.env` was loaded.

---

## Step 14 — Docker setup (only if deployment = docker)

Files `docker/Dockerfile` and `docker/docker-compose.yml` already exist in the template (after ticket F4 lands). No changes needed — they reference `.env` from the repo root.

Tell the user:

```
To run in Docker:
  docker compose -f docker/docker-compose.yml up -d
To view logs:
  docker compose -f docker/docker-compose.yml logs -f
To stop:
  docker compose -f docker/docker-compose.yml down
```

---

## Step 15 — Write install record

Create `.mvpclaw-install.json`:

```json
{
  "schemaVersion": 1,
  "installedAt": "<ISO 8601 UTC>",
  "installedBy": "claude-code | codex | other",
  "projectName": "<PROJECT_NAME>",
  "mode": "independent | fork",
  "deployment": "local | docker",
  "provider": "claude-cli | openrouter",
  "mvpclawTemplateCommit": "<current HEAD SHA before any agent changes>",
  "lockdown": false
}
```

**Commit this file.** It is NOT in `.gitignore`. Future agent sessions read it to know the install is done.

---

## Step 16 — Fork mode: add upstream-sync section to CLAUDE.md

In fork mode only, append this section to the project's `CLAUDE.md`:

```markdown
## Upstream sync (fork mode)

This project tracks MVPClaw as `mvpclaw-upstream`. To pull template updates:

    git fetch mvpclaw-upstream
    git merge mvpclaw-upstream/main

Conflicts are expected in:
- package.json (your project name vs "mvpclaw")
- README.md (your heading vs "MVPClaw")
- .mvpclaw-install.json (yours wins)

Keep your versions. Never push to mvpclaw-upstream.
```

---

## Step 17 — Final summary

Print:

```
✓ <PROJECT_NAME> installed.
✓ Mode: <independent|fork>
✓ Deployment: <local|docker>
✓ Provider: <claude-cli|openrouter>
✓ Telegram: <connected|pending — set TELEGRAM_BOT_TOKEN in .env>
✓ OpenRouter: <connected|pending — set OPENROUTER_API_KEY in .env>

Next:
  - Run: pnpm dev
  - Message your bot on Telegram.
  - Push to your own GitHub:
      git remote add origin <your-url>
      git push -u origin main

Docs:
  - ./CLAUDE.md            — rules for you (the dev agent)
  - ./prompts/internal-agent/CLAUDE.md — the bot's own behavior
  - ./ARCHITECTURE.md      — full system architecture
  - ./INSTALL.md           — this playbook (re-runnable in lockdown mode)
```

---

## Step 18 — Stop

Do not continue past this point unless the user asks for something specific. Install is complete.

---

## Lockdown mode

Triggered by `.mvpclaw-lockdown` file in repo root OR user saying "lockdown mode" / "don't run commands".

In this mode, the agent:

1. **Writes** every file the playbook says to write.
2. **Generates `install-commands.sh`** containing every shell command, in order, with comments.
3. **Does NOT execute** anything.
4. Prints: "Review `install-commands.sh`, then run `bash install-commands.sh`."

Example `install-commands.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# MVPClaw install — generated <ISO 8601 UTC>
# Mode: independent, local, openrouter provider

# Step 4 — Git identity (independent mode)
git remote remove origin

# Step 9 — Dependencies
pnpm install

# Step 10 — Verify Claude CLI
claude --version

# Step 11 — Migrations
mkdir -p data workspace
pnpm migrate

# Step 12 — Test gate
pnpm check

# Step 13 — Smoke test (manual)
echo "Run: pnpm dev"
echo "Then message your bot on Telegram and verify /start works."
```

`install-commands.sh` is in `.gitignore` (regenerate-on-demand, not source).

To enable lockdown by default, the user creates the marker file BEFORE running the agent:

```bash
touch .mvpclaw-lockdown
claude
> make this work
```
