import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WhatsAppNumbers } from './WhatsAppNumbers';
import type { NumeroWhatsApp } from '@/lib/whatsapp';

const getWhatsAppNumbers = vi.fn();
const renameWhatsAppNumber = vi.fn();
const setPrimaryWhatsAppNumber = vi.fn();

vi.mock('@/lib/whatsapp', async () => {
  const real = await vi.importActual<typeof import('@/lib/whatsapp')>(
    '@/lib/whatsapp',
  );
  return {
    ...real,
    getWhatsAppNumbers: () => getWhatsAppNumbers(),
    renameWhatsAppNumber: (id: string, l: string | null) =>
      renameWhatsAppNumber(id, l),
    setPrimaryWhatsAppNumber: (id: string) => setPrimaryWhatsAppNumber(id),
  };
});

function numero(overrides: Partial<NumeroWhatsApp> = {}): NumeroWhatsApp {
  return {
    id: 'n1',
    phoneNumberId: '1234567890123456',
    displayPhoneNumber: '+573001112233',
    label: null,
    isPrimary: false,
    order: 0,
    status: 'CONNECTED',
    connectedAt: null,
    lastErrorCode: null,
    ...overrides,
  };
}

function renderNumeros() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WhatsAppNumbers />
    </QueryClientProvider>,
  );
}

describe('WhatsAppNumbers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('con un solo número no dibuja nada: la lista no informaría', async () => {
    getWhatsAppNumbers.mockResolvedValue([numero({ isPrimary: true })]);
    const { container } = renderNumeros();

    await waitFor(() => expect(getWhatsAppNumbers).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('con dos números aparece y marca cuál es el principal', async () => {
    getWhatsAppNumbers.mockResolvedValue([
      numero({ id: 'n1', label: 'Ventas', isPrimary: true }),
      numero({ id: 'n2', label: 'Soporte', displayPhoneNumber: '+573004445566' }),
    ]);
    renderNumeros();

    expect(await screen.findByText('Ventas')).toBeInTheDocument();
    expect(screen.getByText('Soporte')).toBeInTheDocument();
    expect(screen.getByText('Principal')).toBeInTheDocument();
  });

  it('explica que se responde por donde entró, no siempre desde el principal', async () => {
    getWhatsAppNumbers.mockResolvedValue([numero(), numero({ id: 'n2' })]);
    renderNumeros();

    expect(
      await screen.findByText(/se responde desde el número por el que entró/i),
    ).toBeInTheDocument();
  });

  it('sin etiqueta enseña el número, nunca el phoneNumberId interno', async () => {
    getWhatsAppNumbers.mockResolvedValue([
      numero({ id: 'n1', isPrimary: true }),
      numero({ id: 'n2', displayPhoneNumber: '+573004445566' }),
    ]);
    renderNumeros();

    expect(await screen.findByText('+573001112233')).toBeInTheDocument();
    expect(screen.queryByText('1234567890123456')).not.toBeInTheDocument();
  });

  it('el principal no ofrece "hacer principal"', async () => {
    getWhatsAppNumbers.mockResolvedValue([
      numero({ id: 'n1', label: 'Ventas', isPrimary: true }),
      numero({ id: 'n2', label: 'Soporte' }),
    ]);
    renderNumeros();

    await screen.findByText('Ventas');
    expect(
      screen.getAllByRole('button', { name: 'Hacer principal' }),
    ).toHaveLength(1);
  });

  it('un número sin conexión no puede hacerse principal', async () => {
    getWhatsAppNumbers.mockResolvedValue([
      numero({ id: 'n1', label: 'Ventas', isPrimary: true }),
      numero({ id: 'n2', label: 'Viejo', status: 'DISCONNECTED' }),
    ]);
    renderNumeros();

    const boton = await screen.findByRole('button', { name: 'Hacer principal' });
    expect(boton).toBeDisabled();
    expect(screen.getByText('Sin conexión')).toBeInTheDocument();
  });

  it('cambia el principal', async () => {
    getWhatsAppNumbers.mockResolvedValue([
      numero({ id: 'n1', label: 'Ventas', isPrimary: true }),
      numero({ id: 'n2', label: 'Soporte' }),
    ]);
    setPrimaryWhatsAppNumber.mockResolvedValue(numero({ id: 'n2' }));
    const user = userEvent.setup();
    renderNumeros();

    await user.click(
      await screen.findByRole('button', { name: 'Hacer principal' }),
    );

    await waitFor(() =>
      expect(setPrimaryWhatsAppNumber).toHaveBeenCalledWith('n2'),
    );
  });

  it('renombra, y una etiqueta vacía se manda como null para borrarla', async () => {
    getWhatsAppNumbers.mockResolvedValue([
      numero({ id: 'n1', label: 'Ventas', isPrimary: true }),
      numero({
        id: 'n2',
        label: 'Soporte',
        displayPhoneNumber: '+573004445566',
      }),
    ]);
    renameWhatsAppNumber.mockResolvedValue(numero({ id: 'n2' }));
    const user = userEvent.setup();
    renderNumeros();

    await user.click(
      await screen.findByRole('button', { name: /Renombrar \+573001112233/i }),
    );
    const campo = screen.getByLabelText(/Nombre de \+573001112233/i);
    await user.clear(campo);
    await user.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() =>
      expect(renameWhatsAppNumber).toHaveBeenCalledWith('n1', null),
    );
  });

  it('muestra el motivo del servidor cuando rechaza el cambio', async () => {
    getWhatsAppNumbers.mockResolvedValue([
      numero({ id: 'n1', label: 'Ventas', isPrimary: true }),
      numero({ id: 'n2', label: 'Soporte' }),
    ]);
    setPrimaryWhatsAppNumber.mockRejectedValue({
      response: {
        data: {
          message:
            'Solo un número conectado puede ser el principal: desde uno desconectado no se puede enviar.',
        },
      },
    });
    const user = userEvent.setup();
    renderNumeros();

    await user.click(
      await screen.findByRole('button', { name: 'Hacer principal' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Solo un número conectado/i,
    );
  });

  it('un fallo de carga se ve como error, no como "no hay números"', async () => {
    getWhatsAppNumbers.mockRejectedValue(new Error('boom'));
    renderNumeros();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
