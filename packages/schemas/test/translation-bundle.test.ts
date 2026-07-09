import { describe, expect, test } from 'bun:test';
import { TranslationBundle } from '../src/translation-bundle';

describe('TranslationBundle', () => {
  test('accepts a valid bundle', () => {
    const bundle = {
      locale: 'fr-CA',
      namespace: 'common',
      version: 3,
      keys: {
        'home.hero.title': 'Bonjour',
        'cart.items': '{count, plural, =0 {aucun article} one {1 article} other {# articles}}',
      },
    };

    expect(TranslationBundle.parse(bundle)).toEqual(bundle);
  });

  test('accepts a bundle with no keys', () => {
    const bundle = { locale: 'en', namespace: 'common', version: 0, keys: {} };

    expect(TranslationBundle.parse(bundle)).toEqual(bundle);
  });

  test.each([
    { locale: 'not-a-locale', namespace: 'common', version: 1, keys: {} },
    { locale: 'en', namespace: 'Not Valid', version: 1, keys: {} },
    { locale: 'en', namespace: 'common', version: -1, keys: {} },
    { locale: 'en', namespace: 'common', version: 1.5, keys: {} },
    { locale: 'en', namespace: 'common', version: 1, keys: { a: 1 } },
    { locale: 'en', namespace: 'common', keys: {} },
    { locale: 'en', version: 1, keys: {} },
  ])('rejects invalid bundle %j', (bundle) => {
    expect(() => TranslationBundle.parse(bundle)).toThrow();
  });
});
