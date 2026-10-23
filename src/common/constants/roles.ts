/**
 * Role names, as stored in roles.name.
 * Use these instead of plain strings, e.g. @Roles(ROLE.SUPER_ADMIN).
 */
export const ROLE = {
  USER: 'USER',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;

export type RoleName = (typeof ROLE)[keyof typeof ROLE];
