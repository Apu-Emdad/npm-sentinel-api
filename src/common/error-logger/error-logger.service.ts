import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import type { Result } from '../interfaces/result.interface.js';

interface LogErrorInput {
  errorMessage: string;
  errorStack: unknown;
  context: string;
}

// Used in every service catch block: logs the unexpected error and returns a 500 Result.
@Injectable()
export class ErrorLoggerService {
  private readonly logger = new Logger(ErrorLoggerService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  logError({ errorMessage, errorStack, context }: LogErrorInput): Result {
    this.logger.error(errorMessage, errorStack, context);

    const isProduction =
      this.config.get('NODE_ENV', { infer: true }) === 'production';

    return {
      status: 500,
      message: errorMessage,
      // Raw error text can reveal internals (SQL, file paths), so it is only sent outside production.
      error: isProduction
        ? undefined
        : errorStack instanceof Error
          ? errorStack.message
          : String(errorStack),
      context,
    };
  }
}
