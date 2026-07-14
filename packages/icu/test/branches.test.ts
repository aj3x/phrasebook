import { describe, expect, test } from 'bun:test';
import {
  assemblePluralMessage,
  extractPluralBranches,
  pluralBranchSlots,
  requiredPluralCategories,
} from '../src/branches';
import { format } from '../src/format';

describe('requiredPluralCategories', () => {
  test('English cardinal requires only one/other', () => {
    expect(requiredPluralCategories('en')).toEqual(['one', 'other']);
  });

  test('Arabic cardinal requires all six categories', () => {
    expect(requiredPluralCategories('ar')).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
  });
});

describe('extractPluralBranches', () => {
  test('extracts the argument name and each branch as source text', () => {
    const extracted = extractPluralBranches('{count, plural, one {# item} other {# items}}');

    expect(extracted?.argument).toBe('count');
    expect(extracted?.pluralType).toBe('cardinal');
    expect(extracted?.branches).toEqual({ one: '# item', other: '# items' });
  });

  test('returns undefined for a message with no top-level plural', () => {
    expect(extractPluralBranches('just plain text')).toBeUndefined();
  });

  test('preserves an explicit offset', () => {
    const extracted = extractPluralBranches(
      '{count, plural, offset:1 =0 {no one} one {one other} other {# people}}',
    );
    expect(extracted?.offset).toBe(1);
  });
});

describe('pluralBranchSlots', () => {
  test('returns one slot per CLDR-required category for the target locale', () => {
    const slots = pluralBranchSlots('{count, plural, one {# item} other {# items}}', 'ar');

    expect(slots?.map((s) => s.category)).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
  });

  test('marks a category absent from the source as a fallback slot, not silently filled', () => {
    const slots = pluralBranchSlots('{count, plural, one {# item} other {# items}}', 'ar');

    const zeroSlot = slots?.find((s) => s.category === 'zero');
    expect(zeroSlot?.isFallback).toBe(true);
    expect(zeroSlot?.text).toBe('');

    const oneSlot = slots?.find((s) => s.category === 'one');
    expect(oneSlot?.isFallback).toBe(false);
    expect(oneSlot?.text).toBe('# item');
  });

  test('English only needs one/other even though the source has extra explicit categories', () => {
    const slots = pluralBranchSlots(
      '{count, plural, =0 {no items} one {# item} other {# items}}',
      'en',
    );

    expect(slots?.map((s) => s.category)).toEqual(['one', 'other']);
  });
});

describe('assemblePluralMessage', () => {
  test('reassembles branches back into a valid ICU plural message', () => {
    const message = assemblePluralMessage({
      argument: 'count',
      offset: 0,
      pluralType: 'cardinal',
      branches: { one: '# item', other: '# items' },
    });

    expect(extractPluralBranches(message)).toEqual({
      argument: 'count',
      offset: 0,
      pluralType: 'cardinal',
      branches: { one: '# item', other: '# items' },
    });
  });

  test('the # pound placeholder actually substitutes the count when rendered, not a literal "#"', () => {
    const message = assemblePluralMessage({
      argument: 'count',
      offset: 0,
      pluralType: 'cardinal',
      branches: { one: '# item', other: '# items' },
    });

    // A regression guard, not just round-tripping through extraction:
    // extracting a branch's text back out uses printAST(option.value) with
    // isInPlural=false, which would mask a live '#' having been silently
    // escaped into a literal "'#'" during assembly (the escaped literal
    // reads back out as unescaped text either way) -- only actually
    // formatting the message catches that class of corruption.
    expect(format(message, 'en', { count: 3 })).toBe('3 items');
    expect(format(message, 'en', { count: 1 })).toBe('1 item');
  });

  test('always keeps the other branch even if empty (ICU requires it)', () => {
    const message = assemblePluralMessage({
      argument: 'count',
      offset: 0,
      pluralType: 'cardinal',
      branches: { one: '# item', other: '' },
    });

    expect(extractPluralBranches(message)?.branches.other).toBe('');
  });

  test('omits categories left blank other than "other" rather than saving an empty branch', () => {
    const message = assemblePluralMessage({
      argument: 'count',
      offset: 0,
      pluralType: 'cardinal',
      branches: { zero: '', one: '# item', other: '# items' },
    });

    expect(extractPluralBranches(message)?.branches).toEqual({ one: '# item', other: '# items' });
  });

  test('round-trips through extraction after being edited via CLDR-required slots', () => {
    const original = '{count, plural, one {# item} other {# items}}';
    const slots = pluralBranchSlots(original, 'ar') ?? [];
    const extracted = extractPluralBranches(original);

    const branches: Record<string, string> = {};
    for (const slot of slots) {
      branches[slot.category] = slot.category === 'zero' ? 'no items at all' : slot.text;
    }

    const reassembled = assemblePluralMessage({
      argument: extracted?.argument ?? 'count',
      offset: extracted?.offset ?? 0,
      pluralType: extracted?.pluralType ?? 'cardinal',
      branches,
    });

    expect(extractPluralBranches(reassembled)?.branches).toEqual({
      zero: 'no items at all',
      one: '# item',
      other: '# items',
    });
  });
});
