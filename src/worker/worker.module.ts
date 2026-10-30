import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '../common/constants/queues.js';
import { RegistryModule } from '../modules/packages/registry/registry.module.js';
import { ScanProcessor } from './scan.processor.js';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.SCANS }), RegistryModule],
  providers: [ScanProcessor],
})
export class WorkerModule {}
