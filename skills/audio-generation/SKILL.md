---
name: audio-generation
description: Use when the user asks you to send a voice message, audio reply, narration, or any spoken response. Generate speech via OpenAI TTS (or local `say`) and deliver it through the Telegram channel as a voice note.
enabled: true
---

# audio-generation

The bot can produce spoken replies and send them as Telegram voice notes (OGG/Opus) via `bot.api.sendVoice` (channel adapter verb `voice(chatId, path)`).

## Procedure

1. Build the text the user wants spoken.
2. Generate audio. Two paths:
   - **macOS local fallback (always works)**: `bash_exec` `say -o /tmp/mvpclaw-voice-<ts>.aiff "<text>"; ffmpeg -y -i /tmp/mvpclaw-voice-<ts>.aiff -c:a libopus -b:a 32k /tmp/mvpclaw-voice-<ts>.ogg`.
   - **OpenAI TTS (when `OPENAI_API_KEY` is set)**: POST to `https://api.openai.com/v1/audio/speech` with `model: "tts-1"`, `voice: "alloy"`, `input: <text>`, `response_format: "opus"`. Save to `/tmp/mvpclaw-voice-<ts>.ogg`.
3. Call the new `audio_send` tool (or `bash_exec` `curl -F voice=@<path> "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendVoice?chat_id=<chat>"`) to deliver it.
4. Reply with one short line: "Sent voice note (X seconds)."

## Notes

- Voice notes have a 1MB Telegram limit; trim long messages or split.
- Don't send voice for one-word answers — text is faster.
