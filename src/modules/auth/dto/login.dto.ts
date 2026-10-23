import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'apu_emdad',
    description:
      'Username or email. A value containing "@" is treated as an email.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString({ message: 'Username or email must be a string' })
  @IsNotEmpty({ message: 'Username or email is required' })
  @MaxLength(254, {
    message: 'Username or email must be at most 254 characters',
  })
  userNameOrEmail: string;

  @ApiProperty({ example: 'correct-horse-battery' })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MaxLength(128, { message: 'Password must be at most 128 characters' })
  password: string;
}
