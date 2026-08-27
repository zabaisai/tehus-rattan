// Contrato del antibot, desacoplado del proveedor concreto. Permite conectar
// Cloudflare Turnstile en producción y un adaptador falso en local/tests sin que
// el resto del código sepa cuál está activo.

export interface CaptchaVerifyInput {
  token: string;
  // IP del cliente (ya de confianza vía trust proxy), opcional.
  remoteIp?: string | null;
  // action/hostname esperados, si el proveedor los soporta.
  expectedAction?: string;
}

export interface CaptchaResult {
  success: boolean;
  // Motivo clasificado (NUNCA el token ni secretos), para logs y diagnóstico.
  reason?: string;
}

export interface CaptchaProvider {
  readonly name: string;
  verify(input: CaptchaVerifyInput): Promise<CaptchaResult>;
}

// Token de inyección del proveedor.
export const CAPTCHA_PROVIDER = Symbol('CAPTCHA_PROVIDER');
