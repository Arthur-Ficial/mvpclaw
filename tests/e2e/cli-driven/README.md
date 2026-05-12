# CLI-driven end-to-end harness (ticket C11)

Every test in this directory MUST invoke the project entirely through
`node dist/cli/main.js …`. Tests never import from `src/` — they spawn
the compiled CLI as a subprocess and assert on stdout / stderr / exit
codes / sqlite state on disk.

Why this exists: per the project's CLI-first rule, every feature must
be drivable by an AI through a deterministic CLI surface. If a feature
can only be exercised by reaching into `src/`, that feature is not
AI-steerable and the test fails to prove it.

Conventions:

- Each scenario gets its own `mkdtemp`'d data directory + ad-hoc
  `mvpclaw.config.json` so the live `.env`-backed DB is never touched.
- Tests assert exit codes against the project contract (0 success, 1
  usage, 2 config, 3 runtime, 4 not found, 5 timeout).
- `--json` output is parsed with `JSON.parse`; pretty output is the
  human surface, JSON is the machine surface.
- Provider-touching scenarios skip when the relevant env var is unset.
