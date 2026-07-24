import { describe, expect, test } from 'bun:test';
import { isSupportedLocale } from '../src/locale';

describe('isSupportedLocale', () => {
  test.each(['en', 'fr', 'es', 'de', 'ja', 'fr-CA', 'en-US', 'pt-BR', 'zh-Hans'])(
    'accepts the canonical CLDR locale %s',
    (code) => {
      expect(isSupportedLocale(code)).toBe(true);
    },
  );

  test.each(['zz', 'xx', 'qq-CA'])('rejects the wellformed-but-unknown language %s', (code) => {
    expect(isSupportedLocale(code)).toBe(false);
  });

  test.each(['EN', 'fr-ca', 'en_US', 'en-us'])('rejects the non-canonical form %s', (code) => {
    expect(isSupportedLocale(code)).toBe(false);
  });

  test.each(['', 'not a locale', '123', 'toolonglang', '-'])(
    'rejects the malformed tag %p',
    (code) => {
      expect(isSupportedLocale(code)).toBe(false);
    },
  );
});
