import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { ROLE } from '../../common/constants/roles.js';
import type { Result } from '../../common/interfaces/result.interface.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EmailTokenType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RateLimitService } from '../../infra/redis/rate-limit.service.js';
import type { AuthResult, AuthUser, JwtPayload } from './auth.types.js';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/email-token.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { EmailTokenService } from './email-token.service.js';
import { TokenService } from './token.service.js';

type UserWithRole = Prisma.UserGetPayload<{ include: { roleInfo: true } }>;

// Emails a user can ask for: 5 per 15 minutes, per email and per IP.
const EMAIL_RATE_LIMIT = { limit: 5, windowSeconds: 15 * 60 };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly emailTokenService: EmailTokenService,
    private readonly rateLimit: RateLimitService,
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

    // A failed email must not fail the registration; the user can resend it later.
    await this.emailTokenService
      .sendVerifyEmail(user)
      .catch((error: unknown) => this.logMailError('verify', user.uid, error));

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
        data: { ...tokens, user: this.toSafeUser(user) },
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

  async verifyEmail(dto: VerifyEmailDto): Promise<Result> {
    // 1. using up the token
    const userId = await this.emailTokenService.consume(
      dto.token,
      EmailTokenType.verify_email,
    );

    // 2. marking the email verified
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });

    return { status: HttpStatus.OK, message: 'Email verified successfully' };
  }

  async resendVerification(authUser: AuthUser, ip: string): Promise<Result> {
    // 1. finding the user
    const user = await this.prisma.user.findUnique({
      where: { uid: authUser.uid },
      select: { id: true, userName: true, email: true, emailVerifiedAt: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerifiedAt) {
      throw new ConflictException('Email is already verified');
    }

    // 2. limiting how often the email can be sent
    await this.rateLimit.hit({
      action: 'resend-verification',
      keys: [`email:${user.email}`, `ip:${ip}`],
      ...EMAIL_RATE_LIMIT,
      message: 'Too many verification emails. Try again in 15 minutes.',
    });

    // 3. sending the email; a failure here is a 500, so the user knows to try again
    await this.emailTokenService.sendVerifyEmail(user);

    return { status: HttpStatus.OK, message: 'Verification email sent' };
  }

  async forgotPassword(dto: ForgotPasswordDto, ip: string): Promise<Result> {
    // 1. limiting how often the email can be sent
    await this.rateLimit.hit({
      action: 'forgot-password',
      keys: [`email:${dto.email}`, `ip:${ip}`],
      ...EMAIL_RATE_LIMIT,
      message: 'Too many reset requests. Try again in 15 minutes.',
    });

    // 2. sending the reset email only to an active user
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        uid: true,
        userName: true,
        email: true,
        isActive: true,
      },
    });

    if (user?.isActive) {
      await this.emailTokenService
        .sendResetPassword(user)
        .catch((error: unknown) =>
          this.logMailError('reset password', user.uid, error),
        );
    }

    // 3. the same answer either way, so this can't be used to find accounts
    return {
      status: HttpStatus.OK,
      message:
        'If an account with that email exists, we sent a link to reset the password',
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<Result> {
    // 1. using up the token
    const userId = await this.emailTokenService.consume(
      dto.token,
      EmailTokenType.reset_password,
    );

    // 2. setting the new password
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(dto.password) },
      select: { uid: true },
    });

    // 3. logging the user out everywhere
    await this.tokenService.revokeAll(user.uid);

    return {
      status: HttpStatus.OK,
      message: 'Password reset successfully. Log in with your new password.',
    };
  }

  // Only safe fields leave the API: no password hash and no internal id.
  private toSafeUser(user: UserWithRole) {
    return {
      uid: user.uid,
      userName: user.userName,
      email: user.email,
      role: user.roleInfo.name,
      emailVerified: !!user.emailVerifiedAt,
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

  // Logs the user uid, never the address or the SMTP details.
  private logMailError(kind: string, userUid: string, error: unknown) {
    this.logger.error(
      `Could not send the ${kind} email to user ${userUid}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
