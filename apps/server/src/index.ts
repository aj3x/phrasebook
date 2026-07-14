import { createDb } from '@phrasebook/db';
import { createApp } from './app';
import { createAuth } from './auth';
import { PostgresStore } from './store/postgres';

const connectionString = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;

if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
if (!authSecret) {
  console.error('BETTER_AUTH_SECRET is not set.');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.BIND_ADDR ?? '127.0.0.1';
const authBaseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`;

const db = createDb(connectionString);
const store = new PostgresStore(db);
const auth = createAuth({ db, secret: authSecret, baseURL: authBaseURL });
const app = createApp(store, auth, db);

Bun.serve({
  fetch: app.fetch,
  port,
  hostname,
});

console.log(`Server listening on http://${hostname}:${port}`);
