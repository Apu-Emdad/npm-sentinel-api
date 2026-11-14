import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import { TokenService } from './token.service.js';

/**
 * Tokens
 *
 * Global module: it signs and checks JWTs and keeps refresh tokens in Redis.
 * Any module can inject TokenService or JwtService without importing this module.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
        },
      }),
    }),
  ],
  providers: [TokenService],
  exports: [TokenService],
})
export class TokenModule {}
