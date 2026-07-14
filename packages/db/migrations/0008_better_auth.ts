import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Schema shape matches better-auth's core tables exactly (user, session,
 * account, verification) -- confirmed against @better-auth/core's actual
 * getAuthTables() source (its docs pages don't fully cover this), not
 * guessed. Columns intentionally keep better-auth's own camelCase naming
 * instead of remapping to snake_case: these four tables are owned by that
 * library, not our domain model, and using its default field names (no
 * `fields: {...}` overrides in the betterAuth() config apps/server will add)
 * means schema stays in sync automatically across better-auth upgrades.
 * Postgres preserves case for quoted identifiers, and Kysely always quotes,
 * so this is safe as long as every access goes through Kysely -- which it
 * does, on both sides (our migrations and better-auth's kysely adapter).
 *
 * IDs are `text`, not `uuid`: better-auth generates its own 32-char random
 * alphanumeric IDs (see @better-auth/core's generateId), not RFC-4122
 * UUIDs, so a `uuid` column would reject them.
 */
export const migration0008BetterAuth: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('user')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('email', 'text', (col) => col.notNull().unique())
      .addColumn('emailVerified', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('image', 'text')
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('session')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('expiresAt', 'timestamptz', (col) => col.notNull())
      .addColumn('token', 'text', (col) => col.notNull().unique())
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('ipAddress', 'text')
      .addColumn('userAgent', 'text')
      .addColumn('userId', 'text', (col) => col.notNull().references('user.id').onDelete('cascade'))
      .execute();
    await db.schema.createIndex('session_userId_index').on('session').column('userId').execute();

    await db.schema
      .createTable('account')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('accountId', 'text', (col) => col.notNull())
      .addColumn('providerId', 'text', (col) => col.notNull())
      .addColumn('userId', 'text', (col) => col.notNull().references('user.id').onDelete('cascade'))
      .addColumn('accessToken', 'text')
      .addColumn('refreshToken', 'text')
      .addColumn('idToken', 'text')
      .addColumn('accessTokenExpiresAt', 'timestamptz')
      .addColumn('refreshTokenExpiresAt', 'timestamptz')
      .addColumn('scope', 'text')
      .addColumn('password', 'text')
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();
    await db.schema.createIndex('account_userId_index').on('account').column('userId').execute();

    await db.schema
      .createTable('verification')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('identifier', 'text', (col) => col.notNull())
      .addColumn('value', 'text', (col) => col.notNull())
      .addColumn('expiresAt', 'timestamptz', (col) => col.notNull())
      .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updatedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();
    await db.schema
      .createIndex('verification_identifier_index')
      .on('verification')
      .column('identifier')
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('verification').execute();
    await db.schema.dropTable('account').execute();
    await db.schema.dropTable('session').execute();
    await db.schema.dropTable('user').execute();
  },
};
