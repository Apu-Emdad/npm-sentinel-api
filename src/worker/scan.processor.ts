import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  GatewayTimeoutException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE } from '../common/constants/queues.js';
import { ScanError, ScanStatus } from '../generated/prisma/enums.js';
import { RegistryService } from '../modules/packages/registry/registry.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Runs queued scans
 *
 * Marks the scan running, resolves the package version from the npm registry
 * and saves the package rows. A package that does not exist fails the scan at
 * once. Any other failure is rethrown so BullMQ retries the job, and the scan
 * is set to failed with a reason only on the last attempt.
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
}
