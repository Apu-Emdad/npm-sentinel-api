import { CheckType, Severity } from '../../generated/prisma/enums.js';
import type { Check } from '../analyzer.types.js';

/** Scripts npm runs by itself when the package is installed. */
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

/**
 * CHECK: install scripts
 *
 * Flags every script npm runs on install, since that is where most malicious
 * packages start. #24 adds what the scripts do (downloads, env access, ...).
 */
export const installScriptsCheck: Check = {
  type: CheckType.install_scripts,
  run: async ({ registryVersion }) => {
    return INSTALL_SCRIPTS.filter((name) => registryVersion.scripts[name]).map(
      (name) => ({
        checkType: CheckType.install_scripts,
        severity: Severity.medium,
        summary: `Runs a ${name} script on install`,
        evidence: registryVersion.scripts[name],
        details: { script: name },
      }),
    );
  },
};
