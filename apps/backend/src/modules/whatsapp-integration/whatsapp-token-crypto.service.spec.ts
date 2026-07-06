import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';

describe('WhatsAppTokenCryptoService', () => {
  const TEST_KEY = 'crypto-service-test-only-key-do-not-use';
  let configService: any;
  let service: WhatsAppTokenCryptoService;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) =>
        key === 'WHATSAPP_TOKEN_ENCRYPTION_KEY' ? TEST_KEY : undefined,
      ),
    };
    service = new WhatsAppTokenCryptoService(configService);
  });

  it('encrypt returns a value with 3 parts separated by ":"', () => {
    const encrypted = service.encrypt('fake-token-123');
    const parts = encrypted.split(':');

    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0], 'hex').length).toBe(12); // IV
    expect(Buffer.from(parts[1], 'hex').length).toBe(16); // GCM auth tag
  });

  it('decrypt(encrypt(token)) returns the original token', () => {
    const encrypted = service.encrypt('round-trip-token');

    expect(service.decrypt(encrypted)).toBe('round-trip-token');
  });

  it('encrypt rejects an empty or whitespace-only token', () => {
    expect(() => service.encrypt('')).toThrow();
    expect(() => service.encrypt('   ')).toThrow();
  });

  it('decrypt rejects an invalid format', () => {
    expect(() => service.decrypt('not-a-valid-format')).toThrow();
    expect(() => service.decrypt('only:two-parts')).toThrow();
    expect(() => service.decrypt('')).toThrow();
  });

  it('throws when WHATSAPP_TOKEN_ENCRYPTION_KEY is missing', () => {
    configService.get.mockReturnValue(undefined);

    expect(() => service.encrypt('fake-token')).toThrow();
    expect(() => service.decrypt('aa:bb:cc')).toThrow();
  });

  it('never includes the plain token or the key in thrown error messages', () => {
    let emptyTokenError: Error | undefined;
    try {
      service.encrypt('   ');
    } catch (error) {
      emptyTokenError = error as Error;
    }

    let missingKeyError: Error | undefined;
    configService.get.mockReturnValue(undefined);
    try {
      service.encrypt('some-real-looking-token');
    } catch (error) {
      missingKeyError = error as Error;
    }

    expect(emptyTokenError?.message).not.toContain(TEST_KEY);
    expect(missingKeyError?.message).not.toContain(TEST_KEY);
    expect(missingKeyError?.message).not.toContain('some-real-looking-token');
  });
});
