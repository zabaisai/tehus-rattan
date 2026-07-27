import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import {
  renderPasswordResetEmail,
  type PasswordResetEmailData,
} from './templates/password-reset-email.template';

export interface SendPasswordResetInput extends PasswordResetEmailData {
  to: string;
}

// Provider-agnostic transactional mail. The only coupling to nodemailer is
// inside getTransporter(); callers depend on this class, not the provider.
//
// Modes:
//  - ENABLED  (PASSWORD_RESET_ENABLED=true AND SMTP configured): sends via SMTP.
//             A send failure THROWS so the caller can compensate (revoke the
//             just-created token) — the public endpoint still replies generically.
//  - DISABLED (default in dev/tests): a controlled no-op. It never prints the
//             token or the reset URL (only a redacted marker), so a full token
//             never lands in a console/log. Local QA reads the token from the DB.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return (
      this.config.get<string>('PASSWORD_RESET_ENABLED') === 'true' &&
      !!this.config.get<string>('SMTP_HOST')?.trim()
    );
  }

  async sendPasswordResetEmail(input: SendPasswordResetInput): Promise<void> {
    if (!this.isEnabled()) {
      // Controlled no-op — NEVER log the token/url or recipient.
      this.logger.log(
        'Password reset email suppressed (mail disabled in this environment)',
      );
      return;
    }

    const fromName =
      this.config.get<string>('SMTP_FROM_NAME')?.trim() || 'Tehus Rattan';
    const fromEmail = this.config.getOrThrow<string>('SMTP_FROM_EMAIL');
    const { subject, html, text } = renderPasswordResetEmail(input);

    await this.getTransporter().sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: input.to,
      subject,
      html,
      text,
    });
    // No recipient, no token, no URL in the log line.
    this.logger.log('Password reset email dispatched');
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: this.config.getOrThrow<string>('SMTP_HOST'),
        port: Number(this.config.get<string>('SMTP_PORT') ?? '587'),
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        auth: {
          user: this.config.getOrThrow<string>('SMTP_USER'),
          pass: this.config.getOrThrow<string>('SMTP_PASSWORD'),
        },
      });
    }
    return this.transporter;
  }
}
