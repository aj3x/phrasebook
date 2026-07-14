import { describe, expect, test } from 'vitest';
import type { KeyRow } from '../src/api';
import { computePluralEditState, reassemblePluralEdit } from '../src/icuEditing';

function row(overrides: Partial<KeyRow> = {}): KeyRow {
  return {
    key: 'cart.items',
    sourceText: '{count, plural, one {# item} other {# items}}',
    targetText: '',
    status: 'untranslated',
    ...overrides,
  };
}

describe('computePluralEditState', () => {
  test('returns undefined for a plain (non-plural) source', () => {
    expect(computePluralEditState(row({ sourceText: 'Welcome' }), 'ar')).toBeUndefined();
  });

  test('returns one slot per CLDR-required category for the target locale', () => {
    const state = computePluralEditState(row(), 'ar');
    expect(state?.slots.map((s) => s.category)).toEqual([
      'zero',
      'one',
      'two',
      'few',
      'many',
      'other',
    ]);
  });

  test('an untranslated key shows every slot empty and marked as fallback', () => {
    const state = computePluralEditState(row({ targetText: '' }), 'ar');
    expect(state?.slots.every((s) => s.text === '' && s.isFallback)).toBe(true);
  });

  test('an already-translated target populates the slots that exist and flags the rest', () => {
    const state = computePluralEditState(
      row({ targetText: '{count, plural, one {# article} other {# articles}}' }),
      'ar',
    );

    const one = state?.slots.find((s) => s.category === 'one');
    expect(one?.text).toBe('# article');
    expect(one?.isFallback).toBe(false);

    const zero = state?.slots.find((s) => s.category === 'zero');
    expect(zero?.text).toBe('');
    expect(zero?.isFallback).toBe(true);
  });

  test('preserves the argument name from the target when already translated', () => {
    const state = computePluralEditState(
      row({ targetText: '{n, plural, one {# article} other {# articles}}' }),
      'fr',
    );
    expect(state?.argument).toBe('n');
  });

  test("falls back to the source's argument name when the target is untranslated", () => {
    const state = computePluralEditState(row({ targetText: '' }), 'fr');
    expect(state?.argument).toBe('count');
  });
});

describe('reassemblePluralEdit', () => {
  test('reassembles edited slot values into one ICU message', () => {
    const state = computePluralEditState(row(), 'ar');
    expect(state).toBeDefined();
    if (!state) throw new Error('expected computePluralEditState to return a state');

    const slotValues: Record<string, string> = {};
    for (const slot of state.slots) {
      slotValues[slot.category] = slot.category === 'zero' ? 'no items' : slot.text || '# items';
    }

    const message = reassemblePluralEdit(state, slotValues);

    expect(message).toContain('zero{no items}');
    expect(message).toContain('other{# items}');
  });
});
