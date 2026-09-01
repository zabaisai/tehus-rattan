import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { WhatsAppTokenCryptoService } from './whatsapp-integration/whatsapp-token-crypto.service';

/**
 * Compatibilidad y rotación del cifrado de tokens de WhatsApp.
 *
 * El cambio a v2 (scrypt + sal) NO puede dejar ilegibles los tokens ya
 * guardados con el formato legacy (sha256 sin sal). Este spec lo demuestra
 * construyendo un ciphertext legacy con el MISMO algoritmo antiguo y probando
 * que el servicio nuevo lo descifra, y que la rotación funciona en ambos
 * formatos.
 */
function cifrarLegacy(rawKey: string, token: string): string {
  const key = createHash('sha256').update(rawKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function servicioCon(actual?: string, anterior?: string) {
  const config = {
    get: jest.fn((k: string) =>
      k === 'WHATSAPP_TOKEN_ENCRYPTION_KEY'
        ? actual
        : k === 'WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS'
          ? anterior
          : undefined,
    ),
  };
  return new WhatsAppTokenCryptoService(config as never);
}

const CLAVE_A = 'clave-de-cifrado-de-prueba-numero-uno-32+';
const CLAVE_B = 'clave-de-cifrado-de-prueba-numero-dos-32+';

describe('WhatsAppTokenCryptoService — formato v2 + compatibilidad', () => {
  it('encrypt produce el formato v2 (prefijo + salt + iv + tag + ct)', () => {
    const enc = servicioCon(CLAVE_A).encrypt('token-123');
    const partes = enc.split(':');
    expect(partes[0]).toBe('v2');
    expect(partes).toHaveLength(5);
    expect(Buffer.from(partes[1], 'hex').length).toBe(16); // salt
    expect(Buffer.from(partes[2], 'hex').length).toBe(12); // iv
    expect(Buffer.from(partes[3], 'hex').length).toBe(16); // gcm tag
  });

  it('round-trip v2 devuelve el token original', () => {
    const s = servicioCon(CLAVE_A);
    expect(s.decrypt(s.encrypt('round-trip'))).toBe('round-trip');
  });

  it('dos cifrados del mismo token usan sales distintas (no determinista)', () => {
    const s = servicioCon(CLAVE_A);
    expect(s.encrypt('x').split(':')[1]).not.toBe(s.encrypt('x').split(':')[1]);
  });

  it('descifra un ciphertext LEGACY (sha256, 3 partes) sin migración', () => {
    const legacy = cifrarLegacy(CLAVE_A, 'token-heredado');
    expect(legacy.split(':')).toHaveLength(3);
    expect(servicioCon(CLAVE_A).decrypt(legacy)).toBe('token-heredado');
  });

  it('rotación: descifra v2 cifrado con la clave ANTERIOR', () => {
    const viejo = servicioCon(CLAVE_A).encrypt('token-viejo'); // v2 con CLAVE_A
    const enRotacion = servicioCon(CLAVE_B, CLAVE_A); // actual B, anterior A
    const info = enRotacion.decryptWithInfo(viejo);
    expect(info.token).toBe('token-viejo');
    expect(info.conClaveAnterior).toBe(true);
  });

  it('rotación: descifra LEGACY cifrado con la clave ANTERIOR', () => {
    const legacy = cifrarLegacy(CLAVE_A, 'legacy-viejo');
    const enRotacion = servicioCon(CLAVE_B, CLAVE_A);
    const info = enRotacion.decryptWithInfo(legacy);
    expect(info.token).toBe('legacy-viejo');
    expect(info.conClaveAnterior).toBe(true);
  });

  it('con la clave actual correcta, conClaveAnterior es false', () => {
    const s = servicioCon(CLAVE_A, CLAVE_B);
    expect(s.decryptWithInfo(s.encrypt('t')).conClaveAnterior).toBe(false);
  });

  it('rotacionEnCurso refleja si hay clave anterior', () => {
    expect(servicioCon(CLAVE_A).rotacionEnCurso()).toBe(false);
    expect(servicioCon(CLAVE_A, CLAVE_B).rotacionEnCurso()).toBe(true);
  });

  it('un token manipulado no descifra (GCM autentica)', () => {
    const s = servicioCon(CLAVE_A);
    const enc = s.encrypt('intacto');
    const partes = enc.split(':');
    // Voltea un byte del ciphertext.
    const ct = Buffer.from(partes[4], 'hex');
    ct[0] ^= 0xff;
    partes[4] = ct.toString('hex');
    expect(() => s.decrypt(partes.join(':'))).toThrow();
  });

  it('nunca incluye la clave ni el token en el mensaje de error', () => {
    const s = servicioCon(undefined);
    let err: Error | undefined;
    try {
      s.encrypt('token-super-secreto');
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).not.toContain('token-super-secreto');
  });
});
