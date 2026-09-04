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

describe('ProductModal — lo que la empresa puede crear (Fase 4)', () => {
  it('solo servicios: titula «Nuevo servicio», no pregunta el tipo y manda SERVICE', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: ProductFormData) => Promise<void>>(async () => undefined);
    render(
      <ProductModal product={null} allowedItemTypes={['SERVICE']} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Nuevo servicio');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre/)).toHaveAttribute('placeholder', 'Nombre del servicio');

    await user.type(screen.getByLabelText(/Nombre/), 'Vacunación');
    await user.type(screen.getByLabelText(/Precio base/), '60000');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ itemType: 'SERVICE', name: 'Vacunación' });
  });

  it('solo productos: titula «Nuevo producto» y manda PRODUCT sin preguntar', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: ProductFormData) => Promise<void>>(async () => undefined);
    render(
      <ProductModal product={null} allowedItemTypes={['PRODUCT']} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Nuevo producto');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Nombre/), 'Collar');
    await user.type(screen.getByLabelText(/Precio base/), '100');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ itemType: 'PRODUCT' });
  });

  it('ambos tipos con Servicio por defecto: propone Servicio y deja cambiar', () => {
    render(
      <ProductModal
        product={null}
        allowedItemTypes={['PRODUCT', 'SERVICE']}
        defaultItemType="SERVICE"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Nuevo elemento del catálogo');
    expect(screen.getByRole('radio', { name: 'Servicio' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Producto' })).toBeInTheDocument();
  });

  it('un producto heredado en una empresa de solo servicios: tipo como texto, y NO viaja al guardar', async () => {
    // No se cambia el tipo a escondidas ni se manda para que el servidor lo
    // rechace: el elemento se conserva tal cual y se edita lo demás.
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: ProductFormData) => Promise<void>>(async () => undefined);
    render(
      <ProductModal product={legacy} allowedItemTypes={['SERVICE']} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Editar producto');
    const tipo = screen.getByTestId('tipo-heredado');
    expect(tipo).toHaveTextContent('Producto');
    expect(tipo).toHaveTextContent('Heredado');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('itemType');
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: 'Sala Toscana' });
  });

  it('editar un servicio en una empresa de solo servicios: sin selector, sin «heredado», y el tipo no viaja', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: ProductFormData) => Promise<void>>(async () => undefined);
    render(
      <ProductModal
        product={{ ...legacy, id: 'p2', name: 'Consulta', itemType: 'SERVICE' }}
        allowedItemTypes={['SERVICE']}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tipo-heredado')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('itemType');
  });

  it('un 400 del servidor se muestra con su motivo, no como «ocurrió un error»', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: ProductFormData) => Promise<void>>(async () => {
      throw {
        response: {
          status: 400,
          data: {
            message:
              'Esta empresa vende solo servicios: el catálogo no admite productos. Cambia la forma de vender en Configuración si necesitas ambos.',
          },
        },
      };
    });
    render(<ProductModal product={null} onClose={vi.fn()} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/Nombre/), 'Collar');
    await user.type(screen.getByLabelText(/Precio base/), '100');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/vende solo servicios/);
    expect(alerta).toHaveAttribute('id');
  });

  it('un módulo desactivado (403 MODULE_DISABLED) lo dice en español y apunta a Configuración', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: ProductFormData) => Promise<void>>(async () => {
      throw { response: { status: 403, data: { code: 'MODULE_DISABLED', module: 'catalog', message: 'x' } } };
    });
    render(<ProductModal product={null} onClose={vi.fn()} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/Nombre/), 'Collar');
    await user.type(screen.getByLabelText(/Precio base/), '100');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/catálogo está desactivado/);
  });

  it('la ayuda de la descripción es neutra: no presupone material ni medidas', () => {
    render(<ProductModal product={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const descripcion = screen.getByLabelText(/Descripción/);
    expect(descripcion.getAttribute('placeholder')).not.toMatch(/material|medidas|mueble/i);
    expect(screen.getByText(/Opcional\. Lo que ayuda a entender/)).toBeInTheDocument();
  });
});
