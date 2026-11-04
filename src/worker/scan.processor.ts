import { setTimeout } from 'node:timers/promises';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  GatewayTimeoutException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Job } from 'bullmq';
import dayjs from 'dayjs';
import {
  ANALYZER_VERSION,
  SCAN_TIMEOUT_MS,
} from '../analyzer/analyzer.constants.js';
import { AnalyzerService } from '../analyzer/analyzer.service.js';
import type {
  AnalysisResult,
  DependencyStats,
} from '../analyzer/analyzer.types.js';
import { getUnknownDependencies } from '../analyzer/checks/suspicious-dependency.check.js';
import { QUEUE } from '../common/constants/queues.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ScanError, ScanStatus } from '../generated/prisma/enums.js';
import { RegistryService } from '../modules/packages/registry/registry.service.js';
import type { RegistryVersion } from '../modules/packages/registry/registry.types.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

const DB_CHECK_INTERVAL_MS = 5_000;

/**
 * PROCESSOR: runs one scan job
 *
 * @Processor(QUEUE.SCANS) makes BullMQ create a Worker for the scans queue in
 * the worker process. That Worker takes each job from Redis and calls
 * process() below with it; this class only holds what to do with one job.
 *
 * Marks the scan running, gets the scan's package version from the npm
 * registry, downloads its files, runs the analyzer, then saves the findings
 * and score. The API saved the package and version rows already. The fetch
 * and analysis must finish within SCAN_TIMEOUT_MS. A package that no longer
 * exists, or a tarball that is too large, fails the scan at once. Any other failure is rethrown so BullMQ
 * retries the job, and the scan is set to failed with a reason only on the
 * last attempt.
 *
 * If the database goes down, the worker pauses and resumes once it is back,
 * so queued jobs don't use up their attempts during the outage.
 */
