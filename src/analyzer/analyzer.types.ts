import type {
  CheckType,
  RiskLevel,
  Severity,
} from '../generated/prisma/enums.js';
import type {
  RegistryPackage,
  RegistryVersion,
} from '../modules/packages/registry/registry.types.js';

/** What every check gets: the package and the version being scanned. */
export interface CheckInput {
  registryPackage: RegistryPackage;
  registryVersion: RegistryVersion;
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
