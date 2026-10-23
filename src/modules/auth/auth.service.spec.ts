import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { ErrorLoggerService } from '../../common/error-logger/error-logger.service.js';
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
      name: 'user',
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
    const config = {
      get: (key: string) => (key === 'NODE_ENV' ? 'test' : 86400),
    } as unknown as ConfigService;
    authService = new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      config,
      new ErrorLoggerService(config),
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

    expect(result.status).toBe(201);
    const { data } = prisma.user.create.mock.calls[0][0];
    expect(data.passwordHash).not.toBe('correct-horse-battery');
    expect(
      await argon2.verify(data.passwordHash, 'correct-horse-battery'),
    ).toBe(true);
    expect(data.role).toEqual({ connect: { name: 'user' } });
    expect(result.data.user).toEqual({
      id: USER_UID,
      userName: 'apu_emdad',
      email: 'apu@example.com',
      role: 'user',
    });
    expect(await jwtService.verifyAsync(result.data.accessToken)).toMatchObject(
      { sub: USER_UID, userName: 'apu_emdad', role: 'user' },
    );
  });

  it('register rejects a taken username', async () => {
    prisma.user.findFirst.mockResolvedValue({ userName: 'apu_emdad' });

    const result = await authService.register({
      userName: 'apu_emdad',
      email: 'other@example.com',
      password: 'correct-horse-battery',
    });

    expect(result).toEqual({
      status: 409,
      message: 'Username is already taken',
    });
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
    expect(result.status).toBe(200);
    expect(result.data.tokenType).toBe('Bearer');
    expect(result.data.expiresIn).toBe(86400);
  });

  it('login rejects a wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue(
      await makeUser('correct-horse-battery'),
    );

    const result = await authService.login({
      userNameOrEmail: 'apu_emdad',
      password: 'wrong',
    });

    expect(result.status).toBe(401);
  });

  it('login rejects an unknown user with the same error', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await authService.login({
      userNameOrEmail: 'nobody',
      password: 'whatever',
    });

    expect(result).toEqual({
      status: 401,
      message: 'Invalid username, email or password',
    });
  });

  it('returns a 500 Result when the database fails', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('connection refused'));

    const result = await authService.login({
      userNameOrEmail: 'apu_emdad',
      password: 'correct-horse-battery',
    });

    expect(result).toEqual({
      status: 500,
      message: 'An error occurred while logging in',
      error: 'connection refused',
      context: 'AuthService - login',
    });
  });
});
