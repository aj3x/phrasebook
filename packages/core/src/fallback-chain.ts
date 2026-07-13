/**
 * Derives an F10 fallback chain from a BCP-47 locale by walking dash-separated
 * subtags down to the language ("fr-CA" -> "fr-CA" -> "fr"), then appending
 * the default (source) locale if it isn't already in the chain.
 */
export function deriveFallbackChain(
  locale: string,
  defaultLocale: string,
  overrides?: Record<string, string[]>,
): string[] {
  const override = overrides?.[locale];
  if (override) return override;

  const chain: string[] = [];
  const parts = locale.split('-');
  for (let i = parts.length; i > 0; i--) {
    chain.push(parts.slice(0, i).join('-'));
  }

  if (!chain.includes(defaultLocale)) {
    chain.push(defaultLocale);
  }

  return chain;
}
