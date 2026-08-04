import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Conversation } from '@/types';
import { PanelContacto } from './PanelContacto';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
const ejecuciones = vi.fn();

vi.mock('@/lib/axios', () => ({
  default: {
    // Se reenvían los argumentos TAL CUAL: envolverlos con parámetros
    // opcionales añade un `undefined` que no existía y hace fallar las
    // comprobaciones por algo que el código nunca envió.
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

vi.mock('@/lib/flowbots', async () => {
  const real =
    await vi.importActual<typeof import('@/lib/flowbots')>('@/lib/flowbots');
  return {
    ...real,
    flowbots: { ...real.flowbots, ejecuciones: (f: unknown) => ejecuciones(f) },
  };
});

vi.mock('@/lib/users', () => ({ getCompanyUsers: () => Promise.resolve([]) }));
vi.mock('@/lib/conversations', () => ({
  resumeConversation: vi.fn().mockResolvedValue({}),
}));

const conversacion = {
  id: 'cv1',
  status: 'OPEN',
  stage: null,
  isPaused: false,
  channel: 'whatsapp',
  lastMessageAt: null,
  updatedAt: '2026-08-01T10:00:00.000Z',
  contact: {
    id: 'ct1',
    name: 'Ana Pérez',
    phone: '+573000000000',
    email: null,
    tags: [],
    isBlocked: false,
    createdAt: '2026-07-01T10:00:00.000Z',
  },
  agent: null,
  lead: null,
} as unknown as Conversation;

function contactoRespuesta(extra: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'ct1',
      name: 'Ana Pérez',
      phone: '+573000000000',
      email: 'ana@ejemplo.com',
      tags: ['cliente'],
      isBlocked: false,
      archivedAt: null,
      archivedReason: null,
      ...extra,
    },
  };
}

function pintar(conv: Conversation = conversacion) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelContacto conversation={conv} onCerrar={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('Ficha del contacto en la conversación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation((url: string) =>
      url.startsWith('/contacts')
        ? Promise.resolve(contactoRespuesta())
        : Promise.resolve({ data: [] }),
    );
    ejecuciones.mockResolvedValue({ items: [], siguienteCursor: null });
  });

  it('enseña los datos del contacto sin salir del chat', async () => {
    pintar();
    expect(await screen.findByText('ana@ejemplo.com')).toBeInTheDocument();
    expect(screen.getByText('cliente')).toBeInTheDocument();
  });

  it('avisa de que el bot está esperando antes de que alguien escriba encima', async () => {
    // Contestar encima de un bot que espera respuesta deja al cliente con dos
    // interlocutores a la vez.
    ejecuciones.mockResolvedValue({
      items: [
        {
          id: 'ex1',
          estado: 'WAITING_INPUT',
          botNombre: 'Primer contacto',
          hayHandoff: false,
        },
      ],
      siguienteCursor: null,
    });
    pintar();

    expect(
      await screen.findByText(/El bot está esperando/),
    ).toBeInTheDocument();
  });

  it('«archivar» EXPLICA que no se borra nada', async () => {
    pintar();
    await screen.findByText('ana@ejemplo.com');

    await userEvent.click(
      screen.getByRole('button', { name: 'Acciones del contacto' }),
    );
    await userEvent.click(
      screen.getByRole('menuitem', { name: /Archivar el contacto/ }),
    );

    // La palabra «eliminar» hace pensar que se destruye todo. Aquí no se
    // destruye nada, y el producto tiene que decirlo con esas palabras.
    expect(screen.getByText(/No se borra nada/)).toBeInTheDocument();
    expect(
      screen.getByText(/se conservan/),
    ).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
  });

  it('archivar manda el motivo y NO borra', async () => {
    del.mockResolvedValue({ data: { archivado: true } });
    pintar();
    await screen.findByText('ana@ejemplo.com');

    await userEvent.click(
      screen.getByRole('button', { name: 'Acciones del contacto' }),
    );
    await userEvent.click(
      screen.getByRole('menuitem', { name: /Archivar el contacto/ }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'ya no es cliente');
    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));

    expect(del).toHaveBeenCalledWith('/contacts/ct1', {
      data: { motivo: 'ya no es cliente' },
    });
  });

  it('un contacto archivado se ve archivado y se puede restaurar', async () => {
    get.mockImplementation((url: string) =>
      url.startsWith('/contacts')
        ? Promise.resolve(
            contactoRespuesta({
              archivedAt: '2026-08-01T10:00:00.000Z',
              archivedReason: 'pidió que no le escribiéramos',
            }),
          )
        : Promise.resolve({ data: [] }),
    );
    post.mockResolvedValue({ data: { restaurado: true } });
    pintar();

    expect(
      await screen.findByText(/Contacto archivado/),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Acciones del contacto' }),
    );
    await userEvent.click(
      screen.getByRole('menuitem', { name: /Restaurar el contacto/ }),
    );

    expect(post).toHaveBeenCalledWith('/contacts/ct1/restore');
  });

  it('solo ofrece devolver al bot si la conversación está pausada', async () => {
    pintar();
    await screen.findByText('ana@ejemplo.com');
    await userEvent.click(
      screen.getByRole('button', { name: 'Acciones del contacto' }),
    );
    expect(screen.queryByRole('menuitem', { name: /Devolver al bot/ })).toBeNull();
  });

  it('enseña los campos personalizados que tenga la empresa', async () => {
    get.mockImplementation((url: string) =>
      url.startsWith('/contacts')
        ? Promise.resolve(contactoRespuesta())
        : Promise.resolve({
            data: [{ key: 'ciudad', label: 'Ciudad', value: 'Bogotá' }],
          }),
    );
    pintar();

    expect(await screen.findByText('Ciudad')).toBeInTheDocument();
    expect(screen.getByText('Bogotá')).toBeInTheDocument();
  });

  it('un fallo al archivar se dice', async () => {
    del.mockRejectedValue(new Error('no se pudo'));
    pintar();
    await screen.findByText('ana@ejemplo.com');

    await userEvent.click(
      screen.getByRole('button', { name: 'Acciones del contacto' }),
    );
    await userEvent.click(
      screen.getByRole('menuitem', { name: /Archivar el contacto/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
