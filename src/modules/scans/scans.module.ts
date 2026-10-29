import { Module } from '@nestjs/common';
import { ScanRateLimitGuard } from './scan-rate-limit.guard.js';
import { ScansController } from './scans.controller.js';
import { ScansService } from './scans.service.js';

@Module({
  controllers: [ScansController],
  providers: [ScansService, ScanRateLimitGuard],
})
export class ScansModule {}
