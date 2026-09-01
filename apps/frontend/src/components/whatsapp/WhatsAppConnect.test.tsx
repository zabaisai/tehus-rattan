import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore } from '@/store/auth.store';
import { WhatsAppConnect } from './WhatsAppConnect';

const wa = vi.hoisted(() => ({
  getWhatsAppConnectionStatus: vi.fn(),
  startEmbeddedSignup: vi.fn(),
  completeEmbeddedSignup: vi.fn(),
  reconnectWhatsApp: vi.fn(),
  disconnectWhatsAppIntegration: vi.fn(),
  getWhatsAppIntegration: vi.fn(),
  testWhatsAppConnection: vi.fn(),
}));
const sdk = vi.hoisted(() => ({
  loadFacebookSdk: vi.fn(),
  launchEmbeddedSignup: vi.fn(),
}));

vi.mock('@/lib/whatsapp', () => wa);
vi.mock('@/lib/meta-sdk', async () => {
  class EmbeddedSignupError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { ...sdk, EmbeddedSignupError };
});

function renderConnect() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WhatsAppConnect />
    </QueryClientProvider>,
  );
}

const DISCONNECTED = {
  status: 'NOT_CONNECTED',
  connectionMethod: null,
  coexistence: false,
  maskedPhoneNumber: null,
  businessName: null,
  connectedAt: null,
  lastCheckedAt: null,
  webhookStatus: 'UNKNOWN',
  actionRequired: false,
  errorCode: null,
};
const CONNECTED = {
  status: 'CONNECTED',
  connectionMethod: 'COEXISTENCE',
  coexistence: true,
  maskedPhoneNumber: '••• 4521',
  businessName: 'Tehus QA',
  connectedAt: '2026-07-27T00:00:00Z',
  lastCheckedAt: '2026-07-27T00:00:00Z',
  webhookStatus: 'SUBSCRIBED',
  actionRequired: false,
  errorCode: null,
};

// El SDK precargado es un objeto sentinela: las aserciones verifican que el
// lanzamiento usa EXACTAMENTE la instancia preparada antes del clic.
const FB = { sentinel: 'fb-instance' };
const CFG = {
  appId: 'app',
  configId: 'cfg',
  graphVersion: 'v25.0',
  state: 'st-precarga',
  expiresAt: 'x',
};
const RESULT = {
  code: 'the-code',
  phoneNumberId: '123',
  wabaId: '456',
  businessId: '789',
};

// Prepara los mocks del camino feliz "desconectado": precarga OK y botones
// habilitados. Los tests luego afinan lo que necesitan.
function mockHappyPrep() {
  wa.getWhatsAppConnectionStatus.mockResolvedValue(DISCONNECTED);
  wa.startEmbeddedSignup.mockResolvedValue(CFG);
  sdk.loadFacebookSdk.mockResolvedValue(FB);
}

async function findEnabledConnectButton() {
  const btn = await screen.findByRole('button', {
    name: /Conectar mi WhatsApp actual/i,
  });
  await waitFor(() => expect(btn).toBeEnabled());
  return btn;
}

