import { validateEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://sentinel:sentinel@localhost:5433/npm_sentinel',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6380',
  JWT_ACCESS_SECRET: 'a-test-access-secret-at-least-32-chars',
  JWT_REFRESH_SECRET: 'a-test-refresh-secret-at-least-32-chars',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'smtp-user',
  SMTP_PASS: 'smtp-pass',
  MAIL_FROM: 'npm-sentinel <no-reply@example.com>',
};

describe('validateEnv', () => {
  it('parses valid variables and applies defaults', () => {
    expect(validateEnv(validEnv)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: validEnv.DATABASE_URL,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6380,
      REDIS_DB: 0,
      JWT_ACCESS_SECRET: validEnv.JWT_ACCESS_SECRET,
      JWT_ACCESS_EXPIRES_IN: 900,
      JWT_REFRESH_SECRET: validEnv.JWT_REFRESH_SECRET,
      JWT_REFRESH_EXPIRES_IN: 604800,
      SCAN_RATE_LIMIT: 10,
      SCAN_RATE_WINDOW: 3600,
      WEB_ORIGIN: 'http://localhost:7001',
      WEB_URL: 'http://localhost:7001',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_USER: 'smtp-user',
      SMTP_PASS: 'smtp-pass',
      MAIL_FROM: 'npm-sentinel <no-reply@example.com>',
    });
  });

  it('throws when the SMTP settings are missing', () => {
    const { SMTP_HOST: _host, SMTP_PASS: _pass, ...withoutSmtp } = validEnv;
    expect(() => validateEnv(withoutSmtp)).toThrow(/SMTP_HOST[\s\S]*SMTP_PASS/);
  });

  it('rejects an invalid WEB_URL', () => {
    expect(() => validateEnv({ ...validEnv, WEB_URL: 'not a url' })).toThrow(
      /WEB_URL/,
    );
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

  it('accepts a Redis database number from 0 to 15', () => {
    expect(validateEnv({ ...validEnv, REDIS_DB: '1' }).REDIS_DB).toBe(1);
  });

  it('rejects a Redis database number above 15', () => {
    expect(() => validateEnv({ ...validEnv, REDIS_DB: '16' })).toThrow(
      /REDIS_DB/,
    );
  });

  it('rejects a non-numeric port', () => {
    expect(() => validateEnv({ ...validEnv, REDIS_PORT: 'abc' })).toThrow(
      /REDIS_PORT/,
    );
  });
});
