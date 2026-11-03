import { Injectable } from '@nestjs/common';
import { RiskLevel } from '../generated/prisma/enums.js';
import { SEVERITY_WEIGHT } from './analyzer.constants.js';
import type {
  AnalysisResult,
  Check,
  CheckFinding,
  CheckInput,
} from './analyzer.types.js';
import { installScriptsCheck } from './checks/install-scripts.check.js';

/**
 * ANALYZER: runs every check on one package version
 *
 * Collects the findings, scores them and returns what the worker saves.
 * It only reads data; saving is the worker's job.
 */
@Injectable()
export class AnalyzerService {
  /** Every check a scan runs. New checks are added here. */
  private readonly checks: Check[] = [installScriptsCheck];

  async analyze(input: CheckInput): Promise<AnalysisResult> {
    // 1. running the checks; any check that throws fails the scan
    const results = await Promise.all(
      this.checks.map((check) => check.run(input)),
    );
    const findings = results.flat();

    // 2. scoring the findings
    const riskScore = this.getRiskScore(findings);

    // 3. returning the result
    return {
      findings,
      riskScore,
      riskLevel: this.getRiskLevel(riskScore),
      metadataSnapshot: this.getSnapshot(input),
    };
  }

  /** Adds up the weight of every finding, capped at 100. */
  private getRiskScore(findings: CheckFinding[]): number {
    const total = findings.reduce(
      (sum, finding) => sum + SEVERITY_WEIGHT[finding.severity],
      0,
    );
    return Math.min(total, 100);
  }

  /** 0 to 39 is low, 40 to 69 medium, 70 to 100 high. */
  private getRiskLevel(score: number): RiskLevel {
    if (score >= 70) return RiskLevel.high;
    if (score >= 40) return RiskLevel.medium;
    return RiskLevel.low;
  }

  /** The registry facts the checks saw, saved with the scan. */
  private getSnapshot({ registryVersion }: CheckInput) {
    return {
      version: registryVersion.version,
      publishedAt: registryVersion.publishedAt,
      publishedBy: registryVersion.publishedBy,
      maintainers: registryVersion.maintainers,
      scripts: registryVersion.scripts,
      dependencies: registryVersion.dependencies,
      optionalDependencies: registryVersion.optionalDependencies,
      peerDependencies: registryVersion.peerDependencies,
      unpackedSize: registryVersion.unpackedSize,
    };
  }
}
