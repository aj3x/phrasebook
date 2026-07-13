import IntlMessageFormat from 'intl-messageformat';

export type FormatValues = Record<string, string | number | boolean | Date | null | undefined>;

export function format(source: string, locale: string, values?: FormatValues): string {
  const result = new IntlMessageFormat(source, locale).format(values);
  return String(result);
}
