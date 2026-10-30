import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../config/env.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { WorkerModule } from './worker.module.js';

/**
 * Root module of the worker process
 *
 * Runs scan jobs only: no HTTP server, controllers or auth.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    QueueModule,
    WorkerModule,
  ],
})
export class WorkerAppModule {}
