import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductImportModal } from './ProductImportModal';
import type { CatalogItemType } from '@/lib/tenant-configuration';
import { capacidadesDeCatalogo } from '@/lib/__fixtures__/catalogo.fixture';

let tipos: CatalogItemType[] = ['PRODUCT', 'SERVICE'];
vi.mock('@/lib/tenant-capabilities', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-capabilities')>('@/lib/tenant-capabilities');
  return { ...real, useTenantCapabilities: () => capacidadesDeCatalogo(tipos) };
});

const subirImportacion = vi.fn();
const vistaPreviaDeImportacion = vi.fn();
const fijarMapeoDeImportacion = vi.fn();
const arrancarImportacion = vi.fn();
const llamadas: string[] = [];

vi.mock('@/lib/products', async () => {
  const real = await vi.importActual<typeof import('@/lib/products')>('@/lib/products');
  return {
    ...real,
    getLimitesDeImportacion: vi.fn(async () => ({
      formatos: ['.xlsx', '.csv'],
      tamañoMaximoMb: 50,
      filasMaximas: 100000,
      subidaMaximaMb: 50,
      limitadoPorElProxy: false,
    })),
    subirImportacion: (f: File) => subirImportacion(f),
    vistaPreviaDeImportacion: (id: string) => vistaPreviaDeImportacion(id),
    fijarMapeoDeImportacion: (id: string, m: unknown) => {
      llamadas.push('mapeo');
      return fijarMapeoDeImportacion(id, m);
    },
    arrancarImportacion: (id: string) => {
      llamadas.push('arrancar');
      return arrancarImportacion(id);
    },
    estadoDeImportacion: vi.fn(async () => ({ status: 'RUNNING', porcentaje: 10 })),
  };
});

const importacion = {
  id: 'imp-1',
  status: 'PENDING',
  fileName: 'catalogo.csv',
  fileSize: 100,
  totalRows: 2,
  processedRows: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  errorMessage: null,
  createdAt: '',
  finishedAt: null,
};

