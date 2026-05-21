/**
 * Email area — the `himalaya` transport shared by the email channel (unattended
 * IMAP poll + SMTP send). The on-demand email *skill* drives the same binary
 * directly; this module is the code path the channel uses. No raw IMAP/SMTP,
 * no extra credential store — himalaya owns account config.
 */
export { createEmailTransport, parseEnvelopeList } from './transport.js';
export type { EmailTransport, EmailEnvelope, HimalayaRun } from './transport.js';
