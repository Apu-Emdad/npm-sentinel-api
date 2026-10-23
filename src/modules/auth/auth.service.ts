import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { ErrorLoggerService } from '../../common/error-logger/error-logger.service.js';
import type { Result } from '../../common/interfaces/result.interface.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const DEFAULT_ROLE = 'user';

type UserWithRole = Prisma.UserGetPayload<{ include: { role: true } }>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly errorLogger: ErrorLoggerService,
  ) {}

  async register(dto: RegisterDto): Promise<Result> {
    try {
      const existing = await this.prisma.user.findFirst({
        where: { OR: [{ userName: dto.userName }, { email: dto.email }] },
        select: { userName: true },
      });

      if (existing) {
        return {
          status: 409,
          message:
            existing.userName === dto.userName
              ? 'Username is already taken'
              : 'Email is already registered',
        };
      }

      const user = await this.prisma.user.create({
        data: {
          userName: dto.userName,
          email: dto.email,
          passwordHash: await argon2.hash(dto.password),
          role: { connect: { name: DEFAULT_ROLE } },
        },
        include: { role: true },
      });

      return {
        status: 201,
        message: 'Registration successful',
        data: await this.buildAuthData(user),
      };
    } catch (error) {
      return this.errorLogger.logError({
        errorMessage: 'An error occurred while registering',
        errorStack: error,
        context: 'AuthService - register',
      });
    }
  }

  async login(dto: LoginDto): Promise<Result> {
    try {
      // Usernames can't contain "@", so a value with "@" is an email.
      const where = dto.userNameOrEmail.includes('@')
        ? { email: dto.userNameOrEmail }
        : { userName: dto.userNameOrEmail };

      const user = await this.prisma.user.findUnique({
        where,
        include: { role: true },
      });

      // Same message for an unknown user and a wrong password, so accounts can't be discovered.
      if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
        return {
          status: 401,
          message: 'Invalid username, email or password',
        };
      }

      return {
        status: 200,
        message: 'Login successful',
        data: await this.buildAuthData(user),
      };
    } catch (error) {
      return this.errorLogger.logError({
        errorMessage: 'An error occurred while logging in',
        errorStack: error,
        context: 'AuthService - login',
      });
    }
  }

  async me(uid: string): Promise<Result> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { uid },
        include: { role: true },
      });

      if (!user) {
        return {
          status: 404,
          message: 'User not found',
        };
      }

      return {
        status: 200,
        message: 'Current user fetched successfully',
        data: this.toSafeUser(user),
      };
    } catch (error) {
      return this.errorLogger.logError({
        errorMessage: 'An error occurred while fetching the current user',
        errorStack: error,
        context: 'AuthService - me',
      });
    }
  }

  // Only safe fields leave the API: no password hash, and the uid instead of the internal id.
  private toSafeUser(user: UserWithRole) {
    return {
      id: user.uid,
      userName: user.userName,
      email: user.email,
      role: user.role.name,
    };
  }

  private async buildAuthData(user: UserWithRole) {
    const payload: JwtPayload = {
      sub: user.uid,
      userName: user.userName,
      role: user.role.name,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_EXPIRES_IN', { infer: true }),
      user: this.toSafeUser(user),
    };
  }
}