const previa = {
  cabeceras: ['Nombre', 'Precio', 'Tipo', 'Producto o servicio'],
  filas: [['Silla', '100', 'Salas', 'Producto']],
  mapeoPropuesto: {
    campos: { name: 0, price: 1, category: 2, itemType: 3 },
    sinAsignar: [],
  },
  camposReconocidos: ['name', 'price', 'category', 'itemType'],
  camposDisponibles: ['name', 'sku', 'code', 'price', 'category', 'stock', 'description', 'itemType'],
};

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProductImportModal onClose={vi.fn()} onFinished={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function subirArchivo(user: ReturnType<typeof userEvent.setup>) {
  const archivo = new File(['Nombre,Precio\nSilla,100'], 'catalogo.csv', { type: 'text/csv' });
  await user.upload(screen.getByLabelText('Archivo del catálogo'), archivo);
  await user.click(screen.getByRole('button', { name: /Subir y revisar/ }));
  await screen.findByText(/Así se leyó el archivo/);
}

describe('ProductImportModal — mapeo y tipo de elemento', () => {
  beforeEach(() => {
    tipos = ['PRODUCT', 'SERVICE'];
    llamadas.length = 0;
    subirImportacion.mockReset().mockResolvedValue(importacion);
    vistaPreviaDeImportacion.mockReset().mockResolvedValue(previa);
    fijarMapeoDeImportacion.mockReset().mockResolvedValue(importacion);
    arrancarImportacion.mockReset().mockResolvedValue({ encolada: true });
  });

  it('la vista previa muestra etiquetas legibles por columna y reconoce «Tipo de elemento»', async () => {
    const user = userEvent.setup();
    montar();
    await subirArchivo(user);

    expect(screen.getByLabelText('Campo para la columna Nombre')).toHaveValue('name');
    expect(screen.getByLabelText('Campo para la columna Tipo')).toHaveValue('category');
    const tipo = screen.getByLabelText('Campo para la columna Producto o servicio');
    expect(tipo).toHaveValue('itemType');
    expect(tipo).toHaveDisplayValue('Tipo de elemento');
    expect(screen.getByTestId('nota-tipo')).toHaveTextContent(
      'La columna Producto o servicio indica el tipo de elemento',
    );
  });

  it('sin columna de tipo explica que todo se importa como Producto y permite asignarla', async () => {
    vistaPreviaDeImportacion.mockResolvedValue({
      ...previa,
      cabeceras: ['Nombre', 'Precio', 'Clase'],
      filas: [['Silla', '100', 'Servicio']],
      mapeoPropuesto: {
        campos: { name: 0, price: 1 },
        sinAsignar: [{ indice: 2, cabecera: 'Clase' }],
      },
      camposReconocidos: ['name', 'price'],
    });
    const user = userEvent.setup();
    montar();
    await subirArchivo(user);

    expect(screen.getByTestId('nota-tipo')).toHaveTextContent('todo se importa como Producto');
    expect(screen.getByText(/Estas columnas no se importarán/)).toHaveTextContent('Clase');

    await user.selectOptions(screen.getByLabelText('Campo para la columna Clase'), 'itemType');
    expect(screen.getByTestId('nota-tipo')).toHaveTextContent('La columna Clase indica el tipo de elemento');
    expect(screen.queryByText(/Estas columnas no se importarán/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Empezar la importación/ }));
    await waitFor(() => expect(arrancarImportacion).toHaveBeenCalledTimes(1));
    expect(fijarMapeoDeImportacion).toHaveBeenCalledWith('imp-1', {
      campos: { name: 0, price: 1, itemType: 2 },
      sinAsignar: [],
    });
    // El mapeo se fija ANTES de arrancar.
    expect(llamadas).toEqual(['mapeo', 'arrancar']);
  });

  it('una columna alimenta un solo campo: reasignar mueve el campo y libera la anterior', async () => {
    const user = userEvent.setup();
    montar();
    await subirArchivo(user);

    // "Tipo" pasa de categoría a tipo de elemento: la columna 3 queda libre.
    await user.selectOptions(screen.getByLabelText('Campo para la columna Tipo'), 'itemType');
    expect(screen.getByLabelText('Campo para la columna Tipo')).toHaveValue('itemType');
    expect(screen.getByLabelText('Campo para la columna Producto o servicio')).toHaveValue('');
    expect(screen.getByText(/Estas columnas no se importarán/)).toHaveTextContent('Producto o servicio');
  });

  it('en una empresa de solo servicios, avisa de que las filas de otro tipo fallarán', async () => {
    // El servidor aplica la misma regla fila a fila; decirlo antes evita
    // arrancar una importación que termina con la mitad en el reporte.
    tipos = ['SERVICE'];
    const user = userEvent.setup();
    montar();
    await subirArchivo(user);

    const nota = screen.getByTestId('nota-tipo');
    expect(nota).toHaveTextContent('Esta empresa solo crea servicios');
    expect(nota).toHaveTextContent('se reportan como fallidas');

    // Sin la columna, todo toma el tipo por defecto de la empresa: Servicio.
    await user.selectOptions(screen.getByLabelText('Campo para la columna Producto o servicio'), '');
    expect(screen.getByTestId('nota-tipo')).toHaveTextContent('todo se importa como Servicio');
  });

  it('si el servidor rechaza el mapeo, lo muestra y no arranca', async () => {
    fijarMapeoDeImportacion.mockRejectedValue({
      response: { data: { message: 'Hace falta una columna de nombre, código o SKU' } },
    });
    const user = userEvent.setup();
    montar();
    await subirArchivo(user);
    await user.click(screen.getByRole('button', { name: /Empezar la importación/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Hace falta una columna');
    expect(arrancarImportacion).not.toHaveBeenCalled();
  });
});
