import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.js';
import {
  type MailContent,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from './mail.templates.js';

/**
 * Sends emails over SMTP with nodemailer.
 *
 * The transport opens a connection only when an email is sent, so the app boots without SMTP.
 * Errors are thrown to the caller, which decides if a failed email should fail the request.
 */
@Injectable()
export class MailService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    const port = config.get('SMTP_PORT', { infer: true });

    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port,
      secure: port === 465,
      auth: {
        user: config.get('SMTP_USER', { infer: true }),
        pass: config.get('SMTP_PASS', { infer: true }),
      },
    });
    this.from = config.get('MAIL_FROM', { infer: true });
  }

  async sendVerifyEmail(to: string, userName: string, link: string) {
    await this.send(to, verifyEmailTemplate(userName, link));
  }

  async sendResetPassword(to: string, userName: string, link: string) {
    await this.send(to, resetPasswordTemplate(userName, link));
  }

  private async send(to: string, content: MailContent) {
    await this.transporter.sendMail({ from: this.from, to, ...content });
  }
}
