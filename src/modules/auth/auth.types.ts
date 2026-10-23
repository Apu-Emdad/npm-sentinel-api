// Claims inside the access token.
export interface JwtPayload {
  sub: string; // user uid
  userName: string;
  role: string;
}

// The logged-in user attached to the request by AuthGuard.
export interface AuthUser {
  uid: string;
  userName: string;
  role: string;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
