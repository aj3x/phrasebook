import { createDb } from '@phrasebook/db';
import { createApp } from './app';
import { PostgresStore } from './store/postgres';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.BIND_ADDR ?? '127.0.0.1';

const db = createDb(connectionString);
const store = new PostgresStore(db);
const app = createApp(store);

Bun.serve({
  fetch: app.fetch,
  port,
  hostname,
});

console.log(`Server listening on http://${hostname}:${port}`);
