import { describe, expect, test } from 'bun:test';
import { format } from '../src/format';

describe('format', () => {
  test.each([
    [0, '0 items'],
    [1, '1 item'],
    [2, '2 items'],
  ])('resolves the English plural category for count=%d', (count, expected) => {
    const source = '{count, plural, one {# item} other {# items}}';
    expect(format(source, 'en', { count })).toBe(expected);
  });

  test.each([
    [0, '0 article'],
    [1, '1 article'],
    [2, '2 articles'],
  ])('resolves the French plural category for count=%d', (count, expected) => {
    const source = '{count, plural, one {# article} other {# articles}}';
    expect(format(source, 'fr', { count })).toBe(expected);
  });

  test.each([
    [0, 'zero'],
    [1, 'one'],
    [2, 'two'],
    [3, 'few'],
    [11, 'many'],
    [100, 'other'],
  ])('resolves all six Arabic plural categories, count=%d -> %s', (count, expected) => {
    const source =
      '{count, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}';
    expect(format(source, 'ar', { count })).toBe(expected);
  });
});
