import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { MigrationProvider } from 'kysely/migration';
import { migrations } from '../migrations/index';

const provider: MigrationProvider = {
  getMigrations: async () => migrations,
};

export function createMigrator(db: Kysely<any>): Migrator {
  return new Migrator({ db, provider });
}
