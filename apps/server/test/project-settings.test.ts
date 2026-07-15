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

function patchAutoApprove(app: ReturnType<typeof createApp>, cookie: string | null, body: unknown) {
  return app.request('/v1/projects/demo/settings', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH /v1/projects/:project/settings', () => {
  test('rejects an unauthenticated request with 401', async () => {
    const { db, app } = await createTestSetup();

    const res = await patchAutoApprove(app, null, { autoApprove: false });

    expect(res.status).toBe(401);

    await db.destroy();
  });

  test('returns 404 for an unknown project', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'admin@example.com',
      BUILT_IN_ROLE_IDS.admin,
      null,
    );

    const res = await app.request('/v1/projects/no-such/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ autoApprove: false }),
    });

    expect(res.status).toBe(404);

    await db.destroy();
  });

  test('rejects a Translator (not a project manager) with 403', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'ada@example.com',
      BUILT_IN_ROLE_IDS.translator,
      PROJECT_ID,
    );

    const res = await patchAutoApprove(app, cookie, { autoApprove: false });

    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('rejects an admin scoped to a different project with 403', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'otheradmin@example.com',
      BUILT_IN_ROLE_IDS.admin,
      OTHER_PROJECT_ID,
    );

    const res = await patchAutoApprove(app, cookie, { autoApprove: false });

    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('rejects a request with a non-boolean autoApprove with 400', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'admin@example.com',
      BUILT_IN_ROLE_IDS.admin,
      null,
    );

    const res = await patchAutoApprove(app, cookie, { autoApprove: 'nope' });

    expect(res.status).toBe(400);

    await db.destroy();
  });

  test('an instance-wide admin turns auto-approve off, reflected in the project detail', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'admin@example.com',
      BUILT_IN_ROLE_IDS.admin,
      null,
    );

    const res = await patchAutoApprove(app, cookie, { autoApprove: false });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ autoApprove: false });

    const detailRes = await app.request('/v1/projects/demo', { headers: { Cookie: cookie } });
    const detail = (await detailRes.json()) as { autoApprove: boolean };
    expect(detail.autoApprove).toBe(false);

    await db.destroy();
  });

  test('a Developer scoped to the project can toggle it', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'dev@example.com',
      BUILT_IN_ROLE_IDS.developer,
      PROJECT_ID,
    );

    const res = await patchAutoApprove(app, cookie, { autoApprove: false });

    expect(res.status).toBe(200);

    await db.destroy();
  });
});
