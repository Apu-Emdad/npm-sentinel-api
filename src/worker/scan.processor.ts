import { setTimeout } from 'node:timers/promises';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  GatewayTimeoutException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE } from '../common/constants/queues.js';
import { ScanError, ScanStatus } from '../generated/prisma/enums.js';
import { RegistryService } from '../modules/packages/registry/registry.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

const DB_CHECK_INTERVAL_MS = 5_000;

/**
 * PROCESSOR: runs one scan job
 *
 * @Processor(QUEUE.SCANS) makes BullMQ create a Worker for the scans queue in
 * the worker process. That Worker takes each job from Redis and calls
 * process() below with it; this class only holds what to do with one job.
 *
 * Marks the scan running, resolves the package version from the npm registry
 * and saves the package rows. A package that does not exist fails the scan at
 * once. Any other failure is rethrown so BullMQ retries the job, and the scan
 * is set to failed with a reason only on the last attempt.
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
  ) {
    super();
  }

  async process(job: Job<{ scanUid: string }>): Promise<void> {
    // 1. marking the scan as running
    const scan = await this.prisma.scan.update({
      where: { uid: job.data.scanUid },
      data: { status: ScanStatus.running, startedAt: new Date() },
      select: { id: true, packageName: true, requestedVersion: true },
    });

    try {
      // 2. resolving the version: the requested one, or the latest dist-tag
      const registryPackage = await this.registry.getPackage(scan.packageName);
      const version = scan.requestedVersion ?? registryPackage.distTags.latest;
      const registryVersion = registryPackage.versions.find(
        (item) => item.version === version,
      );

      if (!registryVersion) {
        await this.prisma.scan.update({
          where: { id: scan.id },
          data: {
            status: ScanStatus.failed,
            error: ScanError.version_not_found,
            completedAt: new Date(),
          },
        });
        return;
      }

      // 3. saving the package and version rows, only now that the registry confirmed them
      const packageRow = await this.prisma.package.upsert({
        where: { name: registryPackage.name },
        update: {},
        create: { name: registryPackage.name },
        select: { id: true },
      });
      const versionRow = await this.prisma.packageVersion.upsert({
        where: {
          packageId_version: {
            packageId: packageRow.id,
            version: registryVersion.version,
          },
        },
        update: {},
        create: {
          packageId: packageRow.id,
          version: registryVersion.version,
          publishedAt: registryVersion.publishedAt
            ? new Date(registryVersion.publishedAt)
            : null,
          tarballUrl: registryVersion.tarballUrl ?? '',
          integrity: registryVersion.integrity,
        },
        select: { id: true },
      });

      // 4. completing the scan; the analyzer (#23) will add the score later
      await this.prisma.scan.update({
        where: { id: scan.id },
        data: {
          status: ScanStatus.completed,
          packageVersionId: versionRow.id,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const reason =
        error instanceof NotFoundException
          ? ScanError.package_not_found
          : error instanceof GatewayTimeoutException
            ? ScanError.timeout
            : ScanError.internal_error;

      if (reason === ScanError.internal_error) {
        this.logger.error(`Scan ${job.data.scanUid} failed`, error);
      }

      // 5. rethrowing temporary failures so BullMQ retries; only the last attempt fails the scan
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (reason !== ScanError.package_not_found && !isLastAttempt) {
        throw error;
      }

      await this.prisma.scan.update({
        where: { id: scan.id },
        data: {
          status: ScanStatus.failed,
          error: reason,
          completedAt: new Date(),
        },
      });
    }
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
