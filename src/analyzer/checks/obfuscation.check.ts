import { CheckType, Severity } from '../../generated/prisma/enums.js';
import type { Check, CheckFinding } from '../analyzer.types.js';

const JS_FILE = /\.(c|m)?js$/;

/** Folders and names where minified code is normal. */
const BUILD_OUTPUT = /(^|\/)(dist|build|bundles?|umd|min)\/|\.min\.js$/;

const SNIPPET_LENGTH = 120;

/**
 * Signs of hidden code
 *
 * `find` returns where in the file the sign starts, or -1 when the file does
 * not have it.
 */
const RULES = [
  {
    name: 'obfuscator names',
    summary: 'Code uses obfuscator-style names like _0x1a2b',
    severity: Severity.high,
    find: (text: string) => findRepeated(text, /\b_0x[0-9a-f]{4,}\b/gi, 10),
  },
  {
    name: 'heavy eval',
    summary: 'Code calls eval or new Function many times',
    severity: Severity.medium,
    find: (text: string) =>
      findRepeated(text, /\beval\s*\(|\bnew\s+Function\s*\(/g, 5),
  },
  {
    name: 'encoded string',
    summary: 'Code contains a long encoded string',
    severity: Severity.low,
    find: (text: string) => text.search(/['"`][A-Za-z0-9+/]{200,}={0,2}['"`]/),
  },
  {
    name: 'minified source',
    summary: 'Source file is minified',
    severity: Severity.low,
    find: (text: string, path: string) => {
      if (BUILD_OUTPUT.test(path) || text.length <= 2_000) return -1;
      const averageLineLength = text.length / text.split('\n').length;
      return averageLineLength >= 300 ? 0 : -1;
    },
  },
];

/**
 * CHECK: obfuscation
 *
 * Reads the package's JS files and looks for code that hides what it does:
 * obfuscator-style names, heavy eval, long encoded strings and minified
 * source outside build folders. Makes at most one finding per rule, with
 * the first matching file and a snippet as evidence.
 */
export const obfuscationCheck: Check = {
  type: CheckType.obfuscation,
  run: async ({ files }) => {
    const jsFiles = files
      .filter((file) => JS_FILE.test(file.path))
      .map((file) => ({ path: file.path, text: file.content.toString() }));

    const findings: CheckFinding[] = [];

    for (const rule of RULES) {
      const matches = jsFiles
        .map((file) => ({ ...file, index: rule.find(file.text, file.path) }))
        .filter((match) => match.index !== -1);
      if (!matches.length) continue;

      const [first] = matches;
      const snippet = first.text.slice(
        first.index,
        first.index + SNIPPET_LENGTH,
      );

      findings.push({
        checkType: CheckType.obfuscation,
        severity: rule.severity,
        summary: rule.summary,
        evidence: `${first.path}: ${snippet}`,
        details: {
          rule: rule.name,
          file: first.path,
          matchedFiles: matches.length,
        },
      });
    }

    return findings;
  },
};

/** Where `regex` first matches, but only when it matches at least `minCount` times. */
const findRepeated = (text: string, regex: RegExp, minCount: number) => {
  const matches = [...text.matchAll(regex)];
  return matches.length >= minCount ? matches[0].index : -1;
};
