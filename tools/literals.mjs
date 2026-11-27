#!/usr/bin/env node
/**
 * List the CJK string literals of one source file, with line numbers — the
 * translation checklist.
 *
 *   node tools/literals.mjs <file> <js|py>
 */
import { readFileSync } from 'node:fs';
import { cjkLiterals } from '../lib/scan.mjs';

const [file, lang] = process.argv.slice(2);
if (!file || !lang) {
  console.error('usage: literals.mjs <file> <js|py>');
  process.exit(2);
}
const literals = cjkLiterals(readFileSync(file, 'utf8'), lang);
console.log(JSON.stringify(literals.map(({ line, raw }) => ({ line, raw })), null, 2));
console.error(`${literals.length} CJK literals`);
