import { describe, expect, test } from 'bun:test';
import { BUILT_IN_ROLE_IDS } from '@phrasebook/db';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { PostgresStore } from '../src/store/postgres';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_PROJECT_ID = '99999999-9999-9999-9999-999999999999';
const LOCALE_ID = '44444444-4444-4444-4444-444444444444';
const NAMESPACE_ID = '66666666-6666-6666-6666-666666666666';
const KEY_ID = '88888888-8888-8888-8888-888888888888';

const KEYS_PATH = '/v1/projects/demo/keys?namespace=common&locale=fr';

async function createTestSetup() {
  const db = await createMigratedTestDb();
  const auth = createAuth({
    db,
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3000',
  });
  const app = createApp(new PostgresStore(db), auth, db);

  await db.insertInto('organizations').values({ id: ORG_ID, name: 'Acme' }).execute();
  await db
    .insertInto('workspaces')
    .values({ id: WORKSPACE_ID, org_id: ORG_ID, name: 'Acme Marketing' })
    .execute();
  await db
    .insertInto('projects')
    .values({ id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'demo', source_locale: 'en' })
    .execute();
  await db
    .insertInto('projects')
    .values({
      id: OTHER_PROJECT_ID,
      workspace_id: WORKSPACE_ID,
      name: 'other',
      source_locale: 'en',
    })
    .execute();
  await db
    .insertInto('locales')
    .values({ id: LOCALE_ID, project_id: PROJECT_ID, code: 'fr' })
    .execute();
  await db
    .insertInto('namespaces')
    .values({ id: NAMESPACE_ID, project_id: PROJECT_ID, name: 'common', authority: 'code' })
    .execute();
  await db
    .insertInto('keys')
    .values({
      id: KEY_ID,
      namespace_id: NAMESPACE_ID,
      name: 'home.hero.title',
      source_text: 'Welcome',
      source_hash: 'deadbeef',
    })
    .execute();

  return { db, app };
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  return setCookie.split(';')[0] ?? '';
}

async function signUpWithRole(
  app: ReturnType<typeof createApp>,
  db: Awaited<ReturnType<typeof createTestSetup>>['db'],
  email: string,
  roleId: string,
  projectId: string | null,
): Promise<string> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'correct-horse-battery-staple' }),
  });
  const cookie = extractSessionCookie(res);

  const user = await db
    .selectFrom('user')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('role_assignments')
    .values({ id: crypto.randomUUID(), user_id: user.id, role_id: roleId, project_id: projectId })
    .execute();

  return cookie;
}

describe('GET /v1/projects/:project/keys', () => {
  test('rejects an unauthenticated request with 401', async () => {
    const { db, app } = await createTestSetup();

    const res = await app.request(KEYS_PATH);

    expect(res.status).toBe(401);

    await db.destroy();
  });

  test('rejects a user scoped to a different project with 403', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'ada@example.com',
      BUILT_IN_ROLE_IDS.translator,
      OTHER_PROJECT_ID,
    );

    const res = await app.request(KEYS_PATH, { headers: { Cookie: cookie } });

    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('rejects a request missing the namespace/locale query params with 400', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'ada@example.com',
      BUILT_IN_ROLE_IDS.translator,
      PROJECT_ID,
    );

    const res = await app.request('/v1/projects/demo/keys', { headers: { Cookie: cookie } });

    expect(res.status).toBe(400);

    await db.destroy();
  });

  test('returns every key in the namespace, including untranslated ones', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'ada@example.com',
      BUILT_IN_ROLE_IDS.translator,
      PROJECT_ID,
    );

    const res = await app.request(KEYS_PATH, { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      keys: [
        { key: 'home.hero.title', sourceText: 'Welcome', targetText: '', status: 'untranslated' },
      ],
    });

    await db.destroy();
  });

  test('filters by status via the query param', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'ada@example.com',
      BUILT_IN_ROLE_IDS.translator,
      PROJECT_ID,
    );

    const res = await app.request(`${KEYS_PATH}&status=approved`, {
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keys: [] });

    await db.destroy();
  });

  test('returns 404 for an unknown namespace', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'ada@example.com',
      BUILT_IN_ROLE_IDS.translator,
      PROJECT_ID,
    );

    const res = await app.request('/v1/projects/demo/keys?namespace=no-such&locale=fr', {
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(404);

    await db.destroy();
  });
});
