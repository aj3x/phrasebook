import { describe, expect, test } from 'bun:test';
import { deriveFallbackChain } from '../src/fallback-chain';

describe('deriveFallbackChain', () => {
  test('walks a region subtag down to the language, then the default locale', () => {
    expect(deriveFallbackChain('fr-CA', 'en')).toEqual(['fr-CA', 'fr', 'en']);
  });

  test('appends the default locale for a plain language subtag', () => {
    expect(deriveFallbackChain('es', 'en')).toEqual(['es', 'en']);
  });

  test("does not duplicate the default locale when it's already the requested locale", () => {
    expect(deriveFallbackChain('en', 'en')).toEqual(['en']);
  });

  test("does not duplicate the default locale when it's already in the chain", () => {
    expect(deriveFallbackChain('en-GB', 'en')).toEqual(['en-GB', 'en']);
  });

  test('an explicit override replaces the derived chain entirely', () => {
    expect(deriveFallbackChain('fr-CA', 'en', { 'fr-CA': ['fr-CA', 'en'] })).toEqual([
      'fr-CA',
      'en',
    ]);
  });

  test('locales without an override still derive normally', () => {
    expect(deriveFallbackChain('es', 'en', { 'fr-CA': ['fr-CA', 'en'] })).toEqual(['es', 'en']);
  });
});
