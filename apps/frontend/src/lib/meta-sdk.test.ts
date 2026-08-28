import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedSignupError, launchEmbeddedSignup } from './meta-sdk';

// El flujo real tiene DOS resultados independientes que llegan sin orden
// garantizado: el `code` OAuth (callback de FB.login) y los datos de sesión
// (postMessage WA_EMBEDDED_SIGNUP). Estas pruebas fijan ese contrato.

type LoginCallback = (resp: {
  authResponse?: { code?: string } | null;
  status?: string;
}) => void;

function fakeFb() {
  const loginCalls: Array<Record<string, unknown>> = [];
  let callback: LoginCallback | null = null;
  const fb = {
    init: () => undefined,
    login: (cb: LoginCallback, opts: Record<string, unknown>) => {
      callback = cb;
      loginCalls.push(opts);
    },
  };
  return {
    fb,
    loginCalls,
    completeLogin: (code?: string) => {
      callback?.({
        authResponse: code ? { code } : null,
        status: code ? 'connected' : 'unknown',
      });
    },
  };
}

function postSignupMessage(
  data: unknown,
  origin = 'https://www.facebook.com',
) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

const FINISH_COEXISTENCE = {
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  data: { phone_number_id: '111', waba_id: '222', business_id: '333' },
};

const TIMING = { timeoutMs: 1_000, graceMs: 100 };

