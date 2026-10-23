import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { ERROR_MESSAGE_KEY } from '../decorators/error-message.decorator.js';

declare module 'express' {
  interface Request {
    errorMessage?: string;
  }
}

/**
 * Global error message interceptor
 *
 * Copies the route's @ErrorMessage onto the request,
 * because HttpExceptionFilter can't see which handler ran.
 */
@Injectable()
export class ErrorMessageInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    request.errorMessage = this.reflector.getAllAndOverride<string | undefined>(
      ERROR_MESSAGE_KEY,
      [context.getHandler(), context.getClass()],
    );

    return next.handle();
  }
}
