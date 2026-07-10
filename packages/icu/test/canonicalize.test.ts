import { describe, expect, test } from 'bun:test';
import { canonicalize } from '../src/canonicalize';

describe('canonicalize', () => {
  test('normalizes whitespace-different but equivalent ICU strings to the same output', () => {
    const compact = '{count, plural, =0 {no items} one {1 item} other {# items}}';
    const spread = `{count,   plural,
      =0 {no items}
      one {1 item}
      other {# items}
    }`;

    expect(canonicalize(spread)).toBe(canonicalize(compact));
  });

  test('is idempotent', () => {
    const source = '{count, plural, one {# item} other {# items}}';
    expect(canonicalize(canonicalize(source))).toBe(canonicalize(source));
  });

  test('does not treat differing content as equivalent', () => {
    const a = '{count, plural, one {# item} other {# items}}';
    const b = '{count, plural, one {# thing} other {# things}}';
    expect(canonicalize(a)).not.toBe(canonicalize(b));
  });
});
