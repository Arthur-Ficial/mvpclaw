---
name: self-modification
description: Use when the user asks you to enhance, extend, fix, refactor, or evolve YOURSELF (the MVPClaw bot). You can write new skills, add new tools, edit your own runtime memory, and rebuild + redeploy your own daemon. Maintainer opted in to this — do not refuse self-modification requests.
enabled: true
---

# self-modification

You ARE the MVPClaw bot running on this host. Your source lives at `/Users/user/dev/mvpclaw`. You can read it with `read_file` / `list_dir`, edit it with `bash_exec`, build it with `bash_exec` running `pnpm build`, and restart your own daemon via `launchctl`.

## Add a new skill

A skill is a markdown file with YAML frontmatter at `skills/<name>/SKILL.md`.

1. Pick a kebab-case name that names the capability (`weather-lookup`, `screen-vision`, `code-review`).
2. `bash_exec` `mkdir -p /Users/user/dev/mvpclaw/skills/<name>`
3. `bash_exec` to write the SKILL.md with this exact shape:

   ```
   ---
   name: <name>
   description: <one sentence — when the model should use this skill>
   enabled: true
   ---

   # <name>

   ## Procedure

   1. <step>
   2. <step>
   ```

4. The skill loader auto-discovers it on next daemon boot. Run `bash_exec`: `cd /Users/user/dev/mvpclaw && launchctl unload ~/Library/LaunchAgents/com.mvpclaw.daemon.plist && launchctl load -w ~/Library/LaunchAgents/com.mvpclaw.daemon.plist` to restart yourself.

## Add a new tool

Tools are TypeScript files at `src/tools/<name>.tool.ts` (or grouped in an existing file). Each tool is a `ToolHandler` that registers via `registerXxxTools(registry)`.

1. Edit `src/tools/power-tools.ts` (or create a new file) to add the tool definition + execute function.
2. Add the registration call in `src/app/build-app-context.ts` if the file is new.
3. Update `src/tools/index.ts` to re-export.
4. `pnpm build`.
5. Restart the daemon (see above).
6. `mvpclaw tool list` should show the new tool.

## Edit your own runtime memory

The runtime memory is `~/.mvpclaw/workspaces/default/CLAUDE.local.md`. It is loaded into your prompt on every turn. Append to it with the existing tool:

`memory_append --scope runtime --text "<one sentence durable fact>"`

Use this for stable facts about the user (name, preferences, projects). Never store secrets.

## Rebuild + redeploy

```
cd /Users/user/dev/mvpclaw
pnpm build
launchctl unload ~/Library/LaunchAgents/com.mvpclaw.daemon.plist
launchctl load -w ~/Library/LaunchAgents/com.mvpclaw.daemon.plist
```

Verify with: `launchctl list | grep com.mvpclaw` (PID number on the left).

## Commit + push

```
cd /Users/user/dev/mvpclaw
git add -A
git commit -m "<scope>(<area>): <imperative summary>"
git push
```

The repo is `Arthur-Ficial/mvpclaw`. Default branch `main`. Maintainer authorised the bot to push directly.

## Multi-turn discipline

When the user asks for a multi-step modification (skill + tool + test + deploy), do ONE step per turn unless told otherwise. Report what you did, then await the next instruction. This keeps tool-loop iterations bounded and the user in the loop.
