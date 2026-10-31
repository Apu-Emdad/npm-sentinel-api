export interface SentMail {
  kind: 'verify-email' | 'reset-password';
  to: string;
  userName: string;
  link: string;
}

/**
 * Stand-in for MailService that records every email instead of sending it,
 * so tests never need SMTP. Set `fail` to make the next sends throw.
 */
export class FakeMailService {
  readonly sent: SentMail[] = [];
  fail = false;

  async sendVerifyEmail(to: string, userName: string, link: string) {
    this.record({ kind: 'verify-email', to, userName, link });
  }

  async sendResetPassword(to: string, userName: string, link: string) {
    this.record({ kind: 'reset-password', to, userName, link });
  }

  // The token from the last email of this kind.
  lastToken(kind: SentMail['kind']): string {
    const mail = this.sent.findLast((m) => m.kind === kind);
    if (!mail) throw new Error(`no ${kind} email sent`);
    return new URL(mail.link).searchParams.get('token') ?? '';
  }

  private record(mail: SentMail) {
    if (this.fail) throw new Error('SMTP is down');
    this.sent.push(mail);
  }
}
