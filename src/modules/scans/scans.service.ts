import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import dayjs from 'dayjs';
import { QUEUE } from '../../common/constants/queues.js';
import type { Result } from '../../common/interfaces/result.interface.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ScanStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { RegistryService } from '../packages/registry/registry.service.js';
import type {
  RegistryPackage,
  RegistryVersion,
} from '../packages/registry/registry.types.js';
import { CreateScanDto } from './dto/create-scan.dto.js';

@Injectable()
export class ScansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RegistryService,
    @InjectQueue(QUEUE.SCANS) private readonly scanQueue: Queue,
  ) {}

  /**
   * Scans a package version; each version has one scan
   *
   * A version scanned before is scanned again on the same scan, with the same
   * uid. A scan that is still queued or running is returned as it is.
   */
  async createScan(dto: CreateScanDto, authUser?: AuthUser): Promise<Result> {
    // 1. finding the exact version on the npm registry; a missing package or version is a 404
    const registryPackage = await this.registry.getPackage(dto.packageName);
    const version = dto.version ?? registryPackage.distTags.latest;
    const registryVersion = registryPackage.versions.find(
      (item) => item.version === version,
    );
    if (!registryVersion?.tarballUrl) {
      throw new NotFoundException(
        `Version "${version}" of "${dto.packageName}" was not found`,
      );
    }

    // 2. saving the package and version rows if they are new
    const packageVersionId = await this.saveVersion(
      registryPackage,
      registryVersion,
    );

    // 3. returning a scan that is not done yet, so the version is never scanned twice at once
    const existing = await this.prisma.scan.findUnique({
      where: { packageVersionId },
      select: { uid: true, status: true, packageName: true, createdAt: true },
    });
    if (
      existing?.status === ScanStatus.queued ||
      existing?.status === ScanStatus.running
    ) {
      return {
        status: HttpStatus.ACCEPTED,
        message: 'Scan is already in progress',
        data: { ...existing, version },
      };
    }

    // 4. linking the scan to the logged-in user, if any
    const user = authUser
      ? await this.prisma.user.findUnique({
          where: { uid: authUser.uid },
          select: { id: true },
        })
      : null;

    // 5. creating the scan, or clearing the old result so it runs again
    const [, scan] = await this.prisma.$transaction([
      this.prisma.finding.deleteMany({
        where: { scanInfo: { packageVersionId } },
      }),
      this.prisma.scan.upsert({
        where: { packageVersionId },
        create: {
          packageName: registryPackage.name,
          packageVersionId,
          userId: user?.id,
        },
        // an anonymous rescan keeps the user who scanned it before
        update: {
          status: ScanStatus.queued,
          riskScore: null,
          riskLevel: null,
          error: null,
          metadataSnapshot: Prisma.DbNull,
          analyzerVersion: null,
          startedAt: null,
          completedAt: null,
          ...(user && { userId: user.id }),
        },
        select: { uid: true, status: true, packageName: true, createdAt: true },
      }),
    ]);

    /**
     * 6. adding a job to the scans queue (QUEUE: producer side)
     *
     * Saves the job in Redis under bull:scans:<scanUid>. The worker process
     * picks it up from there; the API never runs the scan itself. BullMQ
     * ignores a job whose id is taken, and failed jobs are kept for a while,
     * so the last run's job is removed first.
     */
    await this.scanQueue.remove(scan.uid);
    await this.scanQueue.add(
      'scan',
      { scanUid: scan.uid },
      {
        jobId: scan.uid,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return {
      status: HttpStatus.ACCEPTED,
      message: 'Scan queued successfully',
      data: { ...scan, version },
    };
  }

  async getScan(uid: string): Promise<Result> {
    const scan = await this.prisma.scan.findUnique({
      where: { uid },
      select: {
        uid: true,
        status: true,
        packageName: true,
        riskScore: true,
        riskLevel: true,
        error: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        packageVersionInfo: { select: { version: true } },
        findings: {
          orderBy: { createdAt: 'asc' },
          select: {
            checkType: true,
            severity: true,
            summary: true,
            evidence: true,
          },
        },
      },
    });

    if (!scan) {
      throw new NotFoundException('Scan not found');
    }

    return {
      status: HttpStatus.OK,
      message: 'Scan fetched successfully',
      data: {
        uid: scan.uid,
        status: scan.status,
        packageName: scan.packageName,
        version: scan.packageVersionInfo.version,
        riskScore: scan.riskScore,
        riskLevel: scan.riskLevel,
        findings: scan.findings,
        error: scan.error,
        createdAt: scan.createdAt,
        startedAt: scan.startedAt,
        completedAt: scan.completedAt,
      },
    };
  }

  /** Saves the package and version rows if they are new, and returns the version id. */
  private async saveVersion(
    registryPackage: RegistryPackage,
    registryVersion: RegistryVersion,
  ): Promise<bigint> {
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
          ? dayjs(registryVersion.publishedAt).toDate()
          : null,
        tarballUrl: registryVersion.tarballUrl ?? '',
        integrity: registryVersion.integrity,
      },
      select: { id: true },
    });

    return versionRow.id;
  }
}
