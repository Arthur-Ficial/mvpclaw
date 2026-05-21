/**
 * Links area — configurable channel linking. A link group ties multiple
 * channel identities into one shared session (e.g. owner Telegram + email),
 * so a single-thread bot can converse across channels. One pure resolver;
 * the router consumes it. No I/O, no business logic.
 */
export { resolvePrimaryChatRef } from './resolve.js';
export type { ChatRef, LinkGroup } from './resolve.js';
