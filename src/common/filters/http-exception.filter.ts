import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Result } from '../interfaces/result.interface.js';

// Sends every thrown error in the Result shape.
// Validation errors put the list of problems in `data`; unexpected errors hide their details.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const context = `${req.method} ${req.path}`;

    if (!(exception instanceof HttpException)) {
      this.logger.error(exception, context);
      const result: Result = {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        error: 'Internal Server Error',
        context,
      };
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
