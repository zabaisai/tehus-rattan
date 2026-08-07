import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuoteDetailModal } from './QuoteDetailModal';
import type { Quote } from '@/types';

/**
 * QUE LOS CAMPOS SE PUEDAN USAR DE VERDAD.
 *
 * El backend soportaba transporte, impuesto y ajuste; los DTO los rechazaban y
 * el formulario ni siquiera los pintaba. Estas pruebas comprueban las dos
 * mitades del arreglo: que los campos EXISTEN en pantalla y que lo que se
 * escribe LLEGA a la petición.
 */
const actualizar = vi.fn();

vi.mock('@/lib/quotes', async () => {
  const real = await vi.importActual<typeof import('@/lib/quotes')>(
    '@/lib/quotes',
  );
  return {
    ...real,
    getQuote: vi.fn(() => Promise.resolve(cotizacion)),
    updateQuote: (...args: unknown[]) => actualizar(...args),
    deleteQuote: vi.fn(),
  };
});

const cotizacion: Quote = {
  id: 'q1',
  number: 'COT-0001',
  title: 'Sala de ratán',
  status: 'DRAFT',
  subtotal: 500000,
  lineDiscountTotal: 0,
  discount: 0,
  shipping: 0,
  adjustment: 0,
  adjustmentLabel: null,
  taxRate: 0,
  taxTotal: 0,
  taxIncluded: false,
  currency: 'COP',
  roundingDecimals: 0,
  total: 500000,
  notes: null,
  validUntil: null,
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  leadId: 'l1',
  companyId: 'c1',
  createdById: null,
  lead: { id: 'l1', title: 'Cliente', status: 'OPEN' },
  items: [
    {
      id: 'it1',
      name: 'Silla de ratán',
      description: null,
      category: null,
      quantity: 2,
      unitPrice: 250000,
      lineDiscount: 0,
      lineDiscountPercent: null,
      subtotal: 500000,
      notes: null,
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      quoteId: 'q1',
      productId: 'p1',
    },
  ],
};

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QuoteDetailModal quoteId="q1" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('Cotización: campos económicos en el formulario', () => {
  beforeEach(() => {
    actualizar.mockReset();
    actualizar.mockResolvedValue(cotizacion);
  });

  it('el formulario ofrece transporte, IVA, ajuste y descuento por línea', async () => {
    const usuario = userEvent.setup();
    montar();

    await screen.findByText('Sala de ratán');
    await usuario.click(screen.getByRole('button', { name: /editar/i }));

    // Etiquetas accesibles: se buscan por su nombre, no por su posición.
    expect(screen.getByLabelText(/transporte/i)).toBeTruthy();
    expect(screen.getByLabelText(/iva \(%\)/i)).toBeTruthy();
    expect(screen.getByLabelText(/^ajuste$/i)).toBeTruthy();
    expect(screen.getByLabelText(/concepto del ajuste/i)).toBeTruthy();
    expect(screen.getByLabelText(/silla de ratán/i)).toBeTruthy();
  });

  it('lo que se escribe LLEGA a la petición', async () => {
    const usuario = userEvent.setup();
    montar();

    await screen.findByText('Sala de ratán');
    await usuario.click(screen.getByRole('button', { name: /editar/i }));

    await usuario.clear(screen.getByLabelText(/transporte/i));
    await usuario.type(screen.getByLabelText(/transporte/i), '50000');
    await usuario.clear(screen.getByLabelText(/iva \(%\)/i));
    await usuario.type(screen.getByLabelText(/iva \(%\)/i), '19');
    await usuario.clear(screen.getByLabelText(/^ajuste$/i));
    await usuario.type(screen.getByLabelText(/^ajuste$/i), '-5000');

    await usuario.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    const [, payload] = actualizar.mock.calls[0];
    expect(payload.shipping).toBe(50000);
    expect(payload.taxRate).toBe(19);
    // El ajuste NEGATIVO tiene que sobrevivir el viaje: es su razón de ser.
    expect(payload.adjustment).toBe(-5000);
  });

  it('solo se envían las líneas cuyo descuento cambió', async () => {
    const usuario = userEvent.setup();
    montar();

    await screen.findByText('Sala de ratán');
    await usuario.click(screen.getByRole('button', { name: /editar/i }));

    // Guardar sin tocar nada NO debe reescribir cada línea.
    await usuario.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    expect(actualizar.mock.calls[0][1].lineas).toBeUndefined();

    actualizar.mockClear();
    await usuario.click(screen.getByRole('button', { name: /editar/i }));
    await usuario.clear(screen.getByLabelText(/silla de ratán/i));
    await usuario.type(screen.getByLabelText(/silla de ratán/i), '100000');
    await usuario.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    expect(actualizar.mock.calls[0][1].lineas).toEqual([
      { id: 'it1', lineDiscount: 100000 },
    ]);
  });

  it('el error del servidor se muestra y no se pierde lo escrito', async () => {
    const usuario = userEvent.setup();
    actualizar.mockRejectedValue({
      response: { data: { message: 'El ajuste deja el total por debajo de cero.' } },
    });
    montar();

    await screen.findByText('Sala de ratán');
    await usuario.click(screen.getByRole('button', { name: /editar/i }));
    await usuario.clear(screen.getByLabelText(/^ajuste$/i));
    await usuario.type(screen.getByLabelText(/^ajuste$/i), '-999999');
    await usuario.click(screen.getByRole('button', { name: /guardar/i }));

    expect(
      await screen.findByText(/por debajo de cero/i),
    ).toBeTruthy();
    // Lo escrito sigue ahí: obligar a teclearlo otra vez tras un error es la
    // forma más rápida de que alguien abandone el formulario.
    expect(
      (screen.getByLabelText(/^ajuste$/i) as HTMLInputElement).value,
    ).toBe('-999999');
  });
});
