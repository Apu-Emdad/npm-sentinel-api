import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from './redis.service.js';

interface RateLimitInput {
  // Name of the action, e.g. "forgot-password"
  action: string;
  // What is counted, e.g. ["email:a@b.com", "ip:1.2.3.4"]. Each one has its own counter.
  keys: string[];
  limit: number;
  windowSeconds: number;
  message: string;
}

/**
 * Fixed-window rate limit kept in Redis.
 *
 * Each key `rate:<action>:<key>` counts hits and expires when its window ends.
 * Throws 429 when any of the keys is over the limit.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async hit({
    action,
    keys,
    limit,
    windowSeconds,
    message,
  }: RateLimitInput): Promise<void> {
    for (const key of keys) {
      const redisKey = `rate:${action}:${key}`;
      const count = await this.redis.incr(redisKey);
      // The first hit starts the window.
      if (count === 1) await this.redis.expire(redisKey, windowSeconds);
      if (count > limit) {
        throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }
}
