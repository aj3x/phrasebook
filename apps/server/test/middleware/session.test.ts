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
    expect(authContext.roles).toEqual([{ role: 'Admin', workspaceId: null, projectId: null, localeCode: null }]);

    await db.destroy();
  });
});
