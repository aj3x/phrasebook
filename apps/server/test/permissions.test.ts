import { describe, expect, test } from 'bun:test';
import { matches, parsePermission } from '../src/permissions';

describe('parsePermission', () => {
  test('splits a concrete pattern into its two segments', () => {
    expect(parsePermission('translation:save')).toEqual({
      resource: 'translation',
      action: 'save',
    });
  });

  test('accepts a wildcard in either segment, and in both', () => {
    expect(parsePermission('project:*')).toEqual({ resource: 'project', action: '*' });
    expect(parsePermission('*:view')).toEqual({ resource: '*', action: 'view' });
    expect(parsePermission('*:*')).toEqual({ resource: '*', action: '*' });
  });

  test('accepts underscored segments, as the catalog uses them', () => {
    expect(parsePermission('role_assignment:revoke')).toEqual({
      resource: 'role_assignment',
      action: 'revoke',
    });
    expect(parsePermission('translation:send_back')).toEqual({
      resource: 'translation',
      action: 'send_back',
    });
  });

  test.each([
    ['no separator', 'translation'],
    ['more than one separator', 'translation:save:extra'],
    ['an empty resource', ':save'],
    ['an empty action', 'translation:'],
    ['an empty string', ''],
    ['whitespace', 'translation: save'],
    ['a partial wildcard', 'trans*:save'],
    ['uppercase', 'Translation:save'],
    ['a leading underscore', '_translation:save'],
  ])('rejects %s', (_label, pattern) => {
    expect(() => parsePermission(pattern)).toThrow();
  });
});

describe('matches', () => {
  // The four shapes a held grant can take, each against a required
  // permission it should and shouldn't satisfy. Required is always
  // concrete, so this is the whole matrix.
  test('a concrete grant satisfies only itself', () => {
    expect(matches('translation:save', 'translation:save')).toBe(true);
    expect(matches('translation:save', 'translation:approve')).toBe(false);
    expect(matches('translation:save', 'project:save')).toBe(false);
    expect(matches('translation:save', 'project:view')).toBe(false);
  });

  test('an action wildcard satisfies every action on its own resource only', () => {
    expect(matches('project:*', 'project:view')).toBe(true);
    expect(matches('project:*', 'project:delete')).toBe(true);
    expect(matches('project:*', 'translation:view')).toBe(false);
  });

  test('a resource wildcard satisfies its action on every resource only', () => {
    expect(matches('*:view', 'project:view')).toBe(true);
    expect(matches('*:view', 'org:view')).toBe(true);
    expect(matches('*:view', 'project:delete')).toBe(false);
  });

  test('the full wildcard satisfies everything -- the Owner grant', () => {
    expect(matches('*:*', 'project:view')).toBe(true);
    expect(matches('*:*', 'workspace:create')).toBe(true);
    expect(matches('*:*', 'translation:send_back')).toBe(true);
  });

  test('rejects a wildcard on the required side -- code asks for concrete permissions', () => {
    expect(() => matches('*:*', 'project:*')).toThrow();
    expect(() => matches('project:*', '*:view')).toThrow();
    expect(() => matches('project:view', '*:*')).toThrow();
  });

  test('rejects a malformed pattern on either side', () => {
    expect(() => matches('project', 'project:view')).toThrow();
    expect(() => matches('project:view', 'project')).toThrow();
  });
});
