import { kyselyAdapter } from '@better-auth/kysely-adapter';
import type { Database } from '@phrasebook/db';
import { betterAuth } from 'better-auth';
import type { Kysely } from 'kysely';

export interface CreateAuthOptions {
  db: Kysely<Database>;
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
}

/**
 * Wraps better-auth's own Kysely adapter around our existing connection --
 * kyselyAdapter(db, config) accepts any pre-built Kysely instance directly,
 * so this is the exact same connection @phrasebook/db's createDb() makes,
 * not a second pool. Email+password only for M2; OIDC/SAML deferred per
 * plan/03-milestone-2-editor.md.
 */
export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    database: kyselyAdapter(options.db, { type: 'postgres' }),
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins,
    emailAndPassword: {
      enabled: true,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
