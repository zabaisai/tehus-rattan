'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { login, resendDeviceVerification, verifyDevice } from '@/lib/auth';
import {
  challengeFromResult,
  initialLoginState,
  isLocked,
  loginReducer,
  secondsUntil,
} from '@/lib/login-machine';
import { useAuthStore } from '@/store/auth.store';
import { ConnectionUnavailable } from '@/components/auth/ConnectionUnavailable';
import {
  LoginShowcase,
  LEYENDA_ILUSTRATIVA,
} from '@/components/auth/LoginShowcase';
import { DeviceVerificationForm } from '@/components/auth/DeviceVerificationForm';
import { WorkspaceOpening } from '@/components/auth/WorkspaceOpening';
import { TaktoLogo } from '@/components/ui/TaktoLogo';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';

type ApiError = {
  response?: {
    status?: number;
    data?: { message?: string };
    headers?: Record<string, unknown>;
  };
};

const MENSAJE_CREDENCIALES = 'Credenciales inválidas';
const MENSAJE_CODIGO = 'El código no es válido o ya venció. Solicita uno nuevo.';
const MENSAJE_BLOQUEO =
  'Demasiados intentos. Espera un momento antes de volver a intentarlo.';
const ESPERA_BLOQUEO_POR_DEFECTO_S = 60;

function mensajeDeError(error: unknown, generico: string): string {
  return (error as ApiError).response?.data?.message || generico;
}

function esDemasiadosIntentos(error: unknown): boolean {
  return (error as ApiError).response?.status === 429;
}

/** Hasta cuándo bloquear. Usa `Retry-After` si viene; si no, un minuto. */
function bloqueoHasta(error: unknown): string {
  const cabecera = (error as ApiError).response?.headers?.['retry-after'];
  const segundos = Number(cabecera);
  const espera =
    Number.isFinite(segundos) && segundos > 0
      ? segundos
      : ESPERA_BLOQUEO_POR_DEFECTO_S;
  return new Date(Date.now() + espera * 1000).toISOString();
}

