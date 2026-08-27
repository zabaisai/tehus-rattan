'use client';

import { useEffect, useRef } from 'react';
import {
  getTurnstileSiteKey,
  loadTurnstileScript,
} from '@/lib/turnstile';

interface TurnstileWidgetProps {
  // Se llama con el token cuando el reto se supera.
  onVerify: (token: string) => void;
  // El token caducó o falló: el consumidor debe limpiarlo (fail-closed en UI).
  onExpire?: () => void;
  onError?: () => void;
}

/**
 * Widget de Cloudflare Turnstile para el login.
 *
 * Solo se monta si hay site key pública (NEXT_PUBLIC_TURNSTILE_SITE_KEY). El
 * token se entrega al formulario, que lo manda al backend para verificación
 * server-side. Al caducar o fallar, se avisa para limpiar el token y volver a
 * exigir el reto (nunca se reutiliza).
 *
 * Accesibilidad: contenedor con `role="group"` y etiqueta; el widget de
 * Cloudflare es accesible por sí mismo, y aquí se le da nombre.
 */
export function TurnstileWidget({
  onVerify,
  onExpire,
  onError,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const siteKey = getTurnstileSiteKey();

  useEffect(() => {
    if (!siteKey) return;
    let cancelado = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelado || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: 'login',
          callback: (token: string) => onVerify(token),
          'expired-callback': () => onExpire?.(),
          'error-callback': () => onError?.(),
        });
      })
      .catch(() => onError?.());

    return () => {
      cancelado = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // El widget puede haberse retirado ya; ignorar.
        }
        widgetIdRef.current = null;
      }
    };
    // Solo depende de la site key; los callbacks se leen por referencia estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  if (!siteKey) return null;

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Verificación de seguridad antibot"
      data-testid="turnstile-widget"
    />
  );
}
