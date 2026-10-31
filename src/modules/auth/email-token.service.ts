import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import dayjs from 'dayjs';
import type { Env } from '../../config/env.js';
import { EmailTokenType } from '../../generated/prisma/enums.js';
import { MailService } from '../../infra/mail/mail.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// How long each link works, in minutes
const TOKEN_LIFETIME_MINUTES: Record<EmailTokenType, number> = {
  [EmailTokenType.verify_email]: 24 * 60,
  [EmailTokenType.reset_password]: 30,
};

const INVALID_TOKEN_MESSAGE: Record<EmailTokenType, string> = {
  [EmailTokenType.verify_email]:
    'This verification link is invalid or has expired',
  [EmailTokenType.reset_password]: 'This reset link is invalid or has expired',
};

interface EmailUser {
  id: bigint;
  userName: string;
  email: string;
}

/**
 * One-use tokens sent by email (verify email, reset password).
 *
 * A token is 32 random bytes, sent as hex in the link. Only its SHA-256 hash is stored,
 * so a leaked database can't be used to verify or reset accounts.
 * Creating a token deletes the user's older unused tokens of that type, so only the newest link works.
 */
@Injectable()
export class EmailTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(userId: bigint, type: EmailTokenType): Promise<string> {
    const token = randomBytes(32).toString('hex');

    await this.prisma.emailToken.deleteMany({
      where: { userId, type, usedAt: null },
    });
    await this.prisma.emailToken.create({
      data: {
        userId,
        type,
        tokenHash: this.hash(token),
        expiresAt: dayjs().add(TOKEN_LIFETIME_MINUTES[type], 'minute').toDate(),
      },
    });

    return token;
  }

  /**
   * Checks a token and uses it up. Returns the id of the token's user.
   * Throws 400 when the token is unknown, of another type, expired or already used.
   */
  async consume(token: string, type: EmailTokenType): Promise<bigint> {
    const row = await this.prisma.emailToken.findUnique({
      where: { tokenHash: this.hash(token) },
      select: { id: true, userId: true, type: true, expiresAt: true },
    });

    if (!row || row.type !== type || row.expiresAt < new Date()) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE[type]);
    }

    // Only one request can mark the token used, so two clicks at once can't both pass.
    const { count } = await this.prisma.emailToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE[type]);
    }

    return row.userId;
  }

  async sendVerifyEmail(user: EmailUser): Promise<void> {
    const token = await this.create(user.id, EmailTokenType.verify_email);
    await this.mailService.sendVerifyEmail(
      user.email,
      user.userName,
      this.link('/verify-email', token),
    );
  }

  async sendResetPassword(user: EmailUser): Promise<void> {
    const token = await this.create(user.id, EmailTokenType.reset_password);
    await this.mailService.sendResetPassword(
      user.email,
      user.userName,
      this.link('/reset-password', token),
    );
  }

  private link(path: string, token: string): string {
    // String join instead of new URL(path, base), which would drop a path in WEB_URL.
    const base = this.config
      .get('WEB_URL', { infer: true })
      .replace(/\/+$/, '');
    return `${base}${path}?token=${token}`;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
