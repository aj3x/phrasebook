import { describe, expect, test } from 'bun:test';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { resolveSeedFlags, seed } from '../src/seed';
import { PostgresStore } from '../src/store/postgres';

describe('seed', () => {
  test('creates the demo project with en/fr/fr-CA/es bundles', async () => {
    const db = await createMigratedTestDb();
    await seed(db);

    const store = new PostgresStore(db);

    const en = await store.getBundle('demo', 'en', 'common');
    expect(en?.keys).toEqual({
      'home.hero.title': 'Welcome',
      'home.hero.subtitle': 'Manage your translations with ease',
      'cart.items': 'You have {count, plural, =0 {no items} one {1 item} other {# items}}',
    });

    const fr = await store.getBundle('demo', 'fr', 'common');
    expect(fr?.keys).toEqual({
      'home.hero.title': 'Bienvenue',
      'home.hero.subtitle': 'Gérez vos traductions facilement',
      'cart.items':
        'Vous avez {count, plural, =0 {aucun article} one {1 article} other {# articles}}',
    });

    const es = await store.getBundle('demo', 'es', 'common');
    expect(es?.keys).toEqual({
      'home.hero.title': 'Bienvenido',
      'home.hero.subtitle': 'Gestiona tus traducciones con facilidad',
      'cart.items':
        'Tienes {count, plural, =0 {ningún artículo} one {1 artículo} other {# artículos}}',
    });

    await db.destroy();
  });

  test('fr-CA is intentionally missing the plural key, to prove the fallback chain', async () => {
    const db = await createMigratedTestDb();
    await seed(db);

    const store = new PostgresStore(db);
    const frCa = await store.getBundle('demo', 'fr-CA', 'common');

    expect(frCa?.keys).toEqual({
      'home.hero.title': 'Bienvenue',
      'home.hero.subtitle': 'Gérez vos traductions facilement',
    });
    expect(frCa?.keys['cart.items']).toBeUndefined();

    await db.destroy();
  });

  test('is idempotent: running twice leaves the same data, not duplicates', async () => {
    const db = await createMigratedTestDb();
    await seed(db);
    await seed(db);

    const keyCount = await db
      .selectFrom('keys')
      .select(db.fn.countAll().as('count'))
      .executeTakeFirstOrThrow();
    expect(Number(keyCount.count)).toBe(3);

    const translationCount = await db
      .selectFrom('translations')
      .select(db.fn.countAll().as('count'))
      .executeTakeFirstOrThrow();
    // 3 keys x (en, fr, es) + 2 keys x fr-CA (cart.items intentionally missing)
    expect(Number(translationCount.count)).toBe(3 * 3 + 2);

    const store = new PostgresStore(db);
    const en = await store.getBundle('demo', 'en', 'common');
    expect(en?.version).toBe(0);

    await db.destroy();
  });
});

describe('resolveSeedFlags', () => {
  test('real-deployment posture (production, no flags) seeds nothing', () => {
    expect(resolveSeedFlags({ NODE_ENV: 'production' })).toEqual({
      seedDemoData: false,
      seedDevAdmin: false,
    });
  });

  test('dev posture (non-production, no flags) seeds demo data and dev admin', () => {
    expect(resolveSeedFlags({ NODE_ENV: 'development' })).toEqual({
      seedDemoData: true,
      seedDevAdmin: true,
    });
    // Unset NODE_ENV is treated as dev, not production.
    expect(resolveSeedFlags({})).toEqual({ seedDemoData: true, seedDevAdmin: true });
  });

  test('either flag explicitly overrides its posture default', () => {
    // Production opting into the convenience admin (e.g. the docker demo).
    expect(resolveSeedFlags({ NODE_ENV: 'production', SEED_DEV_ADMIN: 'true' })).toEqual({
      seedDemoData: false,
      seedDevAdmin: true,
    });
    // Dev suppressing demo data to exercise the first-run wizard locally.
    expect(resolveSeedFlags({ NODE_ENV: 'development', SEED_DEMO_DATA: 'false' })).toEqual({
      seedDemoData: false,
      seedDevAdmin: true,
    });
  });

  test.each([
    ['1', true],
    ['yes', true],
    ['on', true],
    ['TRUE', true],
    ['0', false],
    ['no', false],
    ['off', false],
  ])('parses the flag value %p as %p', (value, expected) => {
    expect(resolveSeedFlags({ NODE_ENV: 'production', SEED_DEMO_DATA: value }).seedDemoData).toBe(
      expected,
    );
  });

  test('a real deployment (migrations only, no seed) boots to needsSetup: true', async () => {
    // The whole point of the reconciliation: a migrated-but-unseeded instance
    // has no org, so first-run onboarding takes over (DoD #1).
    const db = await createMigratedTestDb();
    const org = await db.selectFrom('organizations').select('id').executeTakeFirst();
    expect(org).toBeUndefined();
    await db.destroy();
  });
});
