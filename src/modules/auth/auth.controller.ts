import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { Result } from '../../common/interfaces/result.interface.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res() res: Response) {
    const result: Result = await this.authService.register(dto);

    return res.status(result.status).json(result);
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res() res: Response) {
    const result: Result = await this.authService.login(dto);

    return res.status(result.status).json(result);
  }

  @Get('me')
  @ApiBearerAuth()
  async me(@CurrentUser() authUser: AuthUser, @Res() res: Response) {
    const result: Result = await this.authService.me(authUser.uid);

    return res.status(result.status).json(result);
  }
}
