// Loads Meta's official Facebook JS SDK and drives WhatsApp Embedded Signup.
// The browser receives only a short-lived exchangeable code plus the selected
// WhatsApp asset ids. The code-to-token exchange always happens server-side.
//
// Coexistence is requested explicitly for businesses that want to keep using
// their existing WhatsApp Business app number while also using TAKTO.
export type EmbeddedSignupErrorCode =
  | 'SDK_LOAD_FAILED'
  | 'CANCELLED'
  | 'NO_CODE'
  | 'INCOMPLETE_SESSION'
  | 'META_ERROR';

export class EmbeddedSignupError extends Error {
  constructor(readonly code: EmbeddedSignupErrorCode) {
    super(code);
    this.name = 'EmbeddedSignupError';
  }
}

export type EmbeddedSignupMode = 'COEXISTENCE' | 'STANDARD';

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
const SESSION_CALLBACK_TIMEOUT_MS = 15_000;
let sdkPromise: Promise<FbInstance> | null = null;

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
    }, 15_000);

    window.fbAsyncInit = () => {
      window.clearTimeout(timeout);
      if (!window.FB) {
        sdkPromise = null;
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

interface SessionInfo {
  phoneNumberId: string;
  wabaId: string;
  businessId?: string;
}

// Meta returns the authorization code through FB.login and the WhatsApp asset
// ids through a window message. Their order is not guaranteed, so wait for both
// independently instead of assuming the message arrived before the callback.
export async function launchEmbeddedSignup(
  fb: FbInstance,
  configId: string,
  mode: EmbeddedSignupMode = 'COEXISTENCE',
): Promise<EmbeddedSignupResult> {
  let resolveSession!: (value: SessionInfo) => void;
  let rejectSession!: (reason: EmbeddedSignupError) => void;
  const sessionPromise = new Promise<SessionInfo>((resolve, reject) => {
    resolveSession = resolve;
    rejectSession = reject;
  });

  const onMessage = (event: MessageEvent) => {
    if (
      event.origin !== 'https://www.facebook.com' &&
      event.origin !== 'https://web.facebook.com'
    ) {
      return;
    }
    try {
      const data =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;

      if (data.event === 'FINISH') {
        const phoneNumberId = data.data?.phone_number_id;
        const wabaId = data.data?.waba_id;
        if (!phoneNumberId || !wabaId) {
          rejectSession(new EmbeddedSignupError('INCOMPLETE_SESSION'));
          return;
        }
        resolveSession({
          phoneNumberId,
          wabaId,
          businessId: data.data?.business_id,
        });
      } else if (data.event === 'CANCEL') {
        rejectSession(new EmbeddedSignupError('CANCELLED'));
      } else if (data.event === 'ERROR') {
        rejectSession(new EmbeddedSignupError('META_ERROR'));
      }
    } catch {
      // Ignore malformed or unrelated browser messages.
    }
  };

  window.addEventListener('message', onMessage);
  try {
    const extras: Record<string, unknown> = {
      setup: {},
      // Meta requires a session-info version for the WhatsApp callback.
      sessionInfoVersion: '3',
    };
    if (mode === 'COEXISTENCE') {
      extras.featureType = 'whatsapp_business_app_onboarding';
    }

    const loginResponse = await new Promise<FbLoginResponse>((resolve) => {
      fb.login(resolve, {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras,
      });
    });

    const code = loginResponse?.authResponse?.code;
    if (!code) {
      throw new EmbeddedSignupError('NO_CODE');
    }

    let timeoutId: number | undefined;
    const sessionTimeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new EmbeddedSignupError('INCOMPLETE_SESSION')),
        SESSION_CALLBACK_TIMEOUT_MS,
      );
    });

    const session = await Promise.race([sessionPromise, sessionTimeout]).finally(
      () => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      },
    );

    return { code, ...session };
  } finally {
    window.removeEventListener('message', onMessage);
  }
}
