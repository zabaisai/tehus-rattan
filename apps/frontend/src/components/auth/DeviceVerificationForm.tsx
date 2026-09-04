'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  formatCountdown,
  secondsUntil,
  type DeviceChallenge,
  type LoginStep,
} from '@/lib/login-machine';

const LONGITUD = 6;
const VACIO = Array.from({ length: LONGITUD }, () => '');

export interface PropsVerificacion {
  challenge: DeviceChallenge;
  step: Extract<LoginStep, 'verification' | 'verifying' | 'resending'>;
  error: string;
  /** Cambia con cada error, aunque el texto se repita: dispara el vaciado. */
  errorSeq: number;
  notice: string;
  onVerify: (code: string, trustDevice: boolean) => void;
  onResend: () => void;
  onBack: () => void;
}

/**
 * Segundo factor por correo: seis dígitos, una cuenta atrás y un reenvío.
 *
 * Son seis campos y no uno solo porque es lo que la gente espera de un código
 * de un solo uso y lo que hace que el autorrelleno del sistema (`one-time-code`)
 * funcione. El precio es que hay que reponer a mano lo que un `<input>` normal
 * da gratis —avanzar, retroceder, pegar—, y eso es justo lo que vive aquí.
 *
 * La cuenta atrás usa UN intervalo, no uno por contador: el vencimiento y el
 * reenvío se pintan con el mismo instante, así que nunca se ven desfasados.
 */
