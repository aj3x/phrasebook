import { parse } from '@formatjs/icu-messageformat-parser';
import { printAST } from '@formatjs/icu-messageformat-parser/printer.js';

export function canonicalize(source: string): string {
  return printAST(parse(source));
}
