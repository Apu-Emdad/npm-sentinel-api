import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';

@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ResponseMessage('API is up')
  check() {
    return { status: 'ok' };
  }
}
