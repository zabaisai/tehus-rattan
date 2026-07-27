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
  | 'INCOMPLETE_SESSION';

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

// Launches Embedded Signup and resolves with the code + session info, or
// rejects with a typed EmbeddedSignupError (cancelled / no code / incomplete).
// The `state` is our own single-use anti-CSRF value; it is not consumed here —
// the browser simply forwards it to the backend `complete` call.
export async function launchEmbeddedSignup(
  fb: FbInstance,
  configId: string,
): Promise<EmbeddedSignupResult> {
  const session: { phoneNumberId?: string; wabaId?: string; businessId?: string; cancelled?: boolean } = {};

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') {
      return;
    }
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (data.event === 'FINISH') {
        session.phoneNumberId = data.data?.phone_number_id;
        session.wabaId = data.data?.waba_id;
        session.businessId = data.data?.business_id;
      } else if (data.event === 'CANCEL') {
        session.cancelled = true;
      }
    } catch {
      // Ignore malformed / unrelated messages.
    }
  };

  window.addEventListener('message', onMessage);
  try {
    const loginResponse = await new Promise<FbLoginResponse>((resolve) => {
      fb.login(resolve, {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} },
      });
    });

    const code: string | undefined = loginResponse?.authResponse?.code;
    if (session.cancelled || !code) {
      throw new EmbeddedSignupError(code ? 'CANCELLED' : 'NO_CODE');
    }
    if (!session.phoneNumberId || !session.wabaId) {
      throw new EmbeddedSignupError('INCOMPLETE_SESSION');
    }
    return {
      code,
      phoneNumberId: session.phoneNumberId,
      wabaId: session.wabaId,
      businessId: session.businessId,
    };
  } finally {
    window.removeEventListener('message', onMessage);
  }
}