export function DeviceVerificationForm({
  challenge,
  step,
  error,
  errorSeq,
  notice,
  onVerify,
  onResend,
  onBack,
}: PropsVerificacion) {
  const [digitos, setDigitos] = useState<string[]>(VACIO);
  const [confiar, setConfiar] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  const referencias = useRef<Array<HTMLInputElement | null>>([]);

  const enVuelo = step === 'verifying' || step === 'resending';

  // Un solo intervalo para toda la pantalla, parado al desmontar.
  useEffect(() => {
    const intervalo = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(intervalo);
  }, []);

  // El foco entra en el primer dígito al aparecer el paso. Es la única vez que
  // esta pantalla roba el foco, y lo hace porque el campo es el motivo de que
  // la pantalla exista.
  useEffect(() => {
    referencias.current[0]?.focus();
  }, []);

  // Un código rechazado deja los seis campos escritos: si no se vacían, el
  // siguiente intento empieza corrigiendo dígitos en vez de escribiéndolos.
  useEffect(() => {
    if (!error) return;
    // El vaciado es la reacción a un suceso externo (la respuesta del
    // servidor), no un estado derivable del render: la única señal que llega
    // hasta aquí es el par error/errorSeq, y sin este efecto no hay dónde
    // engancharlo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDigitos(VACIO);
    referencias.current[0]?.focus();
  }, [error, errorSeq]);

  const segundosParaVencer = secondsUntil(challenge.expiresAt, ahora);
  const segundosParaReenviar = secondsUntil(challenge.resendAvailableAt, ahora);
  const vencido = segundosParaVencer <= 0;
  const codigo = digitos.join('');
  const completo = codigo.length === LONGITUD && /^\d{6}$/.test(codigo);

  const enviar = useCallback(
    (valor: string) => {
      if (vencido || enVuelo) return;
      onVerify(valor, confiar);
    },
    [confiar, enVuelo, onVerify, vencido],
  );

  function escribir(indice: number, bruto: string) {
    const digito = bruto.replace(/\D/g, '').slice(-1);
    setDigitos((actuales) => {
      const siguientes = [...actuales];
      siguientes[indice] = digito;
      return siguientes;
    });
    if (digito && indice < LONGITUD - 1) {
      referencias.current[indice + 1]?.focus();
    }
  }

  function teclear(indice: number, evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'Backspace' && !digitos[indice] && indice > 0) {
      evento.preventDefault();
      referencias.current[indice - 1]?.focus();
      setDigitos((actuales) => {
        const siguientes = [...actuales];
        siguientes[indice - 1] = '';
        return siguientes;
      });
      return;
    }
    if (evento.key === 'ArrowLeft' && indice > 0) {
      evento.preventDefault();
      referencias.current[indice - 1]?.focus();
      return;
    }
    if (evento.key === 'ArrowRight' && indice < LONGITUD - 1) {
      evento.preventDefault();
      referencias.current[indice + 1]?.focus();
    }
  }

  // Pegar el código entero en CUALQUIERA de los seis campos lo reparte y envía.
  // Quien copia un código del correo lo pega donde tenga el cursor, no siempre
  // en el primero.
  function pegar(evento: React.ClipboardEvent<HTMLInputElement>) {
    const texto = (evento.clipboardData?.getData('text') ?? '').replace(/\D/g, '');
    if (texto.length < LONGITUD) return;
    evento.preventDefault();
    const repartido = texto.slice(0, LONGITUD).split('');
    setDigitos(repartido);
    referencias.current[LONGITUD - 1]?.focus();
    enviar(repartido.join(''));
  }

  function manejarEnvio(evento: React.FormEvent) {
    evento.preventDefault();
    if (!completo) return;
    enviar(codigo);
  }

  const idGrupo = 'verificacion-grupo';
  const idError = 'verificacion-error';

  return (
    <div className="w-full">
      <h1 className="font-brand text-2xl font-extrabold text-content-primary">
        Verifica este dispositivo
      </h1>
      <p className="mt-2 text-sm text-content-secondary">
        Enviamos un código de 6 dígitos a {challenge.maskedEmail}.
      </p>

      <form onSubmit={manejarEnvio} className="mt-6">
        <p id={idGrupo} className="mb-2 text-sm font-medium text-neutral-700">
          Código de verificación
        </p>
        <div
          role="group"
          aria-labelledby={idGrupo}
          aria-describedby={error ? idError : undefined}
          className="flex gap-2"
        >
          {digitos.map((digito, indice) => (
            <input
              key={indice}
              ref={(elemento) => {
                referencias.current[indice] = elemento;
              }}
              value={digito}
              onChange={(evento) => escribir(indice, evento.target.value)}
              onKeyDown={(evento) => teclear(indice, evento)}
              onPaste={pegar}
              onFocus={(evento) => evento.target.select()}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              // Solo en el PRIMERO: repetirlo en los seis hace que el navegador
              // ofrezca el código entero en cada casilla y lo pegue seis veces.
              autoComplete={indice === 0 ? 'one-time-code' : 'off'}
              aria-label={`Dígito ${indice + 1} de 6`}
              aria-invalid={error ? true : undefined}
              disabled={enVuelo}
              className="h-12 w-full min-w-0 rounded-md border border-neutral-300 bg-white text-center font-mono text-lg text-content-primary outline-none transition-colors focus:border-line-focus focus:ring-1 focus:ring-line-focus disabled:bg-neutral-50 sm:h-14"
            />
          ))}
        </div>

        <p className="mt-3 text-xs text-content-secondary" role="status" aria-live="polite">
          {vencido
            ? 'El código venció. Pide uno nuevo.'
            : `El código vence en ${formatCountdown(segundosParaVencer)}`}
        </p>

        {challenge.attemptsRemaining <= 2 && (
          <p role="status" className="mt-1 text-xs font-medium text-status-warning-strong">
            Te quedan {challenge.attemptsRemaining} intentos.
          </p>
        )}

        {notice && (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 rounded-md border border-status-success/20 bg-status-success-surface px-3 py-2 text-sm text-status-success-strong"
          >
            {notice}
          </p>
        )}

        {error && (
          <p
            id={idError}
            role="alert"
            aria-live="assertive"
            className="mt-3 text-sm text-status-error"
          >
            {error}
          </p>
        )}

        <label className="mt-5 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={confiar}
            onChange={(evento) => setConfiar(evento.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 accent-brand-primary outline-none focus-visible:ring-2 focus-visible:ring-line-focus focus-visible:ring-offset-1"
          />
          <span className="min-w-0 text-sm text-content-primary">
            Confiar en este dispositivo privado durante 30 días
            <span className="mt-0.5 block text-xs text-content-secondary">
              No lo actives en equipos compartidos o públicos.
            </span>
          </span>
        </label>

        <Button
          type="submit"
          disabled={enVuelo || vencido || !completo}
          className="mt-5 w-full py-3"
        >
          {step === 'verifying' ? 'Verificando...' : 'Verificar'}
        </Button>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          {/* `h-11`: 44 px de alto también en móvil, como el resto de
              controles de la pantalla. */}
          <Button
            variant="quiet"
            size="sm"
            onClick={onBack}
            disabled={enVuelo}
            className="h-11 px-4"
          >
            Volver
          </Button>
          <div className="flex min-w-0 flex-col items-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={onResend}
              disabled={enVuelo || segundosParaReenviar > 0}
              className="h-11 px-4"
            >
              {step === 'resending' ? 'Enviando...' : 'Enviar otro código'}
            </Button>
            {segundosParaReenviar > 0 && (
              <span className="mt-1 text-xs text-content-secondary">
                Puedes pedir otro en {segundosParaReenviar}s
              </span>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
