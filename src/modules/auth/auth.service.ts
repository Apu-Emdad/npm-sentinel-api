import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { ROLE } from '../../common/constants/roles.js';
import type { Result } from '../../common/interfaces/result.interface.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthResult, JwtPayload } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { TokenService } from './token.service.js';

type UserWithRole = Prisma.UserGetPayload<{ include: { roleInfo: true } }>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
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
        roleInfo: { connect: { name: ROLE.USER } },
      },
      include: { roleInfo: true },
    });

    const { tokens, ...refresh } = await this.issueTokens(user);
    return {
      ...refresh,
      result: {
        status: HttpStatus.CREATED,
        message: 'Registration successful',
        data: { ...tokens, user: this.toSafeUser(user) },
      },
    };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    // Usernames can't contain "@", so a value with "@" is an email.
    const where = dto.userNameOrEmail.includes('@')
      ? { email: dto.userNameOrEmail }
      : { userName: dto.userNameOrEmail };

    const user = await this.prisma.user.findUnique({
      where,
      include: { roleInfo: true },
    });

    // Same message for an unknown user and a wrong password, so accounts can't be discovered.
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid username, email or password');
    }
    if (!user.isActive) {
      throw new ForbiddenException('Account is disabled');
    }

    const { tokens, ...refresh } = await this.issueTokens(user);
    return {
      ...refresh,
      result: {
        status: HttpStatus.OK,
        message: 'Login successful',
        data: { ...tokens, user: this.toSafeUser(user) },
      },
    };
  }

  // Uses up the refresh token from the cookie and issues a new pair (rotation).
  async refresh(refreshToken: string | undefined): Promise<AuthResult> {
    const uid = await this.tokenService.consume(refreshToken);

    const user = await this.prisma.user.findUnique({
      where: { uid },
      include: { roleInfo: true },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (!user.isActive) {
      throw new ForbiddenException('Account is disabled');
    }

    const { tokens, ...refresh } = await this.issueTokens(user);
    return {
      ...refresh,
      result: {
        status: HttpStatus.OK,
        message: 'Access token refreshed',
        data: tokens,
      },
    };
  }

  async logout(refreshToken: string | undefined): Promise<Result> {
    await this.tokenService.revoke(refreshToken);

    return { status: HttpStatus.OK, message: 'Logged out' };
  }

  async me(uid: string): Promise<Result> {
    const user = await this.prisma.user.findUnique({
      where: { uid },
      include: { roleInfo: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      status: HttpStatus.OK,
      message: 'Current user fetched successfully',
      data: this.toSafeUser(user),
    };
  }

  // Only safe fields leave the API: no password hash and no internal id.
  private toSafeUser(user: UserWithRole) {
    return {
      uid: user.uid,
      userName: user.userName,
      email: user.email,
      role: user.roleInfo.name,
    };
  }

  // `tokens` goes in the response data; the refresh token only goes in the cookie.
  private async issueTokens(user: UserWithRole) {
    const payload: JwtPayload = {
      sub: user.uid,
      userName: user.userName,
      role: user.roleInfo.name,
    };
    const tokens = await this.tokenService.issue(payload);

    return {
      refreshToken: tokens.refreshToken,
      refreshExpiresIn: tokens.refreshExpiresIn,
      tokens: {
        accessToken: tokens.accessToken,
        tokenType: 'Bearer',
        expiresIn: tokens.accessExpiresIn,
      },
    };
  }
}
