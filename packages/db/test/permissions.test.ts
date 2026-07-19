import { describe, expect, test } from 'bun:test';
import type { Kysely } from 'kysely';
import { BUILT_IN_ROLE_IDS } from '../migrations/0009_rbac';
import type { Database } from '../src/generated';
import { createMigratedTestDb } from './helpers/test-db';

async function grantsFor(db: Kysely<Database>, roleId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('role_permissions')
    .select(['resource', 'action'])
    .where('role_id', '=', roleId)
    .execute();
  return rows.map((r) => `${r.resource}:${r.action}`).sort();
}

describe('permissions & role_permissions', () => {
  test('seeds the Owner role as a sixth built-in, non-custom role', async () => {
    const db = await createMigratedTestDb();

    const owner = await db
      .selectFrom('roles')
      .selectAll()
      .where('id', '=', BUILT_IN_ROLE_IDS.owner)
      .executeTakeFirstOrThrow();

    expect(owner.name).toBe('Owner');
    expect(owner.is_custom).toBe(false);

    await db.destroy();
  });

  test('seeds the concrete permission catalog', async () => {
    const db = await createMigratedTestDb();

    const permissions = await db.selectFrom('permissions').selectAll().execute();

    expect(permissions).toHaveLength(44);

    const approve = permissions.find((p) => p.resource === 'translation' && p.action === 'approve');
    expect(approve?.description).toBeTruthy();

    const revoke = permissions.find(
      (p) => p.resource === 'role_assignment' && p.action === 'revoke',
    );
    expect(revoke?.description).toBeTruthy();

    await db.destroy();
  });

  test('grants Owner exactly the *:* wildcard', async () => {
    const db = await createMigratedTestDb();

    const grants = await db
      .selectFrom('role_permissions')
      .selectAll()
      .where('role_id', '=', BUILT_IN_ROLE_IDS.owner)
      .execute();

    expect(grants).toHaveLength(1);
    expect(grants[0]?.resource).toBe('*');
    expect(grants[0]?.action).toBe('*');

    await db.destroy();
  });

  test('grants Admin the starter matrix, including workspace:view but not workspace:create', async () => {
    const db = await createMigratedTestDb();

    const grants = await grantsFor(db, BUILT_IN_ROLE_IDS.admin);

    expect(grants).toEqual(
      [
        'project:*',
        'namespace:*',
        'key:*',
        'locale:*',
        'translation:*',
        'comment:*',
        'settings:*',
        'user:*',
        'invite:*',
        'role_assignment:*',
        'workspace:view',
      ].sort(),
    );
    expect(grants).not.toContain('workspace:create');

    await db.destroy();
  });

  test('grants Developer and Translator their starter matrices', async () => {
    const db = await createMigratedTestDb();

    const developerGrants = await grantsFor(db, BUILT_IN_ROLE_IDS.developer);
    expect(developerGrants).toEqual(
      [
        'project:view',
        'namespace:*',
        'key:*',
        'locale:view',
        'translation:view',
        'translation:save',
        'comment:view',
        'comment:create',
      ].sort(),
    );

    const translatorGrants = await grantsFor(db, BUILT_IN_ROLE_IDS.translator);
    expect(translatorGrants).toEqual(
      [
        'project:view',
        'key:view',
        'locale:view',
        'translation:view',
        'translation:save',
        'comment:view',
        'comment:create',
      ].sort(),
    );

    await db.destroy();
  });

  test("grants Reviewer Translator's matrix plus the three review actions", async () => {
    const db = await createMigratedTestDb();

    const translatorGrants = await grantsFor(db, BUILT_IN_ROLE_IDS.translator);
    const reviewerGrants = await grantsFor(db, BUILT_IN_ROLE_IDS.reviewer);

    for (const grant of translatorGrants) {
      expect(reviewerGrants).toContain(grant);
    }
    expect(reviewerGrants).toEqual(
      [
        ...translatorGrants,
        'translation:claim',
        'translation:approve',
        'translation:send_back',
      ].sort(),
    );

    await db.destroy();
  });

  test('grants Viewer exactly its five read-only permissions, never translation:save', async () => {
    const db = await createMigratedTestDb();

    const grants = await grantsFor(db, BUILT_IN_ROLE_IDS.viewer);

    expect(grants).toEqual(
      ['project:view', 'key:view', 'locale:view', 'translation:view', 'comment:view'].sort(),
    );
    expect(grants).not.toContain('translation:save');

    await db.destroy();
  });

  test('rejects a duplicate (role_id, resource, action) grant', async () => {
    const db = await createMigratedTestDb();

    await expect(
      db
        .insertInto('role_permissions')
        .values({
          id: crypto.randomUUID(),
          role_id: BUILT_IN_ROLE_IDS.admin,
          resource: 'project',
          action: '*',
        })
        .execute(),
    ).rejects.toThrow();

    await db.destroy();
  });

  test('rejects a grant for an unknown role, and cascades on role delete', async () => {
    const db = await createMigratedTestDb();

    await expect(
      db
        .insertInto('role_permissions')
        .values({
          id: crypto.randomUUID(),
          role_id: '00000000-0000-0000-0000-000000000000',
          resource: 'project',
          action: 'view',
        })
        .execute(),
    ).rejects.toThrow();

    const customRole = await db
      .insertInto('roles')
      .values({ id: crypto.randomUUID(), name: 'Custom QA', is_custom: true })
      .returningAll()
      .executeTakeFirstOrThrow();
    await db
      .insertInto('role_permissions')
      .values({
        id: crypto.randomUUID(),
        role_id: customRole.id,
        resource: 'project',
        action: 'view',
      })
      .execute();

    await db.deleteFrom('roles').where('id', '=', customRole.id).execute();
    const remaining = await db
      .selectFrom('role_permissions')
      .selectAll()
      .where('role_id', '=', customRole.id)
      .execute();
    expect(remaining).toHaveLength(0);

    await db.destroy();
  });
});
