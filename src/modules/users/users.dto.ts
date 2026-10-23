import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ROLE, type RoleName } from '../../common/constants/roles.js';
import { toBoolean } from '../../common/utils/to-boolean.util.js';

export class UsersQueryDto {
  @ApiPropertyOptional({ description: 'Search by user name or email' })
  @IsOptional()
  @IsString({ message: 'Search must be a string' })
  search?: string;

  @ApiPropertyOptional({ enum: Object.values(ROLE) })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === '' ? undefined : value,
  )
  @IsIn(Object.values(ROLE), {
    message: `Role must be one of: ${Object.values(ROLE).join(', ')}`,
  })
  role?: RoleName;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'isActive must be true or false' })
  isActive?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page size must be a whole number' })
  @Min(1, { message: 'Page size must be at least 1' })
  @Max(100, { message: 'Page size must be at most 100' })
  pageSize?: number;
}
