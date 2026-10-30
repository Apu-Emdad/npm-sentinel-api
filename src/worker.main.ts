import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker/worker-app.module.js';

/**
 * WORKER: entry point of the worker process
 *
 * Started with `yarn start:worker` or `node dist/worker.main`, separate from
 * the API (`main.ts`). Starts the scan worker without an HTTP server. Shutdown hooks close the
 * BullMQ worker on SIGTERM, which waits for the running job to finish.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  app.enableShutdownHooks();
  new Logger('Worker').log('npm-sentinel worker is running');
}

await bootstrap();
