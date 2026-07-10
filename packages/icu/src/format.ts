import IntlMessageFormat from 'intl-messageformat';

export function format(
  source: string,
  locale: string,
  values?: Record<string, string | number | boolean | Date | null | undefined>,
): string {
  const result = new IntlMessageFormat(source, locale).format(values);
  return String(result);
}
