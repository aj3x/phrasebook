import { describe, expect, test } from 'bun:test';
import { BUILT_IN_ROLE_IDS, type Database } from '@phrasebook/db';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import type { Kysely } from 'kysely';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { PostgresStore } from '../src/store/postgres';

async function createTestSetup() {
  const db = await createMigratedTestDb();
  const auth = createAuth({
    db,
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3000',
  });
  const app = createApp(new PostgresStore(db), auth, db);
  return { db, app };
}

function extractSessionCookie(res: Response): string {
  return res.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}

function postSetup(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request('/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID = {
  ownerEmail: 'owner@example.com',
  password: 'correct-horse-battery-staple',
  ownerName: 'Ada',
  orgName: 'Acme',
};

async function ownerCount(db: Kysely<Database>): Promise<number> {
  const rows = await db
    .selectFrom('role_assignments')
    .select('id')
    .where('role_id', '=', BUILT_IN_ROLE_IDS.owner)
    .execute();
  return rows.length;
}

describe('POST /v1/setup', () => {
  test('bootstraps owner + org + workspace and signs the owner in', async () => {
    const { db, app } = await createTestSetup();

    const res = await postSetup(app, VALID);
    expect(res.status).toBe(201);
    expect(res.headers.get('Set-Cookie')).toBeTruthy();

    // A user was created through better-auth (real hashing path): they can
    // sign in with the password they set.
    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: VALID.ownerEmail, password: VALID.password }),
    });
    expect(signIn.status).toBe(200);

    // Owner role, org, workspace, and the singleton row all exist.
    const user = await db
      .selectFrom('user')
      .select('id')
      .where('email', '=', VALID.ownerEmail)
      .executeTakeFirstOrThrow();
    const owner = await db
      .selectFrom('role_assignments')
      .selectAll()
      .where('user_id', '=', user.id)
      .where('role_id', '=', BUILT_IN_ROLE_IDS.owner)
      .executeTakeFirstOrThrow();
    // Instance-wide Owner: every scope dimension NULL.
    expect(owner.workspace_id).toBeNull();
    expect(owner.project_id).toBeNull();
    expect(owner.locale_code).toBeNull();

    const org = await db.selectFrom('organizations').select('name').executeTakeFirstOrThrow();
    expect(org.name).toBe('Acme');

    const workspace = await db.selectFrom('workspaces').select('id').executeTakeFirst();
    expect(workspace).toBeDefined();

    const singleton = await db.selectFrom('instance_setup').selectAll().execute();
    expect(singleton).toHaveLength(1);

    await db.destroy();
  });

  test('the returned session cookie authenticates the owner', async () => {
    const { db, app } = await createTestSetup();

    const res = await postSetup(app, VALID);
    const cookie = extractSessionCookie(res);
    expect(cookie).not.toBe('');

    // The Owner is instance-wide, so the (empty) project list resolves 200
    // rather than 401 -- proving the cookie carries a real session.
    const projects = await app.request('/v1/projects', { headers: { Cookie: cookie } });
    expect(projects.status).toBe(200);

    await db.destroy();
  });

  test('flips needsSetup to false', async () => {
    const { db, app } = await createTestSetup();

    await postSetup(app, VALID);

    const status = await app.request('/v1/setup/status');
    expect(await status.json()).toEqual({ needsSetup: false });

    await db.destroy();
  });

  test('rejects a second setup once an owner exists (409)', async () => {
    const { db, app } = await createTestSetup();

    const first = await postSetup(app, VALID);
    expect(first.status).toBe(201);

    const second = await postSetup(app, {
      ...VALID,
      ownerEmail: 'other@example.com',
      orgName: 'Beta',
    });
    expect(second.status).toBe(409);

    // Nothing from the second attempt landed.
    expect(await ownerCount(db)).toBe(1);
    const orgs = await db.selectFrom('organizations').select('name').execute();
    expect(orgs).toHaveLength(1);

    await db.destroy();
  });

  test('two concurrent setups cannot both create an owner (DoD #6)', async () => {
    const { db, app } = await createTestSetup();

    const [a, b] = await Promise.all([
      postSetup(app, { ...VALID, ownerEmail: 'a@example.com', orgName: 'A' }),
      postSetup(app, { ...VALID, ownerEmail: 'b@example.com', orgName: 'B' }),
    ]);

    // One wins, one loses on the singleton's fixed primary key.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    // The security invariant: exactly one Owner and one bootstrap row exist --
    // the DB-level singleton, not check-then-insert, made that true. (In
    // production the loser's transaction also rolls back its org/workspace;
    // pg-mem's Kysely adapter doesn't emulate rollback, so we don't assert org
    // count here -- the observable single-Owner/single-singleton invariant is
    // what proves the guard held.)
    expect(await ownerCount(db)).toBe(1);
    const singleton = await db.selectFrom('instance_setup').select('id').execute();
    expect(singleton).toHaveLength(1);

    await db.destroy();
  });

  test.each([
    ['missing ownerEmail', { ...VALID, ownerEmail: undefined }],
    ['malformed ownerEmail', { ...VALID, ownerEmail: 'not-an-email' }],
    ['missing orgName', { ...VALID, orgName: undefined }],
    ['blank orgName', { ...VALID, orgName: '   ' }],
    ['missing password', { ...VALID, password: undefined }],
    ['too-short password', { ...VALID, password: 'short' }],
  ])('rejects %s with 400 and creates nothing', async (_label, body) => {
    const { db, app } = await createTestSetup();

    const res = await postSetup(app, body);
    expect(res.status).toBe(400);

    expect(await ownerCount(db)).toBe(0);
    const orgs = await db.selectFrom('organizations').select('id').execute();
    expect(orgs).toHaveLength(0);

    await db.destroy();
  });
});
