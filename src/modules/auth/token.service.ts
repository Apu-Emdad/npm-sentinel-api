import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import { RedisService } from '../../redis/redis.service.js';
import type { JwtPayload, RefreshPayload } from './auth.types.js';

export interface TokenPair {
  accessToken: string;
  accessExpiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
}

/**
 * Issues access and refresh tokens and keeps refresh tokens in Redis.
 *
 * Each refresh token is stored as `refresh:<userUid>:<jti>` with a TTL equal to its lifetime.
 * - Rotation: a refresh token works once; using it deletes its key and issues a new pair.
 * - Reuse detection: a valid token whose key is already gone was used before
 *   (likely stolen), so every refresh token of that user is revoked.
 * - Logout deletes the key, so the token stops working immediately.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(payload: JwtPayload): Promise<TokenPair> {
    const accessExpiresIn = this.config.get('JWT_ACCESS_EXPIRES_IN', {
      infer: true,
    });
    const refreshExpiresIn = this.config.get('JWT_REFRESH_EXPIRES_IN', {
      infer: true,
    });
    const jti = randomUUID();
    const refreshPayload: RefreshPayload = { sub: payload.sub, jti };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: accessExpiresIn,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: refreshExpiresIn,
      }),
    ]);

    await this.redis.set(
      this.key(payload.sub, jti),
      '1',
      'EX',
      refreshExpiresIn,
    );

    return { accessToken, accessExpiresIn, refreshToken, refreshExpiresIn };
  }

  /**
   * Checks a refresh token and uses it up.
   * Returns the user's uid; the caller issues the new pair.
   */
  async consume(refreshToken: string | undefined): Promise<string> {
    const payload = await this.verify(refreshToken);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const deleted = await this.redis.unlink(this.key(payload.sub, payload.jti));
    if (deleted === 0) {
      await this.revokeAll(payload.sub);
      throw new UnauthorizedException(
        'Refresh token was already used; please log in again',
      );
    }

    return payload.sub;
  }

  // Logout: deletes the token's key. An invalid or missing token is ignored.
  async revoke(refreshToken: string | undefined): Promise<void> {
    const payload = await this.verify(refreshToken);
    if (payload) await this.redis.unlink(this.key(payload.sub, payload.jti));
  }

  async revokeAll(userUid: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        this.key(userUid, '*'),
        'COUNT',
        100,
      );
      if (keys.length) await this.redis.unlink(...keys);
      cursor = next;
    } while (cursor !== '0');
  }

  private async verify(
    refreshToken: string | undefined,
  ): Promise<RefreshPayload | null> {
    if (!refreshToken) return null;
    try {
      return await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      return null;
    }
  }

  private key(userUid: string, jti: string): string {
    return `refresh:${userUid}:${jti}`;
  }
}
