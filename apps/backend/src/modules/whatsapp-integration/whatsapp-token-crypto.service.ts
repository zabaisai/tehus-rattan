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
//
// ROTACION DE CLAVE
// Cifrar usa SIEMPRE la clave actual; descifrar prueba primero la actual y
// despues `WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS` si esta definida.
//
// Esa asimetria es lo que hace posible rotar sin parar el servicio: se pone la
// clave nueva como actual y la vieja como anterior, el sistema sigue leyendo
// todo lo cifrado con la vieja, y un proceso aparte va recifrando. Sin la
// clave anterior, cambiar la variable dejaria ilegibles todos los tokens ya
// guardados en el mismo instante — y el sintoma seria que WhatsApp deja de
// enviar, sin ninguna pista de por que.
//
// La clave anterior se retira DESPUES de verificar el recifrado, no antes.
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
    return this.decryptWithInfo(accessTokenEncrypted).token;
  }

  /**
   * Descifra e informa de QUE clave hizo falta.
   *
   * El `conClaveAnterior` es lo que permite al recifrado saber cuanto queda
   * por migrar y, sobre todo, cuando es seguro retirar la clave vieja: cero
   * filas con la anterior significa que ya no hace falta.
   */
  decryptWithInfo(accessTokenEncrypted: string): {
    token: string;
    conClaveAnterior: boolean;
  } {
    if (!accessTokenEncrypted?.trim()) {
      throw new Error('accessTokenEncrypted no puede estar vacio');
    }

    const [ivHex, authTagHex, cipherTextHex] = accessTokenEncrypted.split(':');

    if (!ivHex || !authTagHex || !cipherTextHex) {
      throw new Error('Formato de accessTokenEncrypted inválido');
    }

    try {
      return {
        token: this.descifrarCon(
          this.deriveKey(),
          ivHex,
          authTagHex,
          cipherTextHex,
        ),
        conClaveAnterior: false,
      };
    } catch (errorConActual) {
      const anterior = this.deriveKeyAnterior();
      // Sin clave anterior configurada, el fallo es el fallo: no hay nada mas
      // que probar y ocultarlo confundiria el diagnostico.
      if (!anterior) throw errorConActual;

      // GCM autentica: si la clave no es la correcta, `final()` lanza. Por eso
      // probar la segunda clave no es adivinar — o descifra bien, o no
      // descifra.
      return {
        token: this.descifrarCon(anterior, ivHex, authTagHex, cipherTextHex),
        conClaveAnterior: true,
      };
    }
  }

  private descifrarCon(
    key: Buffer,
    ivHex: string,
    authTagHex: string,
    cipherTextHex: string,
  ): string {
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

  /** `null` si no hay rotacion en curso. */
  private deriveKeyAnterior(): Buffer | null {
    const rawKey = this.configService.get<string>(
      'WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS',
    );
    if (!rawKey?.trim()) return null;
    return createHash('sha256').update(rawKey).digest();
  }

  /** ¿Hay una rotacion en curso? Lo consulta el recifrado y el health. */
  rotacionEnCurso(): boolean {
    return this.deriveKeyAnterior() !== null;
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
