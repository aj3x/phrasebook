import { z } from 'zod';

export const LocaleCode = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z]{2}|-[0-9]{3})?$/, 'must be a BCP-47-style locale code, e.g. "fr-CA"');

export type LocaleCode = z.infer<typeof LocaleCode>;
