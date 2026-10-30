import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '../common/constants/queues.js';
import { RegistryModule } from '../modules/packages/registry/registry.module.js';
import { ScanProcessor } from './scan.processor.js';

/**
 * WORKER: scan job consumer
 *
 * Registers the scans queue on the consumer side and provides ScanProcessor,
 * which BullMQ turns into a Worker that pulls jobs from Redis. Loaded only by
 * the worker process (WorkerAppModule), never by the API.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.SCANS }), RegistryModule],
  providers: [ScanProcessor],
})
export class WorkerModule {}
