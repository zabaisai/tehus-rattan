import type {
  LoginResult,
  VerificationRequiredResult,
} from '@/lib/auth';

/**
 * La máquina de estados del login, aparte de la pantalla.
 *
 * EXISTE PARA QUE NO HAYA BOOLEANOS SUELTOS. Con `loading`, `verifying`,
 * `resending`, `locked` y `challenge` como estados independientes hay 32
 * combinaciones, y la mayoría son imposibles: «reenviando y en credenciales a
 * la vez», «bloqueado pero enviando». Cada una de esas combinaciones acabó
 * alguna vez en pantalla como un botón activo que no debía estarlo.
 *
 * Aquí solo hay UN paso a la vez y las transiciones son las que este archivo
 * enumera, así que se pueden probar sin montar React.
 */
export type LoginStep =
  /** Formulario de correo y contraseña. */
  | 'credentials'
  /** POST /auth/login en vuelo. */
  | 'submitting'
  /** El servidor pidió verificar el dispositivo: seis dígitos en pantalla. */
  | 'verification'
  /** POST /auth/verify-device en vuelo. */
  | 'verifying'
  /** POST /auth/verify-device/resend en vuelo. */
  | 'resending'
  /** Credenciales aceptadas y sesión en memoria; falta cargar el perfil. */
  | 'granted'
  /** Perfil cargado; se está navegando al tablero. */
  | 'opening';

export interface DeviceChallenge {
  challengeId: string;
  maskedEmail: string;
  expiresAt: string;
  resendAvailableAt: string;
  attemptsRemaining: number;
}

export interface LoginState {
  step: LoginStep;
  /** Mensaje de error visible. Vacío = no hay error. */
  error: string;
  /**
   * Cambia con CADA error, aunque el texto se repita.
   *
   * El formulario de dígitos se vacía y devuelve el foco al primero cuando
   * aparece un error; sin este contador, dos códigos malos seguidos producen
   * el mismo texto y el efecto no vuelve a ejecutarse, así que el segundo
   * intento se quedaba con los dígitos viejos escritos.
   */
  errorSeq: number;
  /** Confirmación breve (p. ej. «Te enviamos otro código.»). Vacío = ninguna. */
  notice: string;
  challenge: DeviceChallenge | null;
  /** ISO. Fijado por un 429; hasta esa hora no se acepta otro intento. */
  lockedUntil: string | null;
}

export const initialLoginState: LoginState = {
  step: 'credentials',
  error: '',
  errorSeq: 0,
  notice: '',
  challenge: null,
  lockedUntil: null,
};

export type LoginAction =
  /** Se envían credenciales. */
  | { type: 'submit' }
  /** El servidor pide verificar el dispositivo. */
  | { type: 'challenge'; challenge: DeviceChallenge }
  /** Se envía el código de 6 dígitos. */
  | { type: 'verify' }
  /** Se pide otro código. */
  | { type: 'resend' }
  /** Llegó un reto nuevo tras reenviar. */
  | { type: 'resent'; challenge: DeviceChallenge; notice: string }
  /** Hay sesión: token y usuario en memoria. */
  | { type: 'granted' }
  /** El perfil está cargado y se navega al tablero. */
  | { type: 'opening' }
  /** Error recuperable; el paso vuelve al formulario que lo originó. */
  | { type: 'error'; message: string }
  /** 429: además del mensaje, hasta cuándo no se acepta otro intento. */
  | { type: 'locked'; message: string; until: string }
  /** «Volver» desde la verificación: descarta el reto, no llama a la API. */
  | { type: 'back' }
  /** Vuelta al estado inicial (p. ej. tras cancelar la apertura). */
  | { type: 'reset' };

/** A dónde vuelve un paso «en vuelo» cuando falla. */
function stepTrasError(step: LoginStep): LoginStep {
  if (step === 'verifying' || step === 'resending' || step === 'verification') {
    return 'verification';
  }
  return 'credentials';
}

export function loginReducer(
  state: LoginState,
  action: LoginAction,
): LoginState {
  switch (action.type) {
    case 'submit':
      return { ...state, step: 'submitting', error: '', notice: '' };

    case 'challenge':
      return {
        ...state,
        step: 'verification',
        error: '',
        notice: '',
        challenge: action.challenge,
      };

    case 'verify':
      return { ...state, step: 'verifying', error: '', notice: '' };

    case 'resend':
      return { ...state, step: 'resending', error: '', notice: '' };

    case 'resent':
      return {
        ...state,
        step: 'verification',
        error: '',
        notice: action.notice,
        challenge: action.challenge,
      };

    case 'granted':
      return { ...state, step: 'granted', error: '', notice: '' };

    case 'opening':
      return { ...state, step: 'opening', error: '' };

    case 'error':
      return {
        ...state,
        step: stepTrasError(state.step),
        error: action.message,
        errorSeq: state.errorSeq + 1,
        notice: '',
      };

    case 'locked':
      return {
        ...state,
        step: stepTrasError(state.step),
        error: action.message,
        errorSeq: state.errorSeq + 1,
        notice: '',
        lockedUntil: action.until,
      };

    case 'back':
      return {
        ...initialLoginState,
        errorSeq: state.errorSeq,
        lockedUntil: state.lockedUntil,
      };

    case 'reset':
      return { ...initialLoginState, errorSeq: state.errorSeq };

    default:
      return state;
  }
}

/**
 * Segundos que faltan para `iso`, nunca negativos.
 *
 * `now` es un parámetro y no `Date.now()` a secas para que la cuenta atrás se
 * pueda probar sin relojes falsos y para que el mismo tick pinte los dos
 * contadores (vencimiento y reenvío) con el mismo instante.
 */
export function secondsUntil(
  iso: string | null | undefined,
  now: number = Date.now(),
): number {
  if (!iso) return 0;
  const objetivo = Date.parse(iso);
  if (!Number.isFinite(objetivo)) return 0;
  return Math.max(0, Math.ceil((objetivo - now) / 1000));
}

/** ¿Sigue vigente el bloqueo por demasiados intentos? */
export function isLocked(
  state: Pick<LoginState, 'lockedUntil'>,
  now: number = Date.now(),
): boolean {
  return secondsUntil(state.lockedUntil, now) > 0;
}

/** `m:ss`. Para la línea «El código vence en 4:37». */
export function formatCountdown(totalSeconds: number): string {
  const seguro = Math.max(0, Math.floor(totalSeconds));
  const minutos = Math.floor(seguro / 60);
  const segundos = seguro % 60;
  return `${minutos}:${String(segundos).padStart(2, '0')}`;
}

/** Pasa la respuesta del servidor al reto que guarda el estado. */
export function challengeFromResult(
  result: VerificationRequiredResult,
): DeviceChallenge {
  return {
    challengeId: result.challengeId,
    maskedEmail: result.maskedEmail,
    expiresAt: result.expiresAt,
    resendAvailableAt: result.resendAvailableAt,
    attemptsRemaining: result.attemptsRemaining,
  };
}

/** Azúcar para la pantalla: qué paso corresponde a una respuesta de login. */
export function actionFromLoginResult(result: LoginResult): LoginAction {
  return result.status === 'verification_required'
    ? { type: 'challenge', challenge: challengeFromResult(result) }
    : { type: 'granted' };
}
