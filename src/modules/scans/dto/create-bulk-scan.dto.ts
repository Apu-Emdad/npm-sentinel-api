import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateBulkScanDto {
  @ApiProperty({
    example: '{"dependencies":{"express":"^4.21.1"}}',
    description: 'Content of a package.json file, as text.',
  })
  @IsString({ message: 'package.json must be text' })
  @IsNotEmpty({ message: 'package.json is required' })
  packageJson: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Also scan devDependencies. Defaults to false.',
  })
  @IsOptional()
  @IsBoolean({ message: 'includeDev must be true or false' })
  includeDev?: boolean;
}
