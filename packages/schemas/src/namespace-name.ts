import { z } from 'zod';

export const NamespaceName = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]*$/,
    'must start with a lowercase letter and contain only lowercase letters, digits, underscores, or hyphens',
  );

export type NamespaceName = z.infer<typeof NamespaceName>;
