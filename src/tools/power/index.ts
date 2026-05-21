/**
 * Power tools — DANGEROUS by default.
 *
 * Per the maintainer's directive ("super super powerful and unsafe"), the
 * bot ships with shell exec, filesystem read, screenshot capture, image
 * generation, the ability to spawn Claude / Codex sub-agents, and Telegram
 * media upload. The agent can see the desktop and run any command the host
 * user can.
 *
 * Each tool's enablement is gated on `config.power.enabled` (default `true`)
 * so a security-minded operator can flip the whole set off in one place;
 * individual tools also respect their own `power.*` config keys. The factories
 * live in sibling modules (bash / fs / screenshot / spawn / image /
 * telegram-media); this file is the single registrar.
 */
import type { MvpClawConfigType } from '../../config/index.js';
import type { ToolRegistry } from '../tool-registry.js';
import { bashExecTool } from './bash.js';
import { listDirTool, readFileTool } from './fs.js';
import { geminiImageTool } from './image.js';
import { screenshotTool } from './screenshot.js';
import { claudeSpawnTool, codexSpawnTool } from './spawn.js';
import { telegramPhotoTool, telegramVideoTool } from './telegram-media.js';

export { bashExecTool } from './bash.js';
export { listDirTool, readFileTool } from './fs.js';
export { geminiImageTool } from './image.js';
export { screenshotTool } from './screenshot.js';
export { claudeSpawnTool, codexSpawnTool } from './spawn.js';
export { telegramPhotoTool, telegramVideoTool } from './telegram-media.js';

/**
 * Register the power tools on `registry`.
 *
 * @param registry - The tool registry.
 * @param config - Resolved MVPClaw config.
 */
export function registerPowerTools(registry: ToolRegistry, config: MvpClawConfigType): void {
  const enabled = config.power.enabled;
  registry.register(bashExecTool(enabled && config.power.bashExec));
  registry.register(readFileTool(enabled && config.power.readFs));
  registry.register(listDirTool(enabled && config.power.readFs));
  registry.register(screenshotTool(enabled && config.power.screenshot));
  registry.register(claudeSpawnTool(enabled && config.power.claudeSpawn));
  registry.register(codexSpawnTool(enabled && config.power.codexSpawn));
  registry.register(geminiImageTool(enabled && config.power.geminiImage));
  registry.register(telegramPhotoTool(enabled && config.power.telegramPhoto));
  registry.register(telegramVideoTool(enabled && config.power.telegramVideo));
}
