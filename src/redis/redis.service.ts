import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';

// Connects lazily on the first command, so the app can boot without Redis.
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      db: config.get('REDIS_DB', { infer: true }),
      lazyConnect: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    // A lazy client that never connected has nothing to close gracefully.
    if (this.status === 'wait') {
      this.disconnect();
      return;
    }
    await this.quit();
  }
}
