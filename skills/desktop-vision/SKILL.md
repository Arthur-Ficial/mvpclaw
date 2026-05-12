---
name: desktop-vision
description: Use when the user asks what is on their screen, what app is open, what they are looking at, or to take a screenshot. Calls the screenshot tool to capture the host display.
enabled: true
---

# desktop-vision

You can see the user's screen by calling the `screenshot` tool. The tool returns a PNG path on disk.

## Procedure

1. Call `screenshot` (no arguments needed; defaults to `/tmp/mvpclaw-<ts>.png`).
2. Optionally call `bash_exec` with `file <path>` to confirm dimensions / size.
3. Report the path back to the user with one sentence about what was captured (e.g., "Screenshot saved to /tmp/mvpclaw-1234.png — 2560x1664 PNG.").
4. If the user asks "what's on my screen?", you cannot literally see the pixels — but you saved the image and they can open it. Suggest `open <path>` to view.

## Notes

- macOS only — `screencapture -x` is the underlying binary.
- Don't take repeated screenshots in a loop. One per request.
