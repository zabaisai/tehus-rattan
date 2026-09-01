// Loads Meta's official Facebook JS SDK and drives the WhatsApp Embedded Signup
// flow. The SDK returns a 30-second exchangeable `code` (never a token) plus,
// via a window `message` event, the phone_number_id / waba_id / business_id.
// Everything sensitive (code -> token exchange) happens server-side.
//
// Requires the app's CSP to allow https://connect.facebook.net (script) and
// www/web/staticxx.facebook.com (frame — staticxx is the SDK's xd_arbiter
// relay that returns the FB.login code) — see docs/WHATSAPP_EMBEDDED_SIGNUP.md.

export type EmbeddedSignupErrorCode =
  | 'SDK_LOAD_FAILED'
  | 'CANCELLED'
  | 'NO_CODE'
  | 'INCOMPLETE_SESSION'
  | 'META_ERROR'
  | 'TIMEOUT';

// COEXISTENCE connects the number the business already uses in the WhatsApp
// Business app (and keeps it working there); STANDARD onboards a new number
// straight onto Cloud API. Meta's eligibility rules apply in both cases — the
// mode only selects which official flow the popup drives.
export type EmbeddedSignupMode = 'COEXISTENCE' | 'STANDARD';

export class EmbeddedSignupError extends Error {
  constructor(readonly code: EmbeddedSignupErrorCode) {
    super(code);
    this.name = 'EmbeddedSignupError';
  }
}

export interface EmbeddedSignupResult {
  code: string;
  phoneNumberId: string;
  wabaId: string;
  businessId?: string;
}

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface FbInstance {
  init(opts: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }): void;
  login(cb: (resp: FbLoginResponse) => void, opts: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FbInstance;
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
let sdkPromise: Promise<FbInstance> | null = null;

// Loads + initializes the SDK once (idempotent). Rejects with SDK_LOAD_FAILED
// if the script cannot load (e.g. blocked by CSP / network).
export function loadFacebookSdk(
  appId: string,
  graphVersion: string,
): Promise<FbInstance> {
  if (typeof window === 'undefined') {
    return Promise.reject(new EmbeddedSignupError('SDK_LOAD_FAILED'));
  }
  if (window.FB) {
    window.FB.init({ appId, cookie: true, xfbml: false, version: graphVersion });
    return Promise.resolve(window.FB);
  }
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<FbInstance>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      sdkPromise = null;
      reject(new EmbeddedSignupError('SDK_LOAD_FAILED'));
    }, 15000);

    window.fbAsyncInit = () => {
      window.clearTimeout(timeout);
      if (!window.FB) {
        reject(new EmbeddedSignupError('SDK_LOAD_FAILED'));
        return;
      }
      window.FB.init({ appId, cookie: true, xfbml: false, version: graphVersion });
      resolve(window.FB);
    };

    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      window.clearTimeout(timeout);
      sdkPromise = null;
      reject(new EmbeddedSignupError('SDK_LOAD_FAILED'));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

// The signup happens inside a Meta popup the user drives by hand (portfolio,
// WABA, number, confirmation: 1-3 minutes is normal); the overall deadline
// only fences a flow that was abandoned (window closed with no events, popup
// that never answers).
const DEFAULT_SIGNUP_TIMEOUT_MS = 300_000;
// The OAuth `code` (FB.login callback) and the session info (postMessage) race
// each other and can arrive in either order. Once there is affirmative
// evidence the popup flow ENDED (a code was granted, or a FINISH message
// arrived after a code-less callback), the still-missing half gets this
// bounded grace period before the flow is declared failed.
//
// CAUTION: an FB.login callback with a null authResponse is NOT such
// evidence. Observed in staging (coexistence): the SDK fires the callback
// with status 'unknown' seconds after the popup opens — the xd_arbiter
// handshake resolves before the user has finished (or even started) the
// flow — while the popup is still open on Meta's screens. That premature
// callback must never start a failure countdown.
const DEFAULT_SIGNUP_GRACE_MS = 60_000;

// With sessionInfoVersion 3, coexistence flows report variants such as
// FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING or FINISH_ONLY_WABA. All of them
// carry the session payload; the field validation below decides completeness.
const isFinishEvent = (event: unknown): boolean =>
  typeof event === 'string' && event.startsWith('FINISH');

