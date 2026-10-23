import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Route works without a token. A valid token still sets the user; a bad one is ignored.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
