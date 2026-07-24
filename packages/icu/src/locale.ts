/**
 * Locale-code validity, decided against the CLDR data the runtime's `Intl`
 * ships (same source `format.ts`/`branches.ts` already rely on -- there is no
 * separately bundled dataset). A code is valid when it is a canonical BCP-47
 * tag *and* names a real CLDR language, so structurally-wellformed nonsense
 * like "zz"/"qq-CA" is rejected rather than silently stored and later failing
 * to format.
 *
 * The tag must already be canonical (`getCanonicalLocales` returns it
 * unchanged): callers pass canonical codes -- the wizard's picker, seed data,
 * the LocaleCode schema's regex -- so "EN", "fr-ca", "en_US" are rejected here
 * to keep stored codes consistent instead of quietly normalized.
 */
export function isSupportedLocale(code: string): boolean {
  if (typeof code !== 'string' || code === '') return false;

  let canonical: string[];
  try {
    canonical = Intl.getCanonicalLocales(code);
  } catch {
    // getCanonicalLocales throws RangeError on a structurally malformed tag.
    return false;
  }
  if (canonical.length !== 1 || canonical[0] !== code) return false;

  const language = new Intl.Locale(canonical[0]).language;
  // fallback: 'none' => undefined for a language subtag CLDR doesn't know.
  const named = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(language);
  return named !== undefined;
}
