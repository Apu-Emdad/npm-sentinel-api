import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ROLE } from '../../common/constants/roles.js';
import type { Env } from '../../config/env.js';
import { RedisService } from '../../infra/redis/redis.service.js';

/**
 * Per-IP limit on POST /scans
 *
 * Counts requests in a Redis key that expires after the window.
 * Over the limit the request is rejected with 429.
 * Super admins are not limited.
 */
@Injectable()
export class ScanRateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { ip, user } = context.switchToHttp().getRequest<Request>();
    if (user?.role === ROLE.SUPER_ADMIN) {
      return true;
    }

    const limit = this.config.get('SCAN_RATE_LIMIT', { infer: true });
    const windowSeconds = this.config.get('SCAN_RATE_WINDOW', { infer: true });

    const key = `scan-rate:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSeconds);
    }

    if (count > limit) {
      throw new HttpException(
        'Too many scans. Try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
