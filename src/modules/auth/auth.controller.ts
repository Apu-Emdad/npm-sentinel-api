import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { Env } from '../../config/env.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/email-token.dto.js';
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
  async register(@Body() dto: RegisterDto, @Res() res: Response) {
    const { result, refreshToken, refreshExpiresIn } =
      await this.authService.register(dto);
    this.setRefreshCookie(res, refreshToken, refreshExpiresIn);
    res.status(result.status).json(result);
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res() res: Response) {
    const { result, refreshToken, refreshExpiresIn } =
      await this.authService.login(dto);
    this.setRefreshCookie(res, refreshToken, refreshExpiresIn);
    res.status(result.status).json(result);
  }

  @Public()
  @Post('refresh')
  @ApiCookieAuth(REFRESH_COOKIE)
  async refresh(@Req() req: Request, @Res() res: Response) {
    const { result, refreshToken, refreshExpiresIn } =
      await this.authService.refresh(req.cookies[REFRESH_COOKIE]);
    this.setRefreshCookie(res, refreshToken, refreshExpiresIn);
    res.status(result.status).json(result);
  }

  @Public()
  @Post('logout')
  @ApiCookieAuth(REFRESH_COOKIE)
  async logout(@Req() req: Request, @Res() res: Response) {
    const result = await this.authService.logout(req.cookies[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    res.status(result.status).json(result);
  }

  @Get('me')
  @ApiBearerAuth()
  async me(@CurrentUser() authUser: AuthUser, @Res() res: Response) {
    const result = await this.authService.me(authUser.uid);
    res.status(result.status).json(result);
  }

  @Public()
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto, @Res() res: Response) {
    const result = await this.authService.verifyEmail(dto);
    res.status(result.status).json(result);
  }

  @Post('resend-verification')
  @ApiBearerAuth()
  async resendVerification(
    @CurrentUser() authUser: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.authService.resendVerification(
      authUser,
      req.ip ?? '',
    );
    res.status(result.status).json(result);
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.authService.forgotPassword(dto, req.ip ?? '');
    res.status(result.status).json(result);
  }

  @Public()
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto, @Res() res: Response) {
    const result = await this.authService.resetPassword(dto);
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
