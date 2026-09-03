import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OnboardingPage from './page';
import { TEMPLATES_FIXTURE } from '@/lib/__fixtures__/onboarding-templates.fixture';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const getOnboardingTemplates = vi.fn();
vi.mock('@/lib/onboarding-templates', async () => {
  const real = await vi.importActual<typeof import('@/lib/onboarding-templates')>(
    '@/lib/onboarding-templates',
  );
  return { ...real, getOnboardingTemplates: () => getOnboardingTemplates() };
});

const createCompanyOnboarding = vi.fn();
vi.mock('@/lib/onboarding', async () => {
  const real = await vi.importActual<typeof import('@/lib/onboarding')>('@/lib/onboarding');
  return {
    ...real,
    createCompanyOnboarding: (...args: unknown[]) => createCompanyOnboarding(...args),
  };
});

vi.mock('@/lib/auth', () => ({ getMe: vi.fn() }));

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OnboardingPage />
    </QueryClientProvider>,
  );
}

async function avanzar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
}

/** Código + datos de empresa: llega al paso de industria. */
async function llegarAIndustria(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Código de invitación'), 'TAKTO-AAAA-BBBB-CCCC-DDDD');
  await avanzar(user);
  await user.type(screen.getByLabelText(/Nombre comercial/), 'QA_PHASE1_Empresa');
  await avanzar(user);
  await screen.findByRole('combobox', { name: /Industria/ });
}

