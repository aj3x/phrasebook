import { describe, expect, test } from 'bun:test';
import { canonicalize, format } from '../src/index';

describe('package index', () => {
  test('re-exports format and canonicalize', () => {
    expect(format('{count, plural, one {# item} other {# items}}', 'en', { count: 1 })).toBe(
      '1 item',
    );
    expect(canonicalize('{count, plural, one {1} other {2}}')).toBe(
      canonicalize('{count,   plural,\n  one {1}\n  other {2}\n}'),
    );
  });
});
