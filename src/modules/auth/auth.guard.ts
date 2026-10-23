import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from './auth.types.js';

/**
 * Global guard: every route needs a valid token unless it is marked @Public().
 * On public routes a valid token still sets request.user, and a missing or bad one
 * is ignored (no 401), so an expired token can't block /auth/refresh.
 * The user must still exist and be active, so a disabled account is locked out
 * right away instead of when its access token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Missing access token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const user = await this.prisma.user.findUnique({
      where: { uid: payload.sub },
      select: { isActive: true },
    });
    if (!user || !user.isActive) {
      if (isPublic) return true;
      if (!user) throw new UnauthorizedException('User no longer exists');
      throw new ForbiddenException('Account is disabled');
    }

    request.user = {
      uid: payload.sub,
      userName: payload.userName,
      role: payload.role,
    };
    return true;
  }

  private extractBearerToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' && token ? token : undefined;
  }
}
