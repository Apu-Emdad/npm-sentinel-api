import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @IsInt()
  @IsPositive()
  PORT: number = 3000;

  @IsUrl({ protocols: ['postgres', 'postgresql'], require_tld: false })
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string;

  @IsInt()
  @IsPositive()
  REDIS_PORT: number;

  // Redis database number (0 to 15). Apps that share one Redis server use different numbers.
  @IsInt()
  @Min(0)
  @Max(15)
  REDIS_DB: number = 0;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  // Seconds until an access token expires
  @IsInt()
  @IsPositive()
  JWT_ACCESS_EXPIRES_IN: number = 900;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  // Seconds until a refresh token expires
  @IsInt()
  @IsPositive()
  JWT_REFRESH_EXPIRES_IN: number = 604800;

  // Origin of the web app, allowed by CORS to send the refresh cookie
  @IsUrl({ require_tld: false })
  WEB_ORIGIN: string = 'http://localhost:5173';
}

// Used by ConfigModule: throws on startup when a variable is missing or invalid.
export function validateEnv(config: Record<string, unknown>): Env {
  const env = plainToInstance(Env, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length) {
    const problems = errors
      .map(
        (error) =>
          `  - ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return env;
}
