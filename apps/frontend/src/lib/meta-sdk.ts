// Loads Meta's official Facebook JS SDK and drives the WhatsApp Embedded Signup
// flow. The SDK returns a 30-second exchangeable `code` (never a token) plus,
// via a window `message` event, the phone_number_id / waba_id / business_id.
// Everything sensitive (code -> token exchange) happens server-side.
//
// Requires the app's CSP to allow https://connect.facebook.net (script) and
// https://www.facebook.com (frame) — see docs/WHATSAPP_EMBEDDED_SIGNUP.md.

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

// The signup happens inside a Meta popup the user drives by hand; the overall
// deadline only fences a flow that was abandoned (window closed with no
// callback, popup that never answers).
const DEFAULT_SIGNUP_TIMEOUT_MS = 300_000;
// The OAuth `code` (FB.login callback) and the session info (postMessage) race
// each other and can arrive in either order. When only one half has arrived,
// the other gets this bounded grace period before the flow is declared failed.
const DEFAULT_SIGNUP_GRACE_MS = 15_000;

// With sessionInfoVersion 3, coexistence flows report variants such as
// FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING or FINISH_ONLY_WABA. All of them
// carry the session payload; the field validation below decides completeness.
const isFinishEvent = (event: unknown): boolean =>
  typeof event === 'string' && event.startsWith('FINISH');

const ALLOWED_META_ORIGINS = new Set([
  'https://www.facebook.com',
  'https://web.facebook.com',
]);

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
// Neither one is checked at the moment the other lands: whichever half is
// still missing gets a grace period, because Meta delivers them in no
// guaranteed order. The listener and every timer are cleaned up on ANY
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

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
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
      reject(new EmbeddedSignupError(errorCode));
    };

    const succeed = (result: EmbeddedSignupResult) => {
      if (settled) return;
      settled = true;
      cleanup();
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
      // The grace period only starts once FB.login has called back (the popup
      // is closed, so nothing legitimate can still take long): without a code
      // it merely leaves room to classify a late CANCEL before NO_CODE, and
      // with a code it bounds the wait for the session info. Session-only is
      // deliberately NOT graced — the user may still be on Meta's final
      // screen, so the code waits until the GLOBAL timeout.
      if (loginDone && graceTimer === null) {
        graceTimer = setTimeout(failForMissingHalf, graceMs);
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (!ALLOWED_META_ORIGINS.has(event.origin)) return;
      try {
        const data =
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
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
    overallTimer = setTimeout(() => fail('TIMEOUT'), timeoutMs);

    fb.login(
      (response: FbLoginResponse) => {
        loginDone = true;
        code = response?.authResponse?.code || undefined;
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