describe('launchEmbeddedSignup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('COEXISTENCE lanza FB.login con featureType y sessionInfoVersion', () => {
    const { fb, loginCalls } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'config-123', 'COEXISTENCE', TIMING);
    promesa.catch(() => undefined); // se abandona: solo interesa el lanzamiento

    expect(loginCalls).toHaveLength(1);
    expect(loginCalls[0]).toMatchObject({
      config_id: 'config-123',
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: 'whatsapp_business_app_onboarding',
        sessionInfoVersion: '3',
      },
    });
  });

  it('STANDARD conserva extras { setup: {} } sin featureType ni sessionInfoVersion', () => {
    const { fb, loginCalls } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'config-123', 'STANDARD', TIMING);
    promesa.catch(() => undefined);

    expect(loginCalls).toHaveLength(1);
    expect(loginCalls[0]).toMatchObject({
      config_id: 'config-123',
      response_type: 'code',
      override_default_response_type: true,
    });
    expect(loginCalls[0].extras).toEqual({ setup: {} });
  });

  it('resuelve cuando el code llega primero y FINISH después', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);

    completeLogin('codigo-oauth');
    // Aún no hay sesión: no debe fallar de inmediato.
    postSignupMessage(FINISH_COEXISTENCE);

    await expect(promesa).resolves.toEqual({
      code: 'codigo-oauth',
      phoneNumberId: '111',
      wabaId: '222',
      businessId: '333',
    });
  });

  it('resuelve cuando FINISH llega primero y el code después', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);

    postSignupMessage(FINISH_COEXISTENCE);
    // Aún no hay code: no debe fallar de inmediato.
    completeLogin('codigo-oauth');

    await expect(promesa).resolves.toEqual({
      code: 'codigo-oauth',
      phoneNumberId: '111',
      wabaId: '222',
      businessId: '333',
    });
  });

  it('acepta el evento FINISH clásico (Cloud API) igual que antes', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);

    postSignupMessage({ ...FINISH_COEXISTENCE, event: 'FINISH' });
    completeLogin('codigo-oauth');

    await expect(promesa).resolves.toMatchObject({
      phoneNumberId: '111',
      wabaId: '222',
    });
  });

  it('FINISH_ONLY_WABA (sin número) se acepta y clasifica INCOMPLETE_SESSION', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);
    const expectativa = expect(promesa).rejects.toMatchObject({
      code: 'INCOMPLETE_SESSION',
    });

    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_ONLY_WABA',
      data: { waba_id: '222' },
    });
    completeLogin('codigo-oauth');
    await expectativa;
  });

  it('sesión primero puede esperar el code más de 15 segundos (hasta el timeout global)', async () => {
    const { fb, completeLogin } = fakeFb();
    // Tiempos REALES por defecto de producción: gracia 15 s, timeout 5 min.
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE');

    postSignupMessage(FINISH_COEXISTENCE);
    // El usuario sigue en la pantalla final de Meta: pasan 20 segundos.
    await vi.advanceTimersByTimeAsync(20_000);
    // El code llega al cerrar el popup y el flujo aún debe resolver bien.
    completeLogin('codigo-oauth');

    await expect(promesa).resolves.toMatchObject({
      code: 'codigo-oauth',
      phoneNumberId: '111',
      wabaId: '222',
    });
  });

  it('ignora mensajes de un origen no permitido', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);
    const expectativa = expect(promesa).rejects.toMatchObject({
      code: 'INCOMPLETE_SESSION',
    });

    postSignupMessage(FINISH_COEXISTENCE, 'https://evil.example.com');
    completeLogin('codigo-oauth');
    // La sesión del origen malicioso no cuenta: al agotar la gracia, falla.
    await vi.advanceTimersByTimeAsync(TIMING.graceMs);
    await expectativa;
  });

  it('ignora mensajes malformados o de otro tipo sin romper el flujo', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);

    postSignupMessage('esto no es json{');
    postSignupMessage({ type: 'OTRA_COSA', event: 'FINISH' });
    postSignupMessage(FINISH_COEXISTENCE);
    completeLogin('codigo-oauth');

    await expect(promesa).resolves.toMatchObject({ code: 'codigo-oauth' });
  });

  it('CANCEL rechaza como CANCELLED sin esperar al callback de login', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);
    const expectativa = expect(promesa).rejects.toMatchObject({
      code: 'CANCELLED',
    });

    postSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' });
    await expectativa;

    // Un callback tardío ya no cambia el resultado.
    completeLogin('codigo-tardio');
    await expect(promesa).rejects.toBeInstanceOf(EmbeddedSignupError);
  });

  it('callback sin code rechaza NO_CODE tras la gracia', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);
    const expectativa = expect(promesa).rejects.toMatchObject({
      code: 'NO_CODE',
    });

    completeLogin(undefined); // ventana cerrada / OAuth sin concesión
    await vi.advanceTimersByTimeAsync(TIMING.graceMs);
    await expectativa;
  });

  it('FINISH sin phone_number_id rechaza INCOMPLETE_SESSION', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);
    const expectativa = expect(promesa).rejects.toMatchObject({
      code: 'INCOMPLETE_SESSION',
    });

    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: '222' },
    });
    completeLogin('codigo-oauth');
    await expectativa;
  });

  it('el evento ERROR de Meta rechaza META_ERROR descartando el payload íntegro', async () => {
    const { fb } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);

    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'ERROR',
      data: {
        error_message: 'detalle-interno-que-no-debe-leerse',
        error_id: 'id-interno-999',
      },
    });

    let capturado: EmbeddedSignupError | null = null;
    try {
      await promesa;
    } catch (err) {
      capturado = err as EmbeddedSignupError;
    }
    expect(capturado).toBeInstanceOf(EmbeddedSignupError);
    expect(capturado?.code).toBe('META_ERROR');
    const serializado = String(capturado) + JSON.stringify({ ...capturado });
    expect(serializado).not.toContain('detalle-interno-que-no-debe-leerse');
    expect(serializado).not.toContain('id-interno-999');
  });

  it('un CANCEL tardío dentro de la gracia prevalece sobre NO_CODE', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);
    const expectativa = expect(promesa).rejects.toMatchObject({
      code: 'CANCELLED',
    });

    completeLogin(undefined); // login terminó sin code
    await vi.advanceTimersByTimeAsync(TIMING.graceMs / 2);
    postSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' });
    await expectativa;
  });

  it('el timeout global rechaza TIMEOUT y limpia listener y temporizadores', async () => {
    const removidos: unknown[] = [];
    const originalRemove = window.removeEventListener.bind(window);
    const removeSpy = vi
      .spyOn(window, 'removeEventListener')
      .mockImplementation((...args) => {
        removidos.push(args[1]);
        originalRemove(...args);
      });

    const { fb } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);
    const expectativa = expect(promesa).rejects.toMatchObject({
      code: 'TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(TIMING.timeoutMs);
    await expectativa;

    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);

    // El listener quedó retirado: un FINISH tardío no resucita nada.
    postSignupMessage(FINISH_COEXISTENCE);
    await expect(promesa).rejects.toBeInstanceOf(EmbeddedSignupError);
    expect(removidos.length).toBeGreaterThan(0);
  });

  it('reintentar no acumula listeners: cada add tiene su remove', async () => {
    const agregados: unknown[] = [];
    const retirados: unknown[] = [];
    const originalAdd = window.addEventListener.bind(window);
    const originalRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((...args) => {
      if (args[0] === 'message') agregados.push(args[1]);
      originalAdd(...args);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((...args) => {
      if (args[0] === 'message') retirados.push(args[1]);
      originalRemove(...args);
    });

    const primero = fakeFb();
    const promesa1 = launchEmbeddedSignup(primero.fb, 'cfg', 'COEXISTENCE', TIMING);
    const expectativa1 = expect(promesa1).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    postSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' });
    await expectativa1;

    const segundo = fakeFb();
    const promesa2 = launchEmbeddedSignup(segundo.fb, 'cfg', 'COEXISTENCE', TIMING);
    postSignupMessage(FINISH_COEXISTENCE);
    segundo.completeLogin('codigo-oauth');
    await expect(promesa2).resolves.toMatchObject({ code: 'codigo-oauth' });

    expect(agregados.length).toBe(2);
    expect(retirados.length).toBe(2);
    // Se retira exactamente lo agregado, en ambas rondas.
    expect(new Set(retirados)).toEqual(new Set(agregados));
  });

  it('los errores nunca transportan el code OAuth ni datos de la sesión', async () => {
    const { fb, completeLogin } = fakeFb();
    const promesa = launchEmbeddedSignup(fb, 'cfg', 'COEXISTENCE', TIMING);

    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: '222' }, // incompleto a propósito
    });
    completeLogin('codigo-super-secreto');

    let capturado: EmbeddedSignupError | null = null;
    try {
      await promesa;
    } catch (err) {
      capturado = err as EmbeddedSignupError;
    }

    expect(capturado).toBeInstanceOf(EmbeddedSignupError);
    const serializado =
      String(capturado) + JSON.stringify({ ...capturado });
    expect(serializado).not.toContain('codigo-super-secreto');
    expect(serializado).not.toContain('222');
    expect(capturado?.message).toBe('INCOMPLETE_SESSION');
  });
});
