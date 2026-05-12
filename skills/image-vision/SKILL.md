---
name: image-vision
description: Use when the user sends a photo, screenshot, or image and you need to see what is in it. Downloads the file via Telegram getFile, then describes it via a vision-capable model (OpenAI gpt-4o or Gemini Pro Vision).
enabled: true
---

# image-vision

The Telegram channel surfaces inbound photos as `raw.photo[]` (array of resolutions, last one is the largest). Use this skill to inspect the image content.

## Procedure

1. Pick the largest variant: `raw.photo[-1].file_id`.
2. Download via `bash_exec`:
   ```
   FILE_PATH=$(curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getFile?file_id=<id>" | jq -r .result.file_path)
   curl -sL "https://api.telegram.org/file/bot$TELEGRAM_BOT_TOKEN/$FILE_PATH" -o /tmp/mvpclaw-img-<ts>.jpg
   ```
3. Describe via OpenAI vision (preferred — works with our OpenRouter key too):
   POST OpenRouter `/chat/completions` with model `openai/gpt-4o-mini` and a multimodal user message:
   ```json
   {"role":"user","content":[
     {"type":"text","text":"<the user's question about the image>"},
     {"type":"image_url","image_url":{"url":"data:image/jpeg;base64,<base64-of-file>"}}
   ]}
   ```
4. Return the description / answer to the user.

## Notes

- Don't describe images the user didn't ask about — only when the user's prompt references them.
- For "what does this say?" → set the prompt to "Transcribe any text in this image verbatim".
- Resize huge images first (`bash_exec` `convert in.jpg -resize 1024x1024 out.jpg`).
