import dayjs from 'dayjs';
import { CheckType, Severity } from '../../generated/prisma/enums.js';
import type { RegistryVersion } from '../../modules/packages/registry/registry.types.js';
import type {
  Check,
  CheckFinding,
  DependencyStats,
} from '../analyzer.types.js';
import {
  LOW_WEEKLY_DOWNLOADS,
  NEW_PACKAGE_DAYS,
} from './maintainer-anomaly.check.js';
import { findLookalike, KNOWN_PACKAGES } from './typosquatting.check.js';

/** The worker looks up at most this many dependencies, so a scan stays fast. */
const MAX_DEPENDENCY_LOOKUPS = 20;

/**
 * Places a dependency can come from other than the npm registry
 *
 * Code from these skips npm's checks and can change at any time.
 */
const SOURCES = [
  {
    rule: 'url dependency',
    summary: 'Installs dependencies from a URL',
    severity: Severity.high,
    pattern: /^https?:\/\//i,
  },
  {
    rule: 'git dependency',
    summary: 'Installs dependencies from a git repository',
    severity: Severity.medium,
    // `git+https://...`, `github:user/repo` or the `user/repo` shorthand
    pattern:
      /^(git\+|git:\/\/|github:|gitlab:|bitbucket:|gist:)|^[\w-][\w.-]*\/[\w.-]+(#.*)?$/i,
  },
  {
    rule: 'local dependency',
    summary: 'Installs dependencies from a local path',
    severity: Severity.low,
    pattern: /^(file:|link:|\.\.?\/|\/|~\/)/,
  },
];

/**
 * CHECK: suspicious dependencies
 *
 * Looks at the dependencies users install: `dependencies`,
 * `optionalDependencies` and `peerDependencies` (npm 7+ installs those too).
 * Flags ones that come from a URL, git or a local path, names that look like
 * popular packages, and packages that are very new with almost no downloads.
 * Makes at most one finding per rule, listing every matching dependency.
 */
export const suspiciousDependencyCheck: Check = {
  type: CheckType.suspicious_dependency,
  run: async ({ registryVersion, dependencyStats }) => {
    const dependencies = getDependencies(registryVersion);

    const findings = [
      ...SOURCES.map((source) => findFromSource(dependencies, source)),
      findTyposquats(getRegistryNames(dependencies)),
      findNewAndUnused(dependencyStats),
    ];

    return findings.filter((finding) => finding !== null);
  },
};

/**
 * Registry dependencies the worker should look up
 *
 * Well-known packages are skipped, since they are never new or unused.
 */
export const getUnknownDependencies = (registryVersion: RegistryVersion) =>
  getRegistryNames(getDependencies(registryVersion))
    .filter((name) => !KNOWN_PACKAGES.has(name))
    .slice(0, MAX_DEPENDENCY_LOOKUPS);

/** The installed dependencies as `[name, spec]` pairs. */
const getDependencies = (registryVersion: RegistryVersion) =>
  Object.entries({
    ...registryVersion.dependencies,
    ...registryVersion.optionalDependencies,
    ...registryVersion.peerDependencies,
  });

/**
 * Names of the dependencies that come from the npm registry
 *
 * An alias like `"x": "npm:lodahs@1.0.0"` installs `lodahs`, so its real name
 * is used.
 */
const getRegistryNames = (dependencies: [string, string][]) => {
  const names = dependencies
    .filter(([, spec]) => !SOURCES.some((source) => source.pattern.test(spec)))
    .map(([name, spec]) => getAliasTarget(spec) ?? name);

  return [...new Set(names)];
};

/** The real package name behind an `npm:name@range` alias, or null when it is not one. */
const getAliasTarget = (spec: string) => {
  if (!spec.startsWith('npm:')) return null;

  const target = spec.slice('npm:'.length);
  // starting after the first character, so a scope's `@` is not taken as the version's
  const versionAt = target.indexOf('@', 1);
  return versionAt === -1 ? target : target.slice(0, versionAt);
};

const findFromSource = (
  dependencies: [string, string][],
  source: (typeof SOURCES)[number],
): CheckFinding | null => {
  const matches = dependencies.filter(([, spec]) => source.pattern.test(spec));
  if (!matches.length) return null;

  return {
    checkType: CheckType.suspicious_dependency,
    severity: source.severity,
    summary: `${source.summary}: ${matches.map(([name]) => name).join(', ')}`,
    evidence: matches.map(([name, spec]) => `${name}: ${spec}`).join(', '),
    details: {
      rule: source.rule,
      dependencies: Object.fromEntries(matches),
    },
  };
};

/** Dependencies whose names look like popular packages. */
const findTyposquats = (names: string[]): CheckFinding | null => {
  const matches = names.flatMap((name) => {
    const match = findLookalike(name);
    return match ? [{ name, ...match }] : [];
  });
  if (!matches.length) return null;

  return {
    checkType: CheckType.suspicious_dependency,
    severity: Severity.medium,
    summary: `Depends on packages that look like popular ones: ${matches.map((match) => match.name).join(', ')}`,
    evidence: matches
      .map((match) => `${match.name} looks like ${match.lookalike}`)
      .join(', '),
    details: { rule: 'typosquat dependency', dependencies: matches },
  };
};

/** Dependencies that are only days old and almost nobody downloads. */
const findNewAndUnused = (
  dependencyStats: DependencyStats[],
): CheckFinding | null => {
  const matches = dependencyStats.flatMap((stats) => {
    if (!stats.createdAt || stats.weeklyDownloads === null) return [];

    const ageDays = dayjs().diff(stats.createdAt, 'day');
    const isNewAndUnused =
      ageDays < NEW_PACKAGE_DAYS &&
      stats.weeklyDownloads < LOW_WEEKLY_DOWNLOADS;

    return isNewAndUnused
      ? [{ name: stats.name, ageDays, weeklyDownloads: stats.weeklyDownloads }]
      : [];
  });
  if (!matches.length) return null;

  return {
    checkType: CheckType.suspicious_dependency,
    severity: Severity.medium,
    summary: `Depends on very new packages with almost no downloads: ${matches.map((match) => match.name).join(', ')}`,
    evidence: matches
      .map(
        (match) =>
          `${match.name}: ${match.ageDays} days old, ${match.weeklyDownloads} downloads last week`,
      )
      .join(', '),
    details: { rule: 'new and unused dependency', dependencies: matches },
  };
};