describe('Asistente de onboarding (Fase 1)', () => {
  beforeEach(() => {
    getOnboardingTemplates.mockReset().mockResolvedValue(TEMPLATES_FIXTURE);
    createCompanyOnboarding.mockReset();
  });

  it('cambiar la industria actualiza los tipos de negocio y siempre existe «Otro / Configurar manualmente»', async () => {
    const user = userEvent.setup();
    montar();
    await llegarAIndustria(user);

    expect(screen.getByRole('radio', { name: /Venta de productos/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Otro \/ Configurar manualmente/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: /Industria/ }), 'veterinary_pet');
    expect(screen.getByRole('radio', { name: /Grooming/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Venta de productos/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Otro \/ Configurar manualmente/ })).toBeInTheDocument();
  });

  it('no deja avanzar sin tipo de negocio y avisa junto al paso', async () => {
    const user = userEvent.setup();
    montar();
    await llegarAIndustria(user);

    await avanzar(user);
    expect(screen.getByRole('alert')).toHaveTextContent(/tipo de negocio/);
  });

  it('un negocio sin catálogo omite el paso de categorías y no envía ninguna', async () => {
    const user = userEvent.setup();
    montar();
    await llegarAIndustria(user);
    await user.click(screen.getByRole('radio', { name: /Venta de servicios/ }));
    await avanzar(user);

    // Módulos sugeridos por la plantilla de servicios: sin catálogo.
    expect(screen.getByRole('checkbox', { name: /Catálogo/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Cotizaciones/ })).toBeChecked();
    await avanzar(user);

    // Salta directamente al pipeline.
    expect(screen.getByRole('heading', { name: 'Pipeline inicial' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Categorías del catálogo' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre de la etapa 2')).toHaveValue('Propuesta');
  });

  it('con catálogo muestra las categorías de LA PLANTILLA elegida, nunca las de muebles para otra industria', async () => {
    const user = userEvent.setup();
    montar();
    await llegarAIndustria(user);
    await user.selectOptions(screen.getByRole('combobox', { name: /Industria/ }), 'veterinary_pet');
    await user.click(screen.getByRole('radio', { name: /Grooming/ }));
    await avanzar(user); // módulos
    await avanzar(user); // categorías

    expect(screen.getByRole('heading', { name: 'Categorías del catálogo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grooming', pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salas' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Comedores/)).not.toBeInTheDocument();
  });

  it('pide confirmación antes de reemplazar personalizaciones al cambiar de plantilla, y «Restaurar sugerencias» vuelve a la plantilla', async () => {
    const user = userEvent.setup();
    montar();
    await llegarAIndustria(user);
    await user.selectOptions(screen.getByRole('combobox', { name: /Industria/ }), 'furniture_decor');
    await user.click(screen.getByRole('radio', { name: /Tienda \/ showroom/ }));
    await avanzar(user); // módulos
    await avanzar(user); // categorías

    // Personaliza: agrega una categoría propia.
    await user.type(screen.getByLabelText('Categoría personalizada'), 'Terrazas{Enter}');
    expect(screen.getByText('Editado')).toBeInTheDocument();

    // Vuelve atrás y cambia de tipo: debe preguntar, no pisar en silencio.
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    await user.click(screen.getByRole('radio', { name: /Otro \/ Configurar manualmente/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent('¿Reemplazar tus cambios?');

    // Conservar: cancela → mantiene la personalización, aplica el tipo nuevo.
    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('radio', { name: /Otro \/ Configurar manualmente/ })).toBeChecked();
    // «Otro» no trae catálogo, pero los módulos no estaban editados: se
    // actualizan. Las categorías (editadas) se conservan.
    await user.click(screen.getByRole('radio', { name: /Tienda \/ showroom/ }));
    const dialogo2 = await screen.findByRole('dialog');
    await user.click(within(dialogo2).getByRole('button', { name: 'Aplicar sugerencias' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await avanzar(user); // módulos
    await avanzar(user); // categorías
    expect(screen.getByText('Sugerido')).toBeInTheDocument();
    expect(screen.queryByText('Terrazas')).not.toBeInTheDocument();

    // Edita otra vez y restaura.
    await user.click(screen.getByRole('button', { name: 'Salas', pressed: true }));
    expect(screen.getByText('Editado')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Restaurar sugerencias/ }));
    expect(screen.getByRole('button', { name: 'Salas', pressed: true })).toBeInTheDocument();
    expect(screen.getByText('Sugerido')).toBeInTheDocument();
  });

  it('valida el pipeline tipado antes de avanzar (exactamente un cierre ganado)', async () => {
    const user = userEvent.setup();
    montar();
    await llegarAIndustria(user);
    await user.click(screen.getByRole('radio', { name: /Venta de servicios/ }));
    await avanzar(user); // módulos
    await avanzar(user); // pipeline

    await user.selectOptions(screen.getByLabelText('Tipo de la etapa 2'), 'WON');
    await avanzar(user);
    expect(screen.getByRole('alert')).toHaveTextContent(/exactamente una etapa de cierre ganado/);
  });

  it('conserva la información al ir atrás y adelante, muestra el resumen y envía el contrato v2 sin colores por defecto', async () => {
    const user = userEvent.setup();
    createCompanyOnboarding.mockResolvedValue({
      message: 'ok',
      company: { id: 'c1', name: 'QA_PHASE1_Empresa', slug: 'qa', status: 'ACTIVE', logoUrl: null, secondaryLogoUrl: null },
      admin: { id: 'u1', name: 'Admin', email: 'admin@example.test', role: 'ADMIN' },
      agents: [],
      pipeline: { id: 'p1', name: 'Ventas' },
      stages: [],
    });
    montar();
    await llegarAIndustria(user);
    await user.click(screen.getByRole('radio', { name: /Venta de productos/ }));
    await avanzar(user); // módulos
    await avanzar(user); // categorías
    await user.click(screen.getByRole('button', { name: 'Otros', pressed: true })); // quita Otros
    await user.type(screen.getByLabelText('Categoría personalizada'), 'Accesorios{Enter}');
    await avanzar(user); // pipeline
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    // Al volver, la personalización sigue ahí.
    expect(screen.getByRole('button', { name: 'Quitar categoría Accesorios' })).toBeInTheDocument();
    await avanzar(user); // pipeline
    await avanzar(user); // branding
    expect(screen.getByRole('heading', { name: 'Branding' })).toBeInTheDocument();
    await avanzar(user); // admin
    await user.type(screen.getByLabelText(/^Nombre/), 'Admin QA');
    await user.type(screen.getByLabelText(/^Email/), 'admin@example.test');
    await user.type(screen.getByLabelText(/^Contraseña/), 'SuperSecret!123');
    await user.type(screen.getByLabelText(/Confirmar contraseña/), 'SuperSecret!123');
    await avanzar(user); // asesores
    await avanzar(user); // confirmación

    expect(screen.getByRole('heading', { name: 'Confirmación' })).toBeInTheDocument();
    expect(screen.getByText('Productos, Accesorios')).toBeInTheDocument();
    expect(screen.getByText(/Apariencia neutral TAKTO/)).toBeInTheDocument();
    expect(screen.getByText(/Cerrado ganado \(cierre ganado\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Crear empresa' }));
    await waitFor(() => expect(createCompanyOnboarding).toHaveBeenCalledTimes(1));
    const [payload, files, code] = createCompanyOnboarding.mock.calls[0];
    expect(code).toBe('TAKTO-AAAA-BBBB-CCCC-DDDD');
    expect(files).toEqual({ logo: undefined, secondaryLogo: undefined });
    expect(payload.branding).toEqual({
      primaryColor: undefined,
      accentColor: undefined,
      backgroundColor: undefined,
    });
    expect(payload.commercial).toEqual({
      sellsProducts: true,
      sellsServices: false,
      usesCatalog: true,
      usesQuotes: true,
      usesTasks: true,
      categories: ['Productos', 'Accesorios'],
      industry: 'generic',
      businessType: 'products',
      businessModel: 'products',
    });
    expect(payload.pipeline).toEqual({
      name: 'Ventas',
      typedStages: [
        { name: 'Nuevo lead', type: 'OPEN' },
        { name: 'Contactado', type: 'OPEN' },
        { name: 'Cerrado ganado', type: 'WON' },
        { name: 'Cerrado perdido', type: 'LOST' },
      ],
      templateKey: 'products',
    });
    expect(JSON.stringify(payload)).not.toMatch(/tehus|salas|comedor|A57014/i);
  });

  it(
    'si las plantillas no cargan, avisa y permite reintentar',
    async () => {
      // La consulta reintenta UNA vez sola antes de rendirse: los dos primeros
      // intentos fallan; el tercero (el botón «Reintentar») funciona.
      getOnboardingTemplates
        .mockRejectedValueOnce(new Error('red'))
        .mockRejectedValueOnce(new Error('red'))
        .mockResolvedValue(TEMPLATES_FIXTURE);
      const user = userEvent.setup();
      montar();
      await user.type(screen.getByLabelText('Código de invitación'), 'TAKTO-AAAA-BBBB-CCCC-DDDD');
      await avanzar(user);
      await user.type(screen.getByLabelText(/Nombre comercial/), 'QA_PHASE1_Empresa');
      await avanzar(user);

      expect(await screen.findByRole('alert', {}, { timeout: 8000 })).toHaveTextContent(
        /No pudimos cargar/,
      );
      await user.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(await screen.findByRole('combobox', { name: /Industria/ })).toBeInTheDocument();
    },
    20000,
  );
});
