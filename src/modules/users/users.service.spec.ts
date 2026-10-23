import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import type { TokenService } from '../auth/token.service.js';
import { UsersService } from './users.service.js';

const ADMIN: AuthUser = {
  uid: 'admin-uid1',
  userName: 'admin',
  role: 'SUPER_ADMIN',
};
const USER_UID = 'k3F9x2Mq7A';

const selectedUser = {
  uid: USER_UID,
  userName: 'apu_emdad',
  email: 'apu@example.com',
  isActive: true,
  createdAt: new Date('2026-10-23T00:00:00Z'),
  roleInfo: { uid: 'role-uid01', name: 'USER' },
};

describe('UsersService', () => {
  let prisma: {
    user: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };
  let tokenService: { revokeAll: ReturnType<typeof vi.fn> };
  let usersService: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        count: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    tokenService = { revokeAll: vi.fn() };
    usersService = new UsersService(
      prisma as unknown as PrismaService,
      tokenService as unknown as TokenService,
    );
  });

  it('getUsers builds the filter, pages and maps uid to id', async () => {
    prisma.user.count.mockResolvedValue(1);
    prisma.user.findMany.mockResolvedValue([selectedUser]);

    const result = await usersService.getUsers({
      search: 'apu',
      role: 'USER',
      isActive: true,
      page: 2,
      pageSize: 5,
    });

    const args = prisma.user.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      OR: [
        { userName: { contains: 'apu', mode: 'insensitive' } },
        { email: { contains: 'apu', mode: 'insensitive' } },
      ],
      roleInfo: { name: 'USER' },
      isActive: true,
    });
    expect(args.skip).toBe(5);
    expect(args.take).toBe(5);
    expect(result.data).toEqual({
      total: 1,
      users: [
        {
          id: USER_UID,
          userName: 'apu_emdad',
          email: 'apu@example.com',
          isActive: true,
          createdAt: selectedUser.createdAt,
          roleInfo: { id: 'role-uid01', name: 'USER' },
        },
      ],
    });
  });

  it('getUser rejects an unknown uid', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(usersService.getUser(USER_UID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('deactivateUser deactivates and logs the user out everywhere', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 2n, isActive: true });

    const result = await usersService.deactivateUser(USER_UID, ADMIN);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: { isActive: false },
    });
    expect(tokenService.revokeAll).toHaveBeenCalledWith(USER_UID);
    expect(result.status).toBe(200);
  });

  it('deactivateUser rejects an already inactive user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 2n, isActive: false });

    await expect(usersService.deactivateUser(USER_UID, ADMIN)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a super admin cannot deactivate or delete their own account', async () => {
    await expect(usersService.deactivateUser(ADMIN.uid, ADMIN)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(usersService.deleteUser(ADMIN.uid, ADMIN)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('deleteUser deletes and logs the user out everywhere', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 2n });

    const result = await usersService.deleteUser(USER_UID, ADMIN);

    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 2n } });
    expect(tokenService.revokeAll).toHaveBeenCalledWith(USER_UID);
    expect(result.status).toBe(200);
  });

  it('deleteUser rejects an unknown uid', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(usersService.deleteUser(USER_UID, ADMIN)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });
});
