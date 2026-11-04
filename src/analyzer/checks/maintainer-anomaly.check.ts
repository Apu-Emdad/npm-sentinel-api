import dayjs from 'dayjs';
import { CheckType, Severity } from '../../generated/prisma/enums.js';
import type {
  RegistryPackage,
  RegistryVersion,
} from '../../modules/packages/registry/registry.types.js';
import type { Check, CheckFinding } from '../analyzer.types.js';

/** A release this long after the previous one counts as a long gap. */
const LONG_GAP_DAYS = 730;

/** A package younger than this, with fewer weekly downloads than the limit, is new and unused. */
const NEW_PACKAGE_DAYS = 30;
const LOW_WEEKLY_DOWNLOADS = 100;

/**
 * CHECK: maintainer and publish anomalies
 *
 * Compares the scanned version with the version published just before it,
 * and looks at the package's age and downloads. Uses registry data only.
 */
export const maintainerAnomalyCheck: Check = {
  type: CheckType.maintainer_anomaly,
  run: async ({ registryPackage, registryVersion, weeklyDownloads }) => {
    const previous = getPreviousVersion(registryPackage, registryVersion);

    const findings = [
      previous ? findNewMaintainers(previous, registryVersion) : null,
      previous ? findLongGap(previous, registryVersion) : null,
      findNewAndUnused(registryPackage, weeklyDownloads),
    ];

    return findings.filter((finding) => finding !== null);
  },
};

/** The version published just before the scanned one, or null when there is none. */
const getPreviousVersion = (
  registryPackage: RegistryPackage,
  registryVersion: RegistryVersion,
) => {
  const publishedAt = registryVersion.publishedAt;
  if (!publishedAt) return null;

  const earlier = registryPackage.versions
    .filter(
      (item) =>
        item.publishedAt && dayjs(item.publishedAt).isBefore(publishedAt),
    )
    .sort((a, b) => dayjs(a.publishedAt).diff(b.publishedAt));

  return earlier.at(-1) ?? null;
};

/** Maintainers of the scanned version that the previous version did not have. */
const findNewMaintainers = (
  previous: RegistryVersion,
  current: RegistryVersion,
): CheckFinding | null => {
  const previousNames = new Set(previous.maintainers.map((item) => item.name));
  const added = current.maintainers
    .map((item) => item.name)
    .filter((name) => !previousNames.has(name));

  if (!added.length) return null;

  return {
    checkType: CheckType.maintainer_anomaly,
    severity: Severity.low,
    summary: `New maintainer since ${previous.version}: ${added.join(', ')}`,
    evidence: added.join(', '),
    details: {
      rule: 'new maintainer',
      previousVersion: previous.version,
      added,
    },
  };
};

/** A release that came after a long time without one. */
const findLongGap = (
  previous: RegistryVersion,
  current: RegistryVersion,
): CheckFinding | null => {
  const gapDays = dayjs(current.publishedAt).diff(previous.publishedAt, 'day');
  if (gapDays < LONG_GAP_DAYS) return null;

  return {
    checkType: CheckType.maintainer_anomaly,
    severity: Severity.low,
    summary: `Published ${gapDays} days after the previous version`,
    evidence: `${previous.version} on ${previous.publishedAt}, ${current.version} on ${current.publishedAt}`,
    details: {
      rule: 'long gap',
      previousVersion: previous.version,
      gapDays,
    },
  };
};

/** A package that is only days old and almost nobody downloads. */
const findNewAndUnused = (
  registryPackage: RegistryPackage,
  weeklyDownloads: number | null,
): CheckFinding | null => {
  if (!registryPackage.createdAt || weeklyDownloads === null) return null;

  const ageDays = dayjs().diff(registryPackage.createdAt, 'day');
  if (ageDays >= NEW_PACKAGE_DAYS || weeklyDownloads >= LOW_WEEKLY_DOWNLOADS) {
    return null;
  }

  return {
    checkType: CheckType.maintainer_anomaly,
    severity: Severity.medium,
    summary: `Package is ${ageDays} days old with ${weeklyDownloads} downloads last week`,
    evidence: `created on ${registryPackage.createdAt}, ${weeklyDownloads} weekly downloads`,
    details: { rule: 'new and unused', ageDays, weeklyDownloads },
  };
};
