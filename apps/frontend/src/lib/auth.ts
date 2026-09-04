import api from "./axios";
import { AuthResponse, User } from "@/types";

/**
 * Resultado de `POST /auth/login`.
 *
 * El login dejó de ser «token o error»: cuando el servidor no reconoce el
 * dispositivo devuelve un reto de verificación SIN token y SIN sesión, así que
 * el tipo tiene que obligar a distinguir los dos casos. Con `AuthResponse` a
 * secas, un `data.token` indefinido se colaba hasta `setSession` y la pantalla
 * creía haber entrado.
 */
export interface AuthenticatedResult {
  status: "authenticated";
  token: string;
  user: User;
}

/** Reto pendiente: hay un código de 6 dígitos en el correo, no hay sesión. */
export interface VerificationRequiredResult {
  status: "verification_required";
  challengeId: string;
  /** Correo enmascarado TAL CUAL lo devuelve el servidor; el cliente no lo recorta. */
  maskedEmail: string;
  /** ISO. Cuándo vence el código. */
  expiresAt: string;
  /** ISO. Desde cuándo se puede pedir otro. */
  resendAvailableAt: string;
  attemptsRemaining: number;
}

export type LoginResult = AuthenticatedResult | VerificationRequiredResult;

export function isVerificationRequired(
  result: LoginResult,
): result is VerificationRequiredResult {
  return result.status === "verification_required";
}

/**
 * Con el interruptor del servidor apagado el login responde exactamente como
 * antes más el campo `status`. Esta normalización acepta también la forma
 * antigua (`{ token, user }` sin `status`) para que un backend viejo o un doble
 * de prueba no rompan la pantalla.
 */
export function normalizeLoginResult(
  data: LoginResult | AuthResponse,
): LoginResult {
  if ("status" in data && data.status === "verification_required") {
    return data;
  }
  const autenticado = data as AuthenticatedResult | AuthResponse;
  return {
    status: "authenticated",
    token: autenticado.token,
    user: autenticado.user,
  };
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  const { data } = await api.post<LoginResult | AuthResponse>("/auth/login", {
    email,
    password,
  });
  return normalizeLoginResult(data);
}

/**
 * Canjea el código de 6 dígitos por una sesión real.
 *
 * `trustDevice` viaja solo si la persona lo marcó: recordar un equipo durante
 * 30 días es una decisión suya, nunca el valor por defecto.
 */
export async function verifyDevice(input: {
  challengeId: string;
  code: string;
  trustDevice?: boolean;
}): Promise<AuthenticatedResult> {
  const { data } = await api.post<AuthenticatedResult>("/auth/verify-device", {
    challengeId: input.challengeId,
    code: input.code,
    ...(input.trustDevice ? { trustDevice: true } : {}),
  });
  return data;
}

/** Pide otro código para el MISMO reto. Devuelve el reto actualizado. */
export async function resendDeviceVerification(
  challengeId: string,
): Promise<VerificationRequiredResult> {
  const { data } = await api.post<VerificationRequiredResult>(
    "/auth/verify-device/resend",
    { challengeId },
  );
  return data;
}

/**
 * Retira la confianza de TODOS los dispositivos recordados de la cuenta.
 *
 * Se exporta aunque la pantalla de login todavía no lo use: es la acción que
 * corresponde a «marqué confiar en un equipo que ya no controlo» y vive junto
 * al resto del contrato de autenticación, no suelta en la pantalla que la
 * acabe llamando.
 */
export async function revokeTrustedDevices(): Promise<void> {
  await api.post("/auth/trusted-devices/revoke-all");
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>("/auth/me");
  return data;
}

// Closes only this browser's session (identified by its httpOnly
// refresh-token cookie) — never other devices.
export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}

// Password recovery. The response is intentionally generic (never reveals
// whether an account exists), so callers show the same message regardless.
export async function forgotPassword(email: string): Promise<void> {
  await api.post("/auth/forgot-password", { email });
}

export async function resetPassword(
  token: string,
  password: string,
  passwordConfirmation: string,
): Promise<void> {
  await api.post("/auth/reset-password", {
    token,
    password,
    passwordConfirmation,
  });
}
