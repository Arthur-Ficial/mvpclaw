---
name: file-inspection
description: Use when the user asks what is in a folder, to read a file, to look at the dev directory, or to inspect on-disk state. Calls list_dir + read_file.
enabled: true
---

# file-inspection

Two tools cover the surface — `list_dir` for directory listings and `read_file` for file contents.

## Procedure — directory questions

1. Call `list_dir` with the requested path (`~`-prefix is supported, e.g., `~/dev`).
2. Group entries: directories first, files second; mention sizes for the largest.
3. If the user asked "what's interesting here?", pick the top 5 by size or by recognisable name (`README.md`, `package.json`, `.git`).

## Procedure — file questions

1. Call `read_file` with the path. Default `maxBytes: 65536` is enough for source files; bump only when needed.
2. If the file is plain text, show the relevant lines. If huge, summarise.
3. If binary, just report the size and type — do NOT dump bytes to chat.

## Combined

For "look at my repo X": list_dir the root, then read_file the README and the entry-point. Combine into a 2-3 sentence summary.
