import { describe, expect, test } from 'bun:test';
import { BUILT_IN_ROLE_IDS } from '@phrasebook/db';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { Hono } from 'hono';
import { createAuth } from '../../src/auth';
import { hasPermission, requirePermission } from '../../src/middleware/permission';
import type { AuthContext, RoleGrant } from '../../src/middleware/session';
import { createSessionMiddleware } from '../../src/middleware/session';

function grant(
  patterns: string[],
  scope: { workspaceId?: string; projectId?: string; localeCode?: string } = {},
): RoleGrant {
  return {
    role: 'Test',
    workspaceId: scope.workspaceId ?? null,
    projectId: scope.projectId ?? null,
    localeCode: scope.localeCode ?? null,
    permissions: patterns.map((p) => {
      const [resource, action] = p.split(':');
      return { resource: resource ?? '', action: action ?? '' };
    }),
  };
}

function ctx(roles: RoleGrant[]): AuthContext {
  return { userId: 'u1', roles };
}

describe('hasPermission (pure)', () => {
  test('returns false when there is no auth context', () => {
    expect(hasPermission(null, 'project:view')).toBe(false);
  });

  test('returns false for a user with no grants', () => {
    expect(hasPermission(ctx([]), 'project:view')).toBe(false);
  });

  test('Owner (*:*) satisfies any concrete permission', () => {
    const owner = ctx([grant(['*:*'])]);
    expect(hasPermission(owner, 'project:view')).toBe(true);
    expect(hasPermission(owner, 'workspace:create')).toBe(true);
    expect(hasPermission(owner, 'translation:send_back')).toBe(true);
  });

  test('a resource wildcard (project:*) covers every action on that resource only', () => {
    const admin = ctx([grant(['project:*'])]);
    expect(hasPermission(admin, 'project:view')).toBe(true);
    expect(hasPermission(admin, 'project:create')).toBe(true);
    expect(hasPermission(admin, 'project:delete')).toBe(true);
    expect(hasPermission(admin, 'translation:save')).toBe(false);
  });

  test('an action wildcard (*:view) covers view on every resource only', () => {
    const auditor = ctx([grant(['*:view'])]);
    expect(hasPermission(auditor, 'project:view')).toBe(true);
    expect(hasPermission(auditor, 'user:view')).toBe(true);
    expect(hasPermission(auditor, 'project:create')).toBe(false);
  });

  test('a concrete grant satisfies exactly itself, nothing adjacent', () => {
    const translator = ctx([grant(['translation:save'])]);
    expect(hasPermission(translator, 'translation:save')).toBe(true);
    expect(hasPermission(translator, 'translation:claim')).toBe(false);
    expect(hasPermission(translator, 'translation:view')).toBe(false);
  });

  test('additive-only: a match on ANY held grant is enough', () => {
    // Viewer-ish grant lacks translation:save; a second grant supplies it.
    const combined = ctx([
      grant(['project:view', 'translation:view']),
      grant(['translation:save']),
    ]);
    expect(hasPermission(combined, 'translation:save')).toBe(true);
  });

  test('a wildcard on the required side is a programming error, not a permissive query', () => {
    const owner = ctx([grant(['*:*'])]);
    expect(() => hasPermission(owner, 'project:*')).toThrow(/must be concrete/);
    expect(() => hasPermission(owner, '*:view')).toThrow(/must be concrete/);
  });

  describe('scope', () => {
    test('a project-scoped grant satisfies only within that project', () => {
      const scoped = ctx([grant(['translation:save'], { projectId: 'p1' })]);
      expect(hasPermission(scoped, 'translation:save', { projectId: 'p1' })).toBe(true);
      expect(hasPermission(scoped, 'translation:save', { projectId: 'p2' })).toBe(false);
    });

    test('an unscoped grant (NULL) satisfies any requested scope -- NULL means all', () => {
      const global = ctx([grant(['translation:save'])]);
      expect(hasPermission(global, 'translation:save', { projectId: 'p1', localeCode: 'fr' })).toBe(
        true,
      );
    });

    test('not requesting a dimension ignores that dimension on the grant', () => {
      const scoped = ctx([grant(['settings:update'], { projectId: 'p1', localeCode: 'fr' })]);
      expect(hasPermission(scoped, 'settings:update', { projectId: 'p1' })).toBe(true);
    });

    test('the three dimensions are independent -- one mismatch refuses', () => {
      const scoped = ctx([
        grant(['translation:save'], { workspaceId: 'w1', projectId: 'p1', localeCode: 'fr' }),
      ]);
      const s = { workspaceId: 'w1', projectId: 'p1', localeCode: 'fr' };
      expect(hasPermission(scoped, 'translation:save', s)).toBe(true);
      expect(hasPermission(scoped, 'translation:save', { ...s, workspaceId: 'w2' })).toBe(false);
      expect(hasPermission(scoped, 'translation:save', { ...s, projectId: 'p2' })).toBe(false);
      expect(hasPermission(scoped, 'translation:save', { ...s, localeCode: 'de' })).toBe(false);
    });

    test('scope and permission are ANDed: right project but wrong permission still refuses', () => {
      const scoped = ctx([grant(['translation:view'], { projectId: 'p1' })]);
      expect(hasPermission(scoped, 'translation:save', { projectId: 'p1' })).toBe(false);
    });
  });
});

