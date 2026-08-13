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
const getSalesTrend = vi.fn();
const getRecentActivity = vi.fn();
const getTasks = vi.fn();
const getInbox = vi.fn();

vi.mock('@/lib/analytics', () => ({
  getOverview: () => getOverview(),
  getLeadsByStage: () => getLeadsByStage(),
  getAgentPerformance: () => getAgentPerformance(),
  getLostReasons: vi.fn().mockResolvedValue([]),
  getOverdueTasksCount: () => getOverdueTasksCount(),
  getPendingConversationsCount: vi.fn().mockResolvedValue(0),
  getSalesTrend: (d: number) => getSalesTrend(d),
  getRecentActivity: (l: number) => getRecentActivity(l),
}));
vi.mock('@/lib/companies', () => ({ getMyCompany: () => getMyCompany() }));
vi.mock('@/lib/tasks', () => ({ getTasks: () => getTasks() }));
vi.mock('@/lib/conversations', () => ({ getInbox: (f: unknown) => getInbox(f) }));

function sesion(role: Role, companyId: string | null = 'c1', name = 'Ana Administradora') {
  useAuthStore.setState({
    user: { id: 'u1', name, email: 'a@co.test', role, companyId } as never,
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

function dia(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${String(d.getDate()).padStart(2, '0')}`;
}

function serie(valores: Array<Partial<{ openedCount: number; openedValue: number }>>) {
  return valores.map((v, i) => ({
    date: dia(i - valores.length + 1),
    openedCount: v.openedCount ?? 0,
    openedValue: v.openedValue ?? 0,
    wonCount: 0,
    wonValue: 0,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getMyCompany.mockResolvedValue({ id: 'c1', name: 'Muebles del Valle' });
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
    {
      agentId: 'a1',
      agentName: 'Ana Restrepo',
      openLeads: 18,
      wonCount: 4,
      wonValue: 28_400_000,
      lostCount: 1,
    },
  ]);
  getOverdueTasksCount.mockResolvedValue(5);
  getSalesTrend.mockResolvedValue({
    days: 30,
    from: dia(-29),
    to: dia(0),
    points: serie([
      { openedCount: 1, openedValue: 1_000_000 },
      { openedCount: 2, openedValue: 3_000_000 },
      { openedCount: 4, openedValue: 5_000_000 },
    ]),
    totals: { openedCount: 7, openedValue: 9_000_000, wonCount: 1, wonValue: 4_000_000 },
    previous: { openedCount: 4, openedValue: 6_000_000, wonCount: 0, wonValue: 0 },
    wonWithoutDate: 0,
  });
  getRecentActivity.mockResolvedValue([
    {
      id: 'al1',
      action: 'contact.archive',
      entityType: 'Contact',
      createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      actorName: 'Ana Administradora',
    },
  ]);
  getTasks.mockResolvedValue([
    {
      id: 't1',
      title: 'Llamar a Laura',
      description: null,
      dueDate: '2026-08-13T14:30:00.000Z',
      priority: 'HIGH',
      type: 'CALL',
      status: 'PENDING',
      leadId: null,
      contactId: 'c9',
      assignedTo: null,
      lead: null,
      contact: { id: 'c9', name: 'Laura Martínez' },
      agent: null,
    },
    {
      id: 't2',
      title: 'Tarea ya hecha',
      description: null,
      dueDate: null,
      priority: 'LOW',
      type: 'TASK',
      status: 'COMPLETED',
      leadId: null,
      contactId: null,
      assignedTo: null,
      lead: null,
      contact: null,
      agent: null,
    },
  ]);
  getInbox.mockResolvedValue({
    items: [
      {
        id: 'cv1',
        status: 'OPEN',
        stage: null,
        isPaused: false,
        channel: 'whatsapp',
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
});

describe('Inicio — hero', () => {
  it('saluda por el primer nombre y nombra a la empresa conectada', async () => {
    sesion('ADMIN');
    renderPage();

    expect(await screen.findByRole('heading', { name: /, Ana$/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/Muebles del Valle/)).toBeInTheDocument(),
    );
  });

  it('NO enseña el prefijo de los datos de prueba en el saludo', async () => {
    // Los datos de la vista previa llevan `PREVIEW_BRANDING_`. Se limpia al
    // pintar, nunca corrigiendo el dato en la base.
    sesion('ADMIN', 'c1', 'PREVIEW_BRANDING_Administrador');
    renderPage();

    const titulo = await screen.findByRole('heading', { name: /Buen/ });
    expect(titulo.textContent).toContain('Administrador');
    expect(titulo.textContent).not.toContain('PREVIEW_BRANDING_');
  });

  it('la acción de cotización lleva a elegir la oportunidad, y lo avisa', async () => {
    // Una cotización SIEMPRE pertenece a una oportunidad
    // (`POST /quotes/from-lead/:leadId`): el botón no puede prometer un
    // formulario que no existe.
    sesion('ADMIN');
    renderPage();

    const cta = await screen.findByRole('link', { name: 'Nueva cotización' });
    expect(cta).toHaveAttribute('href', '/dashboard/pipeline');
    expect(screen.getByText('Elige la oportunidad')).toBeInTheDocument();
  });

  it('sin nombre de usuario el saludo va solo, no con una coma suelta', async () => {
    sesion('ADMIN', 'c1', '');
    renderPage();

    const titulo = await screen.findByRole('heading', { name: /Buen/ });
    expect(titulo.textContent?.trim().endsWith(',')).toBe(false);
  });
});

describe('Inicio — métricas accionables', () => {
  it('cada métrica es un enlace al sitio donde se actúa sobre ella', async () => {
    sesion('ADMIN');
    renderPage();

    expect(
      await screen.findByRole('link', { name: /Tareas vencidas: 5/ }),
    ).toHaveAttribute('href', '/dashboard/tasks');
    expect(
      await screen.findByRole('link', { name: /Oportunidades abiertas: 17/ }),
    ).toHaveAttribute('href', '/dashboard/pipeline');
  });

  it('suma las oportunidades de todas las etapas, no las inventa', async () => {
    sesion('ADMIN');
    renderPage();

    // 12 + 5 de `leads-by-stage`.
    expect(await screen.findByText('17')).toBeInTheDocument();
  });

  it('la comparación sale de la serie real y dice contra qué compara', async () => {
    sesion('ADMIN');
    renderPage();

    // 7 abiertas ahora frente a 4 en la ventana previa.
    expect(await screen.findByText('+3')).toBeInTheDocument();
    expect(
      screen.getAllByText('vs. 30 días previos').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('el nombre accesible incluye la comparación, que la flecha no dice en voz alta', async () => {
    sesion('ADMIN');
    renderPage();

    expect(
      await screen.findByRole('link', {
        name: 'Oportunidades abiertas: 17. +3 vs. 30 días previos. Abrir el embudo',
      }),
    ).toBeInTheDocument();
  });

  it('sin serie previa NO dibuja una comparación inventada', async () => {
    sesion('ADMIN');
    getSalesTrend.mockResolvedValue({
      days: 30,
      from: dia(-29),
      to: dia(0),
      points: serie([{}, {}, {}]),
      totals: { openedCount: 0, openedValue: 0, wonCount: 0, wonValue: 0 },
      previous: { openedCount: 0, openedValue: 0, wonCount: 0, wonValue: 0 },
      wonWithoutDate: 0,
    });
    renderPage();

    await screen.findByRole('link', { name: /Oportunidades abiertas/ });
    expect(screen.queryByText('vs. 30 días previos')).not.toBeInTheDocument();
  });

  it('las métricas sin serie dicen qué son, en vez de dejar el hueco', async () => {
    sesion('ADMIN');
    renderPage();

    expect(await screen.findByText('acumulado histórico')).toBeInTheDocument();
    expect(screen.getByText('ahora mismo')).toBeInTheDocument();
  });
});

describe('Inicio — permisos', () => {
  it('un AGENT no ve métricas y NO se consulta analytics', async () => {
    sesion('AGENT');
    renderPage();

    expect(
      await screen.findByText(/métricas de la empresa son para administradores/i),
    ).toBeInTheDocument();
    for (const consulta of [
      getOverview,
      getLeadsByStage,
      getAgentPerformance,
      getOverdueTasksCount,
      getSalesTrend,
      getRecentActivity,
    ]) {
      expect(consulta).not.toHaveBeenCalled();
    }
  });

  it('un AGENT SÍ ve su agenda y sus conversaciones', async () => {
    sesion('AGENT');
    renderPage();

    expect(await screen.findByText('Llamar a Laura')).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: /Laura Martínez, 3 sin leer/ }),
    ).toBeInTheDocument();
  });

  it('los paneles de administración no se montan para un AGENT', async () => {
    // Antes salían como cuatro cajas de «sin permiso» seguidas y el Inicio de
    // un asesor era medio aviso legal. El mensaje de arriba ya lo dice.
    sesion('AGENT');
    renderPage();

    await screen.findByText('Llamar a Laura');
    expect(screen.queryByRole('region', { name: 'Embudo comercial' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tendencia de ventas' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Actividad reciente' })).toBeNull();
    // Un 403 no es una avería: nada debe invitar a reintentar.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('un 403 del servidor sí se trata como «sin permiso», no como error', async () => {
    // Rol y servidor pueden discrepar: la defensa se queda dentro del panel.
    sesion('ADMIN');
    getLeadsByStage.mockRejectedValue({ response: { status: 403 } });
    renderPage();

    const embudo = await screen.findByRole('region', { name: 'Embudo comercial' });
    await waitFor(() =>
      expect(
        screen.getByText('Solo un administrador ve el resumen por etapa.'),
      ).toBeInTheDocument(),
    );
    expect(embudo.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('Inicio — embudo comercial', () => {
  it('cada etapa enlaza a su etapa y NO enseña el identificador técnico', async () => {
    sesion('ADMIN');
    renderPage();

    const etapa = await screen.findByRole('link', { name: /^Nuevo: 12 oportunidades/ });
    expect(etapa).toHaveAttribute('href', '/dashboard/pipeline?etapa=s1');
    expect(etapa.textContent).not.toContain('s1');
  });

  it('suma el total del embudo con lo que devuelve el contrato', async () => {
    sesion('ADMIN');
    renderPage();

    expect(await screen.findByText('Total del embudo')).toBeInTheDocument();
    expect(screen.getByText('17 leads')).toBeInTheDocument();
  });

  it('pinta las etapas reales, incluidas las de nombre raro: no las filtra', async () => {
    sesion('ADMIN');
    getLeadsByStage.mockResolvedValue([
      { stageId: 's9', stageName: 'sfg', count: 0, totalValue: 0 },
    ]);
    renderPage();

    expect(await screen.findByText('sfg')).toBeInTheDocument();
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

    expect(
      await screen.findByRole('link', { name: /Laura Martínez, 3 sin leer/ }),
    ).toHaveAttribute('href', '/dashboard/conversations?c=cv1');
  });

  it('traduce el estado: nunca enseña OPEN en inglés', async () => {
    sesion('ADMIN');
    renderPage();

    expect((await screen.findAllByText(/Abierta/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\bOPEN\b/)).not.toBeInTheDocument();
  });

  it('ordena por quien lleva más tiempo esperando, no por actividad reciente', async () => {
    sesion('ADMIN');
    getInbox.mockResolvedValue({
      items: [
        base('nuevo', 'Reciente Recién', 5),
        base('viejo', 'Antigua Espera', 400),
      ],
      hasMore: false,
    });
    renderPage();

    const enlaces = await screen.findAllByRole('link', { name: /sin leer/ });
    expect(enlaces[0]).toHaveAttribute('href', '/dashboard/conversations?c=viejo');
  });

  it('un mensaje sin texto dice qué llegó, no deja el renglón vacío', async () => {
    sesion('ADMIN');
    getInbox.mockResolvedValue({
      items: [{ ...base('cv2', 'Carlos Mejía', 3), messages: [{ id: 'm9', body: null }] }],
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

describe('Inicio — agenda de hoy', () => {
  it('muestra solo lo pendiente, no lo completado', async () => {
    sesion('ADMIN');
    renderPage();

    expect(await screen.findByText('Llamar a Laura')).toBeInTheDocument();
    expect(screen.queryByText('Tarea ya hecha')).not.toBeInTheDocument();
  });

  it('cada tarea abre la suya por enlace profundo', async () => {
    sesion('ADMIN');
    renderPage();

    expect(
      await screen.findByRole('link', { name: /^Llamar a Laura\./ }),
    ).toHaveAttribute('href', '/dashboard/tasks?abrir=t1');
  });

  it('enseña la prioridad en español', async () => {
    sesion('ADMIN');
    renderPage();

    expect(await screen.findByText('Alta')).toBeInTheDocument();
    expect(screen.queryByText('HIGH')).not.toBeInTheDocument();
  });
});

describe('Inicio — rendimiento por asesor', () => {
  it('con leads asignados enseña la tabla comparativa', async () => {
    sesion('ADMIN');
    renderPage();

    expect(await screen.findByText('Ana Restrepo')).toBeInTheDocument();
    // 4 ganadas sobre 5 cerradas.
    expect(screen.getByText('80 %')).toBeInTheDocument();
  });

  it('sin nada asignado da un estado honesto, no una tabla de ceros', async () => {
    sesion('ADMIN');
    getAgentPerformance.mockResolvedValue([
      { agentId: 'a1', agentName: 'Ana', openLeads: 0, wonCount: 0, wonValue: 0, lostCount: 0 },
      { agentId: 'a2', agentName: 'Luis', openLeads: 0, wonCount: 0, wonValue: 0, lostCount: 0 },
    ]);
    renderPage();

    expect(
      await screen.findByText('Ninguna oportunidad tiene responsable asignado.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Asignar desde el embudo' }),
    ).toHaveAttribute('href', '/dashboard/pipeline');
  });

  it('sin cierres dice «sin datos», no acusa a nadie de un 0 %', async () => {
    sesion('ADMIN');
    getAgentPerformance.mockResolvedValue([
      { agentId: 'a1', agentName: 'Ana', openLeads: 3, wonCount: 0, wonValue: 0, lostCount: 0 },
    ]);
    renderPage();

    expect(await screen.findByText('sin datos')).toBeInTheDocument();
  });
});

describe('Inicio — tendencia de ventas', () => {
  it('pide la serie con la ventana declarada', async () => {
    sesion('ADMIN');
    renderPage();

    await waitFor(() => expect(getSalesTrend).toHaveBeenCalledWith(30));
  });

  it('publica los mismos números en texto, no solo como dibujo', async () => {
    sesion('ADMIN');
    renderPage();

    const region = await screen.findByRole('region', { name: 'Tendencia de ventas' });
    // El panel existe desde el primer fotograma con su esqueleto: hay que
    // esperar a que llegue la serie, no solo a que exista la región.
    await waitFor(() => expect(region.querySelector('table')).not.toBeNull());
    expect(await screen.findByText(/^7 ·/)).toBeInTheDocument();
  });

  it('sin movimiento lo dice, en vez de dibujar una recta que parezca un dato', async () => {
    sesion('ADMIN');
    getSalesTrend.mockResolvedValue({
      days: 30,
      from: dia(-29),
      to: dia(0),
      points: serie([{}, {}]),
      totals: { openedCount: 0, openedValue: 0, wonCount: 0, wonValue: 0 },
      previous: { openedCount: 0, openedValue: 0, wonCount: 0, wonValue: 0 },
      wonWithoutDate: 0,
    });
    renderPage();

    expect(await screen.findByText(/Sin movimiento en los últimos 30 días/)).toBeInTheDocument();
  });

  it('avisa de las ventas que no se pueden fechar en vez de repartirlas', async () => {
    sesion('ADMIN');
    getSalesTrend.mockResolvedValue({
      days: 30,
      from: dia(-29),
      to: dia(0),
      points: serie([{ openedCount: 1, openedValue: 100 }, {}]),
      totals: { openedCount: 1, openedValue: 100, wonCount: 0, wonValue: 0 },
      previous: { openedCount: 0, openedValue: 0, wonCount: 0, wonValue: 0 },
      wonWithoutDate: 2,
    });
    renderPage();

    expect(
      await screen.findByText(/2 ventas no aparecen en la curva/),
    ).toBeInTheDocument();
  });
});

describe('Inicio — actividad reciente', () => {
  it('lee la auditoría de la empresa, no la bandeja personal de avisos', async () => {
    sesion('ADMIN');
    renderPage();

    await waitFor(() => expect(getRecentActivity).toHaveBeenCalledWith(8));
    expect(await screen.findByText('Contacto archivado')).toBeInTheDocument();
  });

  it('traduce el código de auditoría: nunca enseña la constante', async () => {
    sesion('ADMIN');
    getRecentActivity.mockResolvedValue([
      {
        id: 'al2',
        action: 'USE_INVITATION_CODE',
        entityType: 'InvitationCode',
        createdAt: new Date().toISOString(),
        actorName: null,
      },
    ]);
    renderPage();

    expect(await screen.findByText('Código de invitación usado')).toBeInTheDocument();
    expect(screen.queryByText('USE_INVITATION_CODE')).not.toBeInTheDocument();
  });

  it('una acción desconocida se enseña legible, no se esconde', async () => {
    sesion('ADMIN');
    getRecentActivity.mockResolvedValue([
      {
        id: 'al3',
        action: 'modulo.nuevo_evento',
        entityType: 'Cosa',
        createdAt: new Date().toISOString(),
        actorName: 'Luis',
      },
    ]);
    renderPage();

    expect(await screen.findByText('Modulo nuevo evento')).toBeInTheDocument();
  });

  it('un actor dado de baja se atribuye al sistema, no deja el hueco', async () => {
    sesion('ADMIN');
    getRecentActivity.mockResolvedValue([
      {
        id: 'al4',
        action: 'contact.archive',
        entityType: 'Contact',
        createdAt: new Date().toISOString(),
        actorName: null,
      },
    ]);
    renderPage();

    expect(await screen.findByText('Sistema')).toBeInTheDocument();
  });

  it('sin actividad lo dice', async () => {
    sesion('ADMIN');
    getRecentActivity.mockResolvedValue([]);
    renderPage();

    expect(
      await screen.findByText('Sin actividad registrada todavía.'),
    ).toBeInTheDocument();
  });
});

describe('Inicio — estados de carga y error', () => {
  it('mientras carga anuncia ocupado, sin texto de relleno por bloque', async () => {
    sesion('ADMIN');
    getTasks.mockReturnValue(new Promise(() => {}));
    renderPage();

    const agenda = screen.getByRole('region', { name: 'Agenda de hoy' });
    expect(agenda).toHaveAttribute('aria-busy', 'true');
    expect(agenda.textContent).not.toContain('Cargando');
  });

  it('un fallo real sí es un error anunciado', async () => {
    sesion('ADMIN');
    getTasks.mockRejectedValue(new Error('caída'));
    renderPage();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toBeInTheDocument();
  });

  it('al terminar la carga deja de anunciar ocupado', async () => {
    sesion('ADMIN');
    renderPage();

    const agenda = screen.getByRole('region', { name: 'Agenda de hoy' });
    await waitFor(() => expect(agenda).not.toHaveAttribute('aria-busy'));
  });
});

/** Una conversación de bandeja con la espera que se quiera, en minutos. */
function base(id: string, nombre: string, minutos: number) {
  return {
    id,
    status: 'OPEN',
    stage: null,
    isPaused: false,
    channel: 'whatsapp',
    lastMessageAt: new Date(Date.now() - minutos * 60_000).toISOString(),
    updatedAt: '2026-08-12T10:00:00.000Z',
    contact: { id: `c-${id}`, name: nombre },
    agent: null,
    unreadCount: 1,
    lastReadAt: null,
    messages: [{ id: `m-${id}`, body: 'hola' }],
  };
}
