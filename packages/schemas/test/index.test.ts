import { describe, expect, test } from 'bun:test';
import { LocaleCode, NamespaceName, TranslationBundle } from '../src/index';

describe('package index', () => {
  test('re-exports all M1 wire schemas', () => {
    expect(LocaleCode.parse('fr-CA')).toBe('fr-CA');
    expect(NamespaceName.parse('common')).toBe('common');
    expect(
      TranslationBundle.parse({ locale: 'en', namespace: 'common', version: 0, keys: {} }),
    ).toEqual({ locale: 'en', namespace: 'common', version: 0, keys: {} });
  });
});