const ALLOWED_META_ORIGINS = new Set([
  'https://www.facebook.com',
  'https://web.facebook.com',
]);

// Diagnostic breadcrumbs for the signup return path. Never logs the OAuth
// code, tokens, or Meta identifiers — only presence flags and classifiers.
// The detail is stringified so screenshots/copies of the console show the
// values instead of a collapsed "Object".
const logSignup = (msg: string, detail?: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.info(`[wa-signup] ${msg}`, detail ? JSON.stringify(detail) : '');

// Staging-only diagnosis for "zero WA_EMBEDDED_SIGNUP messages": when enabled
// (build-time env or a localStorage switch togglable without a rebuild), a
// second listener logs origin + type/event CLASSIFIERS of EVERY window message
// received during the flow, to rule out events arriving with an unexpected
// origin or shape. It never logs payload contents (data/code/ids).
export function isSignupDebugEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_WA_SIGNUP_DEBUG === 'true') return true;
  try {
    return window.localStorage.getItem('wa-signup-debug') === '1';
  } catch {
    return false; // storage blocked (private mode / policy)
  }
}

const debugDescribeMessage = (event: MessageEvent) => {
  let type: unknown;
  let flowEvent: unknown;
  let shape: string = typeof event.data;
  try {
    const data =
      typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (data && typeof data === 'object') {
      type = (data as { type?: unknown }).type;
      flowEvent = (data as { event?: unknown }).event;
      shape = typeof event.data === 'string' ? 'json-string' : 'object';
    }
  } catch {
    shape = 'non-json-string';
  }
  logSignup('debug: message recibido', {
    origin: event.origin,
    shape,
    type: typeof type === 'string' ? type : undefined,
    event: typeof flowEvent === 'string' ? flowEvent : undefined,
  });
};

