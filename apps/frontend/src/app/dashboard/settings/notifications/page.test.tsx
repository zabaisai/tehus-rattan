import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Page from './page';

const p = vi.hoisted(() => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({
  ...p,
  CATEGORY_LABELS: {
    TASK: 'Tareas',
    SECURITY: 'Seguridad',
    LEAD: 'Oportunidades',
  },
}));

const PREFS = [
  { category: 'TASK', inAppEnabled: true, emailEnabled: false },
  { category: 'SECURITY', inAppEnabled: true, emailEnabled: true },
  { category: 'LEAD', inAppEnabled: true, emailEnabled: false },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

describe('NotificationPreferencesPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a per-category matrix and only shows email for eligible categories', async () => {
    p.getNotificationPreferences.mockResolvedValue(PREFS);
    renderPage();
    expect(await screen.findByText('Tareas')).toBeInTheDocument();
    // TASK + SECURITY are email-eligible → have an email checkbox; LEAD does not.
    expect(screen.getByLabelText('Correo: Tareas')).toBeInTheDocument();
    expect(screen.queryByLabelText('Correo: Oportunidades')).not.toBeInTheDocument();
  });

  it('toggles and saves the edited preferences', async () => {
    p.getNotificationPreferences.mockResolvedValue(PREFS);
    p.updateNotificationPreferences.mockResolvedValue(PREFS);
    renderPage();
    await screen.findByText('Tareas');

    await userEvent.click(screen.getByLabelText('Correo: Tareas'));
    await userEvent.click(screen.getByRole('button', { name: /Guardar preferencias/i }));

    await waitFor(() => expect(p.updateNotificationPreferences).toHaveBeenCalled());
    const sent = p.updateNotificationPreferences.mock.calls[0][0] as {
      category: string;
      emailEnabled: boolean;
    }[];
    expect(sent.find((x) => x.category === 'TASK')?.emailEnabled).toBe(true);
    expect(await screen.findByText('Preferencias guardadas.')).toBeInTheDocument();
  });
});
