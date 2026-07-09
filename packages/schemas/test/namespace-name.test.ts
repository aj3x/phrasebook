import { describe, expect, test } from 'bun:test';
import { NamespaceName } from '../src/namespace-name';

describe('NamespaceName', () => {
  test.each(['common', 'cart_items', 'auth-v2', 'a'])('accepts valid namespace name %s', (name) => {
    expect(NamespaceName.parse(name)).toBe(name);
  });

  test.each(['', 'Common', '1common', 'common name', 'common.json', '-common'])(
    'rejects invalid namespace name %s',
    (name) => {
      expect(() => NamespaceName.parse(name)).toThrow();
    },
  );
});
