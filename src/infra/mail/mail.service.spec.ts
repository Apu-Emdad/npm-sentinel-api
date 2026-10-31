import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { MailService } from './mail.service.js';

const sendMail = vi.fn();
const createTransport = vi.fn((_options: unknown) => ({ sendMail }));

vi.mock('nodemailer', () => ({
  createTransport: (options: unknown) => createTransport(options),
}));

const env: Record<string, unknown> = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 587,
  SMTP_USER: 'smtp-user',
  SMTP_PASS: 'smtp-pass',
  MAIL_FROM: 'Starter <no-reply@example.com>',
};

describe('MailService', () => {
  let mailService: MailService;

  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
    mailService = new MailService({
      get: (key: string) => env[key],
    } as unknown as ConfigService<Env, true>);
  });

  it('connects with the SMTP settings, using STARTTLS on port 587', () => {
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'smtp-user', pass: 'smtp-pass' },
    });
  });

  it('sends the verify email with the link in the HTML and the text', async () => {
    const link = 'http://localhost:5001/verify-email?token=abc';

    await mailService.sendVerifyEmail('apu@example.com', 'apu_emdad', link);

    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({
      from: 'Starter <no-reply@example.com>',
      to: 'apu@example.com',
      subject: 'Verify your email',
    });
    expect(mail.html).toContain(`href="${link}"`);
    expect(mail.html).toContain('apu_emdad');
    expect(mail.text).toContain(link);
  });

  it('sends the reset password email', async () => {
    await mailService.sendResetPassword(
      'apu@example.com',
      'apu_emdad',
      'http://localhost:5001/reset-password?token=abc&x=<b>',
    );

    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toBe('Reset your password');
    expect(mail.html).toContain('30 minutes');
    // Values are escaped in the HTML.
    expect(mail.html).toContain('token=abc&amp;x=&lt;b&gt;');
  });

  it('throws when sending fails, so the caller can decide what to do', async () => {
    sendMail.mockRejectedValue(new Error('SMTP is down'));

    await expect(
      mailService.sendVerifyEmail('apu@example.com', 'apu_emdad', 'http://x'),
    ).rejects.toThrow('SMTP is down');
  });
});
