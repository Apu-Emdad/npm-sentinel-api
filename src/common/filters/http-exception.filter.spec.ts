import type { ArgumentsHost } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { ErrorLoggerService } from '../error-logger/error-logger.service.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

function makeHost(req: Record<string, unknown>) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

function makeFilter(nodeEnv: string) {
  const config = { get: () => nodeEnv } as unknown as ConfigService<Env, true>;
  return new HttpExceptionFilter(new ErrorLoggerService(config));
}

describe('HttpExceptionFilter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('uses the generic message when the route has no @ErrorMessage', () => {
    const { host, res } = makeHost({ method: 'GET', path: '/things' });

    makeFilter('development').catch(new Error('boom'), host);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      status: 500,
      message: 'Something went wrong',
      error: 'boom',
      context: 'GET /things',
    });
  });

  it('hides the raw error in production', () => {
    const { host, res } = makeHost({
      method: 'POST',
      path: '/auth/login',
      errorMessage: 'An error occurred while logging in',
    });

    makeFilter('production').catch(new Error('database is down'), host);

    expect(res.json).toHaveBeenCalledWith({
      status: 500,
      message: 'An error occurred while logging in',
      error: undefined,
      context: 'POST /auth/login',
    });
  });
});
