import { describe, it, expect } from 'vitest';
import {
  parseSlashCommand,
  isBuiltinCommand,
  BUILTIN_COMMANDS,
} from '../../src/channels/telegram.commands.js';

describe('parseSlashCommand', () => {
  it('returns null for non-command text', () => {
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand(' /start')).toBeNull(); // leading space disqualifies
  });

  it('parses /command alone', () => {
    expect(parseSlashCommand('/start')).toEqual({ command: 'start', args: '' });
    expect(parseSlashCommand('/help')).toEqual({ command: 'help', args: '' });
  });

  it('lower-cases the command name', () => {
    expect(parseSlashCommand('/StArT')).toEqual({ command: 'start', args: '' });
  });

  it('parses /command args', () => {
    expect(parseSlashCommand('/research what is X')).toEqual({
      command: 'research',
      args: 'what is X',
    });
  });

  it('preserves arg whitespace internally; trims trailing whitespace', () => {
    expect(parseSlashCommand('/research  hello   world   ')).toEqual({
      command: 'research',
      args: 'hello   world',
    });
  });

  it('parses /command@BotName', () => {
    expect(parseSlashCommand('/status@MyBot')).toEqual({
      command: 'status',
      botMention: 'mybot',
      args: '',
    });
    expect(parseSlashCommand('/research@Bot what is X')).toEqual({
      command: 'research',
      botMention: 'bot',
      args: 'what is X',
    });
  });

  it('rejects commands starting with a digit (Telegram disallows this anyway)', () => {
    expect(parseSlashCommand('/1start')).toBeNull();
  });

  it('rejects commands containing punctuation', () => {
    expect(parseSlashCommand('/foo-bar')).toBeNull();
    expect(parseSlashCommand('/foo.bar')).toBeNull();
  });

  it('handles multi-line args (regex uses /s dotall)', () => {
    const out = parseSlashCommand('/research line one\nline two');
    expect(out).toEqual({ command: 'research', args: 'line one\nline two' });
  });
});

describe('isBuiltinCommand', () => {
  it('recognises every documented built-in', () => {
    for (const c of BUILTIN_COMMANDS) {
      expect(isBuiltinCommand(c)).toBe(true);
    }
  });

  it('rejects unknown commands', () => {
    expect(isBuiltinCommand('research')).toBe(false);
    expect(isBuiltinCommand('bogus')).toBe(false);
    expect(isBuiltinCommand('')).toBe(false);
  });

  it('BUILTIN_COMMANDS lists the 5 names from the spec', () => {
    expect([...BUILTIN_COMMANDS].sort()).toEqual(['help', 'new', 'skills', 'start', 'status']);
  });
});
