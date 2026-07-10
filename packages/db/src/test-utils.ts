import type { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { migrations } from '../migrations/index';
import type { Database } from './generated';

/**
 * Runs the same `up()` functions the real Migrator runs in production, but
 * calls them directly instead of going through `Migrator.migrateToLatest()`.
 * pg-mem's Postgres catalog emulation can't execute the regex operator
 * Kysely's Migrator uses to check for its own bookkeeping table
 * (`nspname !~ '^pg_'`), so the stock Migrator can't run against pg-mem at
 * all. That's a pg-mem gap in catalog introspection, not a problem with our
 * migration SQL — this still exercises every `up()` against real SQL
 * execution, just without Kysely's own tracking-table bookkeeping.
 *
 * Exported (not test-only) so other packages/apps that depend on
 * @phrasebook/db can get a real, migrated, Postgres-wire-compatible
 * database in their own tests without duplicating this workaround.
 */
export async function createMigratedTestDb(): Promise<Kysely<Database>> {
  const db = newDb().adapters.createKysely() as Kysely<Database>;

  const sortedMigrations = Object.entries(migrations).sort(([a], [b]) => (a < b ? -1 : 1));

  for (const [, migration] of sortedMigrations) {
    await migration.up(db);
  }

  return db;
}
