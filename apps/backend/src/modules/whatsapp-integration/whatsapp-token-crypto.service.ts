import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

// accessTokenEncrypted format: "<ivHex>:<authTagHex>:<cipherTextHex>",
// AES-256-GCM with a 12-byte IV, key = sha256(WHATSAPP_TOKEN_ENCRYPTION_KEY).
@Injectable()
export class WhatsAppTokenCryptoService {
  constructor(private configService: ConfigService) {}

  encrypt(plainToken: string): string {
    if (!plainToken?.trim()) {
      throw new Error('El token de WhatsApp no puede estar vacio');
    }

    const key = this.deriveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainToken.trim(), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(accessTokenEncrypted: string): string {
    if (!accessTokenEncrypted?.trim()) {
      throw new Error('accessTokenEncrypted no puede estar vacio');
    }

    const [ivHex, authTagHex, cipherTextHex] =
      accessTokenEncrypted.split(':');

    if (!ivHex || !authTagHex || !cipherTextHex) {
      throw new Error('Formato de accessTokenEncrypted inválido');
    }

    const key = this.deriveKey();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherTextHex, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private deriveKey(): Buffer {
    const rawKey = this.configService.get<string>(
      'WHATSAPP_TOKEN_ENCRYPTION_KEY',
    );

    if (!rawKey?.trim()) {
      throw new Error('WHATSAPP_TOKEN_ENCRYPTION_KEY no está configurada');
    }

    return createHash('sha256').update(rawKey).digest();
  }
}