// Launches Embedded Signup (Cloud API or WhatsApp Business App coexistence)
// and resolves with the code + session info, or rejects with a typed
// EmbeddedSignupError (cancelled / no code / incomplete / timeout).
// The `state` is our own single-use anti-CSRF value; it is not consumed here —
// the browser simply forwards it to the backend `complete` call.
//
// Two independent results must BOTH arrive before resolving:
//   - the OAuth `code`, in the FB.login callback;
//   - waba_id / phone_number_id / business_id, via a WA_EMBEDDED_SIGNUP
//     window message.
// Neither one is checked at the moment the other lands, because Meta delivers
// them in no guaranteed order. A bounded grace for the missing half only
// starts once the flow has demonstrably ENDED (code granted, or FINISH after
// a code-less callback); a premature code-less FB.login callback — which the
// SDK fires while the user is still inside the popup — keeps waiting until
// the global timeout. The listener and every timer are cleaned up on ANY
// outcome, so a retry never stacks a second listener.
export function launchEmbeddedSignup(
  fb: FbInstance,
  configId: string,
  mode: EmbeddedSignupMode = 'COEXISTENCE',
  timing: { timeoutMs?: number; graceMs?: number } = {},
): Promise<EmbeddedSignupResult> {
  const timeoutMs = timing.timeoutMs ?? DEFAULT_SIGNUP_TIMEOUT_MS;
  const graceMs = timing.graceMs ?? DEFAULT_SIGNUP_GRACE_MS;

  return new Promise<EmbeddedSignupResult>((resolve, reject) => {
    let loginDone = false;
    let code: string | undefined;
    let session:
      | { phoneNumberId?: string; wabaId?: string; businessId?: string }
      | null = null;
    let cancelled = false;
    let sessionErrored = false;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let overallTimer: ReturnType<typeof setTimeout> | null = null;
    const debugListener = isSignupDebugEnabled() ? debugDescribeMessage : null;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (debugListener) window.removeEventListener('message', debugListener);
      if (overallTimer !== null) clearTimeout(overallTimer);
      if (graceTimer !== null) clearTimeout(graceTimer);
      overallTimer = null;
      graceTimer = null;
    };

    // The error carries ONLY the classifier — never the OAuth code, a token or
    // any Meta identifier — so it is safe to log or show upstream.
    const fail = (errorCode: EmbeddedSignupErrorCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      logSignup('flujo terminado con error', { errorCode });
      reject(new EmbeddedSignupError(errorCode));
    };

    const succeed = (result: EmbeddedSignupResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      logSignup('flujo completo: code y session info recibidos');
      resolve(result);
    };

    // Which half is missing decides the failure classifier. Evaluated only
    // when the grace period expires, never the instant one half arrives.
    const failForMissingHalf = () => {
      if (!code) {
        fail('NO_CODE'); // OAuth finished without granting a code.
      } else {
        fail('INCOMPLETE_SESSION'); // Meta never posted the session info.
      }
    };

    const evaluate = () => {
      if (settled) return;
      if (cancelled) {
        fail('CANCELLED');
        return;
      }
      if (sessionErrored) {
        fail('META_ERROR');
        return;
      }
      if (loginDone && code && session) {
        if (!session.phoneNumberId || !session.wabaId) {
          fail('INCOMPLETE_SESSION');
          return;
        }
        succeed({
          code,
          phoneNumberId: session.phoneNumberId,
          wabaId: session.wabaId,
          businessId: session.businessId,
        });
        return;
      }
      // Grace only starts on affirmative evidence the popup flow ended:
      //   - a code was granted (OAuth completed) but the session info is
      //     still missing, or
      //   - a FINISH session arrived after a code-less callback (the flow
      //     finished on Meta's side; leave bounded room for a late code).
      // A code-less FB.login callback ALONE is not evidence — the SDK fires
      // it prematurely while the user is still inside the popup (see
      // DEFAULT_SIGNUP_GRACE_MS) — so that case keeps waiting for Meta's
      // events until the GLOBAL timeout. Session-only (no callback yet) is
      // also not graced: the user may still be on Meta's final screen.
      const flowEnded = Boolean(code) || (loginDone && session !== null);
      if (flowEnded && graceTimer === null) {
        graceTimer = setTimeout(failForMissingHalf, graceMs);
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (!ALLOWED_META_ORIGINS.has(event.origin)) {
        // A Meta-looking origin outside the allowlist would silently eat the
        // session info — surface it so a regional host is diagnosable.
        if (event.origin.endsWith('.facebook.com')) {
          logSignup('mensaje descartado: origin de Meta no permitido', {
            origin: event.origin,
          });
        }
        return;
      }
      try {
        const data =
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        logSignup('evento WA_EMBEDDED_SIGNUP recibido', {
          origin: event.origin,
          event: data.event,
          hasPhoneNumberId: Boolean(data.data?.phone_number_id),
          hasWabaId: Boolean(data.data?.waba_id),
        });
        if (isFinishEvent(data.event)) {
          session = {
            phoneNumberId: data.data?.phone_number_id,
            wabaId: data.data?.waba_id,
            businessId: data.data?.business_id,
          };
        } else if (data.event === 'CANCEL') {
          cancelled = true;
        } else if (data.event === 'ERROR') {
          // v3 reports in-flow errors explicitly. Only the fact is kept — the
          // payload (error_message, ids) is dropped unread and never logged.
          sessionErrored = true;
        } else {
          return;
        }
        evaluate();
      } catch {
        // Ignore malformed / unrelated messages.
      }
    };

    window.addEventListener('message', onMessage);
    if (debugListener) {
      window.addEventListener('message', debugListener);
      logSignup('debug: listener de diagnóstico de messages activo');
    }
    overallTimer = setTimeout(() => fail('TIMEOUT'), timeoutMs);

    fb.login(
      (response: FbLoginResponse) => {
        loginDone = true;
        // Never let a later empty callback erase a code already granted; the
        // SDK may call back more than once (premature handshake + real one).
        const grantedCode = response?.authResponse?.code || undefined;
        if (grantedCode) code = grantedCode;
        logSignup('callback de FB.login', {
          status: response?.status,
          hasCode: Boolean(grantedCode),
        });
        if (!grantedCode && !session) {
          logSignup(
            'callback sin code y sin session info: posible callback prematuro del SDK; se sigue esperando los eventos de Meta',
          );
        }
        evaluate();
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras:
          mode === 'COEXISTENCE'
            ? {
                setup: {},
                // Official coexistence onboarding: connect the number the
                // customer already uses in the WhatsApp Business app, keeping
                // it working there.
                featureType: 'whatsapp_business_app_onboarding',
                sessionInfoVersion: '3',
              }
            : { setup: {} },
      },
    );
  });
}
