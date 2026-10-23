import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ErrorLoggerModule } from './common/error-logger/error-logger.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { RolesGuard } from './modules/auth/roles.guard.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    ErrorLoggerModule,
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: AuthGuard sets request.user, RolesGuard reads it.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Thrown errors (validation, guards, HttpException) are sent in the Result shape.
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
