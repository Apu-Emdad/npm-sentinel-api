import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ROLE } from '../../common/constants/roles.js';
import type { Env } from '../../config/env.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import { ScanRateLimitGuard } from './scan-rate-limit.guard.js';

const LIMIT = 3;
const WINDOW = 3600;

const contextFor = (ip: string, role?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ ip, user: role && { role } }),
    }),
  }) as unknown as ExecutionContext;

describe('ScanRateLimitGuard', () => {
  let redis: {
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };
  let guard: ScanRateLimitGuard;

  beforeEach(() => {
    redis = { incr: vi.fn(), expire: vi.fn() };
    const config = {
      get: (key: string) => (key === 'SCAN_RATE_LIMIT' ? LIMIT : WINDOW),
    } as unknown as ConfigService<Env, true>;
    guard = new ScanRateLimitGuard(redis as unknown as RedisService, config);
  });

  it('starts the window on the first request', async () => {
    redis.incr.mockResolvedValue(1);

    await expect(guard.canActivate(contextFor('1.2.3.4'))).resolves.toBe(true);

    expect(redis.incr).toHaveBeenCalledWith('scan-rate:1.2.3.4');
    expect(redis.expire).toHaveBeenCalledWith('scan-rate:1.2.3.4', WINDOW);
  });

  it('allows requests up to the limit without resetting the window', async () => {
    redis.incr.mockResolvedValue(LIMIT);

    await expect(guard.canActivate(contextFor('1.2.3.4'))).resolves.toBe(true);

    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('rejects the request over the limit with 429', async () => {
    redis.incr.mockResolvedValue(LIMIT + 1);

    await expect(
      guard.canActivate(contextFor('1.2.3.4')),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('does not limit super admins', async () => {
    await expect(
      guard.canActivate(contextFor('1.2.3.4', ROLE.SUPER_ADMIN)),
    ).resolves.toBe(true);

    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('still limits regular users', async () => {
    redis.incr.mockResolvedValue(LIMIT + 1);

    await expect(
      guard.canActivate(contextFor('1.2.3.4', ROLE.USER)),
    ).rejects.toMatchObject({ status: 429 });
  });
});
