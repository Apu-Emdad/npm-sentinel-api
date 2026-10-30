import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '../../common/constants/queues.js';
import { ScanRateLimitGuard } from './scan-rate-limit.guard.js';
import { ScansController } from './scans.controller.js';
import { ScansService } from './scans.service.js';

@Module({
  // QUEUE: gives ScansService the scans queue to add jobs to (producer side)
  imports: [BullModule.registerQueue({ name: QUEUE.SCANS })],
  controllers: [ScansController],
  providers: [ScansService, ScanRateLimitGuard],
})
export class ScansModule {}
