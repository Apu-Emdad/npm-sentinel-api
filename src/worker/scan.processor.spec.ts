import {
  BadGatewayException,
  GatewayTimeoutException,
  NotFoundException,
} from '@nestjs/common';
import type { Job } from 'bullmq';
import type { RegistryService } from '../modules/packages/registry/registry.service.js';
import type { PrismaService } from '../infra/prisma/prisma.service.js';
import { ScanProcessor } from './scan.processor.js';

// The DB check waits between tries; resolving at once keeps the tests fast.
vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

const JOB = {
  data: { scanUid: 'Ab3dE5gH7j' },
  attemptsMade: 0,
  opts: { attempts: 3 },
} as Job<{ scanUid: string }>;

const LAST_ATTEMPT_JOB = {
  data: { scanUid: 'Ab3dE5gH7j' },
  attemptsMade: 2,
  opts: { attempts: 3 },
} as Job<{ scanUid: string }>;

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

describe('ScanProcessor', () => {
  let prisma: {
    scan: { update: ReturnType<typeof vi.fn> };
    package: { upsert: ReturnType<typeof vi.fn> };
    packageVersion: { upsert: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
  };
  let registry: { getPackage: ReturnType<typeof vi.fn> };
  let processor: ScanProcessor;

  // The data of the last scan update, i.e. the final state of the scan.
  const lastScanUpdate = () => prisma.scan.update.mock.calls.at(-1)?.[0].data;

  beforeEach(() => {
    prisma = {
      scan: { update: vi.fn() },
      package: { upsert: vi.fn().mockResolvedValue({ id: 5n }) },
      packageVersion: { upsert: vi.fn().mockResolvedValue({ id: 9n }) },
      $queryRaw: vi.fn(),
    };
    prisma.scan.update.mockResolvedValueOnce({
      id: 1n,
      packageName: 'left-pad',
      requestedVersion: null,
    });
    registry = { getPackage: vi.fn() };
    processor = new ScanProcessor(
      prisma as unknown as PrismaService,
      registry as unknown as RegistryService,
    );
  });

  it('marks the scan running first', async () => {
    registry.getPackage.mockResolvedValue(REGISTRY_PACKAGE);

    await processor.process(JOB);

    const first = prisma.scan.update.mock.calls[0][0];
    expect(first.where).toEqual({ uid: 'Ab3dE5gH7j' });
    expect(first.data.status).toBe('running');
    expect(first.data.startedAt).toBeInstanceOf(Date);
  });

  it('completes the scan with the latest version when none was requested', async () => {
    registry.getPackage.mockResolvedValue(REGISTRY_PACKAGE);

    await processor.process(JOB);

    expect(prisma.package.upsert.mock.calls[0][0].create).toEqual({
      name: 'left-pad',
    });
    expect(prisma.packageVersion.upsert.mock.calls[0][0].create).toMatchObject({
      packageId: 5n,
      version: '1.3.0',
      publishedAt: new Date('2018-04-01T00:00:00.000Z'),
      integrity: 'sha512-new',
    });
    expect(lastScanUpdate()).toMatchObject({
      status: 'completed',
      packageVersionId: 9n,
    });
    expect(lastScanUpdate().completedAt).toBeInstanceOf(Date);
  });

  it('uses the requested version', async () => {
    prisma.scan.update.mockReset();
    prisma.scan.update.mockResolvedValueOnce({
      id: 1n,
      packageName: 'left-pad',
      requestedVersion: '1.2.0',
    });
    registry.getPackage.mockResolvedValue(REGISTRY_PACKAGE);

    await processor.process(JOB);

    expect(prisma.packageVersion.upsert.mock.calls[0][0].create.version).toBe(
      '1.2.0',
    );
  });

  it('fails with version_not_found when the version does not exist', async () => {
    prisma.scan.update.mockReset();
    prisma.scan.update.mockResolvedValueOnce({
      id: 1n,
      packageName: 'left-pad',
      requestedVersion: '9.9.9',
    });
    registry.getPackage.mockResolvedValue(REGISTRY_PACKAGE);

    await processor.process(JOB);

    expect(prisma.package.upsert).not.toHaveBeenCalled();
    expect(lastScanUpdate()).toMatchObject({
      status: 'failed',
      error: 'version_not_found',
    });
  });

  it('fails with package_not_found when the registry returns 404', async () => {
    registry.getPackage.mockRejectedValue(new NotFoundException());

    await processor.process(JOB);

    expect(prisma.package.upsert).not.toHaveBeenCalled();
    expect(lastScanUpdate()).toMatchObject({
      status: 'failed',
      error: 'package_not_found',
    });
  });

  it('rethrows a timeout so the job is retried', async () => {
    const error = new GatewayTimeoutException();
    registry.getPackage.mockRejectedValue(error);

    await expect(processor.process(JOB)).rejects.toBe(error);

    // only the running update was made, the scan is not failed yet
    expect(prisma.scan.update).toHaveBeenCalledTimes(1);
  });

  it('fails with timeout on the last attempt', async () => {
    registry.getPackage.mockRejectedValue(new GatewayTimeoutException());

    await processor.process(LAST_ATTEMPT_JOB);

    expect(lastScanUpdate()).toMatchObject({
      status: 'failed',
      error: 'timeout',
    });
  });

  it('rethrows any other error so the job is retried', async () => {
    const error = new BadGatewayException();
    registry.getPackage.mockRejectedValue(error);
    vi.spyOn(processor['logger'], 'error').mockImplementation(() => {});

    await expect(processor.process(JOB)).rejects.toBe(error);

    expect(prisma.scan.update).toHaveBeenCalledTimes(1);
  });

  it('fails with internal_error on the last attempt', async () => {
    registry.getPackage.mockRejectedValue(new BadGatewayException());
    vi.spyOn(processor['logger'], 'error').mockImplementation(() => {});

    await processor.process(LAST_ATTEMPT_JOB);

    expect(lastScanUpdate()).toMatchObject({
      status: 'failed',
      error: 'internal_error',
    });
  });

  describe('pauseWhileDatabaseIsDown', () => {
    let worker: {
      isPaused: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      resume: ReturnType<typeof vi.fn>;
      closing: Promise<void> | undefined;
    };

    beforeEach(() => {
      worker = {
        isPaused: vi.fn().mockReturnValue(false),
        pause: vi.fn(),
        resume: vi.fn(),
        closing: undefined,
      };
      Object.assign(processor, { _worker: worker });
      vi.spyOn(processor['logger'], 'warn').mockImplementation(() => {});
      vi.spyOn(processor['logger'], 'log').mockImplementation(() => {});
    });

    it('does nothing when the database is up', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await processor.pauseWhileDatabaseIsDown();

      expect(worker.pause).not.toHaveBeenCalled();
    });

    it('pauses while the database is down and resumes once it is back', async () => {
      prisma.$queryRaw
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce([]);

      await processor.pauseWhileDatabaseIsDown();

      expect(worker.pause).toHaveBeenCalledWith(true);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
      expect(worker.resume).toHaveBeenCalledTimes(1);
    });

    it('does not pause again when already paused', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('down'));
      worker.isPaused.mockReturnValue(true);

      await processor.pauseWhileDatabaseIsDown();

      expect(worker.pause).not.toHaveBeenCalled();
    });

    it('stops checking when the worker is closing', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('down'));
      worker.pause.mockImplementation(() => {
        worker.closing = Promise.resolve();
      });

      await processor.pauseWhileDatabaseIsDown();

      expect(worker.pause).toHaveBeenCalled();
      expect(worker.resume).not.toHaveBeenCalled();
    });
  });
});
