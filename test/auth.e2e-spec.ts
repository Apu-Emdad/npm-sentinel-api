import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

type FakeUser = Record<string, any>;

// In-memory stand-in for the Prisma user queries AuthService makes, so these tests never touch a database.
function createFakePrisma() {
  const users: FakeUser[] = [];
  const role = { id: 1n, uid: 'role-uid', name: 'user' };
  const matches = (user: FakeUser, where: Record<string, string>) =>
    Object.entries(where).every(([key, value]) => user[key] === value);

  return {
    user: {
      findFirst: async ({
        where,
      }: {
        where: { OR: Record<string, string>[] };
      }) =>
        users.find((u) =>
          where.OR.some((condition) => matches(u, condition)),
        ) ?? null,
      findUnique: async ({ where }: { where: Record<string, string> }) =>
        users.find((u) => matches(u, where)) ?? null,
      create: async ({ data }: { data: FakeUser }) => {
        const { role: _role, ...fields } = data;
        const user = {
          ...fields,
          id: BigInt(users.length + 1),
          uid: randomUUID(),
          role,
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

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(createFakePrisma())
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
      role: 'user',
    });
  });

  it('rejects a duplicate username with 409 in the Result shape', async () => {
    await register().expect(201);
    const res = await register().expect(409);
    expect(res.body).toEqual({
      status: 409,
      message: 'Username is already taken',
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

  it('public routes work without a token but reject an invalid one', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });
});
