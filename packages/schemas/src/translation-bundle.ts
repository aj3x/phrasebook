import { z } from 'zod';
import { LocaleCode } from './locale-code';
import { NamespaceName } from './namespace-name';

export const TranslationBundle = z.object({
  locale: LocaleCode,
  namespace: NamespaceName,
  version: z.number().int().nonnegative(),
  keys: z.record(z.string(), z.string()),
});

export type TranslationBundle = z.infer<typeof TranslationBundle>;
