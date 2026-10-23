import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { FakeRedis } from '../../../test/fakes/fake-redis.js';
import type { Env } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { RedisService } from '../../redis/redis.service.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

const ACCESS_SECRET = 'a-test-access-secret-at-least-32-chars';
const env: Record<string, unknown> = {
  JWT_ACCESS_SECRET: ACCESS_SECRET,
  JWT_REFRESH_SECRET: 'a-test-refresh-secret-at-least-32-chars',
  JWT_ACCESS_EXPIRES_IN: 900,
  JWT_REFRESH_EXPIRES_IN: 604800,
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
    createdAt: new Date(),
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
    };
  };
  let jwtService: JwtService;
  let authService: AuthService;

  beforeEach(() => {
    prisma = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    };
    jwtService = new JwtService();
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService<Env, true>;
    const tokenService = new TokenService(
      jwtService,
      new FakeRedis() as unknown as RedisService,
      config,
    );
    authService = new AuthService(
      prisma as unknown as PrismaService,
      tokenService,
    );
  });

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
      id: USER_UID,
      userName: 'apu_emdad',
      email: 'apu@example.com',
      role: 'USER',
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
});
