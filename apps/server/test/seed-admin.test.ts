import { describe, expect, test } from 'bun:test';
import { BUILT_IN_ROLE_IDS } from '@phrasebook/db';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD, seedAdminUser } from '../src/seed';
import { PostgresStore } from '../src/store/postgres';

async function createTestSetup() {
  const db = await createMigratedTestDb();
  const auth = createAuth({
    db,
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3000',
  });
  const app = createApp(new PostgresStore(db), auth, db);
  return { db, auth, app };
}

describe('seedAdminUser', () => {
  test('creates a user with the Admin role', async () => {
    const { db, auth } = await createTestSetup();

    await seedAdminUser(auth, db);

    const user = await db
      .selectFrom('user')
      .selectAll()
      .where('email', '=', DEV_ADMIN_EMAIL)
      .executeTakeFirstOrThrow();

    const assignment = await db
      .selectFrom('role_assignments')
      .selectAll()
      .where('user_id', '=', user.id)
      .where('role_id', '=', BUILT_IN_ROLE_IDS.admin)
      .executeTakeFirstOrThrow();

    expect(assignment.project_id).toBeNull();

    await db.destroy();
  });

  test('is idempotent: running twice does not duplicate the user or role assignment', async () => {
    const { db, auth } = await createTestSetup();

    await seedAdminUser(auth, db);
    await seedAdminUser(auth, db);

    const users = await db
      .selectFrom('user')
      .selectAll()
      .where('email', '=', DEV_ADMIN_EMAIL)
      .execute();
    expect(users).toHaveLength(1);

    const assignments = await db
      .selectFrom('role_assignments')
      .selectAll()
      .where('user_id', '=', users[0]?.id ?? '')
      .execute();
    expect(assignments).toHaveLength(1);

    await db.destroy();
  });

  test('the seeded admin can actually sign in with the documented dev password', async () => {
    const { db, auth, app } = await createTestSetup();

    await seedAdminUser(auth, db);

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBeTruthy();

    await db.destroy();
  });
});
