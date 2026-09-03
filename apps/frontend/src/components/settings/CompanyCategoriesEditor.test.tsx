import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { CompanyCategoriesEditor } from './CompanyCategoriesEditor';

const settings = {
  version: 1 as const,
  commercial: {
    sellsProducts: true,
    sellsServices: false,
    usesCatalog: true,
    usesQuotes: false,
    usesTasks: true,
  },
  catalog: { categories: ['Salas', 'Comedores'], allowFreeText: true as const },
  vertical: null,
  pipelineDefaults: null,
  limits: { categories: { maxLength: 60, maxCount: 3 } },
};

const getMyCompanySettings = vi.fn();
const updateMyCompanySettings = vi.fn();

vi.mock('@/lib/company-settings', async () => {
  const real = await vi.importActual<typeof import('@/lib/company-settings')>('@/lib/company-settings');
  return {
    ...real,
    getMyCompanySettings: () => getMyCompanySettings(),
    updateMyCompanySettings: (p: unknown) => updateMyCompanySettings(p),
    // El hook real llama a la función INTERNA del módulo, que el mock de
    // exportaciones no intercepta: se reconstruye aquí sobre el doble.
    useCompanySettings: () =>
      useQuery({
        queryKey: real.COMPANY_SETTINGS_QUERY_KEY,
        queryFn: () => getMyCompanySettings(),
      }),
  };
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CompanyCategoriesEditor />
    </QueryClientProvider>,
  );
}

describe('CompanyCategoriesEditor', () => {
  beforeEach(() => {
    getMyCompanySettings.mockReset().mockResolvedValue(settings);
    updateMyCompanySettings.mockReset().mockImplementation(async (p: { catalog: { categories: string[] } }) => ({
      ...settings,
      version: 2,
      catalog: { categories: p.catalog.categories, allowFreeText: true },
    }));
  });

  it('muestra las categorías guardadas de LA EMPRESA (settings v1 incluidos) y no una lista fija', async () => {
    montar();
    const lista = await screen.findByRole('list', { name: 'Categorías actuales' });
    expect(lista).toHaveTextContent('Salas');
    expect(lista).toHaveTextContent('Comedores');
    expect(lista).not.toHaveTextContent('Sillas');
    expect(screen.getByRole('button', { name: 'Guardar categorías' })).toBeDisabled();
  });

  it('agrega sin duplicados, quita, y guarda por PATCH solo cuando hay cambios', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText('Salas');

    const input = screen.getByRole('textbox', { name: 'Nueva categoría' });
    await user.type(input, ' salas {Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('ya está en la lista');

    await user.clear(input);
    await user.type(input, 'Dormitorios{Enter}');
    expect(screen.getByRole('list', { name: 'Categorías actuales' })).toHaveTextContent('Dormitorios');

    await user.click(screen.getByRole('button', { name: 'Quitar categoría Comedores' }));
    expect(screen.getByRole('list', { name: 'Categorías actuales' })).not.toHaveTextContent('Comedores');

    await user.click(screen.getByRole('button', { name: 'Guardar categorías' }));
    await waitFor(() => expect(updateMyCompanySettings).toHaveBeenCalledTimes(1));
    expect(updateMyCompanySettings).toHaveBeenCalledWith({
      catalog: { categories: ['Salas', 'Dormitorios'] },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Categorías guardadas.');
  });

  it('respeta el máximo de categorías que dicta el servidor', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText('Salas');
    const input = screen.getByRole('textbox', { name: 'Nueva categoría' });
    await user.type(input, 'Tres{Enter}');
    await user.type(input, 'Cuatro{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('máximo 3');
    expect(screen.getByRole('list', { name: 'Categorías actuales' })).not.toHaveTextContent('Cuatro');
  });
});
