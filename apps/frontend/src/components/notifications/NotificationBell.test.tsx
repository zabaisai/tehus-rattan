import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationBell } from './NotificationBell';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const n = vi.hoisted(() => ({
  getUnreadCount: vi.fn(),
  getNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({
  ...n,
  CATEGORY_LABELS: { TASK: 'Tareas', MESSAGE: 'Mensajes' },
}));

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationBell />
    </QueryClientProvider>,
  );
}

const item = {
  id: 'n1',
  type: 'TASK_ASSIGNED',
  category: 'TASK',
  priority: 'NORMAL',
  title: 'Tarea asignada',
  bodyPreview: 'Llamar al cliente',
  entityType: 'Task',
  entityId: 't1',
  actionUrl: '/dashboard/tasks',
  readAt: null,
  createdAt: new Date().toISOString(),
};

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    push.mockClear();
  });

  it('shows an unread badge with the count', async () => {
    n.getUnreadCount.mockResolvedValue(3);
    renderBell();
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /3 sin leer/i }),
    ).toBeInTheDocument();
  });

  it('caps the badge at 99+', async () => {
    n.getUnreadCount.mockResolvedValue(250);
    renderBell();
    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('opens the dropdown, lists items and navigates + marks read on click', async () => {
    n.getUnreadCount.mockResolvedValue(1);
    n.getNotifications.mockResolvedValue({ items: [item], nextCursor: null });
    n.markNotificationRead.mockResolvedValue(true);
    renderBell();

    await userEvent.click(await screen.findByRole('button', { name: /Notificaciones/i }));
    expect(await screen.findByText('Tarea asignada')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Tarea asignada'));
    await waitFor(() => expect(n.markNotificationRead).toHaveBeenCalledWith('n1'));
    expect(push).toHaveBeenCalledWith('/dashboard/tasks');
  });

  it('marks all as read from the dropdown', async () => {
    n.getUnreadCount.mockResolvedValue(2);
    n.getNotifications.mockResolvedValue({ items: [item], nextCursor: null });
    n.markAllNotificationsRead.mockResolvedValue(2);
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notificaciones/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Marcar todas/i }));
    expect(n.markAllNotificationsRead).toHaveBeenCalled();
  });

  it('shows an empty state when there are no notifications', async () => {
    n.getUnreadCount.mockResolvedValue(0);
    n.getNotifications.mockResolvedValue({ items: [], nextCursor: null });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notificaciones' }));
    expect(await screen.findByText(/No tienes notificaciones/i)).toBeInTheDocument();
  });
});
