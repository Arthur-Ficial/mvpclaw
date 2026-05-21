/**
 * `gemini_image` power tool — generate or edit an image via Gemini
 * (google/gemini-2.5-flash-image, "nano-banana") through OpenRouter. Gated by
 * `power.geminiImage`. Needs `OPENROUTER_API_KEY`.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolHandler } from '../tool.js';

/**
 * Build the `gemini_image` tool handler.
 *
 * @param enabled - Whether the tool is active (gated by power config).
 * @returns The tool handler.
 */
export function geminiImageTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'gemini_image',
      description:
        'Generate OR EDIT an image via Gemini (google/gemini-2.5-flash-image, a.k.a. "nano-banana") through OpenRouter. ' +
        'To EDIT an existing image, pass `inputImagePath` — the model uses it as a reference and applies the prompt. ' +
        'To GENERATE from scratch, omit `inputImagePath`. Returns the path of the saved PNG.',
      inputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: {
            type: 'string',
            minLength: 1,
            maxLength: 2000,
            description:
              'What to generate, or the edit instruction when `inputImagePath` is provided.',
          },
          outPath: { type: 'string', description: 'Optional output path; defaults to /tmp/.' },
          inputImagePath: {
            type: 'string',
            description:
              'Optional path to an existing image on disk. When set, nano-banana ' +
              'edits this image according to `prompt` rather than generating from scratch. ' +
              'Use for "make it better", "remove the background", "add lighting" workflows.',
          },
        },
      },
      source: 'builtin',
      enabled,
    },
    async execute(input): Promise<{ path: string; bytes: number; edited: boolean }> {
      if (!enabled) {
        throw new Error('gemini_image is disabled — set power.geminiImage to true');
      }
      const apiKey = process.env['OPENROUTER_API_KEY'];
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw new Error('gemini_image: OPENROUTER_API_KEY env var is unset');
      }
      const p = input as { prompt: string; outPath?: string; inputImagePath?: string };
      const out = p.outPath ?? join(tmpdir(), `mvpclaw-img-${Date.now()}.png`);
      const fs = await import('node:fs/promises');

      // Build content: text only for generation, [text, image_url] for editing.
      let content: unknown = p.prompt;
      let edited = false;
      if (typeof p.inputImagePath === 'string' && p.inputImagePath.length > 0) {
        const buf = await fs.readFile(p.inputImagePath);
        const mime =
          p.inputImagePath.toLowerCase().endsWith('.jpg') ||
          p.inputImagePath.toLowerCase().endsWith('.jpeg')
            ? 'image/jpeg'
            : 'image/png';
        const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
        content = [
          { type: 'text', text: p.prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ];
        edited = true;
      }

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'mvpclaw',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-image',
          messages: [{ role: 'user', content }],
          modalities: ['image', 'text'],
        }),
      });
      if (!res.ok) {
        throw new Error(`gemini_image ${res.status}: ${await res.text().catch(() => '')}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{
          message?: { images?: Array<{ image_url?: { url?: string } }> };
        }>;
      };
      const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? '';
      const m = url.match(/^data:image\/\w+;base64,(.+)$/);
      if (!m) {
        throw new Error('gemini_image: no image data url in response');
      }
      const buf = Buffer.from(m[1] ?? '', 'base64');
      await fs.writeFile(out, buf);
      return { path: out, bytes: buf.length, edited };
    },
  };
}
