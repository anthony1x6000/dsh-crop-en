/**
 * dsh-crop-en — English overlay for the agent-crop-dsh plugin.
 *
 * agent-crop ships its UI in Chinese and has no locale layer, so there is
 * nothing to switch on. This bundle rewrites the installed package's string
 * literals once per release: the Web panel, the tool descriptions and protocol
 * text the model sees, and the Python CLI / hook output.
 *
 * Activation order does not matter for correctness: the files on disk are
 * translated at activation, so the next DSH start imports English. In the
 * running process the Python halves are already English (one process per call)
 * and the client bundle is re-served from disk.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadMaps, patchTarget } from './lib/patch.mjs';
import { locateTarget, upstreamVersion } from './lib/target.mjs';

export const name = 'dsh-crop-en';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRANSLATIONS = join(HERE, 'translations');

export function run(config = {}) {
  const targetDir = locateTarget({ explicit: config.target, profileDir: config.profileDir });
  if (!targetDir) {
    return { ok: false, reason: 'agent-crop-dsh is not installed in this profile' };
  }
  const version = upstreamVersion(targetDir);
  if (!existsSync(TRANSLATIONS)) {
    return { ok: false, targetDir, reason: `no translation sets at ${TRANSLATIONS}` };
  }
  const { dir, version: mapVersion, maps } = loadMaps(TRANSLATIONS, config.upstream || version || '');
  const report = patchTarget({ targetDir, maps, write: config.dryRun !== true });
  return { ok: true, targetDir, upstream: version, mapVersion, mapDir: dir, report };
}

export function apply(ctx, config = {}) {
  try {
    const result = run(config);
    if (!result.ok) {
      ctx.logger?.warn?.(`[crop-en] ${result.reason}`);
      return;
    }
    const { report } = result;
    const { patched, replaced, unchanged, stale, missingFile } = report.counts;
    const summary = `[crop-en] agent-crop-dsh ${result.upstream}: ${patched} file(s) translated (${replaced} strings), ${unchanged} already English, ${stale} stale, ${missingFile} missing`;
    if (patched > 0) {
      ctx.logger?.info?.(`${summary}; restart DSH to load the English tool descriptions and protocol text`);
    } else {
      ctx.logger?.info?.(summary);
    }
    for (const warning of report.warnings) ctx.logger?.warn?.(`[crop-en] ${warning}`);
  } catch (error) {
    ctx.logger?.warn?.(`[crop-en] translation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
