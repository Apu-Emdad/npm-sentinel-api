import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorLoggerService } from '../error-logger/error-logger.service.js';
import type { Result } from '../interfaces/result.interface.js';

const GENERIC_ERROR_MESSAGE = 'Something went wrong';

/**
 * Global error handler
 *
 * Sends every error that escapes a request in the Result shape.
 * - HTTP errors (validation, guards, thrown HttpExceptions) keep their status.
 *   Validation errors put the list of problems in `data`.
 * - Unexpected errors are logged and become a 500. Users get the route's
 *   @ErrorMessage text (or a generic one); the raw error is only included outside production.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly errorLogger: ErrorLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const context = `${req.method} ${req.path}`;

    if (!(exception instanceof HttpException)) {
      const result: Result = this.errorLogger.logError({
        errorMessage: req.errorMessage ?? GENERIC_ERROR_MESSAGE,
        errorStack: exception,
        context,
      });
      res.status(result.status).json(result);
      return;
    }

    const status = exception.getStatus();
    const body = exception.getResponse() as
      string | { message?: unknown; error?: string };
    const bodyMessage = typeof body === 'string' ? body : body.message;

    const result: Result = {
      status,
      message:
        typeof bodyMessage === 'string'
          ? bodyMessage
          : Array.isArray(bodyMessage)
            ? 'Validation failed'
            : exception.message,
      error:
        typeof body === 'string'
          ? exception.name
          : (body.error ?? exception.name),
      context,
    };
    if (Array.isArray(bodyMessage)) result.data = bodyMessage;

    res.status(status).json(result);
  }
}
