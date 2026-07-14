import { describe, expect, test } from 'bun:test';
import { hasScopedRole } from '../../src/middleware/scope';
import type { AuthContext } from '../../src/middleware/session';

describe('hasScopedRole', () => {
  test('returns false when there is no auth context', () => {
    expect(hasScopedRole(null, ['Admin'])).toBe(false);
  });

  test('returns false when no grant matches the required role names', () => {
    const ctx: AuthContext = {
      userId: 'u1',
      roles: [{ role: 'Viewer', projectId: null, localeCode: null }],
    };
    expect(hasScopedRole(ctx, ['Admin'])).toBe(false);
  });

  test('an unscoped grant (NULL/NULL) matches any requested scope', () => {
    const ctx: AuthContext = {
      userId: 'u1',
      roles: [{ role: 'Admin', projectId: null, localeCode: null }],
    };
    expect(hasScopedRole(ctx, ['Admin'], { projectId: 'p1', localeCode: 'fr' })).toBe(true);
    expect(hasScopedRole(ctx, ['Admin'])).toBe(true);
  });

  test('a project-scoped grant matches only that project', () => {
    const ctx: AuthContext = {
      userId: 'u1',
      roles: [{ role: 'Translator', projectId: 'p1', localeCode: null }],
    };
    expect(hasScopedRole(ctx, ['Translator'], { projectId: 'p1' })).toBe(true);
    expect(hasScopedRole(ctx, ['Translator'], { projectId: 'p2' })).toBe(false);
  });

  test('a project+locale-scoped grant matches only that exact combination', () => {
    const ctx: AuthContext = {
      userId: 'u1',
      roles: [{ role: 'Translator', projectId: 'p1', localeCode: 'fr' }],
    };
    expect(hasScopedRole(ctx, ['Translator'], { projectId: 'p1', localeCode: 'fr' })).toBe(true);
    expect(hasScopedRole(ctx, ['Translator'], { projectId: 'p1', localeCode: 'de' })).toBe(false);
  });

  test('a project-only-scoped grant (locale NULL) matches any locale within that project', () => {
    const ctx: AuthContext = {
      userId: 'u1',
      roles: [{ role: 'Translator', projectId: 'p1', localeCode: null }],
    };
    expect(hasScopedRole(ctx, ['Translator'], { projectId: 'p1', localeCode: 'de' })).toBe(true);
  });

  test('not requesting a scope dimension ignores that dimension on the grant', () => {
    const ctx: AuthContext = {
      userId: 'u1',
      roles: [{ role: 'Translator', projectId: 'p1', localeCode: 'fr' }],
    };
    expect(hasScopedRole(ctx, ['Translator'])).toBe(true);
  });
});
