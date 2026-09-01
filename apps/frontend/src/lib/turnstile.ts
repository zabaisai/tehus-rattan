// Configuración pública de Cloudflare Turnstile en el frontend.
//
// La site key es PÚBLICA (va en el bundle); el secret vive SOLO en el backend.
// El antibot está activo en el frontend únicamente si esta variable está puesta
// en build. Sin ella, el login funciona igual y el backend decide si exige el
// reto (CAPTCHA_ENABLED). El estado de código puede quedar completo aunque la
// clave real se configure después.
export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js';

export function getTurnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

export function isCaptchaConfigured(): boolean {
  return getTurnstileSiteKey() !== null;
}

// API mínima de Turnstile que usamos (evita un `any` suelto).
export interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      action?: string;
      theme?: 'light' | 'dark' | 'auto';
    },
  ): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

// Carga el script de Turnstile una sola vez. Solo en cliente; en SSR/tests sin
// DOM no hace nada.
export function loadTurnstileScript(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_URL}"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('turnstile')));
      if (window.turnstile) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile-load-failed'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}
