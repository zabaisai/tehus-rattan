import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardHomePage from './page';
import { useAuthStore } from '@/store/auth.store';
import type { Role } from '@/types';

const getMyCompany = vi.fn();
const getOverview = vi.fn();
const getLeadsByStage = vi.fn();
const getAgentPerformance = vi.fn();
const getOverdueTasksCount = vi.fn();
const getTasks = vi.fn();
const getNotifications = vi.fn();
const getInbox = vi.fn();

vi.mock('@/lib/analytics', () => ({
  getOverview: () => getOverview(),
  getLeadsByStage: () => getLeadsByStage(),
  getAgentPerformance: () => getAgentPerformance(),
  getLostReasons: vi.fn().mockResolvedValue([]),
  getOverdueTasksCount: () => getOverdueTasksCount(),
  getPendingConversationsCount: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/lib/companies', () => ({ getMyCompany: () => getMyCompany() }));
vi.mock('@/lib/tasks', () => ({ getTasks: () => getTasks() }));
vi.mock('@/lib/notifications', () => ({ getNotifications: () => getNotifications() }));
vi.mock('@/lib/conversations', () => ({
  getInbox: (f: unknown) => getInbox(f),
}));

function sesion(role: Role, companyId: string | null = 'c1') {
  useAuthStore.setState({
    user: { id: 'u1', name: 'Ana', email: 'a@co.test', role, companyId } as never,
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardHomePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getMyCompany.mockResolvedValue({ id: 'c1', name: 'Empresa A' });
  getOverview.mockResolvedValue({
    leadsThisMonth: 12,
    openValue: 48_200_000,
    wonValue: 10_000_000,
    lostValue: 0,
    wonCount: 3,
    lostCount: 1,
    conversionRate: 18.4,
  });
  getLeadsByStage.mockResolvedValue([
    { stageId: 's1', stageName: 'Nuevo', count: 12, totalValue: 12_400_000 },
    { stageId: 's2', stageName: 'Cotizado', count: 5, totalValue: 9_800_000 },
  ]);
  getAgentPerformance.mockResolvedValue([
    { agentId: 'a1', agentName: 'Ana Restrepo', openLeads: 18, wonCount: 4, wonValue: 28_400_000, lostCount: 1 },
  ]);
  getOverdueTasksCount.mockResolvedValue(5);
  getTasks.mockResolvedValue([
    {
      id: 't1', title: 'Llamar a Laura', description: null,
      dueDate: '2026-08-13T14:30:00.000Z', priority: 'HIGH', type: 'CALL',
      status: 'PENDING', leadId: null, contactId: 'c9', assignedTo: null,
      lead: null, contact: { id: 'c9', name: 'Laura Martínez' }, agent: null,
    },
    {
      id: 't2', title: 'Tarea ya hecha', description: null, dueDate: null,
      priority: 'LOW', type: 'TASK', status: 'COMPLETED', leadId: null,
      contactId: null, assignedTo: null, lead: null, contact: null, agent: null,
    },
  ]);
  getInbox.mockResolvedValue({
    items: [
      {
        id: 'cv1',
        status: 'OPEN',
        stage: null,
        isPaused: false,
        channel: 'WHATSAPP',
        lastMessageAt: new Date(Date.now() - 25 * 60_000).toISOString(),
        updatedAt: '2026-08-12T10:00:00.000Z',
        contact: { id: 'c9', name: 'Laura Martínez' },
        agent: null,
        unreadCount: 3,
        lastReadAt: null,
        messages: [
          {
            id: 'm1',
            body: '¿Tienen disponibilidad para entrega?',
            type: 'text',
            direction: 'INBOUND',
            status: 'DELIVERED',
            createdAt: '2026-08-12T10:00:00.000Z',
          },
        ],
      },
    ],
    hasMore: false,
  });
  getNotifications.mockResolvedValue({
    items: [
      {
        id: 'n1', type: 'quote.created', category: 'COMERCIAL', priority: 'NORMAL',
        title: 'Cotización COT-0521 creada', bodyPreview: 'Para: Laura Martínez',
        entityType: 'quote', entityId: 'q1', actionUrl: '/dashboard/quotes?open=q1',
        readAt: null, createdAt: '2026-08-12T10:00:00.000Z',
      },
    ],
    nextCursor: null,
  });
});

describe('Inicio — identidad de la empresa (caracterización)', () => {
  it('nombra a la empresa conectada, nunca un inquilino fijo', async () => {
    sesion('ADMIN');
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Resumen general de Empresa A.')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Tehus Rattan/)).not.toBeInTheDocument();
  });

  it('sin empresa usa un subtítulo neutro y NO consulta la empresa', async () => {
    sesion('SUPER_ADMIN', null);
    renderPage();

    expect(screen.getByText('Resumen general.')).toBeInTheDocument();
    expect(getMyCompany).not.toHaveBeenCalled();
  });
});

describe('Inicio — métricas accionables', () => {
  it('cada métrica es un enlace al sitio donde se actúa sobre ella', async () => {
    sesion('ADMIN');
    renderPage();

    const vencidas = await screen.findByRole('link', { name: /Tareas vencidas: 5/ });
    expect(vencidas).toHaveAttribute('href', '/dashboard/tasks');

    const abiertas = await screen.findByRole('link', { name: /Oportunidades abiertas: 17/ });
    expect(abiertas).toHaveAttribute('href', '/dashboard/pipeline');
  });

  it('suma las oportunidades de todas las etapas, no las inventa', async () => {
    sesion('ADMIN');
    renderPage();

    // 12 + 5 de `leads-by-stage`.
    expect(await screen.findByText('17')).toBeInTheDocument();
  });

  it('el nombre accesible dice el valor y a dónde lleva', async () => {
    sesion('ADMIN');
    renderPage();

    expect(
      await screen.findByRole('link', { name: 'Tareas vencidas: 5. Abrir tareas' }),
    ).toBeInTheDocument();
  });
});

describe('Inicio — permisos', () => {
  it('un AGENT no ve métricas y NO se consulta analytics', async () => {
    // `analytics` es ADMIN/SUPER_ADMIN entero: pedirlo para recibir un 403
    // llena la consola de errores y hace parpadear la pantalla.
    sesion('AGENT');
    renderPage();

    expect(
      await screen.findByText(/métricas de la empresa son para administradores/i),
    ).toBeInTheDocument();
    expect(getOverview).not.toHaveBeenCalled();
    expect(getLeadsByStage).not.toHaveBeenCalled();
    expect(getAgentPerformance).not.toHaveBeenCalled();
    expect(getOverdueTasksCount).not.toHaveBeenCalled();
  });

  it('un AGENT SÍ ve su agenda y su actividad', async () => {
    sesion('AGENT');
    renderPage();

    expect(await screen.findByText('Llamar a Laura')).toBeInTheDocument();
    expect(await screen.findByText('Cotización COT-0521 creada')).toBeInTheDocument();
    expect(getTasks).toHaveBeenCalled();
    expect(getNotifications).toHaveBeenCalled();
  });

  it('los paneles de administrador dicen «sin permiso», no «error»', async () => {
    sesion('AGENT');
    renderPage();

    const avisos = await screen.findAllByText(/No tienes permiso para ver esto/);
    expect(avisos.length).toBeGreaterThanOrEqual(2);
    // Un 403 no es una avería: no debe invitar a reintentar.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Inicio — agenda y actividad', () => {
  it('la agenda muestra solo lo pendiente, no lo completado', async () => {
    sesion('ADMIN');
    renderPage();

    expect(await screen.findByText('Llamar a Laura')).toBeInTheDocument();
    expect(screen.queryByText('Tarea ya hecha')).not.toBeInTheDocument();
  });

  it('la actividad usa el enlace profundo que ya trae la notificación', async () => {
    sesion('ADMIN');
    renderPage();

    const enlace = await screen.findByRole('link', { name: /Cotización COT-0521 creada/ });
    expect(enlace).toHaveAttribute('href', '/dashboard/quotes?open=q1');
  });

  it('cada etapa del embudo enlaza a su etapa', async () => {
    sesion('ADMIN');
    renderPage();

    const etapa = await screen.findByRole('link', { name: /Nuevo/ });
    expect(etapa).toHaveAttribute('href', '/dashboard/pipeline?etapa=s1');
  });
});

describe('Inicio — conversaciones que requieren respuesta', () => {
  it('pide la bandeja de siempre filtrada por no leídas, no un contrato nuevo', async () => {
    sesion('ADMIN');
    renderPage();

    await waitFor(() => expect(getInbox).toHaveBeenCalled());
    expect(getInbox).toHaveBeenCalledWith({ unread: true, limit: 5 });
  });

  it('cada conversación abre su hilo por enlace profundo', async () => {
    sesion('ADMIN');
    renderPage();

    const enlace = await screen.findByRole('link', { name: /Laura Martínez, 3 sin leer/ });
    expect(enlace).toHaveAttribute('href', '/dashboard/conversations?c=cv1');
  });

  it('el nombre accesible dice cuántos faltan y cuánto llevan esperando', async () => {
    sesion('ADMIN');
    renderPage();

    expect(
      await screen.findByRole('link', {
        name: 'Laura Martínez, 3 sin leer, hace 25 minutos. Abrir la conversación',
      }),
    ).toBeInTheDocument();
  });

  it('un AGENT también lo ve: la bandeja es del equipo, no de los administradores', async () => {
    sesion('AGENT');
    renderPage();

    expect(
      await screen.findByRole('link', { name: /Laura Martínez, 3 sin leer/ }),
    ).toBeInTheDocument();
    expect(getInbox).toHaveBeenCalled();
  });

  it('un mensaje sin texto dice qué llegó, no deja el renglón vacío', async () => {
    sesion('ADMIN');
    getInbox.mockResolvedValue({
      items: [
        {
          id: 'cv2',
          status: 'OPEN',
          stage: null,
          isPaused: false,
          channel: 'WHATSAPP',
          lastMessageAt: new Date().toISOString(),
          updatedAt: '2026-08-12T10:00:00.000Z',
          contact: { id: 'c8', name: 'Carlos Mejía' },
          agent: null,
          unreadCount: 1,
          lastReadAt: null,
          messages: [
            {
              id: 'm9', body: null, type: 'image', direction: 'INBOUND',
              status: 'DELIVERED', createdAt: '2026-08-12T10:00:00.000Z',
            },
          ],
        },
      ],
      hasMore: false,
    });
    renderPage();

    expect(await screen.findByText('Adjunto sin texto.')).toBeInTheDocument();
  });

  it('sin pendientes lo dice, en vez de dejar el bloque en blanco', async () => {
    sesion('ADMIN');
    getInbox.mockResolvedValue({ items: [], hasMore: false });
    renderPage();

    expect(
      await screen.findByText('Todo respondido. No hay mensajes sin leer.'),
    ).toBeInTheDocument();
  });
});

describe('Inicio — estados', () => {
  it('mientras carga anuncia ocupado, sin texto de relleno por bloque', async () => {
    sesion('ADMIN');
    getTasks.mockReturnValue(new Promise(() => {}));
    renderPage();

    const agenda = screen.getByRole('region', { name: 'Agenda de hoy' });
    expect(agenda).toHaveAttribute('aria-busy', 'true');
  });

  it('vacío orienta en vez de dejar el bloque en blanco', async () => {
    sesion('ADMIN');
    getTasks.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('No tienes tareas pendientes.')).toBeInTheDocument();
  });

  it('un fallo real se anuncia como alerta', async () => {
    sesion('ADMIN');
    getTasks.mockRejectedValue({ response: { status: 500 } });
    renderPage();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toBeInTheDocument();
  });
});
