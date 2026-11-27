#!/usr/bin/env node
/**
 * Translation gate for one file pair.
 *
 *   node tools/check-en.mjs <original> <translated> <js|py>
 *
 * Passes when the translated file keeps the original's line count, its code
 * skeleton (comments and literals masked) is byte-identical, and no string
 * literal still contains CJK. Exit 1 with a report otherwise.
 */
import { readFileSync } from 'node:fs';
import { scan, hasCjk } from '../lib/scan.mjs';

const [originalPath, translatedPath, lang] = process.argv.slice(2);
if (!originalPath || !translatedPath || !lang) {
  console.error('usage: check-en.mjs <original> <translated> <js|py>');
  process.exit(2);
}

const original = readFileSync(originalPath, 'utf8');
const translated = readFileSync(translatedPath, 'utf8');
const problems = [];

const originalLines = original.split('\n');
const translatedLines = translated.split('\n');
if (originalLines.length !== translatedLines.length) {
  problems.push(`line count ${translatedLines.length} != original ${originalLines.length}`);
}

const originalScan = scan(original, lang);
const translatedScan = scan(translated, lang);
const originalMasked = originalScan.masked.split('\n');
const translatedMasked = translatedScan.masked.split('\n');
const limit = Math.min(originalMasked.length, translatedMasked.length);
for (let i = 0; i < limit; i += 1) {
  if (originalMasked[i] !== translatedMasked[i]) {
    problems.push(`code changed at line ${i + 1}: ${JSON.stringify(translatedMasked[i].trim())}`);
    if (problems.length > 20) break;
  }
}

const leftover = translatedScan.literals.filter((literal) => hasCjk(literal.raw));
for (const literal of leftover.slice(0, 20)) {
  problems.push(`CJK literal at line ${literal.line}: ${JSON.stringify(literal.raw.slice(0, 80))}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`ok: ${translatedScan.literals.length} literals, no CJK, code unchanged`);
