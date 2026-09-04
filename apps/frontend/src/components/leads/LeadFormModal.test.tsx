import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LeadFormModal } from './LeadFormModal';
import type { PipelineStage } from '@/types';

const getContacts = vi.fn();
const createLead = vi.fn();

vi.mock('@/lib/contacts', async () => {
  const real = await vi.importActual<typeof import('@/lib/contacts')>('@/lib/contacts');
  return { ...real, getContacts: () => getContacts() };
});
vi.mock('@/lib/users', async () => {
  const real = await vi.importActual<typeof import('@/lib/users')>('@/lib/users');
  return { ...real, getCompanyUsers: vi.fn(async () => []) };
});
vi.mock('@/lib/leads', async () => {
  const real = await vi.importActual<typeof import('@/lib/leads')>('@/lib/leads');
  return { ...real, createLead: (p: unknown) => createLead(p) };
});

const etapas: PipelineStage[] = [
  { id: 's1', name: 'Nuevo', order: 0, color: null, isInitial: true },
  { id: 's2', name: 'Cotizado', order: 1, color: null },
];

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LeadFormModal pipelineId="p1" stages={etapas} onClose={vi.fn()} onCreated={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('LeadFormModal — nueva oportunidad', () => {
  beforeEach(() => {
    getContacts.mockReset().mockResolvedValue([
      { id: 'c1', name: 'Laura Pérez', phone: '+57300' },
      { id: 'c2', name: '', phone: '+57301' },
    ]);
    createLead.mockReset().mockResolvedValue({ id: 'l1' });
  });

  it('el ejemplo del título es neutro y no habla del sector de una empresa concreta', async () => {
    montar();
    const titulo = screen.getByLabelText(/Título/);
    expect(titulo).toHaveAttribute('placeholder', 'Describe la oportunidad');
    expect(titulo.getAttribute('placeholder')).not.toMatch(/mueble|rattan/i);
    // La etapa de entrada va preseleccionada.
    expect(await screen.findByRole('option', { name: 'Laura Pérez' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Etapa/)).toHaveValue('s1');
  });

  it('al elegir un contacto, el ejemplo se arma con su nombre (o su teléfono)', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('option', { name: 'Laura Pérez' });

    await user.selectOptions(screen.getByLabelText(/Contacto/), 'c1');
    expect(screen.getByLabelText(/Título/)).toHaveAttribute(
      'placeholder',
      'Ej.: Propuesta para Laura Pérez',
    );

    await user.selectOptions(screen.getByLabelText(/Contacto/), 'c2');
    expect(screen.getByLabelText(/Título/)).toHaveAttribute(
      'placeholder',
      'Ej.: Propuesta para +57301',
    );
  });

  it('envía título, contacto, embudo y etapa', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('option', { name: 'Laura Pérez' });

    await user.type(screen.getByLabelText(/Título/), 'Plan anual');
    await user.selectOptions(screen.getByLabelText(/Contacto/), 'c1');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Plan anual',
        contactId: 'c1',
        pipelineId: 'p1',
        stageId: 's1',
      }),
    );
  });

  it('el motivo del servidor llega a la pantalla como alerta', async () => {
    createLead.mockRejectedValue({
      response: { data: { message: 'El contacto ya tiene una oportunidad abierta' } },
    });
    const user = userEvent.setup();
    montar();
    await screen.findByRole('option', { name: 'Laura Pérez' });

    await user.type(screen.getByLabelText(/Título/), 'Plan anual');
    await user.selectOptions(screen.getByLabelText(/Contacto/), 'c1');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya tiene una oportunidad/);
  });
});
