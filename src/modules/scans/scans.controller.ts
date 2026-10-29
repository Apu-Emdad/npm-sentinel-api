import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ErrorMessage } from '../../common/decorators/error-message.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreateScanDto } from './dto/create-scan.dto.js';
import { ScanRateLimitGuard } from './scan-rate-limit.guard.js';
import { ScansService } from './scans.service.js';

@Public()
@ApiTags('Scans')
@Controller('scans')
export class ScansController {
  constructor(private readonly scansService: ScansService) {}

  @Post()
  @UseGuards(ScanRateLimitGuard)
  @ApiBearerAuth()
  @ErrorMessage('An error occurred while creating the scan')
  async createScan(
    @Body() dto: CreateScanDto,
    @CurrentUser() authUser: AuthUser | undefined,
    @Res() res: Response,
  ) {
    const result = await this.scansService.createScan(dto, authUser);
    res.status(result.status).json(result);
  }

  @Get(':uid')
  @ErrorMessage('An error occurred while fetching the scan')
  async getScan(@Param('uid') uid: string, @Res() res: Response) {
    const result = await this.scansService.getScan(uid);
    res.status(result.status).json(result);
  }
}
