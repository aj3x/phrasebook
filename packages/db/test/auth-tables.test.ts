import { describe, expect, test } from 'bun:test';
import { createMigratedTestDb } from './helpers/test-db';

describe('better-auth tables', () => {
  test('creates a user, a session referencing it, and rejects an orphan session', async () => {
    const db = await createMigratedTestDb();

    const user = await db
      .insertInto('user')
      .values({
        id: 'user_1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        emailVerified: false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(user.email).toBe('ada@example.com');
    expect(user.emailVerified).toBe(false);
    expect(user.locked).toBe(false);

    const session = await db
      .insertInto('session')
      .values({
        id: 'session_1',
        token: 'tok_1',
        userId: user.id,
        expiresAt: new Date('2030-01-01'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(session.userId).toBe(user.id);

    await expect(
      db
        .insertInto('session')
        .values({
          id: 'session_2',
          token: 'tok_2',
          userId: 'no-such-user',
          expiresAt: new Date('2030-01-01'),
        })
        .execute(),
    ).rejects.toThrow();

    await db.destroy();
  });

  test('rejects a duplicate session token', async () => {
    const db = await createMigratedTestDb();

    await db
      .insertInto('user')
      .values({ id: 'user_1', name: 'Ada', email: 'ada@example.com', emailVerified: false })
      .execute();

    await db
      .insertInto('session')
      .values({
        id: 'session_1',
        token: 'tok_1',
        userId: 'user_1',
        expiresAt: new Date('2030-01-01'),
      })
      .execute();

    await expect(
      db
        .insertInto('session')
        .values({
          id: 'session_2',
          token: 'tok_1',
          userId: 'user_1',
          expiresAt: new Date('2030-01-01'),
        })
        .execute(),
    ).rejects.toThrow();

    await db.destroy();
  });

  test('creates an account (credentials row) referencing a user', async () => {
    const db = await createMigratedTestDb();

    await db
      .insertInto('user')
      .values({ id: 'user_1', name: 'Ada', email: 'ada@example.com', emailVerified: false })
      .execute();

    const account = await db
      .insertInto('account')
      .values({
        id: 'account_1',
        accountId: 'ada@example.com',
        providerId: 'credential',
        userId: 'user_1',
        password: 'hashed-password',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(account.providerId).toBe('credential');
    expect(account.password).toBe('hashed-password');

    await db.destroy();
  });

  test('creates a verification row (e.g. for email verification / password reset)', async () => {
    const db = await createMigratedTestDb();

    const verification = await db
      .insertInto('verification')
      .values({
        id: 'verification_1',
        identifier: 'ada@example.com',
        value: 'some-token',
        expiresAt: new Date('2030-01-01'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(verification.identifier).toBe('ada@example.com');

    await db.destroy();
  });

  test('a user can be locked, the §D4/F3 revoke-everything mechanism', async () => {
    const db = await createMigratedTestDb();

    await db
      .insertInto('user')
      .values({ id: 'user_1', name: 'Ada', email: 'ada@example.com', emailVerified: false })
      .execute();

    const locked = await db
      .updateTable('user')
      .set({ locked: true })
      .where('id', '=', 'user_1')
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(locked.locked).toBe(true);

    await db.destroy();
  });
});
