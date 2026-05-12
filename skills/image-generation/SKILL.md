---
name: image-generation
description: Use when the user asks for an image, illustration, picture, photo, drawing, logo, or any visual. Generate via Gemini Imagen (when GEMINI_API_KEY works) or via OpenRouter's Gemini image-preview model (always works), then DELIVER the image as a real Telegram photo, not just a path.
enabled: true
---

# image-generation

Images must arrive in the chat as actual photos, not file paths. The Telegram channel adapter exposes a `photo(chatId, path)` verb that calls `bot.api.sendPhoto`.

## Procedure

1. Take the user's request and rewrite it as a one-sentence Imagen-friendly prompt: subject + style + lighting + camera/composition. (e.g., "wizard in a forest" → "A weathered wizard with a long silver beard, standing in a misty pine forest at dawn, cinematic side-light, 35mm lens, photorealistic".)
2. Generate the PNG. **Preferred**: use the OpenRouter route which always works with the project key:
   ```
   curl -s "https://openrouter.ai/api/v1/chat/completions" \
     -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model":"google/gemini-2.5-flash-image",
       "messages":[{"role":"user","content":"<imagen-friendly prompt>"}],
       "modalities":["image","text"]
     }'
   ```
   The response contains `choices[0].message.images[].image_url.url` as a `data:image/png;base64,…` URL. Decode and save to `/tmp/mvpclaw-img-<ts>.png`.
3. **Direct Gemini fallback** (when OpenRouter routing fails AND `GEMINI_API_KEY` is fresh): POST to `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=$GEMINI_API_KEY` with `{contents:[{parts:[{text: prompt}]}]}` and decode `candidates[0].content.parts[].inlineData.data`.
4. Send the file to Telegram as a photo (when called from a Telegram chat). Use the `photo_send` tool if available, otherwise `bash_exec`:
   ```
   curl -sF photo=@/tmp/mvpclaw-img-<ts>.png \
     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendPhoto?chat_id=<chat>&caption=<short caption>"
   ```
5. Reply with one short caption sentence describing what you generated.

## Notes

- One image per turn. No retries unless the user asks for variants.
- Imagen does not produce text-in-image well; warn briefly if asked for words inside the picture.
