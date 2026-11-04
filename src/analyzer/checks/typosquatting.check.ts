import { npmHighImpact, npmTopDownloads } from 'npm-high-impact';
import { CheckType, Severity } from '../../generated/prisma/enums.js';
import type { Check } from '../analyzer.types.js';

/** About 16,000 most-downloaded packages, the names attackers imitate. The list is sorted by weekly downloads. */
const POPULAR_PACKAGES = npmTopDownloads;

/** About 17,000 packages popular by downloads or dependents; these are never flagged themselves. */
export const KNOWN_PACKAGES = new Set(npmHighImpact);

/** Shorter names are skipped by the one typo rule, since `ms`, `qs` and `ws` would match almost anything. */
const MIN_TYPO_LENGTH = 5;

/**
 * CHECK: typosquatting
 *
 * Flags a name that looks like a popular package but is not it. A look-alike
 * is the same once `-`, `_` and `.` are removed (`react_dom`), or one typo
 * away (`lodahs`, `expres`). Makes at most one finding, for the most-downloaded
 * match.
 */
export const typosquattingCheck: Check = {
  type: CheckType.typosquatting,
  run: async ({ registryPackage }) => {
    const match = findLookalike(registryPackage.name);
    if (!match) return [];

    return [
      {
        checkType: CheckType.typosquatting,
        severity: Severity.medium,
        summary: `Name looks like the popular package "${match.lookalike}"`,
        evidence: match.lookalike,
        details: match,
      },
    ];
  },
};

/** The most-downloaded popular package that `name` imitates, or null when it imitates none. */
export const findLookalike = (name: string) => {
  const lowerName = name.toLowerCase();
  if (KNOWN_PACKAGES.has(lowerName)) return null;

  for (const popular of POPULAR_PACKAGES) {
    const rule = getLookalikeRule(lowerName, popular);
    if (rule) return { lookalike: popular, rule };
  }

  return null;
};

/** Returns which rule makes the two names look alike, or null when they don't. */
const getLookalikeRule = (name: string, popular: string) => {
  const withoutSeparators = (value: string) => value.replace(/[-_.]/g, '');
  if (withoutSeparators(name) === withoutSeparators(popular)) {
    return 'separators';
  }

  if (
    name.length >= MIN_TYPO_LENGTH &&
    popular.length >= MIN_TYPO_LENGTH &&
    isOneTypoApart(name, popular)
  ) {
    return 'one typo';
  }

  return null;
};

/**
 * Whether one change turns `a` into `b`
 *
 * A change is one added, removed or replaced character, or two characters
 * next to each other swapped.
 */
const isOneTypoApart = (a: string, b: string): boolean => {
  if (Math.abs(a.length - b.length) > 1) return false;

  // skipping the start and end the names share
  let start = 0;
  while (start < a.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const restA = a.slice(start, endA);
  const restB = b.slice(start, endB);

  // one character added, removed or replaced
  if (restA.length <= 1 && restB.length <= 1) return restA !== restB;

  // two characters swapped
  return (
    restA.length === 2 &&
    restB.length === 2 &&
    restA[0] === restB[1] &&
    restA[1] === restB[0]
  );
};
