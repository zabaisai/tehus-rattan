import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GRAPH_API_VERSION_FORMAT } from '../../common/config/env.validation';

const META_TIMEOUT_MS = 10_000;
const GRAPH_BASE = 'https://graph.facebook.com';

// A redacted, non-secret error classifier. Callers surface a generic message to
// the user and log ONLY the classifier — never the Meta response body, which
// could echo the code/token.
export type MetaSignupErrorCode =
  | 'CONFIG_MISSING'
  | 'CODE_EXCHANGE_FAILED'
  | 'WABA_LOOKUP_FAILED'
  | 'PHONE_NOT_IN_WABA'
  | 'SUBSCRIBE_FAILED'
  | 'REGISTER_FAILED'
  | 'SEND_FAILED'
  | 'META_TIMEOUT';

export class MetaSignupError extends Error {
  constructor(readonly classifier: MetaSignupErrorCode) {
    super(classifier);
    this.name = 'MetaSignupError';
  }
}

export interface MetaPhoneNumber {
  id: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  // Meta reports 'CLOUD_API' for numbers fully on Cloud API and a coexistence
  // marker for numbers still running in the WhatsApp Business app.
  platformType?: string;
}

// Thin, injectable wrapper over the Meta Graph API used by the Embedded Signup
// flow. All calls are server-side only, time-bounded, and never log secrets.
// In tests this whole service is mocked — no real Meta calls are ever made.
@Injectable()
export class WhatsAppMetaClientService {
  private readonly logger = new Logger(WhatsAppMetaClientService.name);

  constructor(private configService: ConfigService) {}

  appId(): string {
    return this.requireConfig('WHATSAPP_APP_ID');
  }

  configId(): string {
    return this.requireConfig('WHATSAPP_CONFIG_ID');
  }

  graphVersion(): string {
    const raw = this.configService.get<string>('WHATSAPP_GRAPH_API_VERSION');
    const version = raw?.trim();
    if (!version || !GRAPH_API_VERSION_FORMAT.test(version)) {
      throw new MetaSignupError('CONFIG_MISSING');
    }
    return version;
  }

  // Exchange the 30-second Embedded Signup code for a customer-scoped business
  // access token. GET /oauth/access_token with the app's client_id/secret.
  async exchangeCode(code: string): Promise<string> {
    const appId = this.appId();
    const appSecret = this.requireConfig('WHATSAPP_APP_SECRET');
    const url = `${GRAPH_BASE}/${this.graphVersion()}/oauth/access_token`;

    try {
      const res = await axios.get(url, {
        params: { client_id: appId, client_secret: appSecret, code },
        timeout: META_TIMEOUT_MS,
      });
      const token: unknown = res.data?.access_token;
      if (typeof token !== 'string' || !token) {
        throw new MetaSignupError('CODE_EXCHANGE_FAILED');
      }
      return token;
    } catch (error) {
      throw this.normalize(error, 'CODE_EXCHANGE_FAILED');
    }
  }

  // List the phone numbers of a WABA to confirm the phoneNumberId really
  // belongs to the authorized WABA and to read display name / platform type.
  async listPhoneNumbers(
    wabaId: string,
    token: string,
  ): Promise<MetaPhoneNumber[]> {
    const url = `${GRAPH_BASE}/${this.graphVersion()}/${wabaId}/phone_numbers`;
    try {
      const res = await axios.get(url, {
        params: {
          fields: 'id,display_phone_number,verified_name,platform_type',
        },
        headers: { Authorization: `Bearer ${token}` },
        timeout: META_TIMEOUT_MS,
      });
      const data: unknown = res.data?.data;
      if (!Array.isArray(data)) return [];
      return data.map((n: any) => ({
        id: String(n?.id ?? ''),
        displayPhoneNumber: n?.display_phone_number || undefined,
        verifiedName: n?.verified_name || undefined,
        platformType: n?.platform_type || undefined,
      }));
    } catch (error) {
      throw this.normalize(error, 'WABA_LOOKUP_FAILED');
    }
  }

  // Subscribe the app to the customer's WABA so inbound webhooks are delivered.
  // Idempotent on Meta's side: repeating it is a no-op.
  async subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
    const url = `${GRAPH_BASE}/${this.graphVersion()}/${wabaId}/subscribed_apps`;
    try {
      await axios.post(url, undefined, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: META_TIMEOUT_MS,
      });
    } catch (error) {
      throw this.normalize(error, 'SUBSCRIBE_FAILED');
    }
  }

  // Register a phone number for Cloud API use. Only for NEW / migrated numbers,
  // NEVER for coexistence numbers (registering would take the number out of the
  // WhatsApp Business app). Requires the customer's 2-step-verification PIN.
  async registerPhoneNumber(
    phoneNumberId: string,
    token: string,
    pin: string,
  ): Promise<void> {
    const url = `${GRAPH_BASE}/${this.graphVersion()}/${phoneNumberId}/register`;
    try {
      await axios.post(
        url,
        { messaging_product: 'whatsapp', pin },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: META_TIMEOUT_MS,
        },
      );
    } catch (error) {
      throw this.normalize(error, 'REGISTER_FAILED');
    }
  }

  // Sends a plain text message via the Cloud API. Used by the explicit
  // connection-test endpoint; a closed conversation window / missing template
  // surfaces as a generic SEND_FAILED (never the raw Meta body).
  async sendText(
    phoneNumberId: string,
    token: string,
    to: string,
    body: string,
  ): Promise<void> {
    const url = `${GRAPH_BASE}/${this.graphVersion()}/${phoneNumberId}/messages`;
    try {
      await axios.post(
        url,
        { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: META_TIMEOUT_MS,
        },
      );
    } catch (error) {
      throw this.normalize(error, 'SEND_FAILED');
    }
  }

  private requireConfig(name: string): string {
    const value = this.configService.get<string>(name)?.trim();
    if (!value) throw new MetaSignupError('CONFIG_MISSING');
    return value;
  }

  // Convert any thrown error into a redacted MetaSignupError. Logs ONLY the
  // classifier + HTTP status — never the response body (which can echo the
  // code/token).
  private normalize(
    error: unknown,
    fallback: MetaSignupErrorCode,
  ): MetaSignupError {
    if (error instanceof MetaSignupError) return error;
    let code: MetaSignupErrorCode = fallback;
    let status: number | undefined;
    if (axios.isAxiosError(error)) {
      status = error.response?.status;
      if (error.code === 'ECONNABORTED') code = 'META_TIMEOUT';
    }
    this.logger.warn(
      `Meta Embedded Signup call failed [${code}] status=${status ?? 'n/a'}`,
    );
    return new MetaSignupError(code);
  }
}
