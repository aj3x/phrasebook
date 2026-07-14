import {
  type MessageFormatElement,
  type PluralElement,
  TYPE,
  parse,
} from '@formatjs/icu-messageformat-parser';
import { printAST } from '@formatjs/icu-messageformat-parser/printer.js';

/**
 * CLDR determines which branches a target locale requires (§5) -- resolved
 * via the JS runtime's native Intl.PluralRules, the same source of truth
 * `format.ts` already relies on for formatting (see CLDR_VERSION.md). No
 * bundled CLDR dataset here either.
 */
export function requiredPluralCategories(
  locale: string,
  type: Intl.PluralRulesOptions['type'] = 'cardinal',
): string[] {
  return new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories;
}

export interface PluralBranches {
  argument: string;
  offset: number;
  pluralType: Intl.PluralRulesOptions['type'];
  /** category -> that branch's source text (not the whole message). */
  branches: Record<string, string>;
}

function findTopLevelPlural(ast: MessageFormatElement[]): PluralElement | undefined {
  return ast.find((el): el is PluralElement => el.type === TYPE.plural);
}

/** Undefined if the message has no top-level plural/select argument to edit per-branch. */
export function extractPluralBranches(source: string): PluralBranches | undefined {
  const plural = findTopLevelPlural(parse(source));
  if (!plural) return undefined;

  const branches: Record<string, string> = {};
  for (const [category, option] of Object.entries(plural.options)) {
    branches[category] = printAST(option.value);
  }

  return {
    argument: plural.value,
    offset: plural.offset,
    pluralType: plural.pluralType,
    branches,
  };
}

/**
 * Reassembles edited branch text back into one ICU message (M2 step 9) --
 * the same guarantee `format.ts`'s existing tests prove for rendering, now
 * on the write path. `other` is always kept, even empty, since ICU plural
 * syntax requires it; every other category is included only when it has
 * content, so a slot left blank falls back to `other` at render time
 * (§5) rather than saving a spurious empty branch.
 */
export function assemblePluralMessage(input: PluralBranches): string {
  const options: PluralElement['options'] = {};

  for (const [category, text] of Object.entries(input.branches)) {
    if (category === 'other' || text.trim() !== '') {
      options[category] = { value: parse(text) };
    }
  }

  const pluralElement: PluralElement = {
    type: TYPE.plural,
    value: input.argument,
    offset: input.offset,
    pluralType: input.pluralType,
    options,
  };

  return printAST([pluralElement]);
}

export interface PluralBranchSlot {
  category: string;
  /** The branch's source text, or '' if absent from the source entirely. */
  text: string;
  /** True when this category isn't in the source and falls back to `other` at render time (§5). */
  isFallback: boolean;
}

/**
 * One editable slot per CLDR-required branch for the target locale (M2
 * step 9) -- e.g. an `en` source with only one/other still shows an
 * Arabic translator all six categories. Undefined if the message has no
 * top-level plural to edit this way.
 */
export function pluralBranchSlots(source: string, locale: string): PluralBranchSlot[] | undefined {
  const extracted = extractPluralBranches(source);
  if (!extracted) return undefined;

  const categories = requiredPluralCategories(locale, extracted.pluralType);
  return categories.map((category) => {
    const text = extracted.branches[category];
    return { category, text: text ?? '', isFallback: text === undefined };
  });
}
