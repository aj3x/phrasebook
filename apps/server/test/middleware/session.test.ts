import { describe, expect, test } from 'bun:test';
import { BUILT_IN_ROLE_IDS } from '@phrasebook/db';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { Hono } from 'hono';
import { createAuth } from '../../src/auth';
import type { AuthContext } from '../../src/middleware/session';
import { createSessionMiddleware } from '../../src/middleware/session';

async function createTestSetup() {
  const db = await createMigratedTestDb();
  const auth = createAuth({
    db,
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3000',
  });

  const app = new Hono<{ Variables: { authContext: AuthContext | null } }>();
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  app.use('*', createSessionMiddleware(auth, db));
  app.get('/whoami', (c) => c.json(c.get('authContext')));

  return { db, auth, app };
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  // Only need the cookie's name=value pair for the follow-up request, not
  // the Set-Cookie attributes (Path, HttpOnly, etc).
  return setCookie.split(';')[0] ?? '';
}

describe('session middleware', () => {
  test('sets authContext to null when there is no session cookie', async () => {
    const { app, db } = await createTestSetup();

    const res = await app.request('/whoami');

    expect(await res.json()).toBeNull();

    await db.destroy();
  });

  test('resolves userId and an empty roles list for a signed-in user with no role assignments', async () => {
    const { app, db } = await createTestSetup();

    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
      }),
    });
    const cookie = extractSessionCookie(signUpRes);

    const res = await app.request('/whoami', { headers: { Cookie: cookie } });
    const authContext = (await res.json()) as AuthContext;

    expect(authContext.userId).toBeTruthy();
    expect(authContext.roles).toEqual([]);

    await db.destroy();
  });

  test("resolves a user's role assignments, including scope", async () => {
    const { app, db } = await createTestSetup();

    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
      }),
    });
    const cookie = extractSessionCookie(signUpRes);

    const user = await db
      .selectFrom('user')
      .select('id')
      .where('email', '=', 'ada@example.com')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('role_assignments')
      .values({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        user_id: user.id,
        role_id: BUILT_IN_ROLE_IDS.admin,
      })
      .execute();

    const res = await app.request('/whoami', { headers: { Cookie: cookie } });
    const authContext = (await res.json()) as AuthContext;

    expect(authContext.userId).toBe(user.id);
    expect(authContext.roles).toHaveLength(1);

    const grant = authContext.roles[0];
    if (!grant) throw new Error('expected one grant');
    expect(grant.role).toBe('Admin');
    expect(grant.workspaceId).toBeNull();
    expect(grant.projectId).toBeNull();
    expect(grant.localeCode).toBeNull();

    // The grant carries Admin's seeded permission patterns (migration 0014),
    // so downstream requirePermission checks never re-query the DB.
    const patterns = grant.permissions.map((p) => `${p.resource}:${p.action}`).sort();
    expect(patterns).toEqual(
      [
        'project:*',
        'namespace:*',
        'key:*',
        'locale:*',
        'translation:*',
        'comment:*',
        'settings:*',
        'user:*',
        'invite:*',
        'role_assignment:*',
        'workspace:view',
      ].sort(),
    );

    await db.destroy();
  });

  test('a user with two different roles carries each role own permissions on its grant', async () => {
    const { app, db } = await createTestSetup();

    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
      }),
    });
    const cookie = extractSessionCookie(signUpRes);

    const user = await db
      .selectFrom('user')
      .select('id')
      .where('email', '=', 'ada@example.com')
      .executeTakeFirstOrThrow();

    // Two distinct roles -- proves permissions are keyed per role_id and
    // each grant gets its own role's patterns, not a merged or first-wins set.
    await db
      .insertInto('role_assignments')
      .values([
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          user_id: user.id,
          role_id: BUILT_IN_ROLE_IDS.viewer,
        },
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          user_id: user.id,
          role_id: BUILT_IN_ROLE_IDS.translator,
        },
      ])
      .execute();

    const res = await app.request('/whoami', { headers: { Cookie: cookie } });
    const authContext = (await res.json()) as AuthContext;

    expect(authContext.roles).toHaveLength(2);

    const byRole = new Map(
      authContext.roles.map((g) => [
        g.role,
        g.permissions.map((p) => `${p.resource}:${p.action}`).sort(),
      ]),
    );
    expect(byRole.get('Viewer')).toEqual(
      ['project:view', 'key:view', 'locale:view', 'translation:view', 'comment:view'].sort(),
    );
    expect(byRole.get('Translator')).toEqual(
      [
        'project:view',
        'key:view',
        'locale:view',
        'translation:view',
        'translation:save',
        'comment:view',
        'comment:create',
      ].sort(),
    );

    await db.destroy();
  });
});