describe('WhatsAppConnect', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.setState({
      user: { id: 'u1', name: 'A', email: 'a@a.co', role: 'ADMIN', companyId: 'c1' } as never,
    });
  });

  it('offers existing-number coexistence first and a new-number fallback', async () => {
    mockHappyPrep();
    renderConnect();
    expect(await screen.findByText('Conecta tu WhatsApp Business')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Conectar mi WhatsApp actual/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Usar un número nuevo/i }),
    ).toBeInTheDocument();
  });

  // FB.login solo funciona dentro del gesto del clic, así que TODO lo async
  // (POST /start + carga del SDK) ocurre al montar; los botones esperan.
  it('precarga config y SDK al montar y deshabilita los botones hasta estar listo', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(DISCONNECTED);
    let releasePrep!: (v: unknown) => void;
    wa.startEmbeddedSignup.mockImplementationOnce(
      () => new Promise((res) => { releasePrep = res; }),
    );
    sdk.loadFacebookSdk.mockResolvedValue(FB);

    renderConnect();
    const btn = await screen.findByRole('button', {
      name: /Conectar mi WhatsApp actual/i,
    });
    expect(btn).toBeDisabled();
    expect(
      screen.getByText(/Preparando la conexión segura con Meta/i),
    ).toBeInTheDocument();

    releasePrep(CFG);
    await waitFor(() => expect(btn).toBeEnabled());
    expect(sdk.loadFacebookSdk).toHaveBeenCalledWith('app', 'v25.0');
    // La precarga no lanza nada por sí sola.
    expect(sdk.launchEmbeddedSignup).not.toHaveBeenCalled();
  });

  it('el clic lanza FB.login con la instancia precargada SIN esperar el /start fresco', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(DISCONNECTED);
    let releaseFresh!: (v: unknown) => void;
    wa.startEmbeddedSignup
      .mockResolvedValueOnce(CFG) // precarga al montar
      .mockImplementationOnce(
        () => new Promise((res) => { releaseFresh = res; }), // state fresco del clic
      );
    sdk.loadFacebookSdk.mockResolvedValue(FB);
    sdk.launchEmbeddedSignup.mockResolvedValue(RESULT);
    wa.completeEmbeddedSignup.mockResolvedValue(CONNECTED);

    renderConnect();
    await userEvent.click(await findEnabledConnectButton());

    // El popup ya se lanzó con lo precargado, con el POST fresco aún pendiente.
    expect(sdk.launchEmbeddedSignup).toHaveBeenCalledWith(FB, 'cfg', 'COEXISTENCE');
    expect(wa.completeEmbeddedSignup).not.toHaveBeenCalled();

    // El canje usa el state FRESCO minteado en paralelo, no el de la precarga.
    releaseFresh({ ...CFG, state: 'st-fresco' });
    await waitFor(() =>
      expect(wa.completeEmbeddedSignup).toHaveBeenCalledWith({
        state: 'st-fresco',
        code: 'the-code',
        phoneNumberId: '123',
        wabaId: '456',
        businessId: '789',
      }),
    );
  });

  it('si el /start fresco falla, el canje usa el state de la precarga', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(DISCONNECTED);
    wa.startEmbeddedSignup
      .mockResolvedValueOnce(CFG)
      .mockRejectedValueOnce(new Error('red caida'));
    sdk.loadFacebookSdk.mockResolvedValue(FB);
    sdk.launchEmbeddedSignup.mockResolvedValue(RESULT);
    wa.completeEmbeddedSignup.mockResolvedValue(CONNECTED);

    renderConnect();
    await userEvent.click(await findEnabledConnectButton());

    await waitFor(() =>
      expect(wa.completeEmbeddedSignup).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'st-precarga', code: 'the-code' }),
      ),
    );
  });

  it('uses standard Embedded Signup when the company selects a new number', async () => {
    mockHappyPrep();
    sdk.launchEmbeddedSignup.mockRejectedValue(new Error('stop after mode check'));

    renderConnect();
    const btn = await screen.findByRole('button', { name: /Usar un número nuevo/i });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);

    await waitFor(() =>
      expect(sdk.launchEmbeddedSignup).toHaveBeenCalledWith(FB, 'cfg', 'STANDARD'),
    );
    expect(wa.completeEmbeddedSignup).not.toHaveBeenCalled();
  });

  it('shows a friendly message when the user cancels the Meta flow', async () => {
    mockHappyPrep();
    const { EmbeddedSignupError } = await import('@/lib/meta-sdk');
    sdk.launchEmbeddedSignup.mockRejectedValue(new EmbeddedSignupError('CANCELLED'));

    renderConnect();
    await userEvent.click(await findEnabledConnectButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/Cancelaste/i);
    expect(wa.completeEmbeddedSignup).not.toHaveBeenCalled();
  });

  it('shows a generic, useful message when Meta reports an in-flow error', async () => {
    mockHappyPrep();
    const { EmbeddedSignupError } = await import('@/lib/meta-sdk');
    sdk.launchEmbeddedSignup.mockRejectedValue(new EmbeddedSignupError('META_ERROR'));

    renderConnect();
    await userEvent.click(await findEnabledConnectButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Meta informó un error/i,
    );
    expect(wa.completeEmbeddedSignup).not.toHaveBeenCalled();
  });

  it('si la precarga falla muestra el error y un Reintentar que vuelve a preparar', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(DISCONNECTED);
    wa.startEmbeddedSignup
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce(CFG);
    sdk.loadFacebookSdk.mockResolvedValue(FB);

    renderConnect();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no está disponible/i,
    );
    const connectBtn = screen.getByRole('button', {
      name: /Conectar mi WhatsApp actual/i,
    });
    expect(connectBtn).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    await waitFor(() => expect(connectBtn).toBeEnabled());
    expect(sdk.launchEmbeddedSignup).not.toHaveBeenCalled();
  });

  it('la vista conectada precarga vía reconnect y Reconectar lanza en modo coexistencia', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(CONNECTED);
    wa.reconnectWhatsApp.mockResolvedValue(CFG);
    sdk.loadFacebookSdk.mockResolvedValue(FB);
    sdk.launchEmbeddedSignup.mockRejectedValue(new Error('stop after launch check'));

    renderConnect();
    const btn = await screen.findByRole('button', { name: /Reconectar/i });
    await waitFor(() => expect(btn).toBeEnabled());
    expect(wa.reconnectWhatsApp).toHaveBeenCalledTimes(1); // precarga
    expect(wa.startEmbeddedSignup).not.toHaveBeenCalled();

    await userEvent.click(btn);
    expect(sdk.launchEmbeddedSignup).toHaveBeenCalledWith(FB, 'cfg', 'COEXISTENCE');
    // El state fresco del clic (y la re-preparación posterior) también salen
    // del endpoint de reconexión, nunca del /start normal.
    await waitFor(() =>
      expect(wa.reconnectWhatsApp.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(wa.startEmbeddedSignup).not.toHaveBeenCalled();
  });

  it('renders the connected view (masked number, coexistence, webhook, reconnect/disconnect) and never a token', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(CONNECTED);
    wa.reconnectWhatsApp.mockResolvedValue(CFG);
    sdk.loadFacebookSdk.mockResolvedValue(FB);
    renderConnect();
    expect(await screen.findByText('WhatsApp Business conectado')).toBeInTheDocument();
    expect(screen.getByText('••• 4521')).toBeInTheDocument();
    expect(screen.getByText('Coexistencia (App + API)')).toBeInTheDocument();
    expect(screen.getByText('Suscrito')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconectar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Desconectar/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ir a conversaciones/i })).toHaveAttribute(
      'href',
      '/dashboard/conversations',
    );
    expect(document.body.textContent).not.toMatch(/accessToken/i);
  });

  it('sends a test message from the connected view', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(CONNECTED);
    wa.reconnectWhatsApp.mockResolvedValue(CFG);
    sdk.loadFacebookSdk.mockResolvedValue(FB);
    wa.testWhatsAppConnection.mockResolvedValue({ status: 'ok' });
    renderConnect();
    await screen.findByText('WhatsApp Business conectado');
    await userEvent.type(screen.getByPlaceholderText('+573001234567'), '+573001234567');
    await userEvent.click(screen.getByRole('button', { name: /Enviar prueba/i }));
    await waitFor(() =>
      expect(wa.testWhatsAppConnection).toHaveBeenCalledWith('+573001234567'),
    );
    expect(await screen.findByText(/Mensaje de prueba enviado/i)).toBeInTheDocument();
  });

  it('hides the advanced manual section from ADMIN', async () => {
    mockHappyPrep();
    renderConnect();
    await screen.findByText('Conecta tu WhatsApp Business');
    expect(screen.queryByText(/Conexión manual/i)).not.toBeInTheDocument();
  });

  it('shows the advanced manual section only for SUPER_ADMIN', async () => {
    useAuthStore.setState({
      user: { id: 'u1', name: 'A', email: 'a@a.co', role: 'SUPER_ADMIN', companyId: 'c1' } as never,
    });
    mockHappyPrep();
    renderConnect();
    expect(await screen.findByText(/Conexión manual/i)).toBeInTheDocument();
  });
});
