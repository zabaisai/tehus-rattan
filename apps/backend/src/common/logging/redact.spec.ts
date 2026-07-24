import { maskPhone, redactKey, redactObject } from './redact';

describe('redact', () => {
  describe('redactKey', () => {
    it.each([
      'Authorization',
      'authorization',
      'Cookie',
      'set-cookie',
      'x-hub-signature-256',
      'token',
      'refresh_token',
      'refreshToken',
      'device-id',
      'deviceId',
      'password',
      'JWT_SECRET',
      'DATABASE_URL',
      'WHATSAPP_APP_SECRET',
    ])('flags %s as sensitive', (key) => {
      expect(redactKey(key)).toBe(true);
    });

    it.each(['x-request-id', 'content-type', 'accept', 'user-agent', 'name'])(
      'does not flag %s',
      (key) => {
        expect(redactKey(key)).toBe(false);
      },
    );
  });

  describe('redactObject', () => {
    it('redacts sensitive values but keeps safe ones and never leaks length', () => {
      const out = redactObject({
        authorization: 'Bearer super-secret-jwt-value',
        cookie: 'tehus_refresh_token=abc123',
        'content-type': 'application/json',
        'x-request-id': 'req-1',
      });
      expect(out.authorization).toBe('[REDACTED]');
      expect(out.cookie).toBe('[REDACTED]');
      expect(JSON.stringify(out)).not.toContain('super-secret-jwt-value');
      expect(JSON.stringify(out)).not.toContain('abc123');
      expect(out['content-type']).toBe('application/json');
      expect(out['x-request-id']).toBe('req-1');
    });

    it('returns {} for undefined input', () => {
      expect(redactObject(undefined)).toEqual({});
    });
  });

  describe('maskPhone', () => {
    it('keeps only the last 4 digits', () => {
      expect(maskPhone('573001234567')).toBe('****4567');
      expect(maskPhone('+57 300 123 4567')).toBe('****4567');
    });
    it('fully masks short/empty values', () => {
      expect(maskPhone('123')).toBe('****');
      expect(maskPhone('')).toBe('(none)');
      expect(maskPhone(undefined)).toBe('(none)');
    });
    it('never contains the full number', () => {
      const full = '573001234567';
      expect(maskPhone(full)).not.toContain('57300');
    });
  });
});
