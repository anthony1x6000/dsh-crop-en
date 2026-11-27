#!/usr/bin/env node
/**
 * Manual apply / restore, for when the bundle is not installed (or you want to
 * re-run after upgrading agent-crop without restarting DSH first).
 *
 *   node tools/apply.mjs [target]
 *   node tools/apply.mjs --restore [target]
 */
import { join } from 'node:path';
import { loadMaps, patchTarget, restoreTarget } from '../lib/patch.mjs';
import { locateTarget, upstreamVersion } from '../lib/target.mjs';

const HERE = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const restore = args.includes('--restore');
const explicit = args.find((arg) => !arg.startsWith('--'));
const target = locateTarget({ explicit });

if (!target) {
  console.error('agent-crop-dsh not found. Pass its directory, or set CROP_EN_TARGET.');
  process.exit(1);
}

if (restore) {
  const report = restoreTarget({ targetDir: target });
  console.log(`restored ${report.restored.length} file(s) in ${target}`);
} else {
  const version = upstreamVersion(target);
  const { maps, dir } = loadMaps(join(HERE, 'translations'), version ?? '');
  const report = patchTarget({ targetDir: target, maps });
  console.log(`target   ${target} (agent-crop-dsh ${version})`);
  console.log(`dict     ${dir}`);
  console.log(`patched  ${report.counts.patched} file(s), ${report.counts.replaced} string(s)`);
  console.log(`skipped  ${report.counts.unchanged} already English, ${report.counts.stale} stale, ${report.counts.missingFile} missing file`);
  for (const warning of report.warnings) console.warn(`warning  ${warning}`);
  if (report.counts.patched > 0) console.log('restart DSH to load the English tool descriptions and protocol text');
}
