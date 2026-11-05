import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import dayjs from 'dayjs';
import semver from 'semver';
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
import { CreateBulkScanDto } from './dto/create-bulk-scan.dto.js';
import { CreateScanDto, PACKAGE_NAME_PATTERN } from './dto/create-scan.dto.js';

/** How many registry lookups a bulk scan runs at the same time. */
const REGISTRY_BATCH_SIZE = 10;

/** Dependency versions whose code is not on the npm registry, so they are skipped. */
const NOT_ON_REGISTRY = [
  {
    pattern: /^(?:git\+|git:|github:|gitlab:|bitbucket:)/,
    reason: 'Git dependencies are not scanned',
  },
  { pattern: /^https?:/, reason: 'URL dependencies are not scanned' },
  {
    pattern: /^(?:file:|link:|portal:|\.{0,2}\/|~\/)/,
    reason: 'Local dependencies are not scanned',
  },
  { pattern: /^workspace:/, reason: 'Workspace packages are not scanned' },
  // GitHub shorthand like user/repo; npm version ranges never contain a slash
  { pattern: /^[^:@]+\//, reason: 'Git dependencies are not scanned' },
];

/** One entry of package.json `dependencies`; `range` is the text as written. */
interface Dependency {
  packageName: string;
  range: string;
  isDev: boolean;
}

interface SkippedDependency extends Dependency {
  reason: string;
}

/** The registry package and range to scan; differs from the key for `npm:` aliases. */
interface ScanTarget extends Dependency {
  name: string;
  versionRange: string;
}

interface ResolvedTarget {
  target: ScanTarget;
  registryPackage: RegistryPackage;
  registryVersion: RegistryVersion;
}

/** The fields of package.json a bulk scan reads. */
interface PackageJson {
  name?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

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
    const userId = await this.findUserId(authUser);

    // 5. creating the scan, or clearing the old result, and queueing it
    const scan = await this.queueScan(
      packageVersionId,
      registryPackage.name,
      userId,
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

  /**
   * Scans every dependency of a package.json
   *
   * Each registry package becomes its own scan, grouped under one bulk scan.
   * A version scanned before is reused; only a failed one is scanned again.
   * Dependencies that can't be scanned are saved as skipped, with a reason.
   */
  async createBulkScan(
    dto: CreateBulkScanDto,
    authUser?: AuthUser,
  ): Promise<Result> {
    // 1. reading the dependencies; bad JSON or no dependencies is a 400
    const { name, dependencies } = this.readDependencies(
      dto.packageJson,
      dto.includeDev ?? false,
    );

    // 2. setting aside dependencies that are not npm registry packages
    const skipped: SkippedDependency[] = [];
    const targets: ScanTarget[] = [];
    for (const dependency of dependencies) {
      const target = this.toScanTarget(dependency);
      if ('reason' in target) skipped.push(target);
      else targets.push(target);
    }

    // 3. finding each exact version on the registry, a few packages at a time
    const resolved: ResolvedTarget[] = [];
    for (let i = 0; i < targets.length; i += REGISTRY_BATCH_SIZE) {
      const batch = targets.slice(i, i + REGISTRY_BATCH_SIZE);
      const results = await Promise.all(
        batch.map((target) => this.resolveTarget(target)),
      );
      for (const result of results) {
        if ('reason' in result) skipped.push(result);
        else resolved.push(result);
      }
    }

    /**
     * 4. saving the versions and queueing the ones without a usable scan
     *
     * One at a time, since two aliases can point to the same version.
     */
    const userId = await this.findUserId(authUser);
    const items: Prisma.ManifestDependencyCreateWithoutManifestInfoInput[] = [];
    for (const { target, registryPackage, registryVersion } of resolved) {
      const packageVersionId = await this.saveVersion(
        registryPackage,
        registryVersion,
      );
      const existing = await this.prisma.scan.findUnique({
        where: { packageVersionId },
        select: { status: true },
      });
      if (!existing || existing.status === ScanStatus.failed) {
        await this.queueScan(packageVersionId, registryPackage.name, userId);
      }
      items.push({
        packageName: target.packageName,
        range: target.range,
        isDev: target.isDev,
        scanInfo: { connect: { packageVersionId } },
      });
    }

    // 5. saving the manifest with one row per scanned dependency
    const manifest = await this.prisma.manifest.create({
      data: {
        userId,
        name,
        includeDev: dto.includeDev ?? false,
        skipped: skipped as unknown as Prisma.InputJsonValue,
        manifestDependencies: { create: items },
      },
      select: { uid: true, createdAt: true },
    });

    return {
      status: HttpStatus.ACCEPTED,
      message: 'Bulk scan queued successfully',
      data: { ...manifest, total: items.length, skipped: skipped.length },
    };
  }

  async getBulkScan(uid: string): Promise<Result> {
    const manifest = await this.prisma.manifest.findUnique({
      where: { uid },
      select: {
        uid: true,
        name: true,
        includeDev: true,
        skipped: true,
        createdAt: true,
        manifestDependencies: {
          orderBy: { packageName: 'asc' },
          select: {
            packageName: true,
            range: true,
            isDev: true,
            scanInfo: {
              select: {
                uid: true,
                status: true,
                riskScore: true,
                riskLevel: true,
                packageVersionInfo: { select: { version: true } },
                // the enum is declared low, medium, high, so desc puts high first
                findings: {
                  orderBy: { severity: 'desc' },
                  select: { severity: true, summary: true },
                },
              },
            },
          },
        },
      },
    });

    if (!manifest) {
      throw new NotFoundException('Bulk scan not found');
    }

    const items = manifest.manifestDependencies.map(
      ({ packageName, range, isDev, scanInfo }) => {
        const findings = { high: 0, medium: 0, low: 0 };
        for (const finding of scanInfo.findings) {
          findings[finding.severity] += 1;
        }

        return {
          packageName,
          range,
          isDev,
          scanUid: scanInfo.uid,
          version: scanInfo.packageVersionInfo.version,
          status: scanInfo.status,
          riskScore: scanInfo.riskScore,
          riskLevel: scanInfo.riskLevel,
          findings,
          topFinding: scanInfo.findings[0]?.summary ?? null,
        };
      },
    );

    // a scan is done once it has completed or failed
    const done = items.filter(
      (item) =>
        item.status === ScanStatus.completed ||
        item.status === ScanStatus.failed,
    ).length;

    // a completed scan with no findings is clean, not low risk
    const counts = { high: 0, medium: 0, low: 0, clean: 0 };
    for (const item of items) {
      if (item.status !== ScanStatus.completed || !item.riskLevel) continue;
      if (!item.topFinding) counts.clean += 1;
      else counts[item.riskLevel] += 1;
    }

    return {
      status: HttpStatus.OK,
      message: 'Bulk scan fetched successfully',
      data: {
        uid: manifest.uid,
        name: manifest.name,
        includeDev: manifest.includeDev,
        createdAt: manifest.createdAt,
        progress: { done, total: items.length },
        counts,
        items,
        skipped: manifest.skipped,
      },
    };
  }

  /** Returns the id of the logged-in user, or undefined for an anonymous visitor. */
  private async findUserId(authUser?: AuthUser): Promise<bigint | undefined> {
    if (!authUser) return undefined;

    const user = await this.prisma.user.findUnique({
      where: { uid: authUser.uid },
      select: { id: true },
    });
    return user?.id;
  }

  /**
   * Creates the scan of a version, or clears its old result, and queues it
   *
   * Findings and the old result are removed in one transaction, so a rerun
   * never mixes old and new findings.
   */
  private async queueScan(
    packageVersionId: bigint,
    packageName: string,
    userId?: bigint,
  ) {
    const [, scan] = await this.prisma.$transaction([
      this.prisma.finding.deleteMany({
        where: { scanInfo: { packageVersionId } },
      }),
      this.prisma.scan.upsert({
        where: { packageVersionId },
        create: { packageName, packageVersionId, userId },
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
          ...(userId && { userId }),
        },
        select: { uid: true, status: true, packageName: true, createdAt: true },
      }),
    ]);

    /**
     * Adding a job to the scans queue (QUEUE: producer side)
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

    return scan;
  }

  /**
   * Reads `dependencies`, and `devDependencies` when asked, from package.json text
   *
   * Also returns the package.json `name`, or null. A name in both lists is
   * read once, from `dependencies`. Throws BadRequestException for text that
   * is not a JSON object, or a file without dependencies.
   */
  private readDependencies(
    packageJson: string,
    includeDev: boolean,
  ): { name: string | null; dependencies: Dependency[] } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(packageJson);
    } catch {
      throw new BadRequestException('package.json is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('package.json must be a JSON object');
    }

    const { name, dependencies: prod, devDependencies } = parsed as PackageJson;
    const lists = [{ list: prod, isDev: false }];
    if (includeDev) lists.push({ list: devDependencies, isDev: true });

    const dependencies = new Map<string, Dependency>();
    for (const { list, isDev } of lists) {
      if (!list || typeof list !== 'object') continue;
      for (const [packageName, range] of Object.entries(list)) {
        if (dependencies.has(packageName)) continue;
        dependencies.set(packageName, {
          packageName,
          range: String(range),
          isDev,
        });
      }
    }

    if (!dependencies.size) {
      throw new BadRequestException('package.json has no dependencies');
    }

    return {
      name: typeof name === 'string' && name.trim() ? name.trim() : null,
      dependencies: [...dependencies.values()],
    };
  }

  /**
   * Turns a dependency into the registry package to scan, or a skip reason
   *
   * `npm:` aliases scan the real package. Git, URL, local and workspace
   * dependencies are skipped, since their code is not on the registry.
   */
  private toScanTarget(dependency: Dependency): ScanTarget | SkippedDependency {
    const range = dependency.range.trim();

    for (const { pattern, reason } of NOT_ON_REGISTRY) {
      if (pattern.test(range)) return { ...dependency, reason };
    }

    // npm:real-name@range, where the real name can be scoped
    let name = dependency.packageName;
    let versionRange = range;
    if (range.startsWith('npm:')) {
      const alias = range.slice('npm:'.length);
      const at = alias.lastIndexOf('@');
      name = at > 0 ? alias.slice(0, at) : alias;
      versionRange = at > 0 ? alias.slice(at + 1) : '';
    }

    if (!PACKAGE_NAME_PATTERN.test(name)) {
      return { ...dependency, reason: 'Not a valid npm package name' };
    }

    return { ...dependency, name, versionRange };
  }

  /**
   * Finds the exact version npm would install for a range
   *
   * Like npm, the `latest` dist-tag wins when it fits the range; otherwise
   * the highest version that fits is used. A dist-tag like `next` works too.
   */
  private async resolveTarget(
    target: ScanTarget,
  ): Promise<ResolvedTarget | SkippedDependency> {
    const skip = (reason: string): SkippedDependency => ({
      packageName: target.packageName,
      range: target.range,
      isDev: target.isDev,
      reason,
    });

    let registryPackage: RegistryPackage;
    try {
      registryPackage = await this.registry.getPackage(target.name);
    } catch (error) {
      return skip(
        error instanceof NotFoundException
          ? 'Package was not found on npm'
          : 'npm registry could not be reached',
      );
    }

    const versions = registryPackage.versions.map((item) => item.version);
    const latest = registryPackage.distTags.latest;
    const tagged = Object.hasOwn(registryPackage.distTags, target.versionRange)
      ? registryPackage.distTags[target.versionRange]
      : undefined;
    const version =
      tagged ??
      (latest && semver.satisfies(latest, target.versionRange)
        ? latest
        : semver.maxSatisfying(versions, target.versionRange));

    const registryVersion = registryPackage.versions.find(
      (item) => item.version === version,
    );
    if (!registryVersion?.tarballUrl) {
      return skip(`No version matches "${target.versionRange}"`);
    }

    return { target, registryPackage, registryVersion };
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
