import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FakeRedis } from '../../../test/fakes/fake-redis.js';
import type { Env } from '../../config/env.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import { TokenService } from './token.service.js';

const env: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 'a-test-access-secret-at-least-32-chars',
  JWT_REFRESH_SECRET: 'a-test-refresh-secret-at-least-32-chars',
  JWT_ACCESS_EXPIRES_IN: 900,
  JWT_REFRESH_EXPIRES_IN: 604800,
};
const payload = { sub: 'k3F9x2Mq7A', userName: 'apu_emdad', role: 'USER' };

describe('TokenService', () => {
  let redis: FakeRedis;
  let jwtService: JwtService;
  let tokenService: TokenService;

  beforeEach(() => {
    redis = new FakeRedis();
    jwtService = new JwtService();
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService<Env, true>;
    tokenService = new TokenService(
      jwtService,
      redis as unknown as RedisService,
      config,
    );
  });

  it('issues signed tokens and stores the refresh token in Redis', async () => {
    const tokens = await tokenService.issue(payload);

    expect(
      await jwtService.verifyAsync(tokens.accessToken, {
        secret: env.JWT_ACCESS_SECRET as string,
      }),
    ).toMatchObject(payload);
    const refresh = await jwtService.verifyAsync(tokens.refreshToken, {
      secret: env.JWT_REFRESH_SECRET as string,
    });
    expect(redis.store.has(`refresh:k3F9x2Mq7A:${refresh.jti}`)).toBe(true);
    expect(tokens.accessExpiresIn).toBe(900);
    expect(tokens.refreshExpiresIn).toBe(604800);
  });

  it('signs the two tokens with different secrets', async () => {
    const tokens = await tokenService.issue(payload);

    await expect(
      jwtService.verifyAsync(tokens.refreshToken, {
        secret: env.JWT_ACCESS_SECRET as string,
      }),
    ).rejects.toThrow();
  });

  it('consume returns the user uid and uses the token up', async () => {
    const { refreshToken } = await tokenService.issue(payload);

    expect(await tokenService.consume(refreshToken)).toBe('k3F9x2Mq7A');
    expect(redis.store.size).toBe(0);
  });

  it('reusing a refresh token revokes all of the user tokens', async () => {
    const first = await tokenService.issue(payload);
    await tokenService.consume(first.refreshToken);
    await tokenService.issue(payload); // the rotated token
    await tokenService.issue(payload); // another device

    await expect(tokenService.consume(first.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(redis.store.size).toBe(0);
  });

  it('rejects a missing or invalid token', async () => {
    await expect(tokenService.consume(undefined)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(tokenService.consume('not-a-jwt')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('revoke deletes the token, so it no longer works', async () => {
    const { refreshToken } = await tokenService.issue(payload);

    await tokenService.revoke(refreshToken);

    expect(redis.store.size).toBe(0);
    await expect(tokenService.consume(refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
