import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { leftoverLiterals, loadMaps, patchTarget, restoreTarget } from '../lib/patch.mjs';
import { hasCjk, scan } from '../lib/scan.mjs';
import { run } from '../index.js';
import { locateTarget } from '../lib/target.mjs';

const HERE = new URL('..', import.meta.url).pathname;
const FIXTURE = join(HERE, 'test/fixtures/agent-crop-0.8.4');
const TRANSLATIONS = join(HERE, 'translations');
const TEMP_ROOT = join(HERE, '.tmp');
mkdirSync(TEMP_ROOT, { recursive: true });

function copyFixture() {
  const dir = mkdtempSync(join(TEMP_ROOT, 'crop-en-'));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test('dictionaries exist for the vendored release and cover every source file', () => {
  const { maps } = loadMaps(TRANSLATIONS, '0.8.4');
  assert.ok(maps.length >= 6, `expected at least 6 maps, got ${maps.length}`);
  for (const map of maps) {
    assert.ok(map.entries.length > 0, `${map.file} has no entries`);
    assert.ok(existsSync(join(FIXTURE, map.file)), `${map.file} missing from fixture`);
  }
});

test('patching the fixture removes every Chinese literal and keeps the code valid', () => {
  const dir = copyFixture();
  try {
    const { maps } = loadMaps(TRANSLATIONS, '0.8.4');
    const report = patchTarget({ targetDir: dir, maps });
    assert.equal(report.counts.patched, maps.length, JSON.stringify(report.warnings));
    assert.equal(report.counts.stale, 0, JSON.stringify(report.warnings));
    assert.deepEqual(leftoverLiterals({ targetDir: dir, maps }), []);

    for (const map of maps) {
      if (map.lang === 'js') {
        const check = spawnSync(process.execPath, ['--check', join(dir, map.file)], { encoding: 'utf8' });
        assert.equal(check.status, 0, `${map.file}: ${check.stderr}`);
      } else {
        const env = { ...process.env, PYTHONPYCACHEPREFIX: join(TEMP_ROOT, 'pycache') };
        const check = spawnSync('python3', ['-m', 'py_compile', join(dir, map.file)], { encoding: 'utf8', env });
        assert.equal(check.status, 0, `${map.file}: ${check.stderr}`);
      }
    }

    for (const map of maps) {
      const original = readFileSync(join(FIXTURE, map.file), 'utf8');
      const patched = readFileSync(join(dir, map.file), 'utf8');
      assert.equal(scan(original, map.lang).masked, scan(patched, map.lang).masked, `${map.file} code changed`);
      for (const [from, to] of map.entries) {
        assert.notEqual(from, to, `${map.file}: no-op entry ${JSON.stringify(from)}`);
        assert.equal(hasCjk(to), false, `${map.file}: translation still Chinese: ${JSON.stringify(to)}`);
      }
    }

    const patched = readFileSync(join(dir, 'dsh/lib/index.js'), 'utf8');
    assert.match(patched, /Crop protocol/);
    assert.match(readFileSync(join(dir, 'core/probe_core.py'), 'utf8'), /\[crop\]/);
  } finally {
    cleanup(dir);
  }
});

test('a second run is a no-op', () => {
  const dir = copyFixture();
  try {
    const { maps } = loadMaps(TRANSLATIONS, '0.8.4');
    patchTarget({ targetDir: dir, maps });
    const again = patchTarget({ targetDir: dir, maps });
    assert.equal(again.counts.patched, 0);
    assert.equal(again.counts.unchanged, maps.length);
  } finally {
    cleanup(dir);
  }
});

test('a changed upstream string is reported, the rest still translates', () => {
  const dir = copyFixture();
  try {
    const { maps } = loadMaps(TRANSLATIONS, '0.8.4');
    const map = maps.find((entry) => entry.file === 'bin/crop');
    const [from] = [...map.entries].sort((a, b) => b[0].length - a[0].length)[0];
    const target = join(dir, 'bin/crop');
    writeFileSync(target, readFileSync(target, 'utf8').replace(from, 'upstream changed this'));
    const report = patchTarget({ targetDir: dir, maps });
    const entry = report.files.find((file) => file.file === 'bin/crop');
    assert.equal(entry.status, 'patched');
    assert.ok(report.warnings.some((warning) => warning.includes('no longer present upstream')));
  } finally {
    cleanup(dir);
  }
});

test('a file nothing matches any more is marked stale and left alone', () => {
  const dir = copyFixture();
  try {
    const { maps } = loadMaps(TRANSLATIONS, '0.8.4');
    const map = maps.find((entry) => entry.file === 'bin/crop');
    let text = readFileSync(join(dir, 'bin/crop'), 'utf8');
    for (const [from] of map.entries) text = text.split(from).join('gone');
    const target = join(dir, 'bin/crop');
    writeFileSync(target, text);
    const before = readFileSync(target, 'utf8');
    const report = patchTarget({ targetDir: dir, maps });
    const entry = report.files.find((file) => file.file === 'bin/crop');
    assert.equal(entry.status, 'stale');
    assert.equal(readFileSync(target, 'utf8'), before);
  } finally {
    cleanup(dir);
  }
});

test('restore puts the original Chinese files back', () => {
  const dir = copyFixture();
  try {
    const before = readFileSync(join(dir, 'core/probe_core.py'), 'utf8');
    const { maps } = loadMaps(TRANSLATIONS, '0.8.4');
    patchTarget({ targetDir: dir, maps });
    assert.notEqual(readFileSync(join(dir, 'core/probe_core.py'), 'utf8'), before);
    restoreTarget({ targetDir: dir });
    assert.equal(readFileSync(join(dir, 'core/probe_core.py'), 'utf8'), before);
  } finally {
    cleanup(dir);
  }
});

test('run() patches an explicit target and reports it', () => {
  const dir = copyFixture();
  try {
    const result = run({ target: dir });
    assert.equal(result.ok, true);
    assert.equal(result.upstream, '0.8.4');
    assert.ok(result.report.counts.patched > 0);
    assert.equal(locateTarget({ explicit: dir }), dir);
  } finally {
    cleanup(dir);
  }
});