@Processor(QUEUE.SCANS)
export class ScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ScanProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RegistryService,
    private readonly analyzer: AnalyzerService,
  ) {
    super();
  }

  async process(job: Job<{ scanUid: string }>): Promise<void> {
    // 1. marking the scan as running
    const scan = await this.prisma.scan.update({
      where: { uid: job.data.scanUid },
      data: { status: ScanStatus.running, startedAt: dayjs().toDate() },
      select: {
        id: true,
        packageName: true,
        packageVersionInfo: { select: { version: true } },
      },
    });

    try {
      // 2. fetching and analyzing within the time limit; nothing is saved until this is done
      const result = await this.withTimeout(
        this.fetchAndAnalyze(scan.packageName, scan.packageVersionInfo.version),
        SCAN_TIMEOUT_MS,
      );

      if (!result) {
        await this.failScan(scan.id, ScanError.version_not_found);
        return;
      }

      // 3. saving the findings and the score
      await this.completeScan(scan.id, result);
    } catch (error) {
      const reason =
        error instanceof NotFoundException
          ? ScanError.package_not_found
          : error instanceof PayloadTooLargeException
            ? ScanError.tarball_too_large
            : error instanceof GatewayTimeoutException
              ? ScanError.timeout
              : ScanError.internal_error;

      if (reason === ScanError.internal_error) {
        this.logger.error(`Scan ${job.data.scanUid} failed`, error);
      }

      // 4. rethrowing temporary failures so BullMQ retries; only the last attempt fails the scan
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const isPermanent =
        reason === ScanError.package_not_found ||
        reason === ScanError.tarball_too_large;
      if (!isPermanent && !isLastAttempt) {
        throw error;
      }

      await this.failScan(scan.id, reason);
    }
  }

  /**
   * Gets the version from the registry and runs the analyzer on it
   *
   * Returns null when the version no longer exists, e.g. it was unpublished
   * after the scan was queued. The version's files are held in memory only and
   * dropped when the scan ends. Only reads, so it is safe to abandon on timeout.
   */
  private async fetchAndAnalyze(packageName: string, version: string) {
    const registryPackage = await this.registry.getPackage(packageName);
    const registryVersion = registryPackage.versions.find(
      (item) => item.version === version,
    );

    if (!registryVersion?.tarballUrl) return null;

    const [files, weeklyDownloads, dependencyStats] = await Promise.all([
      this.registry.getFiles(registryVersion.tarballUrl, packageName),
      this.getWeeklyDownloads(packageName),
      this.getDependencyStats(registryVersion),
    ]);
    return this.analyzer.analyze({
      registryPackage,
      registryVersion,
      files,
      weeklyDownloads,
      dependencyStats,
    });
  }

  /**
   * Last week's downloads of the package
   *
   * Returns 0 when npm has no download stats for it yet, which happens to
   * packages published in the last day or so. Returns null when the stats
   * could not be fetched, since they alone should not fail the scan.
   */
  private async getWeeklyDownloads(name: string): Promise<number | null> {
    return this.registry
      .getWeeklyDownloads(name)
      .then((stats) => stats.downloads)
      .catch((error: unknown) =>
        error instanceof NotFoundException ? 0 : null,
      );
  }

  /**
   * Creation date and downloads of the dependencies that are not well-known
   *
   * Looks them all up at once. A dependency that cannot be fetched is left
   * out, since it alone should not fail the scan.
   */
  private async getDependencyStats(
    registryVersion: RegistryVersion,
  ): Promise<DependencyStats[]> {
    const stats = await Promise.all(
      getUnknownDependencies(registryVersion).map((name) =>
        Promise.all([
          this.registry.getPackage(name),
          this.getWeeklyDownloads(name),
        ])
          .then(([dependency, weeklyDownloads]) => ({
            name,
            createdAt: dependency.createdAt,
            weeklyDownloads,
          }))
          .catch(() => null),
      ),
    );

    return stats.filter((item) => item !== null);
  }

  /** Saves the findings and completes the scan together, so a retry never finds half a result. */
  private async completeScan(
    scanId: bigint,
    result: AnalysisResult,
  ): Promise<void> {
    const findings = result.findings.map((finding) => ({
      scanId,
      checkType: finding.checkType,
      severity: finding.severity,
      summary: finding.summary,
      evidence: finding.evidence,
      details: finding.details as Prisma.InputJsonValue | undefined,
    }));

    await this.prisma.$transaction([
      this.prisma.finding.createMany({ data: findings }),
      this.prisma.scan.update({
        where: { id: scanId },
        data: {
          status: ScanStatus.completed,
          riskScore: result.riskScore,
          riskLevel: result.riskLevel,
          metadataSnapshot: result.metadataSnapshot as Prisma.InputJsonValue,
          analyzerVersion: ANALYZER_VERSION,
          completedAt: dayjs().toDate(),
        },
      }),
    ]);
  }

  private async failScan(scanId: bigint, reason: ScanError): Promise<void> {
    await this.prisma.scan.update({
      where: { id: scanId },
      data: {
        status: ScanStatus.failed,
        error: reason,
        completedAt: dayjs().toDate(),
      },
    });
  }

  /**
   * Rejects with a GatewayTimeoutException when the promise takes longer than `ms`
   *
   * The work itself is not stopped, so only wrap work that has no side effects.
   * Uses the global setTimeout, since the one imported above only waits.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = globalThis.setTimeout(
        () => reject(new GatewayTimeoutException('Scan timed out')),
        ms,
      );
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * Pauses the worker while the database is down
   *
   * Runs after every failed attempt. A failure may mean the database is down,
   * so it is checked directly instead of guessing from the error. While it is
   * down the worker takes no new jobs; it checks again every few seconds and
   * resumes once the database answers.
   */
  @OnWorkerEvent('failed')
  async pauseWhileDatabaseIsDown(): Promise<void> {
    // checking isPaused after the await, so two failures at once pause only once
    if ((await this.isDatabaseUp()) || this.worker.isPaused()) return;

    this.logger.warn('Database is unreachable, pausing the worker');
    await this.worker.pause(true);

    while (!this.worker.closing) {
      await setTimeout(DB_CHECK_INTERVAL_MS);
      if (await this.isDatabaseUp()) {
        await this.worker.resume();
        this.logger.log('Database is back, resuming the worker');
        return;
      }
    }
  }

  private async isDatabaseUp(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
