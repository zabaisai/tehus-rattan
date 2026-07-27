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

  // Notification emails gate only on SMTP being configured (independent of the
  // password-reset flag). When SMTP is not configured it is a controlled no-op
  // — never throws, so a notification email can never break the main operation.
  // The caller must pass an already-sanitized preview (no secrets, no full
  // message bodies, no other company's data).
  isSmtpConfigured(): boolean {
    return (
      !!this.config.get<string>('SMTP_HOST')?.trim() &&
      !!this.config.get<string>('SMTP_USER')?.trim() &&
      !!this.config.get<string>('SMTP_PASSWORD')?.trim() &&
      !!this.config.get<string>('SMTP_FROM_EMAIL')?.trim()
    );
  }

  async sendNotificationEmail(input: {
    to: string;
    name: string;
    title: string;
    preview: string;
    actionUrl: string | null;
    category: string;
  }): Promise<void> {
    if (!this.isSmtpConfigured()) {
      this.logger.log('Notification email suppressed (SMTP not configured)');
      return;
    }
    const fromName =
      this.config.get<string>('SMTP_FROM_NAME')?.trim() || 'Tehus Rattan';
    const fromEmail = this.config.getOrThrow<string>('SMTP_FROM_EMAIL');
    const safe = (s: string) => s.replace(/[<>]/g, '').slice(0, 300);
    const title = safe(input.title);
    const preview = safe(input.preview);
    // Only an absolute http(s) URL is ever linked (no open redirect / arbitrary
    // scheme); otherwise the button is omitted.
    const link =
      input.actionUrl && /^https?:\/\//i.test(input.actionUrl)
        ? input.actionUrl
        : null;
    const button = link
      ? `<p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#1c1917;color:#fff;border-radius:6px;text-decoration:none">Abrir en el CRM</a></p>`
      : '';
    const html = `<div style="font-family:sans-serif;color:#1c1917"><p>Hola ${safe(input.name)},</p><p><strong>${title}</strong></p>${preview ? `<p>${preview}</p>` : ''}${button}<p style="color:#78716c;font-size:12px">Recibiste este correo por tus preferencias de notificaciones en el CRM Tehus Rattan.</p></div>`;
    const text = `Hola ${safe(input.name)}\n\n${title}\n${preview}${link ? `\n\n${link}` : ''}`;

    await this.getTransporter().sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: input.to,
      subject: title,
      html,
      text,
    });
    this.logger.log('Notification email dispatched');
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