export default function LoginPage() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const usuario = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);

  const [state, dispatch] = useReducer(loginReducer, initialLoginState);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [mayusculas, setMayusculas] = useState(false);
  const [resetNotice, setResetNotice] = useState('');
  const [anchoAmplio, setAnchoAmplio] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());

  // Guarda de doble envío. Un `useState` no sirve: dos pulsaciones seguidas
  // caen en el mismo render y las dos verían el estado anterior.
  const enVueloRef = useRef(false);
  const alertaRef = useRef<HTMLParagraphElement | null>(null);

  const enApertura = state.step === 'granted' || state.step === 'opening';
  const enVerificacion =
    state.step === 'verification' ||
    state.step === 'verifying' ||
    state.step === 'resending';
  const bloqueado = isLocked(state, ahora);
  const segundosBloqueo = secondsUntil(state.lockedUntil, ahora);

  // El panel decorativo NO se monta por debajo de 1024 px. Ocultarlo con CSS
  // seguiría creando sus nodos y sus temporizadores en un móvil, para nada.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const consulta = window.matchMedia('(min-width: 1024px)');
    // Lectura solo de cliente: tiene que ocurrir tras el montaje para no
    // provocar una discrepancia de hidratación.
    const aplicar = () => setAnchoAmplio(consulta.matches);
    aplicar();
    consulta.addEventListener?.('change', aplicar);
    return () => consulta.removeEventListener?.('change', aplicar);
  }, []);

  // Reloj de la pantalla: solo corre mientras hay un bloqueo que contar.
  useEffect(() => {
    if (!state.lockedUntil) return;
    const intervalo = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(intervalo);
  }, [state.lockedUntil]);

  // Ya hay sesión de antes (bootstrap u otra pestaña): al tablero, sin enseñar
  // el formulario. El paso `granted`/`opening` distingue ese caso del login que
  // acaba de ocurrir aquí, que sí tiene su propia pantalla de apertura.
  useEffect(() => {
    if (status === 'authenticated' && !enApertura) {
      router.replace('/dashboard');
    }
  }, [status, enApertura, router]);

  // Avisos que llegan por query (`?reset=1`, `?created=1`); luego se limpia la
  // query para que un refresco no los repita.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === '1') {
      // Lectura de `window`: solo después del montaje.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResetNotice(
        'Contraseña actualizada correctamente. Ya puedes iniciar sesión.',
      );
      window.history.replaceState(null, '', '/login');
    } else if (params.get('created') === '1') {
      setResetNotice(
        'Tu empresa se creó correctamente. Inicia sesión con el correo del administrador.',
      );
      window.history.replaceState(null, '', '/login');
    }
  }, []);

  // El error del formulario de credenciales recibe el foco: es la única forma
  // de que quien navega con teclado sepa que el envío falló sin ir a buscarlo.
  useEffect(() => {
    if (state.error && state.step === 'credentials') {
      alertaRef.current?.focus();
    }
  }, [state.error, state.errorSeq, state.step]);

  function detectarMayusculas(evento: React.KeyboardEvent<HTMLInputElement>) {
    const activo = evento.getModifierState?.('CapsLock');
    if (typeof activo === 'boolean') setMayusculas(activo);
  }

  async function manejarEnvio(evento: React.FormEvent) {
    evento.preventDefault();
    if (enVueloRef.current || bloqueado) return;
    enVueloRef.current = true;
    dispatch({ type: 'submit' });

    try {
      const resultado = await login(email, password);
      if (resultado.status === 'verification_required') {
        dispatch({ type: 'challenge', challenge: challengeFromResult(resultado) });
      } else {
        // El paso cambia ANTES de guardar la sesión: si las dos
        // actualizaciones no se agruparan, un render intermedio con
        // `status: authenticated` y el paso viejo dispararía la redirección
        // automática y se saltaría la pantalla de apertura.
        dispatch({ type: 'granted' });
        setSession(resultado.user, resultado.token);
      }
    } catch (error) {
      // Mensaje idéntico exista o no la cuenta: distinguirlos convertiría el
      // login en un comprobador de correos.
      if (esDemasiadosIntentos(error)) {
        dispatch({
          type: 'locked',
          message: mensajeDeError(error, MENSAJE_BLOQUEO),
          until: bloqueoHasta(error),
        });
        setAhora(Date.now());
      } else {
        dispatch({
          type: 'error',
          message: mensajeDeError(error, MENSAJE_CREDENCIALES),
        });
      }
    } finally {
      enVueloRef.current = false;
    }
  }

  const manejarVerificacion = useCallback(
    async (codigo: string, confiar: boolean) => {
      const reto = state.challenge;
      if (!reto || enVueloRef.current) return;
      enVueloRef.current = true;
      dispatch({ type: 'verify' });

      try {
        const resultado = await verifyDevice({
          challengeId: reto.challengeId,
          code: codigo,
          trustDevice: confiar,
        });
        // El paso cambia ANTES de guardar la sesión: si las dos
        // actualizaciones no se agruparan, un render intermedio con
        // `status: authenticated` y el paso viejo dispararía la redirección
        // automática y se saltaría la pantalla de apertura.
        dispatch({ type: 'granted' });
        setSession(resultado.user, resultado.token);
      } catch (error) {
        if (esDemasiadosIntentos(error)) {
          dispatch({
            type: 'locked',
            message: mensajeDeError(error, MENSAJE_BLOQUEO),
            until: bloqueoHasta(error),
          });
          setAhora(Date.now());
        } else {
          dispatch({
            type: 'error',
            message: mensajeDeError(error, MENSAJE_CODIGO),
          });
        }
      } finally {
        enVueloRef.current = false;
      }
    },
    [setSession, state.challenge],
  );

  const manejarReenvio = useCallback(async () => {
    const reto = state.challenge;
    if (!reto || enVueloRef.current) return;
    enVueloRef.current = true;
    dispatch({ type: 'resend' });

    try {
      const resultado = await resendDeviceVerification(reto.challengeId);
      dispatch({
        type: 'resent',
        challenge: challengeFromResult(resultado),
        notice: 'Te enviamos otro código.',
      });
    } catch (error) {
      dispatch({
        type: 'error',
        message: mensajeDeError(
          error,
          'No pudimos enviar otro código. Inténtalo en un momento.',
        ),
      });
    } finally {
      enVueloRef.current = false;
    }
  }, [state.challenge]);

  const volverACredenciales = useCallback(() => dispatch({ type: 'back' }), []);

  const cancelarApertura = useCallback(() => {
    // `WorkspaceOpening` ya limpió la sesión; aquí solo se vuelve al formulario.
    dispatch({ type: 'reset' });
  }, []);

  // El servidor no respondió durante el arranque (429 / red / 5xx): pantalla de
  // reintento, no un formulario que insinúe que la sesión caducó.
  if (status === 'unavailable') {
    return <ConnectionUnavailable />;
  }

  if (status !== 'anonymous' && !enApertura) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-subtle">
        <p className="text-sm text-neutral-500">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-surface-default">
      {anchoAmplio && (
        <>
          <LoginShowcase />
          {/* La leyenda del panel decorativo, fuera de su subárbol
              `aria-hidden`: lo que ve la vista tiene que oírse también. */}
          <p className="sr-only">{LEYENDA_ILUSTRATIVA}</p>
        </>
      )}

      <div className="flex min-w-0 flex-1 justify-center bg-surface-subtle px-5 py-10 sm:px-8 lg:w-[44%] lg:items-center">
        <div className="w-full max-w-sm">
          {!anchoAmplio && (
            <div className="mb-8">
              <TaktoLogo height={28} />
              <p className="mt-2 text-sm text-content-secondary">
                CRM conversacional para vender por WhatsApp
              </p>
            </div>
          )}

          {enApertura ? (
            usuario ? (
            <WorkspaceOpening
              user={usuario}
              onOpening={() => dispatch({ type: 'opening' })}
              onCancel={cancelarApertura}
            />
            ) : (
              <p className="text-sm text-content-secondary">Abriendo tu sesión...</p>
            )
          ) : enVerificacion && state.challenge ? (
            <DeviceVerificationForm
              challenge={state.challenge}
              step={state.step as 'verification' | 'verifying' | 'resending'}
              error={state.error}
              errorSeq={state.errorSeq}
              notice={state.notice}
              onVerify={manejarVerificacion}
              onResend={manejarReenvio}
              onBack={volverACredenciales}
            />
          ) : (
            <>
              <h1 className="font-brand text-2xl font-extrabold text-content-primary">
                Inicia sesión
              </h1>
              <p className="mt-2 text-sm text-content-secondary">
                Entra con tu correo y tu contraseña.
              </p>

              {resetNotice && (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-5 rounded-md border border-status-success/20 bg-status-success-surface px-3 py-2 text-sm text-status-success-strong"
                >
                  {resetNotice}
                </p>
              )}

              <form onSubmit={manejarEnvio} className="mt-6">
                <Field label="Correo" required className="mb-4">
                  <Input
                    type="email"
                    inputMode="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                    className="h-11"
                  />
                </Field>

                <Field label="Contraseña" required className="mb-2">
                  <div className="relative">
                    <Input
                      type={verPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={detectarMayusculas}
                      onKeyUp={detectarMayusculas}
                      placeholder="••••••••"
                      className="h-11 pr-12"
                    />
                    <button
                      type="button"
                      aria-pressed={verPassword}
                      aria-label={
                        verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                      }
                      onClick={() => setVerPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-content-secondary outline-none transition-colors hover:text-content-primary focus-visible:ring-2 focus-visible:ring-line-focus"
                    >
                      {verPassword ? (
                        <EyeOff aria-hidden="true" className="h-4 w-4" />
                      ) : (
                        <Eye aria-hidden="true" className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </Field>

                {mayusculas && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="mb-2 text-xs font-medium text-status-warning-strong"
                  >
                    Bloq Mayús está activado.
                  </p>
                )}

                <div className="mb-4 text-right">
                  <Link
                    href="/forgot-password"
                    className="inline-flex min-h-11 items-center rounded px-1 text-sm text-content-secondary outline-none transition-colors hover:text-content-primary focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
                  >
                    ¿Olvidaste tu contraseña?
                  </Link>
                </div>

                {state.error && (
                  <p
                    ref={alertaRef}
                    tabIndex={-1}
                    role="alert"
                    aria-live="assertive"
                    className="mb-4 rounded-md bg-status-error-surface px-3 py-2 text-sm text-status-error outline-none"
                  >
                    {state.error}
                  </p>
                )}

                {bloqueado && (
                  <p role="status" className="mb-4 text-xs text-content-secondary">
                    Puedes volver a intentarlo en {segundosBloqueo}s
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={state.step === 'submitting' || bloqueado}
                  className="w-full py-3"
                >
                  {state.step === 'submitting' ? 'Entrando...' : 'Continuar'}
                </Button>
              </form>
            </>
          )}

          {/* Solo afirmaciones ciertas: la conexión va cifrada por TLS, el token
              vive en memoria y el backend aplica los permisos del rol. Nada de
              «cifrado de extremo a extremo» ni de «dispositivo autorizado». */}
          <div className="mt-8 space-y-1 border-t border-line-default pt-5 text-xs text-content-secondary">
            <p>Conexión segura y sesión protegida.</p>
            <p>Cada usuario accede únicamente con sus permisos asignados.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
