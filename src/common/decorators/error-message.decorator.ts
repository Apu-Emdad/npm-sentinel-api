import { SetMetadata } from '@nestjs/common';

export const ERROR_MESSAGE_KEY = 'errorMessage';

/**
 * User-facing message for unexpected (500) errors on this route,
 * e.g. @ErrorMessage('An error occurred while logging in').
 * Routes without it get the generic 'Something went wrong'.
 */
export const ErrorMessage = (message: string) =>
  SetMetadata(ERROR_MESSAGE_KEY, message);
