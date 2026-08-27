import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'node:crypto';

// accessTokenEncrypted — AES-256-GCM, dos formatos:
//
//   v2 (nuevo, por defecto al cifrar):
//     "v2:<saltHex>:<ivHex>:<authTagHex>:<cipherTextHex>"
//     clave = scrypt(RAW_KEY, salt)  — KDF con sal única por ciphertext.
//
//   legacy (los ya guardados antes de v2):
//     "<ivHex>:<authTagHex>:<cipherTextHex>"
//     clave = sha256(RAW_KEY)  — sin sal.
//
// COMPATIBILIDAD: descifrar detecta el formato y usa la derivación correcta, así
// que los tokens legacy siguen leyéndose sin migración. Cifrar produce SIEMPRE
// v2; un proceso de recifrado (o el paso natural al reconectar) va moviendo los
// legacy a v2. El prefijo "v2" ES el versionado de clave/derivación: una v3
// futura se añade sin romper nada.
//
// ROTACION DE CLAVE
// Cifrar usa SIEMPRE la clave actual; descifrar prueba primero la actual y
// despues `WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS` si esta definida. Esa
// asimetria permite rotar sin parar el servicio: clave nueva como actual, vieja
// como anterior, el sistema sigue leyendo lo cifrado con la vieja, y un proceso
// aparte recifra. La clave anterior se retira DESPUES de verificar el recifrado.
const V2_PREFIX = 'v2';
// Parámetros de scrypt: coste moderado (~decenas de ms) — suficiente contra
// fuerza bruta de una passphrase sin penalizar el envío, más la caché de abajo.
const SCRYPT_N = 16384; // 2^14
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32; // AES-256
const SALT_LEN = 16;

@Injectable()
export class WhatsAppTokenCryptoService {
  constructor(private configService: ConfigService) {}

  // scrypt es caro a propósito; derivar en cada envío sería costoso. Un token
  // guardado tiene UNA sal, así que su clave se deriva una vez por proceso y se
  // cachea. La cardinalidad está acotada por el nº de integraciones.
  private readonly claveCache = new Map<string, Buffer>();

  encrypt(plainToken: string): string {
    if (!plainToken?.trim()) {
      throw new Error('El token de WhatsApp no puede estar vacio');
    }

    const salt = randomBytes(SALT_LEN);
    const key = this.deriveScrypt(this.rawKeyActual(), salt);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainToken.trim(), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      V2_PREFIX,
      salt.toString('hex'),
      iv.toString('hex'),
      authTag.toString('hex'),
      encrypted.toString('hex'),
    ].join(':');
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

    const partes = accessTokenEncrypted.split(':');
    const esV2 = partes[0] === V2_PREFIX;

    // Deriva la clave según el formato: v2 → scrypt(raw, salt); legacy → sha256.
    const derivar = (rawKey: string): Buffer => {
      if (esV2) {
        const saltHex = partes[1];
        if (!saltHex) throw new Error('Formato v2 inválido: falta la sal');
        return this.deriveScrypt(rawKey, Buffer.from(saltHex, 'hex'));
      }
      return createHash('sha256').update(rawKey).digest();
    };

    const [ivHex, authTagHex, cipherTextHex] = esV2
      ? [partes[2], partes[3], partes[4]]
      : [partes[0], partes[1], partes[2]];

    if (!ivHex || !authTagHex || !cipherTextHex) {
      throw new Error('Formato de accessTokenEncrypted inválido');
    }

    try {
      return {
        token: this.descifrarCon(
          derivar(this.rawKeyActual()),
          ivHex,
          authTagHex,
          cipherTextHex,
        ),
        conClaveAnterior: false,
      };
    } catch (errorConActual) {
      const rawAnterior = this.rawKeyAnterior();
      // Sin clave anterior configurada, el fallo es el fallo: no hay nada mas
      // que probar y ocultarlo confundiria el diagnostico.
      if (!rawAnterior) throw errorConActual;

      // GCM autentica: si la clave no es la correcta, `final()` lanza. Por eso
      // probar la segunda clave no es adivinar — o descifra bien, o no
      // descifra.
      return {
        token: this.descifrarCon(
          derivar(rawAnterior),
          ivHex,
          authTagHex,
          cipherTextHex,
        ),
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

  /** Deriva (y cachea) la clave scrypt para una (rawKey, salt) dada. */
  private deriveScrypt(rawKey: string, salt: Buffer): Buffer {
    const cacheKey = `${createHash('sha256')
      .update(rawKey)
      .digest('hex')}:${salt.toString('hex')}`;
    const cacheado = this.claveCache.get(cacheKey);
    if (cacheado) return cacheado;

    const key = scryptSync(rawKey, salt, KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    this.claveCache.set(cacheKey, key);
    return key;
  }

  private rawKeyActual(): string {
    const rawKey = this.configService.get<string>(
      'WHATSAPP_TOKEN_ENCRYPTION_KEY',
    );
    if (!rawKey?.trim()) {
      throw new Error('WHATSAPP_TOKEN_ENCRYPTION_KEY no está configurada');
    }
    return rawKey.trim();
  }

  /** `null` si no hay rotacion en curso. */
  private rawKeyAnterior(): string | null {
    const rawKey = this.configService.get<string>(
      'WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS',
    );
    return rawKey?.trim() ? rawKey.trim() : null;
  }

  /** ¿Hay una rotacion en curso? Lo consulta el recifrado y el health. */
  rotacionEnCurso(): boolean {
    return this.rawKeyAnterior() !== null;
  }
}
