---
name: research
description: Use when the user asks for sourced research, citations, fact-checking, or a literature review. The skill enforces a process of gathering reputable sources, citing each fact with a URL, marking uncertainty, and avoiding speculation.
---

# Research

Apply this skill when the user explicitly invokes `/research` or when the task is to produce sourced, citable information rather than an opinion.

## Process

1. **Restate the question.** Write one sentence summarizing what is actually being asked. If the question is ambiguous, ask one clarifying question and stop.
2. **Identify candidate sources.** Prefer primary sources (specifications, official docs, peer-reviewed papers, vendor changelogs) over secondary commentary (blog posts, forum threads). Aim for at least three independent sources.
3. **Gather facts with citations.** For every claim that is not common knowledge, attach a URL. If a fact appears in multiple sources, cite the most authoritative one.
4. **Mark uncertainty explicitly.** When a source contradicts another, when data is older than 18 months on a fast-moving topic, or when no primary source exists — say so in the answer. Do not paper over gaps.
5. **Summarize first, detail second.** Lead with a one-paragraph summary that stands on its own. Follow with a numbered section per sub-question, each with citations.
6. **Refuse to speculate.** If the available sources do not answer the question, say "I could not find a primary source for X" and stop. Do not invent numbers, dates, or quotes.

## Output shape

```
Summary:
  <one paragraph, plain prose, no citations>

Findings:
  1. <claim>
     Source: <url>
  2. <claim>
     Source: <url>
  ...

Gaps / uncertainty:
  - <unanswered sub-question>
  - <contradiction between source A and source B>
```

## Anti-patterns (reject these)

- "It is generally believed that…" without a source → drop the sentence.
- A single Wikipedia citation as the sole source for a contested claim → find a primary source or mark uncertainty.
- Citing a source you have not actually fetched → fetch it (or skip the claim).
- Padding the answer to look thorough → terseness beats theatre.
