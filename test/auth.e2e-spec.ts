import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { RedisService } from '../src/infra/redis/redis.service.js';
import { FakeRedis } from './fakes/fake-redis.js';

type FakeUser = Record<string, any>;

// In-memory stand-in for the Prisma user queries AuthService makes, so these tests never touch a database.
function createFakePrisma() {
  const users: FakeUser[] = [];
  const roleInfo = { id: 1n, uid: 'role-uid', name: 'USER' };
  const matches = (user: FakeUser, where: Record<string, string>) =>
    Object.entries(where).every(([key, value]) => user[key] === value);

  return {
    users,
    user: {
      findFirst: async ({
        where,
      }: {
        where: { OR: Record<string, string>[] };
      }) =>
        users.find((u) =>
          where.OR.some((condition) => matches(u, condition)),
        ) ?? null,
      findUnique: async ({ where }: { where: Record<string, string> }) => {
        // Lets a test simulate the database failing.
        if (where.userName === 'db_down') throw new Error('database is down');
        return users.find((u) => matches(u, where)) ?? null;
      },
      create: async ({ data }: { data: FakeUser }) => {
        const { roleInfo: _roleInfo, ...fields } = data;
        const user = {
          ...fields,
          id: BigInt(users.length + 1),
          uid: randomUUID(),
          isActive: true,
          roleInfo,
        };
        users.push(user);
        return user;
      },
    },
  };
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  const credentials = {
    userName: 'Apu_Emdad',
    email: 'Apu@Example.com',
    password: 'correct-horse-battery',
  };

  let fakePrisma: ReturnType<typeof createFakePrisma>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue((fakePrisma = createFakePrisma()))
      .overrideProvider(RedisService)
      .useValue(new FakeRedis())
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const register = () =>
    request(app.getHttpServer()).post('/auth/register').send(credentials);

  it('registers a user with lowercased username and email', async () => {
    const res = await register().expect(201);

    expect(res.body).toMatchObject({
      status: 201,
      message: 'Registration successful',
    });
    expect(res.body.data.tokenType).toBe('Bearer');
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({
      userName: 'apu_emdad',
      email: 'apu@example.com',
      role: 'USER',
    });
  });

  it('rejects a duplicate username with 409 in the Result shape', async () => {
    await register().expect(201);
    const res = await register().expect(409);
    expect(res.body).toEqual({
      status: 409,
      message: 'Username is already taken',
      error: 'Conflict',
      context: 'POST /auth/register',
    });
  });

  it('rejects an invalid body with 400 and lists the problems', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ userName: 'a@b', email: 'not-an-email', password: 'short' })
      .expect(400);
    expect(res.body.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.data).toEqual(
      expect.arrayContaining(['Email must be a valid email address']),
    );
  });

  it('logs in with the username or the email', async () => {
    await register().expect(201);

    for (const userNameOrEmail of ['apu_emdad', 'APU@example.com']) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ userNameOrEmail, password: credentials.password })
        .expect(200);
      expect(res.body.status).toBe(200);
      expect(res.body.data.user.userName).toBe('apu_emdad');
    }
  });

  it('rejects a wrong password with 401', async () => {
    await register().expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ userNameOrEmail: 'apu_emdad', password: 'wrong-password' })
      .expect(401);
  });

  it('GET /auth/me needs a valid token', async () => {
    const { body } = await register().expect(201);

    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .expect(200);
    expect(res.body.data.userName).toBe('apu_emdad');
  });

  it('locks out a disabled account', async () => {
    const res = await register().expect(201);
    const token = res.body.data.accessToken;
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0].split(
      ';',
    )[0];
    fakePrisma.users[0].isActive = false;

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        userNameOrEmail: credentials.userName,
        password: credentials.password,
      })
      .expect(403);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookie)
      .expect(403);
    // Public routes still work; the token is just ignored.
    await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('public routes ignore the token, even an invalid one', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(200);
  });

  it('sends unexpected errors as a 500 Result with the generic message', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ userNameOrEmail: 'db_down', password: 'whatever-123' })
      .expect(500);

    expect(res.body).toEqual({
      status: 500,
      message: 'An error occurred',
      error: 'database is down',
      context: 'POST /auth/login',
    });
  });

  describe('refresh tokens', () => {
    // The refresh cookie as the browser would send it back: "refresh_token=<value>".
    const refreshCookieOf = (res: request.Response): string => {
      const cookies = res.headers['set-cookie'] as unknown as string[];
      const cookie = cookies.find((c) => c.startsWith('refresh_token='));
      if (!cookie) throw new Error('no refresh_token cookie set');
      return cookie.split(';')[0];
    };

    const refresh = (cookie?: string) => {
      const req = request(app.getHttpServer()).post('/auth/refresh');
      return cookie ? req.set('Cookie', cookie) : req;
    };

    it('login sets an httpOnly refresh cookie and keeps the token out of the body', async () => {
      await register().expect(201);
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ userNameOrEmail: 'apu_emdad', password: credentials.password })
        .expect(200);

      const raw = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('refresh_token='),
      );
      expect(raw).toMatch(/HttpOnly/);
      expect(raw).toMatch(/Path=\/auth/);
      expect(raw).toMatch(/SameSite=Strict/);
      expect(res.body.data.refreshToken).toBeUndefined();
      expect(res.body.data.expiresIn).toBe(900);
    });

    it('refresh returns a new access token and rotates the cookie', async () => {
      const first = refreshCookieOf(await register().expect(201));

      const res = await refresh(first).expect(200);

      expect(res.body.message).toBe('Access token refreshed');
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.user).toMatchObject({
        uid: expect.any(String),
        role: 'USER',
      });
      expect(refreshCookieOf(res)).not.toBe(first);
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${res.body.data.accessToken}`)
        .expect(200);
    });

    it('reusing a refresh token is rejected and revokes the rotated one too', async () => {
      const first = refreshCookieOf(await register().expect(201));
      const second = refreshCookieOf(await refresh(first).expect(200));

      await refresh(first).expect(401);
      await refresh(second).expect(401);
    });

    it('refresh without a cookie is rejected', async () => {
      await refresh().expect(401);
    });

    it('logout clears the cookie and the old refresh token stops working', async () => {
      const cookie = refreshCookieOf(await register().expect(201));

      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', cookie)
        .expect(200);

      expect(refreshCookieOf(res)).toBe('refresh_token=');
      await refresh(cookie).expect(401);
    });

    it('a refresh token is not accepted as an access token', async () => {
      const cookie = refreshCookieOf(await register().expect(201));

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${cookie.split('=')[1]}`)
        .expect(401);
    });
  });
});
