import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Route needs a logged-in user with one of these role names, e.g. @Roles('admin').
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