async function createTestSetup(required: string) {
  const db = await createMigratedTestDb();
  const auth = createAuth({
    db,
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3000',
  });

  const app = new Hono<{ Variables: { authContext: AuthContext | null } }>();
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  app.use('*', createSessionMiddleware(auth, db));
  app.get('/protected', requirePermission(db, required), (c) => c.text('secret stuff'));

  return { db, auth, app };
}

// biome-ignore lint/suspicious/noExplicitAny: only .request() is used; the app's Variables generic is irrelevant here.
async function signUp(app: Hono<any>, email: string): Promise<string> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ada', email, password: 'correct-horse-battery-staple' }),
  });
  return res.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}

async function assignRole(
  // biome-ignore lint/suspicious/noExplicitAny: test-only db handle.
  db: any,
  email: string,
  roleId: string,
): Promise<string> {
  const user = await db
    .selectFrom('user')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('role_assignments')
    .values({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', user_id: user.id, role_id: roleId })
    .execute();
  return user.id;
}

describe('requirePermission (middleware)', () => {
  test('rejects an unauthenticated request with 401', async () => {
    const { app, db } = await createTestSetup('project:create');
    const res = await app.request('/protected');
    expect(res.status).toBe(401);
    await db.destroy();
  });

  test('rejects a signed-in user with no grants with 403', async () => {
    const { app, db } = await createTestSetup('project:create');
    const cookie = await signUp(app, 'ada@example.com');
    const res = await app.request('/protected', { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
    await db.destroy();
  });

  test('allows a user whose role carries the permission (via wildcard)', async () => {
    const { app, db } = await createTestSetup('project:create');
    const cookie = await signUp(app, 'ada@example.com');
    // Admin holds project:* -> covers project:create.
    await assignRole(db, 'ada@example.com', BUILT_IN_ROLE_IDS.admin);
    const res = await app.request('/protected', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('secret stuff');
    await db.destroy();
  });

  test('refuses a role that lacks the permission (Viewer cannot create projects)', async () => {
    const { app, db } = await createTestSetup('project:create');
    const cookie = await signUp(app, 'ada@example.com');
    // Viewer holds project:view, not project:create.
    await assignRole(db, 'ada@example.com', BUILT_IN_ROLE_IDS.viewer);
    const res = await app.request('/protected', { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
    await db.destroy();
  });

  test('rejects a locked user even with the permission (§D4 revoke-everything)', async () => {
    const { app, db } = await createTestSetup('project:create');
    const cookie = await signUp(app, 'ada@example.com');
    const userId = await assignRole(db, 'ada@example.com', BUILT_IN_ROLE_IDS.admin);
    await db.updateTable('user').set({ locked: true }).where('id', '=', userId).execute();
    const res = await app.request('/protected', { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
    await db.destroy();
  });
});
