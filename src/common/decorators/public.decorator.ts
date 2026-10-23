import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Route works without a token. A valid token is still read, so the user is known when logged in.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
