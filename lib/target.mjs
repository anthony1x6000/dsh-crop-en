/**
 * Finding the installed agent-crop-dsh package that this overlay translates.
 *
 * A profile install puts it at <profile>/node_modules/agent-crop-dsh; a linked
 * dev checkout or a non-profile host needs the fallbacks below.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export function isAgentCropPackage(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return pkg.name === 'agent-crop-dsh' && pkg.dsh?.bundle?.patch !== undefined;
  } catch {
    return false;
  }
}

export function upstreamVersion(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

function profileCandidates() {
  const profiles = join(dshHome(), 'profiles');
  if (!existsSync(profiles)) return [];
  return readdirSync(profiles)
    .map((name) => join(profiles, name, 'node_modules', 'agent-crop-dsh'))
    .filter((dir) => isAgentCropPackage(dir));
}

function resolveCandidates() {
  const require = createRequire(import.meta.url);
  const paths = [process.cwd()];
  if (process.env.DSH_PROFILE_DIR) paths.push(process.env.DSH_PROFILE_DIR);
  try {
    return [dirname(require.resolve('agent-crop-dsh/package.json', { paths }))];
  } catch {
    return [];
  }
}

export function locateTarget({ explicit, profileDir } = {}) {
  const candidates = [
    explicit,
    process.env.CROP_EN_TARGET,
    profileDir && join(profileDir, 'node_modules', 'agent-crop-dsh'),
    process.env.DSH_PROFILE_DIR && join(process.env.DSH_PROFILE_DIR, 'node_modules', 'agent-crop-dsh'),
    ...profileCandidates(),
    ...resolveCandidates(),
  ].filter(Boolean);
  for (const dir of candidates) if (isAgentCropPackage(dir)) return dir;
  return undefined;
}
