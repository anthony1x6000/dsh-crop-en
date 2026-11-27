#!/usr/bin/env node
/**
 * Turn the translated copies in .tmp/en/ into the shipped dictionary.
 *
 *   node tools/derive-maps.mjs [stagedDir] [fixtureDir] [outDir]
 *
 * For each source file it pairs literals by position (translators must keep the
 * code skeleton intact), keeps the pairs that differ, and proves the result by
 * re-applying the pairs to the original: the outcome must equal the translated
 * file byte for byte.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyEntries, scan } from '../lib/scan.mjs';

const HERE = new URL('..', import.meta.url).pathname;
const fixtureDir = process.argv[3] ?? join(HERE, 'test/fixtures/agent-crop-0.8.4');
const stagedDir = process.argv[2] ?? join(HERE, '.tmp/en');
const outDir = process.argv[4] ?? join(HERE, 'translations/0.8.4');

const FILES = [
  { file: 'dsh/lib/client.js', staged: 'client.js', lang: 'js' },
  { file: 'dsh/lib/index.js', staged: 'index.js', lang: 'js' },
  { file: 'core/probe_core.py', staged: 'probe_core.py', lang: 'py' },
  { file: 'core/crop_serve.py', staged: 'crop_serve.py', lang: 'py' },
  { file: 'core/crop_voice.py', staged: 'crop_voice.py', lang: 'py' },
  { file: 'core/probe_core_cli.py', staged: 'probe_core_cli.py', lang: 'py' },
  { file: 'bin/crop', staged: 'crop', lang: 'py' },
];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

mkdirSync(outDir, { recursive: true });
let total = 0;
const failures = [];

for (const spec of FILES) {
  const original = readFileSync(join(fixtureDir, spec.file), 'utf8');
  const translatedPath = join(stagedDir, spec.staged);
  let translated;
  try {
    translated = readFileSync(translatedPath, 'utf8');
  } catch {
    failures.push(`${spec.file}: missing translated copy ${translatedPath}`);
    continue;
  }
  const originalScan = scan(original, spec.lang);
  const translatedScan = scan(translated, spec.lang);

  if (originalScan.masked !== translatedScan.masked) {
    failures.push(`${spec.file}: code skeleton changed (only literal text may differ)`);
    continue;
  }
  if (originalScan.literals.length !== translatedScan.literals.length) {
    failures.push(
      `${spec.file}: literal count ${translatedScan.literals.length} != ${originalScan.literals.length} (quote style changed?)`,
    );
    continue;
  }

  const entries = [];
  const seen = new Map();
  const nonCjk = [];
  originalScan.literals.forEach((before, index) => {
    const after = translatedScan.literals[index];
    if (before.raw === after.raw) return;
    if (!CJK.test(before.raw)) nonCjk.push({ line: before.line, before: before.raw.slice(0, 60), after: after.raw.slice(0, 60) });
    if (seen.has(before.raw) && seen.get(before.raw) !== after.raw) {
      failures.push(`${spec.file}: literal appears twice with different translations: ${JSON.stringify(before.raw.slice(0, 60))}`);
      return;
    }
    seen.set(before.raw, after.raw);
    if (entries.every(([from]) => from !== before.raw)) entries.push([before.raw, after.raw]);
  });

  const leftovers = translatedScan.literals.filter((literal) => CJK.test(literal.raw));
  if (leftovers.length) {
    failures.push(`${spec.file}: ${leftovers.length} CJK literals left (line ${leftovers[0].line})`);
    continue;
  }
  if (entries.length === 0) {
    failures.push(`${spec.file}: nothing translated`);
    continue;
  }

  const { out } = applyEntries(original, entries, spec.lang);
  const appliedScan = scan(out, spec.lang);
  if (appliedScan.masked !== translatedScan.masked) {
    const boundary = [...appliedScan.masked].findIndex((char, index) => char !== translatedScan.masked[index]);
    const line = appliedScan.masked.slice(0, boundary).split('\n').length;
    failures.push(`${spec.file}: dictionary changes the code skeleton (first diff line ${line})`);
    continue;
  }
  const appliedLiterals = JSON.stringify(appliedScan.literals.map((literal) => literal.raw));
  const translatedLiterals = JSON.stringify(translatedScan.literals.map((literal) => literal.raw));
  if (appliedLiterals !== translatedLiterals) {
    failures.push(`${spec.file}: dictionary does not reproduce every translated literal`);
    continue;
  }

  const slug = spec.file.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const map = {
    upstream: '0.8.4',
    file: spec.file,
    lang: spec.lang,
    sourceSha256: sha256(original),
    entries,
  };
  writeFileSync(join(outDir, `${slug}.json`), JSON.stringify(map, null, 2) + '\n');
  total += entries.length;
  console.log(`${spec.file.padEnd(26)} ${String(entries.length).padStart(4)} entries`);
  for (const item of nonCjk.slice(0, 5)) {
    console.log(`  note: non-CJK change line ${item.line}: ${JSON.stringify(item.before)} -> ${JSON.stringify(item.after)}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exit(1);
}
if (total === 0) {
  console.error('no entries derived');
  process.exit(1);
}
console.log(`\n${total} entries across ${FILES.length} files -> ${outDir}`);
