import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const toLowerTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// The token from the email link: 32 random bytes as 64 hex characters.
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export class VerifyEmailDto {
  @ApiProperty({ description: 'The token from the verification link' })
  @IsString({ message: 'Token must be a string' })
  @IsNotEmpty({ message: 'Token is required' })
  @Matches(TOKEN_PATTERN, {
    message: 'This verification link is invalid or has expired',
  })
  token: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'maya.rodriguez@example.com' })
  @Transform(toLowerTrimmed)
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(254, { message: 'Email must be at most 254 characters' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'The token from the reset link' })
  @IsString({ message: 'Token must be a string' })
  @IsNotEmpty({ message: 'Token is required' })
  @Matches(TOKEN_PATTERN, {
    message: 'This reset link is invalid or has expired',
  })
  token: string;

  @ApiProperty({ example: 'correct-horse-battery', minLength: 8 })
  @IsString({ message: 'Password must be a string' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must be at most 128 characters' })
  password: string;
}
