import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ErrorMessage } from '../../common/decorators/error-message.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { Env } from '../../config/env.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

export const REFRESH_COOKIE = 'refresh_token';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('register')
  @ErrorMessage('An error occurred while registering')
  async register(@Body() dto: RegisterDto, @Res() res: Response) {
    const { result, refreshToken, refreshExpiresIn } =
      await this.authService.register(dto);
    this.setRefreshCookie(res, refreshToken, refreshExpiresIn);
    res.status(result.status).json(result);
  }

  @Public()
  @Post('login')
  @ErrorMessage('An error occurred while logging in')
  async login(@Body() dto: LoginDto, @Res() res: Response) {
    const { result, refreshToken, refreshExpiresIn } =
      await this.authService.login(dto);
    this.setRefreshCookie(res, refreshToken, refreshExpiresIn);
    res.status(result.status).json(result);
  }

  @Public()
  @Post('refresh')
  @ApiCookieAuth(REFRESH_COOKIE)
  @ErrorMessage('An error occurred while refreshing the access token')
  async refresh(@Req() req: Request, @Res() res: Response) {
    const { result, refreshToken, refreshExpiresIn } =
      await this.authService.refresh(req.cookies[REFRESH_COOKIE]);
    this.setRefreshCookie(res, refreshToken, refreshExpiresIn);
    res.status(result.status).json(result);
  }

  @Public()
  @Post('logout')
  @ApiCookieAuth(REFRESH_COOKIE)
  @ErrorMessage('An error occurred while logging out')
  async logout(@Req() req: Request, @Res() res: Response) {
    const result = await this.authService.logout(req.cookies[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    res.status(result.status).json(result);
  }

  @Get('me')
  @ApiBearerAuth()
  @ErrorMessage('An error occurred while fetching the current user')
  async me(@CurrentUser() authUser: AuthUser, @Res() res: Response) {
    const result = await this.authService.me(authUser.uid);
    res.status(result.status).json(result);
  }

  private setRefreshCookie(
    res: Response,
    token: string,
    maxAgeSeconds: number,
  ) {
    res.cookie(REFRESH_COOKIE, token, {
      ...this.cookieOptions(),
      maxAge: maxAgeSeconds * 1000,
    });
  }

  /**
   * httpOnly: JavaScript can't read it, so XSS can't steal it.
   * secure: HTTPS only in production. sameSite strict: never sent from other sites.
   * path /auth: only sent to the auth endpoints, not to every API call.
   */
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'strict',
      path: '/auth',
    };
  }
}
