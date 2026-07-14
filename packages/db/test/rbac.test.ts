import { describe, expect, test } from 'bun:test';
import { createMigratedTestDb } from './helpers/test-db';

describe('RBAC tables', () => {
  test('seeds the five built-in roles', async () => {
    const db = await createMigratedTestDb();

    const roles = await db.selectFrom('roles').selectAll().orderBy('name').execute();

    expect(roles.map((r) => r.name)).toEqual([
      'Admin',
      'Developer',
      'Reviewer',
      'Translator',
      'Viewer',
    ]);
    expect(roles.every((r) => r.is_custom === false)).toBe(true);

    await db.destroy();
  });

  test('assigns a role to a user, instance-wide (no project/locale scope)', async () => {
    const db = await createMigratedTestDb();

    await db
      .insertInto('user')
      .values({ id: 'user_1', name: 'Ada', email: 'ada@example.com', emailVerified: false })
      .execute();
    const adminRole = await db
      .selectFrom('roles')
      .select('id')
      .where('name', '=', 'Admin')
      .executeTakeFirstOrThrow();

    const assignment = await db
      .insertInto('role_assignments')
      .values({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        user_id: 'user_1',
        role_id: adminRole.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(assignment.project_id).toBeNull();
    expect(assignment.locale_code).toBeNull();

    await db.destroy();
  });

  test('scopes a role assignment to a project and locale', async () => {
    const db = await createMigratedTestDb();

    await db
      .insertInto('user')
      .values({ id: 'user_1', name: 'Ada', email: 'ada@example.com', emailVerified: false })
      .execute();
    await db
      .insertInto('organizations')
      .values({ id: '11111111-1111-1111-1111-111111111111', name: 'Acme' })
      .execute();
    await db
      .insertInto('workspaces')
      .values({
        id: '22222222-2222-2222-2222-222222222222',
        org_id: '11111111-1111-1111-1111-111111111111',
        name: 'Acme Marketing',
      })
      .execute();
    await db
      .insertInto('projects')
      .values({
        id: '33333333-3333-3333-3333-333333333333',
        workspace_id: '22222222-2222-2222-2222-222222222222',
        name: 'demo',
        source_locale: 'en',
      })
      .execute();
    const translatorRole = await db
      .selectFrom('roles')
      .select('id')
      .where('name', '=', 'Translator')
      .executeTakeFirstOrThrow();

    const assignment = await db
      .insertInto('role_assignments')
      .values({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        user_id: 'user_1',
        role_id: translatorRole.id,
        project_id: '33333333-3333-3333-3333-333333333333',
        locale_code: 'fr',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(assignment.project_id).toBe('33333333-3333-3333-3333-333333333333');
    expect(assignment.locale_code).toBe('fr');

    await db.destroy();
  });

  test('rejects a role assignment for an unknown user or role', async () => {
    const db = await createMigratedTestDb();

    const adminRole = await db
      .selectFrom('roles')
      .select('id')
      .where('name', '=', 'Admin')
      .executeTakeFirstOrThrow();

    await expect(
      db
        .insertInto('role_assignments')
        .values({
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          user_id: 'no-such-user',
          role_id: adminRole.id,
        })
        .execute(),
    ).rejects.toThrow();

    await db
      .insertInto('user')
      .values({ id: 'user_1', name: 'Ada', email: 'ada@example.com', emailVerified: false })
      .execute();

    await expect(
      db
        .insertInto('role_assignments')
        .values({
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          user_id: 'user_1',
          role_id: '00000000-0000-0000-0000-000000000000',
        })
        .execute(),
    ).rejects.toThrow();

    await db.destroy();
  });
});
