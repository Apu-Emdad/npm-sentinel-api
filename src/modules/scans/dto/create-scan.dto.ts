import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateScanDto {
  @ApiProperty({
    example: 'left-pad',
    description: 'npm package name. Scoped names are allowed (@scope/name).',
  })
  @Transform(trim)
  @IsString({ message: 'Package name must be a string' })
  @IsNotEmpty({ message: 'Package name is required' })
  @MaxLength(214, { message: 'Package name must be at most 214 characters' })
  @Matches(/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/, {
    message: 'Package name must be a valid npm package name',
  })
  packageName: string;

  @ApiPropertyOptional({
    example: '1.3.0',
    description: 'Exact version. Defaults to the latest dist-tag.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Version must be a string' })
  @MaxLength(256, { message: 'Version must be at most 256 characters' })
  @Matches(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, {
    message: 'Version must be an exact version like 1.2.3',
  })
  version?: string;
}
