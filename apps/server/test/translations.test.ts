import { describe, expect, test } from 'bun:test';
import { BUILT_IN_ROLE_IDS } from '@phrasebook/db';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { PostgresStore } from '../src/store/postgres';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const LOCALE_ID = '44444444-4444-4444-4444-444444444444';
const NAMESPACE_ID = '66666666-6666-6666-6666-666666666666';
const KEY_ID = '88888888-8888-8888-8888-888888888888';
const TRANSLATION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_PROJECT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const REF_PATH = '/v1/projects/demo/translations/common/fr/home.hero.title';

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
      id: TRANSLATION_ID,
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
  scope: { projectId?: string; localeCode?: string } = {},
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
    .values({
      id: crypto.randomUUID(),
      user_id: user.id,
      role_id: roleId,
      project_id: scope.projectId ?? null,
      locale_code: scope.localeCode ?? null,
    })
    .execute();

  return cookie;
}

describe('PUT /v1/projects/:project/translations/:namespace/:locale/:key', () => {
  test('a translator can save a translation; auto-approve (the default) sends it straight to approved', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator);

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ targetText: 'Bienvenue' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'approved' });

    await db.destroy();
  });

  test('rejects an unauthenticated save with 401', async () => {
    const { db, app } = await createTestSetup();

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetText: 'Bienvenue' }),
    });

    expect(res.status).toBe(401);

    await db.destroy();
  });

  test('rejects a Viewer-role save with 403', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(app, db, 'viewer@example.com', BUILT_IN_ROLE_IDS.viewer);

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ targetText: 'Bienvenue' }),
    });

    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('rejects a save missing targetText with 400', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator);

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);

    await db.destroy();
  });

  test('rejects a stale save (D22) with 409 and the currently stored value', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'approved');
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator);

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        originalText: 'a stale snapshot from before someone else edited it',
        targetText: 'my conflicting edit',
      }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', currentText: 'Bienvenue' });

    await db.destroy();
  });

  test('a resubmit of the currently stored value (idempotent double-save) succeeds', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'approved');
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator);

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        originalText: 'a stale snapshot',
        targetText: 'Bienvenue',
      }),
    });

    expect(res.status).toBe(200);

    await db.destroy();
  });

  test('a first save (no row yet) with matching originalText="" succeeds', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator);

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ originalText: '', targetText: 'Bienvenue' }),
    });

    expect(res.status).toBe(200);

    await db.destroy();
  });

  test('a first save (no row yet) with a stale non-empty originalText is 409', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator);

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        originalText: 'something the client thought was there',
        targetText: 'my new text',
      }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', currentText: '' });

    await db.destroy();
  });
});

describe('POST .../claim', () => {
  test('a reviewer claims an unclaimed needs_review translation', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'needs_review');
    const cookie = await signUpWithRole(app, db, 'rex@example.com', BUILT_IN_ROLE_IDS.reviewer);

    const res = await app.request(`${REF_PATH}/claim`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'in_review' });

    await db.destroy();
  });

  test('rejects a Translator-role claim with 403 (claiming is a reviewer action)', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'needs_review');
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator);

    const res = await app.request(`${REF_PATH}/claim`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(403);

    await db.destroy();
  });
});

describe('POST .../approve', () => {
  test('a reviewer approves a claimed translation', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'in_review');
    const cookie = await signUpWithRole(app, db, 'rex@example.com', BUILT_IN_ROLE_IDS.reviewer);

    const res = await app.request(`${REF_PATH}/approve`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'approved' });

    await db.destroy();
  });

  test('rejects approving a translation that was never claimed with 409', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'needs_review');
    const cookie = await signUpWithRole(app, db, 'rex@example.com', BUILT_IN_ROLE_IDS.reviewer);

    const res = await app.request(`${REF_PATH}/approve`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(409);

    await db.destroy();
  });
});

describe('POST .../send-back', () => {
  test('a reviewer sends a claimed translation back to needs_review with a comment', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'in_review');
    const cookie = await signUpWithRole(app, db, 'rex@example.com', BUILT_IN_ROLE_IDS.reviewer);

    const res = await app.request(`${REF_PATH}/send-back`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ comment: 'Please fix the tone here.' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'needs_review' });

    await db.destroy();
  });

  test('rejects a send-back with no comment field with 400', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'in_review');
    const cookie = await signUpWithRole(app, db, 'rex@example.com', BUILT_IN_ROLE_IDS.reviewer);

    const res = await app.request(`${REF_PATH}/send-back`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);

    await db.destroy();
  });

  test('rejects a send-back with an empty comment with 409', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'in_review');
    const cookie = await signUpWithRole(app, db, 'rex@example.com', BUILT_IN_ROLE_IDS.reviewer);

    const res = await app.request(`${REF_PATH}/send-back`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ comment: '' }),
    });

    expect(res.status).toBe(409);

    await db.destroy();
  });
});

