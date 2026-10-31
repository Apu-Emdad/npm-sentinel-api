import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createFakeEmailTokens } from '../../../test/fakes/fake-email-tokens.js';
import { FakeMailService } from '../../../test/fakes/fake-mail.js';
import { FakeRedis } from '../../../test/fakes/fake-redis.js';
import type { Env } from '../../config/env.js';
import type { MailService } from '../../infra/mail/mail.service.js';
import type { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RateLimitService } from '../../infra/redis/rate-limit.service.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import { AuthService } from './auth.service.js';
import { EmailTokenService } from './email-token.service.js';
import { TokenService } from './token.service.js';

const ACCESS_SECRET = 'a-test-access-secret-at-least-32-chars';
const env: Record<string, unknown> = {
  JWT_ACCESS_SECRET: ACCESS_SECRET,
  JWT_REFRESH_SECRET: 'a-test-refresh-secret-at-least-32-chars',
  JWT_ACCESS_EXPIRES_IN: 900,
  JWT_REFRESH_EXPIRES_IN: 604800,
  WEB_URL: 'http://localhost:5001',
};
const USER_UID = 'k3F9x2Mq7A';

async function makeUser(password: string) {
  return {
    id: 1n,
    uid: USER_UID,
    userName: 'apu_emdad',
    email: 'apu@example.com',
    passwordHash: await argon2.hash(password),
    roleId: 1n,
    isActive: true,
    emailVerifiedAt: null as Date | null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date(),
    roleInfo: {
      id: 1n,
      uid: 'role-uid',
      name: 'USER',
      rolePermissions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

describe('AuthService', () => {
  let prisma: {
    user: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    emailToken: ReturnType<typeof createFakeEmailTokens>;
  };
  let jwtService: JwtService;
  let redis: FakeRedis;
  let mail: FakeMailService;
  let tokenService: TokenService;
  let authService: AuthService;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      emailToken: createFakeEmailTokens(),
    };
    jwtService = new JwtService();
    redis = new FakeRedis();
    mail = new FakeMailService();
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService<Env, true>;
    tokenService = new TokenService(
      jwtService,
      redis as unknown as RedisService,
      config,
    );
    authService = new AuthService(
      prisma as unknown as PrismaService,
      tokenService,
      new EmailTokenService(
        prisma as unknown as PrismaService,
        mail as unknown as MailService,
        config,
      ),
      new RateLimitService(redis as unknown as RedisService),
    );
  });

  const refreshKeys = () =>
    [...redis.store.keys()].filter((key) => key.startsWith('refresh:'));

  it('register hashes the password and returns a token for the new user', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockImplementation(
      async ({ data }: { data: { passwordHash: string } }) => ({
        ...(await makeUser('unused')),
        passwordHash: data.passwordHash,
      }),
    );

    const auth = await authService.register({
      userName: 'apu_emdad',
      email: 'apu@example.com',
      password: 'correct-horse-battery',
    });

    const { data } = prisma.user.create.mock.calls[0][0];
    expect(data.passwordHash).not.toBe('correct-horse-battery');
    expect(
      await argon2.verify(data.passwordHash, 'correct-horse-battery'),
    ).toBe(true);
    expect(data.roleInfo).toEqual({ connect: { name: 'USER' } });
    expect(auth.result.data.user).toEqual({
      uid: USER_UID,
      userName: 'apu_emdad',
      email: 'apu@example.com',
      role: 'USER',
      emailVerified: false,
    });
    expect(
      await jwtService.verifyAsync(auth.result.data.accessToken, {
        secret: ACCESS_SECRET,
      }),
    ).toMatchObject({
      sub: USER_UID,
      userName: 'apu_emdad',
      role: 'USER',
    });
  });

  it('register rejects a taken username', async () => {
    prisma.user.findFirst.mockResolvedValue({ userName: 'apu_emdad' });

    await expect(
      authService.register({
        userName: 'apu_emdad',
        email: 'other@example.com',
        password: 'correct-horse-battery',
      }),
    ).rejects.toThrow(new ConflictException('Username is already taken'));
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('login looks up by email when the value contains "@"', async () => {
    prisma.user.findUnique.mockResolvedValue(
      await makeUser('correct-horse-battery'),
    );

    const auth = await authService.login({
      userNameOrEmail: 'apu@example.com',
      password: 'correct-horse-battery',
    });

    expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({
      email: 'apu@example.com',
    });
    expect(auth.result.data.tokenType).toBe('Bearer');
    expect(auth.result.data.expiresIn).toBe(900);
    expect(auth.refreshToken).toEqual(expect.any(String));
  });

  it('login rejects a wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue(
      await makeUser('correct-horse-battery'),
    );

    await expect(
      authService.login({ userNameOrEmail: 'apu_emdad', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('login rejects a disabled account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...(await makeUser('correct-horse-battery')),
      isActive: false,
    });

    await expect(
      authService.login({
        userNameOrEmail: 'apu_emdad',
        password: 'correct-horse-battery',
      }),
    ).rejects.toThrow(new ForbiddenException('Account is disabled'));
  });

  it('login rejects an unknown user with the same error', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      authService.login({ userNameOrEmail: 'nobody', password: 'whatever' }),
    ).rejects.toThrow(
      new UnauthorizedException('Invalid username, email or password'),
    );
  });

  it('me rejects an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(authService.me(USER_UID)).rejects.toThrow(NotFoundException);
  });

  it('lets unexpected errors propagate to the global filter', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('connection refused'));

    await expect(
      authService.login({
        userNameOrEmail: 'apu_emdad',
        password: 'correct-horse-battery',
      }),
    ).rejects.toThrow('connection refused');
  });

  describe('email verification', () => {
    const registerInput = {
      userName: 'apu_emdad',
      email: 'apu@example.com',
      password: 'correct-horse-battery',
    };

    beforeEach(async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(await makeUser('unused'));
    });

    it('register emails a verify link', async () => {
      await authService.register(registerInput);

      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]).toMatchObject({
        kind: 'verify-email',
        to: 'apu@example.com',
      });
      expect(mail.sent[0].link).toMatch(
        /^http:\/\/localhost:5001\/verify-email\?token=[a-f0-9]{64}$/,
      );
    });

    it('register still succeeds when the email can not be sent', async () => {
      mail.fail = true;

      const auth = await authService.register(registerInput);

      expect(auth.result.status).toBe(201);
      expect(auth.result.data.accessToken).toEqual(expect.any(String));
    });

    it('verifyEmail sets email_verified_at and the link works once', async () => {
      await authService.register(registerInput);
      const token = mail.lastToken('verify-email');

      const result = await authService.verifyEmail({ token });

      expect(result).toEqual({
        status: 200,
        message: 'Email verified successfully',
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { emailVerifiedAt: expect.any(Date) },
      });
      await expect(authService.verifyEmail({ token })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('resendVerification sends a new link and rejects a verified email', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(await makeUser('unused'));
      await authService.resendVerification(
        { uid: USER_UID, userName: 'apu_emdad', role: 'USER' },
        '1.1.1.1',
      );
      expect(mail.sent.map((m) => m.kind)).toEqual(['verify-email']);

      prisma.user.findUnique.mockResolvedValueOnce({
        ...(await makeUser('unused')),
        emailVerifiedAt: new Date(),
      });
      await expect(
        authService.resendVerification(
          { uid: USER_UID, userName: 'apu_emdad', role: 'USER' },
          '1.1.1.1',
        ),
      ).rejects.toThrow(new ConflictException('Email is already verified'));
    });
  });

  describe('forgot and reset password', () => {
    const forgotMessage =
      'If an account with that email exists, we sent a link to reset the password';

    it('forgotPassword gives the same answer for known, unknown and disabled emails', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(await makeUser('unused'))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...(await makeUser('unused')),
          isActive: false,
        });

      const results = [
        await authService.forgotPassword(
          { email: 'apu@example.com' },
          '1.1.1.1',
        ),
        await authService.forgotPassword(
          { email: 'nobody@example.com' },
          '1.1.1.2',
        ),
        await authService.forgotPassword(
          { email: 'apu@example.com' },
          '1.1.1.3',
        ),
      ];

      for (const result of results) {
        expect(result).toEqual({ status: 200, message: forgotMessage });
      }
      // Only the active user got an email.
      expect(mail.sent.map((m) => [m.kind, m.to])).toEqual([
        ['reset-password', 'apu@example.com'],
      ]);
    });

    it('forgotPassword gives the same answer when the email can not be sent', async () => {
      prisma.user.findUnique.mockResolvedValue(await makeUser('unused'));
      mail.fail = true;

      expect(
        await authService.forgotPassword(
          { email: 'apu@example.com' },
          '1.1.1.1',
        ),
      ).toEqual({ status: 200, message: forgotMessage });
    });

    it('forgotPassword allows 5 requests per email in 15 minutes', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      for (let i = 0; i < 5; i++) {
        await authService.forgotPassword(
          { email: 'apu@example.com' },
          `1.1.1.${i}`,
        );
      }

      const error = await authService
        .forgotPassword({ email: 'apu@example.com' }, '9.9.9.9')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    });

    it('resetPassword sets the new password, uses the token up and logs out every session', async () => {
      const user = await makeUser('old-password');
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({ uid: USER_UID });
      await authService.login({
        userNameOrEmail: 'apu_emdad',
        password: 'old-password',
      });
      await authService.login({
        userNameOrEmail: 'apu_emdad',
        password: 'old-password',
      });
      expect(refreshKeys()).toHaveLength(2);

      await authService.forgotPassword({ email: 'apu@example.com' }, '1.1.1.1');
      const token = mail.lastToken('reset-password');
      const result = await authService.resetPassword({
        token,
        password: 'new-password-123',
      });

      expect(result.status).toBe(200);
      const { where, data } = prisma.user.update.mock.calls[0][0];
      expect(where).toEqual({ id: 1n });
      expect(await argon2.verify(data.passwordHash, 'new-password-123')).toBe(
        true,
      );
      expect(refreshKeys()).toHaveLength(0);
      await expect(
        authService.resetPassword({ token, password: 'another-password' }),
      ).rejects.toThrow(
        new BadRequestException('This reset link is invalid or has expired'),
      );
    });
  });
});
