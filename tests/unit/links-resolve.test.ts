/**
 * Pure-function tests for `resolvePrimaryChatRef` — the channel-link resolver
 * that maps an inbound identity to its link group's primary chat (so linked
 * identities share one session).
 */
import { describe, it, expect } from 'vitest';
import { resolvePrimaryChatRef } from '../../src/links/resolve.js';

const links = [
  {
    id: 'owner',
    primary: { channel: 'telegram', id: '111' },
    members: [
      { channel: 'telegram', id: '111' },
      { channel: 'email', id: 'me@example.com' },
    ],
  },
];

describe('resolvePrimaryChatRef', () => {
  it('maps a linked member to the group primary', () => {
    expect(resolvePrimaryChatRef('email', 'me@example.com', links)).toEqual({
      channel: 'telegram',
      id: '111',
    });
  });

  it('maps the primary identity to itself', () => {
    expect(resolvePrimaryChatRef('telegram', '111', links)).toEqual({
      channel: 'telegram',
      id: '111',
    });
  });

  it('returns the identity unchanged when not a member', () => {
    expect(resolvePrimaryChatRef('email', 'stranger@x.com', links)).toEqual({
      channel: 'email',
      id: 'stranger@x.com',
    });
  });

  it('returns identity unchanged when links is empty', () => {
    expect(resolvePrimaryChatRef('telegram', '111', [])).toEqual({
      channel: 'telegram',
      id: '111',
    });
  });
});
