import { HttpException, HttpStatus } from '@nestjs/common';
import { FakeRedis } from '../../../test/fakes/fake-redis.js';
import { RateLimitService } from './rate-limit.service.js';
import type { RedisService } from './redis.service.js';

const input = (keys: string[]) => ({
  action: 'forgot-password',
  keys,
  limit: 2,
  windowSeconds: 900,
  message: 'Too many requests',
});

describe('RateLimitService', () => {
  let redis: FakeRedis;
  let rateLimit: RateLimitService;

  beforeEach(() => {
    redis = new FakeRedis();
    rateLimit = new RateLimitService(redis as unknown as RedisService);
  });

  it('allows hits up to the limit, then throws 429', async () => {
    await rateLimit.hit(input(['email:a@b.com']));
    await rateLimit.hit(input(['email:a@b.com']));

    const error = await rateLimit
      .hit(input(['email:a@b.com']))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect((error as HttpException).message).toBe('Too many requests');
  });

  it('counts each key on its own', async () => {
    await rateLimit.hit(input(['email:a@b.com', 'ip:1.1.1.1']));
    await rateLimit.hit(input(['email:a@b.com', 'ip:1.1.1.1']));

    // Same IP, another email: the IP is over the limit.
    await expect(
      rateLimit.hit(input(['email:c@d.com', 'ip:1.1.1.1'])),
    ).rejects.toThrow(HttpException);
    // Another IP and another email: still allowed.
    await rateLimit.hit(input(['email:e@f.com', 'ip:2.2.2.2']));
    expect(redis.store.get('rate:forgot-password:ip:2.2.2.2')).toBe('1');
  });
});
