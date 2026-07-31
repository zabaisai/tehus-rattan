import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const sendMailMock = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: (...args: unknown[]) => sendMailMock(...args),
  })),
}));

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const v = values[key];
      if (v === undefined) throw new Error(`missing ${key}`);
      return v;
    },
  } as unknown as ConfigService;
}

const input = {
  to: 'user@example.com',
  name: 'Ana',
  resetUrl: 'https://crm.example.com/reset-password?token=SECRET_TOKEN_VALUE',
  ttlMinutes: 15,
};

describe('MailService', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
  });

  it('is a controlled no-op when disabled (never sends, never logs the token)', async () => {
    const logSpy = jest
      .spyOn(require('@nestjs/common').Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const svc = new MailService(
      makeConfig({ PASSWORD_RESET_ENABLED: undefined }),
    );

    await svc.sendPasswordResetEmail(input);

    expect(sendMailMock).not.toHaveBeenCalled();
    // No log line ever contains the token or the recipient.
    for (const call of logSpy.mock.calls) {
      const line = String(call[0]);
      expect(line).not.toContain('SECRET_TOKEN_VALUE');
      expect(line).not.toContain('user@example.com');
    }
    logSpy.mockRestore();
  });

  it('sends via SMTP when enabled, with the rendered subject/body', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'x' });
    const svc = new MailService(
      makeConfig({
        PASSWORD_RESET_ENABLED: 'true',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'u',
        SMTP_PASSWORD: 'p',
        SMTP_FROM_EMAIL: 'no-reply@example.com',
        SMTP_FROM_NAME: 'Tehus Rattan',
      }),
    );

    await svc.sendPasswordResetEmail(input);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const sent = sendMailMock.mock.calls[0][0];
    expect(sent.to).toBe('user@example.com');
    expect(sent.subject).toContain('Restablece tu contraseña');
    expect(sent.html).toContain(input.resetUrl);
    expect(sent.from).toContain('no-reply@example.com');
  });

  it('propagates a send failure so the caller can compensate', async () => {
    sendMailMock.mockRejectedValue(new Error('smtp down'));
    const svc = new MailService(
      makeConfig({
        PASSWORD_RESET_ENABLED: 'true',
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'u',
        SMTP_PASSWORD: 'p',
        SMTP_FROM_EMAIL: 'no-reply@example.com',
      }),
    );

    await expect(svc.sendPasswordResetEmail(input)).rejects.toThrow(
      'smtp down',
    );
  });
});
