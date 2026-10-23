import type { Result } from '../../common/interfaces/result.interface.js';

// Claims inside the access token.
export interface JwtPayload {
  sub: string; // user uid
  userName: string;
  role: string;
}

// Claims inside the refresh token. `jti` identifies it in Redis.
export interface RefreshPayload {
  sub: string; // user uid
  jti: string;
}

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
