import { describe, expect, test } from 'bun:test';
import { BUILT_IN_ROLE_IDS, type Database } from '@phrasebook/db';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import type { Kysely } from 'kysely';
import { LastOwnerError, type OwnerAction, assertNotLastOwner } from '../src/owner-guard';

const ACTIONS: OwnerAction[] = ['lock', 'demote', 'delete'];

async function createUser(
  db: Kysely<Database>,
  id: string,
  opts: { owner?: boolean; locked?: boolean } = {},
): Promise<void> {
  await db
    .insertInto('user')
    .values({ id, name: id, email: `${id}@example.com`, locked: opts.locked ?? false })
    .execute();
  if (opts.owner) {
    await db
      .insertInto('role_assignments')
      .values({ id: crypto.randomUUID(), user_id: id, role_id: BUILT_IN_ROLE_IDS.owner })
      .execute();
  }
}

describe('assertNotLastOwner', () => {
  test('a non-owner can be locked/demoted/deleted freely', async () => {
    const db = await createMigratedTestDb();
    await createUser(db, 'owner1', { owner: true });
    await createUser(db, 'plain');

    for (const action of ACTIONS) {
      await expect(assertNotLastOwner(db, 'plain', action)).resolves.toBeUndefined();
    }

    await db.destroy();
  });

  test('the sole active Owner cannot be locked, demoted, or deleted', async () => {
    const db = await createMigratedTestDb();
    await createUser(db, 'owner1', { owner: true });

    for (const action of ACTIONS) {
      await expect(assertNotLastOwner(db, 'owner1', action)).rejects.toBeInstanceOf(LastOwnerError);
    }

    await db.destroy();
  });

  test('with two active Owners, either one may be acted on', async () => {
    const db = await createMigratedTestDb();
    await createUser(db, 'owner1', { owner: true });
    await createUser(db, 'owner2', { owner: true });

    for (const action of ACTIONS) {
      await expect(assertNotLastOwner(db, 'owner1', action)).resolves.toBeUndefined();
      await expect(assertNotLastOwner(db, 'owner2', action)).resolves.toBeUndefined();
    }

    await db.destroy();
  });

  test('a locked second Owner does not count -- the one active Owner is still protected', async () => {
    const db = await createMigratedTestDb();
    await createUser(db, 'active', { owner: true });
    await createUser(db, 'disabled', { owner: true, locked: true });

    // The unlocked Owner is the sole *active* Owner, so it stays protected...
    for (const action of ACTIONS) {
      await expect(assertNotLastOwner(db, 'active', action)).rejects.toBeInstanceOf(LastOwnerError);
    }
    // ...but removing the already-locked Owner reduces nothing and is allowed.
    for (const action of ACTIONS) {
      await expect(assertNotLastOwner(db, 'disabled', action)).resolves.toBeUndefined();
    }

    await db.destroy();
  });

  test('the error names the attempted action', async () => {
    const db = await createMigratedTestDb();
    await createUser(db, 'owner1', { owner: true });

    const err = await assertNotLastOwner(db, 'owner1', 'demote').catch((e) => e);
    expect(err).toBeInstanceOf(LastOwnerError);
    expect((err as LastOwnerError).action).toBe('demote');
    expect((err as LastOwnerError).message).toContain('demote');

    await db.destroy();
  });
});
