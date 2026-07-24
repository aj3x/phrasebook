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
    .values([
      { id: WORKSPACE_ID, org_id: ORG_ID, name: 'Marketing' },
      { id: OTHER_WORKSPACE_ID, org_id: ORG_ID, name: 'Engineering' },
    ])
    .execute();

  return { db, app };
}

function extractSessionCookie(res: Response): string {
  return res.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}

interface Scope {
  workspaceId?: string | null;
  projectId?: string | null;
  localeCode?: string | null;
}

async function signUp(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'correct-horse-battery-staple' }),
  });
  return extractSessionCookie(res);
}

async function userId(db: Kysely<Database>, email: string): Promise<string> {
  const row = await db
    .selectFrom('user')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function grant(
  db: Kysely<Database>,
  uid: string,
  roleId: string,
  scope: Scope = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insertInto('role_assignments')
    .values({
      id,
      user_id: uid,
      role_id: roleId,
      workspace_id: scope.workspaceId ?? null,
      project_id: scope.projectId ?? null,
      locale_code: scope.localeCode ?? null,
    })
    .execute();
  return id;
}

/** Signs up `email` and grants it `roleId` at `scope`; returns cookie + id. */
async function actor(
  app: ReturnType<typeof createApp>,
  db: Kysely<Database>,
  email: string,
  roleId: string,
  scope: Scope = {},
): Promise<{ cookie: string; id: string }> {
  const cookie = await signUp(app, email);
  const id = await userId(db, email);
  await grant(db, id, roleId, scope);
  return { cookie, id };
}

function postAssignment(app: ReturnType<typeof createApp>, cookie: string | null, body: unknown) {
  return app.request('/v1/role-assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function deleteAssignment(app: ReturnType<typeof createApp>, cookie: string, id: string) {
  return app.request(`/v1/role-assignments/${id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
}

describe('POST /v1/role-assignments', () => {
  test('rejects an unauthenticated request with 401', async () => {
    const { db, app } = await createTestSetup();
    const target = await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    const res = await postAssignment(app, null, { userId: targetId, role: 'Translator' });
    expect(res.status).toBe(401);
    // keep `target` referenced -- the sign-up is the point (a user to assign to)
    expect(target).toBeString();

    await db.destroy();
  });

  test('an Owner assigns the Admin role to a user', async () => {
    const { db, app } = await createTestSetup();
    const owner = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner);
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    const res = await postAssignment(app, owner.cookie, {
      userId: targetId,
      role: 'Admin',
      workspaceId: WORKSPACE_ID,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { role: string; workspaceId: string };
    expect(body.role).toBe('Admin');
    expect(body.workspaceId).toBe(WORKSPACE_ID);

    await db.destroy();
  });

  test('a workspace-scoped Admin assigns a role within its own workspace', async () => {
    const { db, app } = await createTestSetup();
    const admin = await actor(app, db, 'admin@example.com', BUILT_IN_ROLE_IDS.admin, {
      workspaceId: WORKSPACE_ID,
    });
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    const res = await postAssignment(app, admin.cookie, {
      userId: targetId,
      role: 'Translator',
      workspaceId: WORKSPACE_ID,
    });
    expect(res.status).toBe(201);

    await db.destroy();
  });

  test('a workspace-scoped Admin cannot assign into another workspace (403)', async () => {
    const { db, app } = await createTestSetup();
    const admin = await actor(app, db, 'admin@example.com', BUILT_IN_ROLE_IDS.admin, {
      workspaceId: WORKSPACE_ID,
    });
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    const res = await postAssignment(app, admin.cookie, {
      userId: targetId,
      role: 'Translator',
      workspaceId: OTHER_WORKSPACE_ID,
    });
    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('a workspace-scoped Admin cannot mint an instance-wide (all-workspaces) assignment (403)', async () => {
    const { db, app } = await createTestSetup();
    const admin = await actor(app, db, 'admin@example.com', BUILT_IN_ROLE_IDS.admin, {
      workspaceId: WORKSPACE_ID,
    });
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    // No workspaceId => instance-wide; the Admin's grant is scoped to W, which
    // does not contain "all".
    const res = await postAssignment(app, admin.cookie, {
      userId: targetId,
      role: 'Translator',
    });
    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('an Admin cannot escalate anyone to Owner -- that needs role:* (403)', async () => {
    const { db, app } = await createTestSetup();
    const admin = await actor(app, db, 'admin@example.com', BUILT_IN_ROLE_IDS.admin);
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    const res = await postAssignment(app, admin.cookie, { userId: targetId, role: 'Owner' });
    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('an Owner can assign the Owner role', async () => {
    const { db, app } = await createTestSetup();
    const owner = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner);
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    const res = await postAssignment(app, owner.cookie, { userId: targetId, role: 'Owner' });
    expect(res.status).toBe(201);

    await db.destroy();
  });

  test('a role without role_assignment:create is refused (403)', async () => {
    const { db, app } = await createTestSetup();
    const translator = await actor(app, db, 'tr@example.com', BUILT_IN_ROLE_IDS.translator);
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    const res = await postAssignment(app, translator.cookie, {
      userId: targetId,
      role: 'Viewer',
    });
    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('an unknown role is 400 and an unknown user is 404', async () => {
    const { db, app } = await createTestSetup();
    const owner = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner);
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    const badRole = await postAssignment(app, owner.cookie, {
      userId: targetId,
      role: 'Nonexistent',
    });
    expect(badRole.status).toBe(400);

    const badUser = await postAssignment(app, owner.cookie, {
      userId: 'no-such-user',
      role: 'Viewer',
    });
    expect(badUser.status).toBe(404);

    await db.destroy();
  });

  test('assigning the same role at the same scope twice is 409', async () => {
    const { db, app } = await createTestSetup();
    const owner = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner);
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    const first = await postAssignment(app, owner.cookie, {
      userId: targetId,
      role: 'Viewer',
      workspaceId: WORKSPACE_ID,
    });
    expect(first.status).toBe(201);

    const second = await postAssignment(app, owner.cookie, {
      userId: targetId,
      role: 'Viewer',
      workspaceId: WORKSPACE_ID,
    });
    expect(second.status).toBe(409);

    await db.destroy();
  });

  test('a locked actor is refused even with the permission (403)', async () => {
    const { db, app } = await createTestSetup();
    const owner = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner);
    await db.updateTable('user').set({ locked: true }).where('id', '=', owner.id).execute();
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');

    const res = await postAssignment(app, owner.cookie, { userId: targetId, role: 'Viewer' });
    expect(res.status).toBe(403);

    await db.destroy();
  });
});

describe('DELETE /v1/role-assignments/:id', () => {
  test('an Owner revokes a non-owner assignment', async () => {
    const { db, app } = await createTestSetup();
    const owner = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner);
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');
    const assignmentId = await grant(db, targetId, BUILT_IN_ROLE_IDS.translator, {
      workspaceId: WORKSPACE_ID,
    });

    const res = await deleteAssignment(app, owner.cookie, assignmentId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });

    const gone = await db
      .selectFrom('role_assignments')
      .select('id')
      .where('id', '=', assignmentId)
      .executeTakeFirst();
    expect(gone).toBeUndefined();

    await db.destroy();
  });

  test('the last Owner cannot be demoted -- revoking their Owner grant is 409 (DoD #10)', async () => {
    const { db, app } = await createTestSetup();
    const owner = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner);
    const ownerGrant = await db
      .selectFrom('role_assignments')
      .select('id')
      .where('user_id', '=', owner.id)
      .where('role_id', '=', BUILT_IN_ROLE_IDS.owner)
      .executeTakeFirstOrThrow();

    const res = await deleteAssignment(app, owner.cookie, ownerGrant.id);
    expect(res.status).toBe(409);

    // Still an Owner -- nothing was removed.
    const still = await db
      .selectFrom('role_assignments')
      .select('id')
      .where('id', '=', ownerGrant.id)
      .executeTakeFirst();
    expect(still).toBeDefined();

    await db.destroy();
  });

  test('with two Owners, one may be demoted', async () => {
    const { db, app } = await createTestSetup();
    const owner = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner);
    await signUp(app, 'owner2@example.com');
    const owner2Id = await userId(db, 'owner2@example.com');
    const owner2Grant = await grant(db, owner2Id, BUILT_IN_ROLE_IDS.owner);

    const res = await deleteAssignment(app, owner.cookie, owner2Grant);
    expect(res.status).toBe(200);

    await db.destroy();
  });

  test('an Admin cannot revoke an Owner grant -- that needs role:* (403)', async () => {
    const { db, app } = await createTestSetup();
    const admin = await actor(app, db, 'admin@example.com', BUILT_IN_ROLE_IDS.admin);
    await signUp(app, 'owner@example.com');
    const ownerId = await userId(db, 'owner@example.com');
    const ownerGrant = await grant(db, ownerId, BUILT_IN_ROLE_IDS.owner);

    const res = await deleteAssignment(app, admin.cookie, ownerGrant);
    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('a workspace-scoped Admin cannot revoke an instance-wide assignment (403)', async () => {
    const { db, app } = await createTestSetup();
    const admin = await actor(app, db, 'admin@example.com', BUILT_IN_ROLE_IDS.admin, {
      workspaceId: WORKSPACE_ID,
    });
    await signUp(app, 'target@example.com');
    const targetId = await userId(db, 'target@example.com');
    // Instance-wide (workspace null) Viewer grant -- outside the Admin's reach.
    const instanceWide = await grant(db, targetId, BUILT_IN_ROLE_IDS.viewer);

    const res = await deleteAssignment(app, admin.cookie, instanceWide);
    expect(res.status).toBe(403);

    await db.destroy();
  });

  test('returns 404 for an unknown assignment id', async () => {
    const { db, app } = await createTestSetup();
    const owner = await actor(app, db, 'owner@example.com', BUILT_IN_ROLE_IDS.owner);

    const res = await deleteAssignment(app, owner.cookie, crypto.randomUUID());
    expect(res.status).toBe(404);

    await db.destroy();
  });
});
