import { describe, expect, it, vi } from 'vitest';
import {
  EmbeddedSignupError,
  launchEmbeddedSignup,
} from './meta-sdk';

const finishMessage = {
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'FINISH',
  data: {
    phone_number_id: '100000000000001',
    waba_id: '200000000000002',
    business_id: '300000000000003',
  },
};

function emitMeta(data: unknown) {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://www.facebook.com',
      data: JSON.stringify(data),
    }),
  );
}

describe('launchEmbeddedSignup', () => {
  it('requests WhatsApp Business app coexistence and tolerates callback ordering', async () => {
    let loginOptions: Record<string, unknown> | undefined;
    const fb = {
      init: vi.fn(),
      login: vi.fn(
        (
          callback: (response: { authResponse: { code: string } }) => void,
          options: Record<string, unknown>,
        ) => {
          loginOptions = options;
          // Meta can publish FINISH before the FB.login callback.
          emitMeta(finishMessage);
          callback({ authResponse: { code: 'exchange-code' } });
        },
      ),
    };

    const result = await launchEmbeddedSignup(
      fb,
      'config-id',
      'COEXISTENCE',
    );

    expect(result).toEqual({
      code: 'exchange-code',
      phoneNumberId: '100000000000001',
      wabaId: '200000000000002',
      businessId: '300000000000003',
    });
    expect(loginOptions).toMatchObject({
      config_id: 'config-id',
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: {},
        sessionInfoVersion: '3',
        featureType: 'whatsapp_business_app_onboarding',
      },
    });
  });

  it('keeps standard onboarding available for a new Cloud API number', async () => {
    let loginOptions:
      | (Record<string, unknown> & {
          extras?: Record<string, unknown>;
        })
      | undefined;
    const fb = {
      init: vi.fn(),
      login: vi.fn(
        (
          callback: (response: { authResponse: { code: string } }) => void,
          options: Record<string, unknown> & {
            extras?: Record<string, unknown>;
          },
        ) => {
          loginOptions = options;
          callback({ authResponse: { code: 'exchange-code' } });
          emitMeta(finishMessage);
        },
      ),
    };

    await launchEmbeddedSignup(fb, 'config-id', 'STANDARD');

    expect(loginOptions?.extras.sessionInfoVersion).toBe('3');
    expect(loginOptions?.extras.featureType).toBeUndefined();
  });

  it('maps an official Meta ERROR event without exposing its payload', async () => {
    const fb = {
      init: vi.fn(),
      login: vi.fn(
        (
          callback: (response: { authResponse: { code: string } }) => void,
        ) => {
          callback({ authResponse: { code: 'exchange-code' } });
          emitMeta({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'ERROR',
            data: { error_message: 'sensitive provider detail' },
          });
        },
      ),
    };

    await expect(
      launchEmbeddedSignup(fb, 'config-id', 'COEXISTENCE'),
    ).rejects.toEqual(new EmbeddedSignupError('META_ERROR'));
  });
});
