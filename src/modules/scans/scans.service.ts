import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { Result } from '../../common/interfaces/result.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreateScanDto } from './dto/create-scan.dto.js';

@Injectable()
export class ScansService {
  constructor(private readonly prisma: PrismaService) {}

  async createScan(dto: CreateScanDto, authUser?: AuthUser): Promise<Result> {
    // 1. linking the scan to the logged-in user, if any
    const user = authUser
      ? await this.prisma.user.findUnique({
          where: { uid: authUser.uid },
          select: { id: true },
        })
      : null;

    // 2. saving the scan as queued
    const scan = await this.prisma.scan.create({
      data: {
        packageName: dto.packageName,
        requestedVersion: dto.version,
        userId: user?.id,
      },
      select: {
        uid: true,
        status: true,
        packageName: true,
        requestedVersion: true,
        createdAt: true,
      },
    });

    return {
      status: HttpStatus.ACCEPTED,
      message: 'Scan queued successfully',
      data: {
        uid: scan.uid,
        status: scan.status,
        packageName: scan.packageName,
        version: scan.requestedVersion,
        createdAt: scan.createdAt,
      },
    };
  }

  async getScan(uid: string): Promise<Result> {
    const scan = await this.prisma.scan.findUnique({
      where: { uid },
      select: {
        uid: true,
        status: true,
        packageName: true,
        requestedVersion: true,
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
        version: scan.packageVersionInfo?.version ?? scan.requestedVersion,
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
}
