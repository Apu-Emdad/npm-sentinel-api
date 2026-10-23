/**
 * Runs before dev, build, start and test scripts. Native modules (argon2) crash on older Node,
 * so stop early with a clear message instead of a segmentation fault.
 */
import { readFileSync } from 'node:fs';

const required = Number(
  readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim(),
);
const current = Number(process.versions.node.split('.')[0]);

if (current < required) {
  console.error(
    `\n  npm-sentinel needs Node ${required}, but this terminal uses Node ${process.versions.node}.\n` +
      `  Run: nvm use\n`,
  );
  process.exit(1);
}
