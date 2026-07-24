import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlatformAuditLogsPage from './page';
import { useAuthStore } from '@/store/auth.store';
import { PlatformAuditLog } from '@/types';

const getPlatformAuditLogs = vi.fn();

vi.mock('@/lib/platform', () => ({
  getPlatformAuditLogs: (...args: unknown[]) => getPlatformAuditLogs(...args),
}));

function log(action: string): PlatformAuditLog {
  return {
    id: `log-${action}`,
    actorUserId: 'u1',
    actorRole: 'SUPER_ADMIN',
    actor: { id: 'u1', name: 'Root', email: 'root@co.test' },
    affectedCompanyId: null,
    affectedCompany: null,
    action,
    entityType: 'UserSession',
    entityId: null,
    reason: null,
    metadata: null,
    ipAddress: null,
    userAgent: null,
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlatformAuditLogsPage />
    </QueryClientProvider>,
  );
}

describe('PlatformAuditLogsPage action labels', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', name: 'Root', email: 'root@co.test', role: 'SUPER_ADMIN', companyId: null } as never,
    });
  });

  it('translates a previously-unmapped action (REVOKE_SESSION) to a readable label', async () => {
    getPlatformAuditLogs.mockResolvedValue([log('REVOKE_SESSION')]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Revocar sesión')).toBeInTheDocument());
    expect(screen.queryByText('REVOKE_SESSION')).not.toBeInTheDocument();
  });

  it('humanizes an unknown action instead of showing the raw SNAKE_CASE code', async () => {
    getPlatformAuditLogs.mockResolvedValue([log('SOME_BRAND_NEW_ACTION')]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Some brand new action')).toBeInTheDocument(),
    );
    expect(screen.queryByText('SOME_BRAND_NEW_ACTION')).not.toBeInTheDocument();
  });
});
