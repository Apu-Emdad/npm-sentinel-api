import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Result } from '../../common/interfaces/result.interface.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { TokenService } from '../auth/token.service.js';
import { UsersQueryDto } from './users.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async getUsers(query: UsersQueryDto): Promise<Result> {
    const page = query.page ? query.page - 1 : 0;
    const pageSize = query.pageSize ?? 10;

    // 1. building the filter
    const filter: Prisma.UserWhereInput = {};

    if (query.search) {
      filter.OR = [
        { userName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.role) {
      filter.roleInfo = { name: query.role };
    }

    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    // 2. fetching the users
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where: filter }),
      this.prisma.user.findMany({
        skip: page * pageSize,
        take: pageSize,
        where: filter,
        orderBy: { createdAt: 'desc' },
        select: {
          uid: true,
          userName: true,
          email: true,
          isActive: true,
          createdAt: true,
          roleInfo: { select: { uid: true, name: true } },
        },
      }),
    ]);

    // 3. returning the result
    return {
      status: HttpStatus.OK,
      message: 'Users fetched successfully',
      data: { users, total },
    };
  }

  async getUser(uid: string): Promise<Result> {
    const user = await this.prisma.user.findUnique({
      where: { uid },
      select: {
        uid: true,
        userName: true,
        email: true,
        isActive: true,
        createdAt: true,
        roleInfo: { select: { uid: true, name: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      status: HttpStatus.OK,
      message: 'User fetched successfully',
      data: user,
    };
  }

  async deactivateUser(uid: string, authUser: AuthUser): Promise<Result> {
    // 1. finding the user: a super admin can't deactivate their own account
    if (uid === authUser.uid) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

    const user = await this.prisma.user.findUnique({
      where: { uid },
      select: { id: true, isActive: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isActive) {
      throw new ConflictException('User is already inactive');
    }

    // 2. deactivating the user
    await this.prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    // 3. logging the user out everywhere
    await this.tokenService.revokeAll(uid);

    return { status: HttpStatus.OK, message: 'User deactivated successfully' };
  }

  async deleteUser(uid: string, authUser: AuthUser): Promise<Result> {
    // 1. finding the user: a super admin can't delete their own account
    if (uid === authUser.uid) {
      throw new ForbiddenException('You cannot delete your own account');
    }

    const user = await this.prisma.user.findUnique({
      where: { uid },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2. deleting the user (their scans and reviews stay, with the user set to null)
    await this.prisma.user.delete({ where: { id: user.id } });

    // 3. logging the user out everywhere
    await this.tokenService.revokeAll(uid);

    return { status: HttpStatus.OK, message: 'User deleted successfully' };
  }
}
