/**
 * Translation overlay for an installed agent-crop-dsh package.
 *
 * The dictionary in translations/<upstream>/ is applied to literal spans only
 * (see lib/scan.mjs), so a replacement can never rewrite code or comments by
 * accident. Applied state lives beside the package in .crop-en/, which makes a
 * second run a no-op and lets a newer upstream release be translated again.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { applyEntries, hasCjk, scan } from './scan.mjs';

export const STATE_DIR = '.crop-en';

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function loadMaps(translationsRoot, version) {
  const byVersion = join(translationsRoot, version);
  const root = existsSync(byVersion) ? byVersion : pickLatestVersion(translationsRoot);
  if (!root) throw new Error(`no translation sets under ${translationsRoot}`);
  const maps = readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const map = JSON.parse(readFileSync(join(root, name), 'utf8'));
      if (typeof map.file !== 'string' || (map.lang !== 'js' && map.lang !== 'py') || !Array.isArray(map.entries)) {
        throw new Error(`malformed translation map ${join(root, name)}`);
      }
      return map;
    });
  return { dir: root, version: root.split('/').at(-1), maps };
}

function pickLatestVersion(root) {
  if (!existsSync(root)) return undefined;
  const versions = readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort(compareVersions);
  return versions.length ? join(root, versions.at(-1)) : undefined;
}

function compareVersions(a, b) {
  const parse = (value) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function writeAtomic(path, text) {
  const tmp = `${path}.crop-en.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function readManifest(stateDir) {
  const path = join(stateDir, 'manifest.json');
  if (!existsSync(path)) return { files: {} };
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    return { files: manifest.files ?? {}, version: manifest.version };
  } catch {
    return { files: {} };
  }
}

/**
 * Apply every map to targetDir.
 * Returns a report; never throws for a single bad file, so a host activation
 * cannot be taken down by a stale dictionary.
 */
export function patchTarget({ targetDir, maps, write = true, now = new Date().toISOString() }) {
  const stateDir = join(targetDir, STATE_DIR);
  const previous = readManifest(stateDir);
  const report = {
    targetDir,
    version: undefined,
    files: [],
    warnings: [],
    counts: { patched: 0, replaced: 0, unchanged: 0, stale: 0, missingFile: 0 },
  };
  if (write) mkdirSync(stateDir, { recursive: true });

  for (const map of maps) {
    report.version = map.upstream;
    const path = join(targetDir, map.file);
    if (!existsSync(path)) {
      report.files.push({ file: map.file, status: 'missing-file' });
      report.counts.missingFile += 1;
      continue;
    }
    const text = readFileSync(path, 'utf8');
    const hash = sha256(text);
    if (previous.files[map.file]?.sha256 === hash) {
      report.files.push({ file: map.file, status: 'unchanged' });
      report.counts.unchanged += 1;
      continue;
    }
    const { out, replaced, missing } = applyEntries(text, map.entries, map.lang);
    if (replaced === 0) {
      report.files.push({ file: map.file, status: 'stale', missing: missing.length });
      report.counts.stale += 1;
      report.warnings.push(`${map.file}: dictionary matched nothing (already English, or upstream changed)`);
      previous.files[map.file] = { sha256: hash };
      continue;
    }
    if (write) {
      const backup = join(stateDir, 'originals', map.file);
      if (!existsSync(backup)) {
        mkdirSync(dirname(backup), { recursive: true });
        copyFileSync(path, backup);
      }
      writeAtomic(path, out);
    }
    const after = sha256(out);
    previous.files[map.file] = { sha256: after };
    report.files.push({ file: map.file, status: 'patched', replaced, missing: missing.length });
    report.counts.patched += 1;
    report.counts.replaced += replaced;
    if (missing.length) {
      report.warnings.push(
        `${map.file}: ${missing.length} dictionary strings no longer present upstream (${missing.slice(0, 3).map(shorten).join(' | ')})`,
      );
    }
  }

  if (write) {
    writeAtomic(
      join(stateDir, 'manifest.json'),
      JSON.stringify({ version: report.version, appliedAt: now, files: previous.files }, null, 2) + '\n',
    );
  }
  return report;
}

function shorten(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 40 ? `${flat.slice(0, 37)}...` : flat;
}

/** Put the pre-translation files back (uninstall path). */
export function restoreTarget({ targetDir }) {
  const stateDir = join(targetDir, STATE_DIR);
  const originals = join(stateDir, 'originals');
  const report = { targetDir, restored: [] };
  if (!existsSync(originals)) return report;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      const rel = relative(originals, path);
      writeAtomic(join(targetDir, rel), readFileSync(path));
      report.restored.push(rel);
    }
  };
  walk(originals);
  return report;
}

/** CJK literals still present in targetDir — the coverage gate. */
export function leftoverLiterals({ targetDir, maps }) {
  const leftovers = [];
  for (const map of maps) {
    const path = join(targetDir, map.file);
    if (!existsSync(path)) continue;
    const { literals } = scan(readFileSync(path, 'utf8'), map.lang);
    for (const literal of literals) {
      if (hasCjk(literal.raw)) leftovers.push({ file: map.file, line: literal.line, text: literal.raw.slice(0, 80) });
    }
  }
  return leftovers;
}