describe('write endpoint scope enforcement (H1)', () => {
  test('a translator scoped to the exact project and locale can save', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator, {
      projectId: PROJECT_ID,
      localeCode: 'fr',
    });

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ targetText: 'Bienvenue' }),
    });

    expect(res.status).toBe(200);

    await db.destroy();
  });

  test('a translator scoped to a different project gets 403', async () => {
    const { db, app } = await createTestSetup();
    await db
      .insertInto('projects')
      .values({
        id: OTHER_PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        name: 'other',
        source_locale: 'en',
      })
      .execute();
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator, {
      projectId: OTHER_PROJECT_ID,
    });

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ targetText: 'Bienvenue' }),
    });

    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('a translator scoped to the right project but a different locale gets 403', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator, {
      projectId: PROJECT_ID,
      localeCode: 'de',
    });

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ targetText: 'Bienvenue' }),
    });

    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('a project-only-scoped translator (NULL locale) can save any locale in the project', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator, {
      projectId: PROJECT_ID,
    });

    const res = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ targetText: 'Bienvenue' }),
    });

    expect(res.status).toBe(200);

    await db.destroy();
  });

  test('a reviewer scoped to a different project gets 403 on POST .../claim', async () => {
    const { db, app } = await createTestSetup();
    await seedTranslation(db, 'needs_review');
    await db
      .insertInto('projects')
      .values({
        id: OTHER_PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        name: 'other',
        source_locale: 'en',
      })
      .execute();
    const cookie = await signUpWithRole(app, db, 'rex@example.com', BUILT_IN_ROLE_IDS.reviewer, {
      projectId: OTHER_PROJECT_ID,
    });

    const res = await app.request(`${REF_PATH}/claim`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('an unknown project on a write endpoint returns 404', async () => {
    const { db, app } = await createTestSetup();
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator);

    const res = await app.request(
      '/v1/projects/does-not-exist/translations/common/fr/home.hero.title',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ targetText: 'Bienvenue' }),
      },
    );

    expect(res.status).toBe(404);

    await db.destroy();
  });
});

describe('approve separation-of-duties (H3)', () => {
  async function setAutoApproveOff(db: Awaited<ReturnType<typeof createTestSetup>>['db']) {
    await db
      .updateTable('projects')
      .set({ auto_approve: false })
      .where('id', '=', PROJECT_ID)
      .execute();
  }

  test('the user who saved a translation cannot approve their own edit (403)', async () => {
    const { db, app } = await createTestSetup();
    await setAutoApproveOff(db);
    // Ada holds both Translator (to save) and Reviewer (would otherwise let her approve) grants.
    const cookie = await signUpWithRole(app, db, 'ada@example.com', BUILT_IN_ROLE_IDS.translator);
    const ada = await db
      .selectFrom('user')
      .select('id')
      .where('email', '=', 'ada@example.com')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('role_assignments')
      .values({
        id: crypto.randomUUID(),
        user_id: ada.id,
        role_id: BUILT_IN_ROLE_IDS.reviewer,
        project_id: null,
        locale_code: null,
      })
      .execute();

    const saveRes = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ targetText: 'Bienvenue' }),
    });
    expect(saveRes.status).toBe(200);
    expect(await saveRes.json()).toEqual({ status: 'needs_review' });

    const claimRes = await app.request(`${REF_PATH}/claim`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(claimRes.status).toBe(200);

    const approveRes = await app.request(`${REF_PATH}/approve`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(approveRes.status).toBe(403);

    await db.destroy();
  });

  test('a different reviewer can approve the same translation', async () => {
    const { db, app } = await createTestSetup();
    await setAutoApproveOff(db);
    const adaCookie = await signUpWithRole(
      app,
      db,
      'ada@example.com',
      BUILT_IN_ROLE_IDS.translator,
    );
    const rexCookie = await signUpWithRole(
      app,
      db,
      'rex@example.com',
      BUILT_IN_ROLE_IDS.reviewer,
    );

    const saveRes = await app.request(REF_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adaCookie },
      body: JSON.stringify({ targetText: 'Bienvenue' }),
    });
    expect(saveRes.status).toBe(200);

    await app.request(`${REF_PATH}/claim`, {
      method: 'POST',
      headers: { Cookie: rexCookie },
    });

    const approveRes = await app.request(`${REF_PATH}/approve`, {
      method: 'POST',
      headers: { Cookie: rexCookie },
    });
    expect(approveRes.status).toBe(200);
    expect(await approveRes.json()).toEqual({ status: 'approved' });

    await db.destroy();
  });
});
