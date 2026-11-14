import type { Result } from '../../common/interfaces/result.interface.js';

// The logged-in user attached to the request by AuthGuard.
export interface AuthUser {
  uid: string;
  userName: string;
  role: string;
}

/**
 * What register, login and refresh return.
 * The controller sends `result` and puts `refreshToken` in the cookie,
 * so the refresh token is never part of the response body.
 */
export interface AuthResult {
  result: Result;
  refreshToken: string;
  refreshExpiresIn: number;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
