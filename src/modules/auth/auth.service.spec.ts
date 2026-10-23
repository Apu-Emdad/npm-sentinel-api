import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

const SECRET = 'a-test-secret-that-is-at-least-32-chars';
const USER_UID = '6f1c2a9e-3b4d-4c8e-9a1f-2d7e5b0c8a31';

async function makeUser(password: string) {
  return {
    id: 1n,
    uid: USER_UID,
    userName: 'apu_emdad',
    email: 'apu@example.com',
    passwordHash: await argon2.hash(password),
    roleId: 1n,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: {
      id: 1n,
      uid: 'role-uid',
      name: 'USER',
      description: null,
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
    jwtService = new JwtService({ secret: SECRET });
    const config = { get: () => 86400 } as unknown as ConfigService<Env, true>;
    authService = new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      config,
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

    const result = await authService.register({
      userName: 'apu_emdad',
      email: 'apu@example.com',
      password: 'correct-horse-battery',
    });

    const { data } = prisma.user.create.mock.calls[0][0];
    expect(data.passwordHash).not.toBe('correct-horse-battery');
    expect(
      await argon2.verify(data.passwordHash, 'correct-horse-battery'),
    ).toBe(true);
    expect(data.role).toEqual({ connect: { name: 'USER' } });
    expect(result.user).toEqual({
      id: USER_UID,
      userName: 'apu_emdad',
      email: 'apu@example.com',
      role: 'USER',
    });
    expect(await jwtService.verifyAsync(result.accessToken)).toMatchObject({
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

    const result = await authService.login({
      userNameOrEmail: 'apu@example.com',
      password: 'correct-horse-battery',
    });

    expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({
      email: 'apu@example.com',
    });
    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBe(86400);
  });

  it('login rejects a wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue(
      await makeUser('correct-horse-battery'),
    );

    await expect(
      authService.login({ userNameOrEmail: 'apu_emdad', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
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
