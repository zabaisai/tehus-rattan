/**
 * Parámetros de la verificación de dispositivo (Fase 4.5).
 *
 * Son constantes del producto, no configuración por entorno: cambiarlas es una
 * decisión de seguridad que debe pasar por revisión y por las pruebas, no por
 * una variable que alguien puede aflojar en caliente. Lo único que sí es
 * configuración es el interruptor de la funcionalidad y su secreto
 * (`device-verification.config.ts`).
 */

/** Dígitos del código enviado por correo. */
export const CHALLENGE_CODE_LENGTH = 6;

/** Vigencia del código. Diez minutos: suficiente para abrir el correo. */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/**
 * Intentos permitidos por reto. Al quinto fallo el reto muere y hay que volver
 * a empezar; con seis dígitos, cinco intentos dejan la probabilidad de acertar
 * a ciegas en 5 entre un millón.
 */
export const CHALLENGE_MAX_ATTEMPTS = 5;

/** Espera mínima entre reenvíos del código. */
export const CHALLENGE_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Vigencia de un dispositivo confiable. Es lo que la persona acepta al marcar
 * la casilla, así que el texto de la interfaz y este número dicen lo mismo.
 */
export const TRUSTED_DEVICE_TTL_DAYS = 30;
export const TRUSTED_DEVICE_TTL_MS =
  TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Cookie del dispositivo confiable.
 *
 * Con HTTPS se usa el prefijo `__Host-`, que el navegador solo acepta si la
 * cookie es `Secure`, tiene `Path=/` y **no** declara `Domain`: así ningún
 * subdominio vecino puede escribirla. Sin HTTPS (desarrollo) ese prefijo es
 * inválido, así que se usa el nombre plano y se acota la ruta a `/api/auth`.
 */
export const TRUSTED_DEVICE_COOKIE_SECURE_NAME = '__Host-takto_trusted_device';
export const TRUSTED_DEVICE_COOKIE_PLAIN_NAME = 'takto_trusted_device';
export const TRUSTED_DEVICE_COOKIE_PLAIN_PATH = '/api/auth';

/** Bytes aleatorios del token del dispositivo (256 bits). */
export const TRUSTED_DEVICE_TOKEN_BYTES = 32;

/**
 * Mensaje único para código incorrecto, ya usado, vencido o inexistente. Un
 * texto distinto por caso le diría a quien prueba códigos en qué se equivocó.
 */
export const CHALLENGE_GENERIC_ERROR =
  'El código no es válido o ya venció. Solicita uno nuevo.';

/** Acciones de auditoría de la fase. Nunca llevan el código ni el token. */
export const AUDIT_CHALLENGE_CREATED = 'DEVICE_VERIFICATION_CHALLENGE_CREATED';
export const AUDIT_CHALLENGE_SUCCEEDED = 'DEVICE_VERIFICATION_SUCCEEDED';
export const AUDIT_CHALLENGE_FAILED = 'DEVICE_VERIFICATION_FAILED';
export const AUDIT_TRUSTED_DEVICE_CREATED = 'TRUSTED_DEVICE_CREATED';
export const AUDIT_TRUSTED_DEVICE_REVOKED = 'TRUSTED_DEVICE_REVOKED';
