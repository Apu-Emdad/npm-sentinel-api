import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import type { Result } from '../common/interfaces/result.interface.js';

@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  check(@Res() res: Response) {
    const result: Result = {
      status: HttpStatus.OK,
      message: 'API is up',
      data: { status: 'ok' },
    };
    res.status(result.status).json(result);
  }
}
