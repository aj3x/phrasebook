import { describe, expect, test } from 'bun:test';
import { LocaleCode } from '../src/locale-code';

describe('LocaleCode', () => {
  test.each(['en', 'fr', 'es', 'fr-CA', 'es-419'])('accepts valid locale code %s', (code) => {
    expect(LocaleCode.parse(code)).toBe(code);
  });

  test.each(['', 'EN', 'eng-USA', 'fr_CA', 'e', 'french'])(
    'rejects invalid locale code %s',
    (code) => {
      expect(() => LocaleCode.parse(code)).toThrow();
    },
  );
});
