import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductModal, type ProductFormData } from './ProductModal';
import type { Product } from '@/types';

const legacy = {
  id: 'p1',
  name: 'Sala Toscana',
  code: 'C-001',
  sku: 'SKU-1',
  category: 'Salas',
  price: 2450000,
  isActive: true,
  // Sin `itemType`: un producto anterior a la Fase 2 tal como lo tenía el
  // cliente en caché (el servidor nuevo siempre lo manda).
} as Product;

describe('ProductModal — tipo de elemento', () => {
  it('al crear propone Producto por defecto, sin aviso', () => {
    render(<ProductModal product={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Nuevo elemento del catálogo');
    expect(screen.getByRole('radio', { name: 'Producto' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Servicio' })).not.toBeChecked();
    expect(screen.queryByText(/se propone «Servicio»/)).not.toBeInTheDocument();
  });

  it('si la empresa vende solo servicios, propone Servicio y lo dice; el usuario puede cambiarlo', async () => {
    const user = userEvent.setup();
    render(
      <ProductModal
        product={null}
        suggestedItemType="SERVICE"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Servicio' })).toBeChecked();
    expect(screen.getByText(/se propone «Servicio»/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Producto' }));
    expect(screen.getByRole('radio', { name: 'Producto' })).toBeChecked();
  });

  it('envía el tipo elegido junto con el resto del formulario', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: ProductFormData) => Promise<void>>(async () => undefined);
    render(<ProductModal product={null} onClose={vi.fn()} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('radio', { name: 'Servicio' }));
    await user.type(screen.getByLabelText(/Nombre/), 'Instalación');
    await user.type(screen.getByLabelText(/Precio base/), '80000');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      itemType: 'SERVICE',
      name: 'Instalación',
      price: '80000',
    });
  });

  it('un producto anterior sin tipo se edita como Producto y el título lo dice', () => {
    render(<ProductModal product={legacy} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Editar producto');
    expect(screen.getByRole('radio', { name: 'Producto' })).toBeChecked();
    expect(screen.getByText(/no borra el precio, el stock ni el SKU/)).toBeInTheDocument();
  });

  it('un servicio existente se edita como Servicio', () => {
    render(
      <ProductModal
        product={{ ...legacy, id: 'p2', name: 'Consulta', itemType: 'SERVICE' }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Editar servicio');
    expect(screen.getByRole('radio', { name: 'Servicio' })).toBeChecked();
  });
});
