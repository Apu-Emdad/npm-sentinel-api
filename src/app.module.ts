import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ErrorLoggerModule } from './common/error-logger/error-logger.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { ErrorMessageInterceptor } from './common/interceptors/error-message.interceptor.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { MailModule } from './infra/mail/mail.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { RolesGuard } from './modules/auth/roles.guard.js';
import { ScansModule } from './modules/scans/scans.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    MailModule,
    QueueModule,
    ErrorLoggerModule,
    AuthModule,
    UsersModule,
    ScansModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: AuthGuard sets request.user, RolesGuard reads it.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Passes the route's @ErrorMessage to HttpExceptionFilter.
    { provide: APP_INTERCEPTOR, useClass: ErrorMessageInterceptor },
    // Sends every error that escapes a request in the Result shape.
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
