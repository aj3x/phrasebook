import { describe, expect, test } from 'bun:test';
import { BUILT_IN_ROLE_IDS, type Database } from '@phrasebook/db';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import type { Kysely } from 'kysely';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { PostgresStore } from '../src/store/postgres';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WORKSPACE_ID = '44444444-4444-4444-4444-444444444444';

/** Creates the org + the single implicit workspace (the M3 shape post-setup). */
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
    .values({ id: WORKSPACE_ID, org_id: ORG_ID, name: 'Marketing' })
    .execute();

  return { db, app };
}

function extractSessionCookie(res: Response): string {
  return res.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}

async function signUp(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'correct-horse-battery-staple' }),
  });
  return extractSessionCookie(res);
}

async function actor(
  app: ReturnType<typeof createApp>,
  db: Kysely<Database>,
  email: string,
  roleId: string,
  workspaceId: string | null,
): Promise<string> {
  const cookie = await signUp(app, email);
  const user = await db
    .selectFrom('user')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('role_assignments')
    .values({
      id: crypto.randomUUID(),
      user_id: user.id,
      role_id: roleId,
      workspace_id: workspaceId,
    })
    .execute();
  return cookie;
}

function postProject(app: ReturnType<typeof createApp>, cookie: string | null, body: unknown) {
  return app.request('/v1/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function localeCodes(db: Kysely<Database>, projectName: string): Promise<string[]> {
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('name', '=', projectName)
    .executeTakeFirstOrThrow();
  const rows = await db
    .selectFrom('locales')
    .select('code')
    .where('project_id', '=', project.id)
    .execute();
  return rows.map((r) => r.code).sort();
}

describe('POST /v1/projects', () => {
  test('rejects an unauthenticated request with 401', async () => {
    const { db, app } = await createTestSetup();

    const res = await postProject(app, null, {
      name: 'Web',
      sourceLocale: 'en',
      targetLocales: ['fr'],
    });
    expect(res.status).toBe(401);

    await db.destroy();
  });

  test('an instance-wide Owner creates a project with source + target locales', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner, null);

    const res = await postProject(app, cookie, {
      name: 'Web',
      sourceLocale: 'en',
      targetLocales: ['fr', 'es'],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; workspaceId: string; locales: string[] };
    expect(body.workspaceId).toBe(WORKSPACE_ID);

    const project = await db
      .selectFrom('projects')
      .selectAll()
      .where('name', '=', 'Web')
      .executeTakeFirstOrThrow();
    expect(project.source_locale).toBe('en');
    expect(project.workspace_id).toBe(WORKSPACE_ID);

    // Source is a locale row too; set = source + targets.
    expect(await localeCodes(db, 'Web')).toEqual(['en', 'es', 'fr']);

    await db.destroy();
  });

  test('a workspace-scoped Admin creates a project in its own workspace', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await actor(app, db, 'admin@example.com', BUILT_IN_ROLE_IDS.admin, WORKSPACE_ID);

    const res = await postProject(app, cookie, {
      name: 'App',
      sourceLocale: 'en',
      targetLocales: ['de'],
      workspaceId: WORKSPACE_ID,
    });
    expect(res.status).toBe(201);

    await db.destroy();
  });

  test('a workspace-scoped Admin cannot create in another workspace (403)', async () => {
    const { db, app } = await createTestSetup();
    await db
      .insertInto('workspaces')
      .values({ id: OTHER_WORKSPACE_ID, org_id: ORG_ID, name: 'Engineering' })
      .execute();
    const cookie = await actor(app, db, 'admin@example.com', BUILT_IN_ROLE_IDS.admin, WORKSPACE_ID);

    const res = await postProject(app, cookie, {
      name: 'App',
      sourceLocale: 'en',
      targetLocales: ['de'],
      workspaceId: OTHER_WORKSPACE_ID,
    });
    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('a role without project:create is refused (403)', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await actor(
      app,
      db,
      'tr@example.com',
      BUILT_IN_ROLE_IDS.translator,
      WORKSPACE_ID,
    );

    const res = await postProject(app, cookie, {
      name: 'Web',
      sourceLocale: 'en',
      targetLocales: ['fr'],
    });
    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('deduplicates the source and repeated target locales into one row each', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner, null);

    const res = await postProject(app, cookie, {
      name: 'Web',
      sourceLocale: 'en',
      targetLocales: ['fr', 'fr', 'en'],
    });
    expect(res.status).toBe(201);
    expect(await localeCodes(db, 'Web')).toEqual(['en', 'fr']);

    await db.destroy();
  });

  test('rejects a duplicate project name with 409', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner, null);

    const first = await postProject(app, cookie, {
      name: 'Web',
      sourceLocale: 'en',
      targetLocales: ['fr'],
    });
    expect(first.status).toBe(201);

    const second = await postProject(app, cookie, {
      name: 'Web',
      sourceLocale: 'en',
      targetLocales: ['de'],
    });
    expect(second.status).toBe(409);

    await db.destroy();
  });

  test('returns 404 for an unknown workspaceId', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner, null);

    const res = await postProject(app, cookie, {
      name: 'Web',
      sourceLocale: 'en',
      targetLocales: ['fr'],
      workspaceId: '00000000-0000-0000-0000-0000000000ff',
    });
    expect(res.status).toBe(404);

    await db.destroy();
  });

  test.each([
    ['missing name', { sourceLocale: 'en', targetLocales: ['fr'] }],
    ['blank name', { name: '  ', sourceLocale: 'en', targetLocales: ['fr'] }],
    ['invalid source locale', { name: 'Web', sourceLocale: 'zz', targetLocales: ['fr'] }],
    ['non-canonical source', { name: 'Web', sourceLocale: 'EN', targetLocales: ['fr'] }],
    ['invalid target locale', { name: 'Web', sourceLocale: 'en', targetLocales: ['fr', 'zz'] }],
    ['targetLocales not an array', { name: 'Web', sourceLocale: 'en', targetLocales: 'fr' }],
  ])('rejects %s with 400 and creates nothing', async (_label, body) => {
    const { db, app } = await createTestSetup();
    const cookie = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner, null);

    const res = await postProject(app, cookie, body);
    expect(res.status).toBe(400);

    const projects = await db.selectFrom('projects').select('id').execute();
    expect(projects).toHaveLength(0);

    await db.destroy();
  });
});
