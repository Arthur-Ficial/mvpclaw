---
name: image-generation
description: Use when the user asks for an image, illustration, picture, photo, drawing, logo, or any visual. Calls the gemini_image tool against Google Imagen 3 and returns the path of the saved PNG.
enabled: true
---

# image-generation

When the user wants a picture: call `gemini_image` with a vivid, detailed prompt describing subject, style, composition, lighting.

## Procedure

1. Take the user's request and rewrite it as a one-sentence Imagen-friendly prompt: subject + style + lighting + camera/composition. (e.g., "A wizard in a dark forest" → "A weathered wizard with a long silver beard, standing in a misty pine forest at dawn, cinematic side-light, 35mm lens, photorealistic".)
2. Call the `gemini_image` tool with that prompt and `outPath: "/tmp/mvpclaw-img-<short-slug>.png"`.
3. Reply to the user with the path, and one short sentence describing what the image contains. Don't pad. Don't apologise.

## Notes

- Imagen does not produce text-in-image well; warn briefly if the user asked for words inside the picture.
- One image per turn — don't loop to "improve" unless the user asks for variants.
