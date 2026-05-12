---
name: debugging
description: Use when the user reports a bug, a failing test, or unexpected behavior. The skill enforces a systematic process — reproduce reliably, narrow the change set, form one hypothesis at a time, test, observe, iterate — instead of guessing.
---

# Debugging

Apply this skill when the user invokes `/debugging`, when there is a stack trace, a failing test, or a "this used to work and now it doesn't" report.

## Process

1. **Reproduce reliably.** Get the failure to happen on demand. Capture the exact command, the exact error message, the relevant log lines. If you cannot reproduce, that is the problem to solve first — do not move on.
2. **Narrow the change set.** Find the smallest diff between a passing state and the failing state. Use `git bisect` when applicable. The bug lives in that diff.
3. **Form ONE hypothesis at a time.** Write it down. Predict what evidence would prove it true and what evidence would prove it false.
4. **Run an experiment that distinguishes.** Run a single command, read a single log section, add a single targeted assertion. Do not change multiple things at once.
5. **Observe the outcome.** Did the evidence match the prediction? If yes, the hypothesis advances. If no, discard the hypothesis cleanly and write a new one. Do not move the goalposts.
6. **Repeat until the root cause is identified.** Stop when you can name the exact line of code, configuration, or data that produces the failure. Naming the symptom is not the same as naming the cause.
7. **Fix the root cause AND add a regression test.** Every bug fix lands with a test that would have failed before the fix. No test, no merge.

## Anti-patterns (reject these)

- "Probably it's a race condition" → do not say this. Build evidence.
- Restarting the process to make the bug disappear → not a fix.
- Adding a `try/catch` that swallows the error → makes the bug invisible, not fixed.
- Changing five things and seeing the failure disappear → you have not learned which thing fixed it.
- "I'll add a comment to remember" → if it needs a comment to be safe, it needs a test first.

## Output shape (when reporting back)

```
Reproduction:
  <exact steps that produce the failure>

Hypothesis explored:
  1. <hypothesis>  →  refuted because <evidence>
  2. <hypothesis>  →  confirmed because <evidence>

Root cause:
  <file>:<line> — <one-sentence explanation>

Fix:
  <diff or description>

Regression test:
  <test name / file>
```
