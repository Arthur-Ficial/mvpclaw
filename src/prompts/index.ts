/**
 * Prompts area — deterministic system-prompt composition.
 *
 * Replaces `src/app/prompt-builder.ts`'s minimal v1 with a 9-section pipeline
 * that produces byte-identical output for identical inputs. The Anthropic
 * cache-breakpoint anchors are returned alongside so providers that support
 * `cache_control` can stamp markers without re-parsing the prompt.
 */
export { composePrompt, PREAMBLE } from './composer.js';
export type { ComposeInput, ComposeOutput } from './composer.js';
export { truncateHistory } from './sliding-window.js';
export type { WindowLimits, TruncateResult } from './sliding-window.js';
