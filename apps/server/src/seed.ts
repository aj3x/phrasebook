import { createHash } from 'node:crypto';
import { BUILT_IN_ROLE_IDS, createDb } from '@phrasebook/db';
import type { Database } from '@phrasebook/db';
import type { Kysely } from 'kysely';
import type { Auth } from './auth';
import { createAuth } from './auth';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002';
const PROJECT_ID = '00000000-0000-0000-0000-000000000003';
const NAMESPACE_ID = '00000000-0000-0000-0000-000000000004';

const LOCALE_IDS: Record<string, string> = {
  en: '00000000-0000-0000-0000-000000000010',
  fr: '00000000-0000-0000-0000-000000000011',
  'fr-CA': '00000000-0000-0000-0000-000000000012',
  es: '00000000-0000-0000-0000-000000000013',
};

const KEY_IDS: Record<string, string> = {
  'home.hero.title': '00000000-0000-0000-0000-000000000020',
  'home.hero.subtitle': '00000000-0000-0000-0000-000000000021',
  'cart.items': '00000000-0000-0000-0000-000000000022',
};

const SOURCE_TEXT: Record<string, string> = {
  'home.hero.title': 'Welcome',
  'home.hero.subtitle': 'Manage your translations with ease',
  'cart.items': 'You have {count, plural, =0 {no items} one {1 item} other {# items}}',
};

/**
 * fr-CA intentionally has no translation for "cart.items" (the ICU
 * plural key) -- once packages/core (step 8) implements the fallback
 * chain, fr-CA should resolve that key through fr, proving the chain
 * works instead of showing a raw key name or blank string.
 */
const TRANSLATIONS: Record<string, Partial<Record<string, string>>> = {
  en: {
    'home.hero.title': 'Welcome',
    'home.hero.subtitle': 'Manage your translations with ease',
    'cart.items': 'You have {count, plural, =0 {no items} one {1 item} other {# items}}',
  },
  fr: {
    'home.hero.title': 'Bienvenue',
    'home.hero.subtitle': 'Gérez vos traductions facilement',
    'cart.items':
      'Vous avez {count, plural, =0 {aucun article} one {1 article} other {# articles}}',
  },
  'fr-CA': {
    'home.hero.title': 'Bienvenue',
    'home.hero.subtitle': 'Gérez vos traductions facilement',
  },
  es: {
    'home.hero.title': 'Bienvenido',
    'home.hero.subtitle': 'Gestiona tus traducciones con facilidad',
    'cart.items':
      'Tienes {count, plural, =0 {ningún artículo} one {1 artículo} other {# artículos}}',
  },
};

function sourceHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function seed(db: Kysely<Database>): Promise<void> {
  await db
    .insertInto('organizations')
    .values({ id: ORG_ID, name: 'Acme' })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();

  await db
    .insertInto('workspaces')
    .values({ id: WORKSPACE_ID, org_id: ORG_ID, name: 'Acme Marketing' })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();

  await db
    .insertInto('projects')
    .values({ id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: 'demo', source_locale: 'en' })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();

  for (const [code, id] of Object.entries(LOCALE_IDS)) {
    await db
      .insertInto('locales')
      .values({ id, project_id: PROJECT_ID, code })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  await db
    .insertInto('namespaces')
    .values({ id: NAMESPACE_ID, project_id: PROJECT_ID, name: 'common', authority: 'code' })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();

  for (const [name, id] of Object.entries(KEY_IDS)) {
    const text = SOURCE_TEXT[name];
    if (!text) continue;
    await db
      .insertInto('keys')
      .values({
        id,
        namespace_id: NAMESPACE_ID,
        name,
        source_text: text,
        source_hash: sourceHash(text),
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  for (const [locale, keys] of Object.entries(TRANSLATIONS)) {
    const localeId = LOCALE_IDS[locale];
    if (!localeId) continue;
    for (const [keyName, targetText] of Object.entries(keys)) {
      const keyId = KEY_IDS[keyName];
      if (!keyId || !targetText) continue;
      await db
        .insertInto('translations')
        .values({
          id: crypto.randomUUID(),
          key_id: keyId,
          locale_id: localeId,
          target_text: targetText,
          status: 'published',
        })
        .onConflict((oc) =>
          oc.columns(['key_id', 'locale_id']).doUpdateSet((eb) => ({
            target_text: eb.ref('excluded.target_text'),
            status: eb.ref('excluded.status'),
          })),
        )
        .execute();
    }
  }
}

/**
 * Dev-only credentials, intentionally committed -- this is a local/demo
 * seed, not a real deployment's admin account. Documented in
 * CONTRIBUTING.md so nobody has to go hunting for it.
 */
export const DEV_ADMIN_EMAIL = 'admin@phrasebook.local';
export const DEV_ADMIN_PASSWORD = 'phrasebook-dev-admin';

/**
 * Goes through better-auth's real sign-up API (not a raw insert into
 * user/account) so password hashing takes the real code path -- hand-
 * rolling that hash here would be both wrong and a second implementation
 * to keep in sync with whatever better-auth does internally.
 */
export async function seedAdminUser(
  auth: Auth,
  db: Kysely<Database>,
  email = DEV_ADMIN_EMAIL,
  password = DEV_ADMIN_PASSWORD,
): Promise<void> {
  const existingUser = await db
    .selectFrom('user')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirst();

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const result = await auth.api.signUpEmail({
      body: { name: 'Admin', email, password },
    });
    userId = result.user.id;
  }

  const existingAssignment = await db
    .selectFrom('role_assignments')
    .select('id')
    .where('user_id', '=', userId)
    .where('role_id', '=', BUILT_IN_ROLE_IDS.admin)
    .executeTakeFirst();

  if (!existingAssignment) {
    await db
      .insertInto('role_assignments')
      .values({ id: crypto.randomUUID(), user_id: userId, role_id: BUILT_IN_ROLE_IDS.admin })
      .execute();
  }
}

export interface SeedFlags {
  seedDemoData: boolean;
  seedDevAdmin: boolean;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * What the seed script should do, resolved from the environment (M3 Phase B
 * step 13). The real-deployment posture -- NODE_ENV=production with neither
 * flag set -- seeds nothing, so the instance boots to `needsSetup: true` and
 * the first-run wizard owns bootstrap. Dev defaults to the convenience demo
 * data (so demo-web's fallback chain works out of the box) plus the dev admin
 * (editor login). Either flag explicitly overrides its posture-derived
 * default, so a deployment can opt into demo data, or a dev can suppress it.
 */
export function resolveSeedFlags(env: Record<string, string | undefined>): SeedFlags {
  const devDefault = env.NODE_ENV !== 'production';
  return {
    seedDemoData: parseBoolEnv(env.SEED_DEMO_DATA, devDefault),
    seedDevAdmin: parseBoolEnv(env.SEED_DEV_ADMIN, devDefault),
  };
}

if (import.meta.main) {
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

  const flags = resolveSeedFlags(process.env);
  const db = createDb(connectionString);
  const auth = createAuth({
    db,
    secret: authSecret,
    baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  });

  if (flags.seedDemoData) {
    await seed(db);
    console.log('Seeded demo data.');
  }
  if (flags.seedDevAdmin) {
    await seedAdminUser(auth, db);
    console.log(`Seeded dev admin (${DEV_ADMIN_EMAIL}).`);
  }
  if (!flags.seedDemoData && !flags.seedDevAdmin) {
    console.log('Seeding skipped; the first-run setup wizard will own bootstrap.');
  }

  await db.destroy();
  console.log('Seed complete.');
}
