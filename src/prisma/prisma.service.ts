import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

// Connects lazily on the first query, so the app can boot without a database.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg(config.get('DATABASE_URL', { infer: true })),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
