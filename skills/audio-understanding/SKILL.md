---
name: audio-understanding
description: Use when the user sends a voice note or audio file and you need to understand it. Downloads the file via Telegram getFile, transcribes via Whisper (local) or OpenAI Whisper API, then proceeds as if the transcript were a normal text inbound.
enabled: true
---

# audio-understanding

When the Telegram channel adapter receives an inbound voice/audio message, the orchestrator's normalised `InboundMessage.text` will be empty BUT a `raw.voice.file_id` will be present. This skill bridges that gap.

## Procedure

1. Detect the voice payload: `raw.voice.file_id` or `raw.audio.file_id`.
2. Download via `bash_exec`:
   ```
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getFile?file_id=<id>" | jq -r .result.file_path
   curl -sL "https://api.telegram.org/file/bot$TELEGRAM_BOT_TOKEN/<file_path>" -o /tmp/mvpclaw-in-<ts>.ogg
   ```
3. Transcribe. Two paths:
   - **OpenAI Whisper (preferred)**: POST `/v1/audio/transcriptions` with `model: "whisper-1"`, `file: @<path>`. Returns `{text}`.
   - **Local whisper.cpp** (if installed at `/opt/homebrew/bin/whisper`): `bash_exec` `whisper /tmp/mvpclaw-in-<ts>.ogg --model base.en --output-format json`.
4. Treat the transcript as the user's text and answer accordingly.
5. Reply briefly noting "(transcribed from voice)" so the user knows the loop closed.

## Notes

- If transcription fails, ask the user to type instead.
- Don't store raw audio after transcription unless the user asked.
