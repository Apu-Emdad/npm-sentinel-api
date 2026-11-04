import type {
  CheckType,
  RiskLevel,
  Severity,
} from '../generated/prisma/enums.js';
import type {
  PackageFile,
  RegistryPackage,
  RegistryVersion,
} from '../modules/packages/registry/registry.types.js';

/** Registry facts about one dependency of the scanned version. */
export interface DependencyStats {
  name: string;
  createdAt: string | null;
  /** Last week's downloads, or null when npm's stats could not be fetched. */
  weeklyDownloads: number | null;
}

/** What every check gets: the package, the version being scanned, its files and downloads. */
export interface CheckInput {
  registryPackage: RegistryPackage;
  registryVersion: RegistryVersion;
  files: PackageFile[];
  /** Last week's downloads, or null when npm's stats could not be fetched. */
  weeklyDownloads: number | null;
  /** Stats of the dependencies that are not well-known packages. */
  dependencyStats: DependencyStats[];
}

/** One problem a check found, with the evidence that triggered it. */
export interface CheckFinding {
  checkType: CheckType;
  severity: Severity;
  summary: string;
  evidence: string;
  details?: Record<string, unknown>;
}

/**
 * One analyzer check
 *
 * Reads the input and returns zero or more findings. A check never runs
 * package code. Throwing fails the whole scan, since a scan is only complete
 * when every check ran.
 */
export interface Check {
  type: CheckType;
  run: (input: CheckInput) => Promise<CheckFinding[]>;
}

export interface AnalysisResult {
  findings: CheckFinding[];
  riskScore: number;
  riskLevel: RiskLevel;
  /** The registry facts the checks saw, so the scan can be re-analyzed later. */
  metadataSnapshot: Record<string, unknown>;
}
