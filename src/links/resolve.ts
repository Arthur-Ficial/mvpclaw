/**
 * Channel-link resolution.
 *
 * A "link group" ties several channel identities (e.g. the owner's Telegram
 * chat + their email address) into one conversation: inbound from any member
 * resolves to the group's `primary` chat, so the agent sees a single shared
 * session across channels. Pure + total — no I/O.
 */

/** One channel identity: a channel name + its external chat/address id. */
export interface ChatRef {
  /** Channel name (`telegram`, `email`, …). */
  channel: string;
  /** External chat id (Telegram chat_id) or address (email sender). */
  id: string;
}

/** A configured link group sharing one session via its `primary` chat. */
export interface LinkGroup {
  /** Stable group id (for config + logs). */
  id: string;
  /** The chat whose session the whole group shares. */
  primary: ChatRef;
  /** Member identities; inbound from any of these maps to `primary`. */
  members: ChatRef[];
}

/**
 * Resolve the session-owning chat for an inbound identity.
 *
 * @param channel - Inbound channel name.
 * @param id - Inbound provider chat id (Telegram chat_id / email sender address).
 * @param links - Configured link groups.
 * @returns The group `primary` when the identity is a member; otherwise the
 *          identity itself (so unlinked chats keep their own session).
 */
export function resolvePrimaryChatRef(channel: string, id: string, links: LinkGroup[]): ChatRef {
  for (const group of links) {
    if (group.members.some((m) => m.channel === channel && m.id === id)) {
      return group.primary;
    }
  }
  return { channel, id };
}
