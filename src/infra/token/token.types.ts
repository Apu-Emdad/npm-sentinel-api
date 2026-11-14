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
