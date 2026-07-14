import {
  type PluralBranchSlot,
  assemblePluralMessage,
  extractPluralBranches,
  requiredPluralCategories,
} from '@phrasebook/icu';
import type { KeyRow } from './api';

export interface PluralEditState {
  argument: string;
  offset: number;
  pluralType: Intl.PluralRulesOptions['type'];
  slots: PluralBranchSlot[];
}

/**
 * Whether a key is plural is determined by its **source** structure (§5) --
 * an untranslated or partially-translated target still needs to show
 * every CLDR-required slot for the target locale, not just whatever
 * (possibly zero) branches the target happens to have today.
 *
 * The argument name/offset/pluralType come from the target's own plural
 * structure when it already has one (a translator may have already
 * established it); otherwise fall back to the source's, since the
 * placeholder name is the same across locales (e.g. `{count}` in both
 * English and French).
 */
export function computePluralEditState(row: KeyRow, locale: string): PluralEditState | undefined {
  const sourceExtracted = extractPluralBranches(row.sourceText);
  if (!sourceExtracted) return undefined;

  const targetExtracted =
    row.targetText.trim() !== '' ? extractPluralBranches(row.targetText) : undefined;
  const base = targetExtracted ?? sourceExtracted;

  const categories = requiredPluralCategories(locale, base.pluralType);
  const slots: PluralBranchSlot[] = categories.map((category) => {
    const text = targetExtracted?.branches[category];
    return { category, text: text ?? '', isFallback: text === undefined };
  });

  return { argument: base.argument, offset: base.offset, pluralType: base.pluralType, slots };
}

export function reassemblePluralEdit(
  state: Pick<PluralEditState, 'argument' | 'offset' | 'pluralType'>,
  slotValues: Record<string, string>,
): string {
  return assemblePluralMessage({
    argument: state.argument,
    offset: state.offset,
    pluralType: state.pluralType,
    branches: slotValues,
  });
}
