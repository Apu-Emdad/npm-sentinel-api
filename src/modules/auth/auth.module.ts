import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailTokenService } from './email-token.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, EmailTokenService],
})
export class AuthModule {}
