import { CheckType, Severity } from '../../generated/prisma/enums.js';
import type { Check, CheckFinding } from '../analyzer.types.js';

/** Scripts npm runs by itself when the package is installed. */
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

/** Signs that an install script does more than build the package. */
const RISKY_PATTERNS = [
  {
    name: 'network call',
    summary: 'makes network calls',
    regex: /\b(curl|wget|nc|Invoke-WebRequest)\b|https?:\/\//i,
  },
  {
    name: 'shell execution',
    summary: 'runs shell commands',
    regex:
      /\|\s*(sh|bash)\b|\b(sh|bash)\s+-c\b|\beval\b|\bpowershell\b|child_process|\bexec\s*\(/i,
  },
  {
    name: 'encoded payload',
    summary: 'contains encoded data',
    regex: /base64|\batob\b|(\\x[0-9a-f]{2}){2,}|[A-Za-z0-9+/]{40,}={0,2}/i,
  },
];

/**
 * CHECK: install scripts
 *
 * Makes one finding per script npm runs on install. A script with a risky
 * pattern (network call, shell execution, encoded payload) is high; any other
 * install script is low, since most of them only build the package.
 * Reads the script text from the registry only, never runs it.
 */
export const installScriptsCheck: Check = {
  type: CheckType.install_scripts,
  run: async ({ registryVersion }) => {
    const findings: CheckFinding[] = [];

    for (const name of INSTALL_SCRIPTS) {
      const script = registryVersion.scripts[name];
      if (!script) continue;

      const matched = RISKY_PATTERNS.filter((pattern) =>
        pattern.regex.test(script),
      );
      const isRisky = matched.length > 0;

      findings.push({
        checkType: CheckType.install_scripts,
        severity: isRisky ? Severity.high : Severity.low,
        summary: isRisky
          ? `${name} script ${matched.map((pattern) => pattern.summary).join(' and ')}`
          : `${name} script runs on install`,
        evidence: script,
        details: {
          script: name,
          patterns: matched.map((pattern) => pattern.name),
        },
      });
    }

    return findings;
  },
};
