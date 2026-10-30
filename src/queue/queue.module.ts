import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/**
 * BullMQ connection
 *
 * Shared by the API (adds jobs) and the worker (runs them), so both use the
 * same Redis and the same default job options.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          db: config.get('REDIS_DB', { infer: true }),
        },
        defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 },
      }),
    }),
  ],
})
export class QueueModule {}
