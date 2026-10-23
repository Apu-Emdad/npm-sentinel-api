import { validateEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://sentinel:sentinel@localhost:5433/npm_sentinel',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6380',
  JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars',
};

describe('validateEnv', () => {
  it('parses valid variables and applies defaults', () => {
    expect(validateEnv(validEnv)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: validEnv.DATABASE_URL,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6380,
      JWT_SECRET: validEnv.JWT_SECRET,
      JWT_EXPIRES_IN: 86400,
    });
  });

  it('throws and names every missing variable', () => {
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL[\s\S]*REDIS_HOST[\s\S]*REDIS_PORT/,
    );
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() =>
      validateEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric port', () => {
    expect(() => validateEnv({ ...validEnv, REDIS_PORT: 'abc' })).toThrow(
      /REDIS_PORT/,
    );
  });
});
