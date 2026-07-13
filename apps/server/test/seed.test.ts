import { describe, expect, test } from 'bun:test';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { seed } from '../src/seed';
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
