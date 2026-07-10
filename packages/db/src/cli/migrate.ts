import { createDb } from '../connection';
import { createMigrator } from '../migrator';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = createDb(connectionString);
const migrator = createMigrator(db);
const { error, results } = await migrator.migrateToLatest();

for (const result of results ?? []) {
  if (result.status === 'Success') {
    console.log(`✓ ${result.migrationName}`);
  } else if (result.status === 'Error') {
    console.error(`✗ ${result.migrationName}`);
  }
}

await db.destroy();

if (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}

console.log('Migrations up to date.');
