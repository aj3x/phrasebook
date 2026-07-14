import { describe, expect, test } from 'bun:test';
import { BUILT_IN_ROLE_IDS } from '@phrasebook/db';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { Hono } from 'hono';
import { createAuth } from '../../src/auth';
import { requireRole } from '../../src/middleware/require-role';
import type { AuthContext } from '../../src/middleware/session';
import { createSessionMiddleware } from '../../src/middleware/session';

async function createTestSetup(roleNames: string[]) {
  const db = await createMigratedTestDb();
  const auth = createAuth({
    db,
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3000',
  });

  const app = new Hono<{ Variables: { authContext: AuthContext | null } }>();
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  app.use('*', createSessionMiddleware(auth, db));
  app.get('/protected', requireRole(db, roleNames), (c) => c.text('secret stuff'));

  return { db, auth, app };
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  return setCookie.split(';')[0] ?? '';
}

// biome-ignore lint/suspicious/noExplicitAny: only .request() is used here; the app's specific Variables generic doesn't matter to this helper.
async function signUp(app: Hono<any>, email: string): Promise<string> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ada', email, password: 'correct-horse-battery-staple' }),
  });
  return extractSessionCookie(res);
}

describe('requireRole', () => {
  test('rejects an unauthenticated request with 401', async () => {
    const { app, db } = await createTestSetup(['Admin']);

    const res = await app.request('/protected');

    expect(res.status).toBe(401);

    await db.destroy();
  });

  test('rejects a signed-in user with no matching role with 403', async () => {
    const { app, db } = await createTestSetup(['Admin']);
    const cookie = await signUp(app, 'ada@example.com');

    const res = await app.request('/protected', { headers: { Cookie: cookie } });

    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('allows a signed-in user with a matching role', async () => {
    const { app, db } = await createTestSetup(['Admin']);
    const cookie = await signUp(app, 'ada@example.com');

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

    const res = await app.request('/protected', { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('secret stuff');

    await db.destroy();
  });

  test('additive-only: matches if the user has ANY of the required roles', async () => {
    const { app, db } = await createTestSetup(['Admin', 'Developer']);
    const cookie = await signUp(app, 'ada@example.com');

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
        role_id: BUILT_IN_ROLE_IDS.developer,
      })
      .execute();

    const res = await app.request('/protected', { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);

    await db.destroy();
  });

  test('rejects a locked user even with a matching role (§D4 revoke-everything)', async () => {
    const { app, db } = await createTestSetup(['Admin']);
    const cookie = await signUp(app, 'ada@example.com');

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
    await db.updateTable('user').set({ locked: true }).where('id', '=', user.id).execute();

    const res = await app.request('/protected', { headers: { Cookie: cookie } });

    expect(res.status).toBe(403);

    await db.destroy();
  });
});
