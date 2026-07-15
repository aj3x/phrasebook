import { describe, expect, test } from 'bun:test';
import { BUILT_IN_ROLE_IDS } from '@phrasebook/db';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { PostgresStore } from '../src/store/postgres';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_PROJECT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const LOCALE_ID = '44444444-4444-4444-4444-444444444444';
const NAMESPACE_ID = '66666666-6666-6666-6666-666666666666';
const KEY_ID = '88888888-8888-8888-8888-888888888888';

const COMMENTS_PATH = '/v1/projects/demo/comments/common/fr/home.hero.title';
const SEND_BACK_PATH = '/v1/projects/demo/translations/common/fr/home.hero.title/send-back';

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

async function seedTranslation(
  db: Awaited<ReturnType<typeof createTestSetup>>['db'],
  status: string,
) {
  await db
    .insertInto('translations')
    .values({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      key_id: KEY_ID,
      locale_id: LOCALE_ID,
      target_text: 'Bienvenue',
      status,
    })
    .execute();
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

interface CommentsResponse {
  comments: { id: string; body: string; authorEmail: string | null; createdAt: string }[];
}

describe('GET /v1/projects/:project/comments/:namespace/:locale/:key', () => {
  test('rejects an unauthenticated request with 401', async () => {
    const { db, app } = await createTestSetup();

    const res = await app.request(COMMENTS_PATH);

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

    const res = await app.request(COMMENTS_PATH, { headers: { Cookie: cookie } });

    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('returns an empty thread when there are no comments yet', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'viewer@example.com',
      BUILT_IN_ROLE_IDS.viewer,
      PROJECT_ID,
    );

    const res = await app.request(COMMENTS_PATH, { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    expect((await res.json()) as CommentsResponse).toEqual({ comments: [] });

    await db.destroy();
  });
});

describe('POST /v1/projects/:project/comments/:namespace/:locale/:key', () => {
  test('rejects an unauthenticated request with 401', async () => {
    const { db, app } = await createTestSetup();

    const res = await app.request(COMMENTS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hi' }),
    });

    expect(res.status).toBe(401);

    await db.destroy();
  });

  test('rejects an empty body with 400', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'ada@example.com',
      BUILT_IN_ROLE_IDS.translator,
      PROJECT_ID,
    );

    const res = await app.request(COMMENTS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ body: '   ' }),
    });

    expect(res.status).toBe(400);

    await db.destroy();
  });

  test('rejects a Viewer (read-only) with 403', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'viewer@example.com',
      BUILT_IN_ROLE_IDS.viewer,
      PROJECT_ID,
    );

    const res = await app.request(COMMENTS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ body: 'a comment' }),
    });

    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('a translator adds a comment, then it appears in the thread with their email', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(
      app,
      db,
      'ada@example.com',
      BUILT_IN_ROLE_IDS.translator,
      PROJECT_ID,
    );

    const postRes = await app.request(COMMENTS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ body: 'Formal or informal here?' }),
    });
    expect(postRes.status).toBe(201);

    const listRes = await app.request(COMMENTS_PATH, { headers: { Cookie: cookie } });
    const body = (await listRes.json()) as CommentsResponse;
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]?.body).toBe('Formal or informal here?');
    expect(body.comments[0]?.authorEmail).toBe('ada@example.com');
  });
});

describe('send-back comment appears in the thread (M2 step 11 outcome)', () => {
  test('a reviewer send-back records a comment visible via the thread endpoint', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'in_review');
    const cookie = await signUpWithRole(
      app,
      db,
      'rex@example.com',
      BUILT_IN_ROLE_IDS.reviewer,
      PROJECT_ID,
    );

    const sendBackRes = await app.request(SEND_BACK_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ comment: 'Please use the informal register.' }),
    });
    expect(sendBackRes.status).toBe(200);

    const listRes = await app.request(COMMENTS_PATH, { headers: { Cookie: cookie } });
    const body = (await listRes.json()) as CommentsResponse;
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]?.body).toBe('Please use the informal register.');
    expect(body.comments[0]?.authorEmail).toBe('rex@example.com');
  });
});
