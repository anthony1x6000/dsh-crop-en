#!/usr/bin/env node
/**
 * End-to-end check of the installed overlay.
 *
 *   node tools/verify-installed.mjs [path/to/agent-crop-dsh]
 *
 * Checks the package on disk (no CJK literals left), the host module the model
 * sees (protocol text is English), and the Python CLI help output.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadMaps, leftoverLiterals } from '../lib/patch.mjs';
import { locateTarget, upstreamVersion } from '../lib/target.mjs';

const HERE = new URL('..', import.meta.url).pathname;
const target = locateTarget({ explicit: process.argv[2] });
if (!target) {
  console.error('agent-crop-dsh not found; pass its directory as the first argument');
  process.exit(1);
}

const version = upstreamVersion(target);
const { maps } = loadMaps(join(HERE, 'translations'), version ?? '');
const failures = [];
const pass = (label) => console.log(`PASS ${label}`);

const leftovers = leftoverLiterals({ targetDir: target, maps });
if (leftovers.length === 0) pass('installed package has no Chinese string literals');
else {
  failures.push(`installed package has ${leftovers.length} Chinese literal(s), e.g. ${leftovers[0].file}:${leftovers[0].line}`);
}

let host;
try {
  host = await import(pathToFileURL(join(target, 'dsh/lib/index.js')).href);
  if (host.name === 'agent-crop-dsh') pass('host module imports');
  else failures.push(`host module name is ${String(host.name)}`);
  if (typeof host.PROTOCOL_TEXT === 'string' && host.PROTOCOL_TEXT.startsWith('Crop protocol')) {
    pass('crop protocol injected into the model is English');
  } else {
    failures.push('PROTOCOL_TEXT is not the English protocol');
  }
} catch (error) {
  failures.push(`host module failed to import: ${error instanceof Error ? error.message : String(error)}`);
}

const help = spawnSync('python3', [join(target, 'bin/crop'), '--help'], { encoding: 'utf8' });
if (help.status === 0 && help.stdout.includes('Agent Crop CLI') && !/[\u4e00-\u9fff]/.test(help.stdout + help.stderr)) {
  pass('crop --help prints English');
} else {
  failures.push(`crop --help still Chinese or failed (status ${help.status})`);
}

if (failures.length) {
  console.error(`\nFAIL\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nok: agent-crop-dsh ${version} at ${target} is English`);
