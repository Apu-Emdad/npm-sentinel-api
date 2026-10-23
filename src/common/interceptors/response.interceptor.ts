import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { map, Observable } from 'rxjs';
import { ERROR_MESSAGE_KEY } from '../decorators/error-message.decorator.js';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator.js';
import type { Result } from '../interfaces/result.interface.js';

declare module 'express' {
  interface Request {
    errorMessage?: string;
  }
}

/**
 * Global response interceptor.
 *
 * Success: wraps whatever the controller returns into a Result,
 * { status, message, data }, using the route's @ResponseMessage.
 *
 * Errors: copies the route's @ErrorMessage onto the request,
 * because HttpExceptionFilter can't see which handler ran.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<Result> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<Request>();

    request.errorMessage = this.reflector.getAllAndOverride<string | undefined>(
      ERROR_MESSAGE_KEY,
      targets,
    );
    const message =
      this.reflector.getAllAndOverride<string | undefined>(
        RESPONSE_MESSAGE_KEY,
        targets,
      ) ?? 'Success';
    const status = this.getStatusCode(context, request);

    return next
      .handle()
      .pipe(map((data: unknown) => ({ status, message, data: data ?? null })));
  }

  /**
   * Same rule Nest uses when it sends the response:
   * @HttpCode() if set, otherwise 201 for POST and 200 for everything else.
   */
  private getStatusCode(context: ExecutionContext, request: Request): number {
    const httpCode = this.reflector.get<number | undefined>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );
    if (httpCode) return httpCode;

    return request.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK;
  }
}
