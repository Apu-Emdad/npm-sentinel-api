import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { ROLE } from '../../common/constants/roles.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

type UserWithRole = Prisma.UserGetPayload<{ include: { role: true } }>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ userName: dto.userName }, { email: dto.email }] },
      select: { userName: true },
    });

    if (existing) {
      throw new ConflictException(
        existing.userName === dto.userName
          ? 'Username is already taken'
          : 'Email is already registered',
      );
    }

    const user = await this.prisma.user.create({
      data: {
        userName: dto.userName,
        email: dto.email,
        passwordHash: await argon2.hash(dto.password),
        role: { connect: { name: ROLE.USER } },
      },
      include: { role: true },
    });

    return this.buildAuthData(user);
  }

  async login(dto: LoginDto) {
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
      throw new UnauthorizedException('Invalid username, email or password');
    }

    return this.buildAuthData(user);
  }

  async me(uid: string) {
    const user = await this.prisma.user.findUnique({
      where: { uid },
      include: { role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toSafeUser(user);
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
