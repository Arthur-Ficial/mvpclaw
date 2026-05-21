---
name: memory
description: Persist and recall typed memories that survive across conversations. Use whenever you learn a non-obvious rule, a project fact, an external system pointer, or a user preference — and whenever a new situation looks similar to one you've seen before. Mirrors Claude Code's MEMORY.md + frontmatter design.
enabled: true
---

# memory

Typed long-term memory. Backed by `~/.mvpclaw/workspaces/default/memory/` — a `MEMORY.md` index plus one frontmatter `<slug>.md` file per memory. The index is inlined at the top of every prompt you receive, so writing a memory makes the lesson available to every future turn.

## When to call `memory_save`

Save a memory whenever you'd otherwise:

- Just figured out how to fix a non-obvious bug → `type: feedback`
- Learned something about the current project, deadline, or stakeholder → `type: project`
- Found out where to look for something in an external system (Linear board, Grafana, repo X) → `type: reference`
- Picked up how the user prefers to collaborate (e.g. "prefers one bundled PR over many small") → `type: user`

**Do not save:** code patterns, file paths, architecture details, git history, anything derivable by reading the project right now. The codebase is its own documentation. Memory is for non-obvious facts that don't live in the code.

## The four types

| type | When | Body must contain |
|------|------|--------------------|
| `feedback` | Rules learned from failures and confirmed-good choices. | `**Why:** …` + `**How to apply:** …` |
| `project` | Who is doing what, by when, why. | `**Why:** …` + `**How to apply:** …` |
| `reference` | Pointer to an external system. | Free body. |
| `user` | How the user thinks, what they value, what to avoid. | Free body. |

The Why/How requirement is checked by the `memory_save` tool — saves that omit them are rejected.

## When to call `memory_list` and `memory_get`

**Before asking the user a question that you may have asked before**, call `memory_list`. If any entry's description matches the current situation, call `memory_get` on its slug and apply the stored rule. This is how the bot learns over time — past decisions get applied automatically instead of re-asking.

## Procedure

1. **Recall first.** Before any user-facing question that needs judgement, call `memory_list`. Scan the descriptions for relevance. On a match, `memory_get <slug>`, read the body, and apply.
2. **Decide.** Either apply the recalled rule or, if none fits, decide fresh.
3. **Save the lesson.** If the situation was new and the decision could recur, call `memory_save` immediately — slug as kebab-case, description as the rule itself (so future-you sees it in `memory_list` without opening the file), body following the type's contract.
4. **Prune.** If a memory turns out to be wrong or outdated, `memory_delete <slug>` and write the corrected one. Don't accumulate contradictions.

## Slug naming

Short kebab-case, scoped to topic. Examples:

- `email-from-acme-corp-billing` (feedback)
- `example-release-gate` (project)
- `inkblot-status-dashboard` (reference)
- `owner-prefers-bundled-prs` (user)

## Index format

MEMORY.md holds one line per memory:

```
- [<description>](<slug>.md) — <type>
```

The index is the source of truth — files on disk that aren't in the index are orphans (use `memory_list` not directory listing).

## Don't

- Don't save what's already documented in `CLAUDE.md` (project rules) or `prompts/internal-agent/CLAUDE.md` (your identity).
- Don't save ephemeral state — in-flight task progress belongs in `todo_add`, not memory.
- Don't save the owner's secrets — the memory dir is plain text and `git diff`-able.
