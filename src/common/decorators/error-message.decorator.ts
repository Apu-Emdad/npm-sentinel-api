import { SetMetadata } from '@nestjs/common';

export const ERROR_MESSAGE_KEY = 'errorMessage';

/**
 * Optional user-facing message for unexpected (500) errors on one route.
 *
 * Routes normally don't set it and get the default 'An error occurred'
 * (GENERIC_ERROR_MESSAGE in http-exception.filter.ts).
 */
export const ErrorMessage = (message: string) =>
  SetMetadata(ERROR_MESSAGE_KEY, message);
