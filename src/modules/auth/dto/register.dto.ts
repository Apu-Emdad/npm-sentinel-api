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

export class RegisterDto {
  @ApiProperty({
    example: 'apu_emdad',
    description: '3 to 30 characters: a-z, 0-9, _ and -. Stored lowercase.',
  })
  @Transform(toLowerTrimmed)
  @IsString({ message: 'Username must be a string' })
  @IsNotEmpty({ message: 'Username is required' })
  @Matches(/^[a-z0-9_-]{3,30}$/, {
    message:
      'Username must be 3 to 30 characters and use only letters, numbers, _ or -',
  })
  userName: string;

  @ApiProperty({ example: 'apu@example.com' })
  @Transform(toLowerTrimmed)
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(254, { message: 'Email must be at most 254 characters' })
  email: string;

  @ApiProperty({ example: 'correct-horse-battery', minLength: 8 })
  @IsString({ message: 'Password must be a string' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must be at most 128 characters' })
  password: string;
}
