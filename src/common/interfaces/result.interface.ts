/**
 * Shape of every API response, success or error.
 * ResponseInterceptor builds it for successful requests, HttpExceptionFilter for errors.
 */
export interface Result {
  status: number;
  message: string;
  data?: any;
  error?: string;
  context?: string;
}
