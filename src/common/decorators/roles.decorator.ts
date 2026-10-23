import { SetMetadata } from '@nestjs/common';
import type { RoleName } from '../constants/roles.js';

export const ROLES_KEY = 'roles';

// Route needs a logged-in user with one of these roles, e.g. @Roles(ROLE.SUPER_ADMIN).
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
