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
  maskedPhoneNumber: null,
  businessName: null,
  connectedAt: null,
  lastCheckedAt: null,
};
const CONNECTED = {
  status: 'CONNECTED',
  connectionMethod: 'EMBEDDED_SIGNUP',
  maskedPhoneNumber: '••• 4521',
  businessName: 'Tehus QA',
  connectedAt: '2026-07-27T00:00:00Z',
  lastCheckedAt: '2026-07-27T00:00:00Z',
};

describe('WhatsAppConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: 'u1', name: 'A', email: 'a@a.co', role: 'ADMIN', companyId: 'c1' } as never,
    });
  });

  it('renders the disconnected view with the "Conectar con Meta" button', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(DISCONNECTED);
    renderConnect();
    expect(await screen.findByText('Conecta tu WhatsApp Business')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conectar con Meta/i })).toBeInTheDocument();
  });

  it('runs the full connect flow and posts the code + ids to the backend', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(DISCONNECTED);
    wa.startEmbeddedSignup.mockResolvedValue({
      appId: 'app', configId: 'cfg', graphVersion: 'v25.0', state: 'st', expiresAt: 'x',
    });
    sdk.loadFacebookSdk.mockResolvedValue({});
    sdk.launchEmbeddedSignup.mockResolvedValue({
      code: 'the-code', phoneNumberId: '123', wabaId: '456', businessId: '789',
    });
    wa.completeEmbeddedSignup.mockResolvedValue(CONNECTED);

    renderConnect();
    await userEvent.click(await screen.findByRole('button', { name: /Conectar con Meta/i }));

    await waitFor(() =>
      expect(wa.completeEmbeddedSignup).toHaveBeenCalledWith({
        state: 'st', code: 'the-code', phoneNumberId: '123', wabaId: '456', businessId: '789',
      }),
    );
  });

  it('shows a friendly message when the user cancels the Meta flow', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(DISCONNECTED);
    wa.startEmbeddedSignup.mockResolvedValue({
      appId: 'app', configId: 'cfg', graphVersion: 'v25.0', state: 'st', expiresAt: 'x',
    });
    sdk.loadFacebookSdk.mockResolvedValue({});
    const { EmbeddedSignupError } = await import('@/lib/meta-sdk');
    sdk.launchEmbeddedSignup.mockRejectedValue(new EmbeddedSignupError('CANCELLED'));

    renderConnect();
    await userEvent.click(await screen.findByRole('button', { name: /Conectar con Meta/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Cancelaste/i);
    expect(wa.completeEmbeddedSignup).not.toHaveBeenCalled();
  });

  it('renders the connected view (masked number, reconnect/disconnect) and never a token', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(CONNECTED);
    renderConnect();
    expect(await screen.findByText('WhatsApp Business conectado')).toBeInTheDocument();
    expect(screen.getByText('••• 4521')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconectar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Desconectar/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/accessToken/i);
  });

  it('hides the advanced manual section from ADMIN', async () => {
    wa.getWhatsAppConnectionStatus.mockResolvedValue(DISCONNECTED);
    renderConnect();
    await screen.findByText('Conecta tu WhatsApp Business');
    expect(screen.queryByText(/Conexión manual/i)).not.toBeInTheDocument();
  });

  it('shows the advanced manual section only for SUPER_ADMIN', async () => {
    useAuthStore.setState({
      user: { id: 'u1', name: 'A', email: 'a@a.co', role: 'SUPER_ADMIN', companyId: 'c1' } as never,
    });
    wa.getWhatsAppConnectionStatus.mockResolvedValue(DISCONNECTED);
    renderConnect();
    expect(await screen.findByText(/Conexión manual/i)).toBeInTheDocument();
  });
});
