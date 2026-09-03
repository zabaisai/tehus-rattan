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

  describe('contraseñas: la misma política que el backend (IsStrongPassword)', () => {
    async function llegarAAdmin(user: ReturnType<typeof userEvent.setup>) {
      await llegarAIndustria(user);
      await user.click(screen.getByRole('radio', { name: /Venta de servicios/ }));
      await avanzar(user); // módulos
      await avanzar(user); // pipeline (sin catálogo: no hay paso de categorías)
      await avanzar(user); // branding
      await avanzar(user); // admin
      expect(screen.getByRole('heading', { name: 'Administrador' })).toBeInTheDocument();
      await user.type(screen.getByLabelText(/^Nombre/), 'Admin QA');
      await user.type(screen.getByLabelText(/^Email/), 'admin@example.test');
    }

    it.each([
      ['8 caracteres', 'Abc!1234', /10 caracteres/],
      ['10 sin mayúscula', 'abcdef!123', /mayúscula/],
      ['10 sin minúscula', 'ABCDEF!123', /minúscula/],
      ['sin número', 'Abcdefgh!!', /número/],
      ['sin símbolo', 'Abcdefgh12', /carácter especial/],
    ])('el administrador no avanza con %s', async (_label, password, pattern) => {
      const user = userEvent.setup();
      montar();
      await llegarAAdmin(user);
      await user.type(screen.getByLabelText(/^Contraseña/), password);
      await user.type(screen.getByLabelText(/Confirmar contraseña/), password);
      await avanzar(user);
      expect(screen.getByRole('alert')).toHaveTextContent(pattern);
      expect(screen.getByRole('heading', { name: 'Administrador' })).toBeInTheDocument();
    });

    it('una contraseña válida permite continuar y no queda ninguna mención a «mínimo 8»', async () => {
      const user = userEvent.setup();
      montar();
      await llegarAAdmin(user);
      expect(document.body.textContent).not.toMatch(/m[ií]nimo 8/i);
      await user.type(screen.getByLabelText(/^Contraseña/), 'SuperSecret!123');
      await user.type(screen.getByLabelText(/Confirmar contraseña/), 'SuperSecret!123');
      await avanzar(user);
      expect(screen.getByRole('heading', { name: 'Asesores' })).toBeInTheDocument();
    });

    it('el error de un asesor identifica a ese asesor', async () => {
      const user = userEvent.setup();
      montar();
      await llegarAAdmin(user);
      await user.type(screen.getByLabelText(/^Contraseña/), 'SuperSecret!123');
      await user.type(screen.getByLabelText(/Confirmar contraseña/), 'SuperSecret!123');
      await avanzar(user); // asesores
      await user.click(screen.getByRole('button', { name: /Agregar asesor/ }));
      await user.click(screen.getByRole('button', { name: /Agregar asesor/ }));
      await user.type(screen.getByLabelText('Nombre del asesor 1'), 'Ana');
      await user.type(screen.getByLabelText('Email del asesor 1'), 'ana@example.test');
      await user.type(screen.getByLabelText('Contraseña temporal del asesor 1'), 'SuperSecret!123');
      await user.type(screen.getByLabelText('Nombre del asesor 2'), 'Luis');
      await user.type(screen.getByLabelText('Email del asesor 2'), 'luis@example.test');
      await user.type(screen.getByLabelText('Contraseña temporal del asesor 2'), 'abcdefgh12');
      await avanzar(user);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/Asesor 2 \(Luis\)/);
      expect(alert).toHaveTextContent(/mayúscula/);
      expect(alert).toHaveTextContent(/carácter especial/);
      // Escribe una docena de campos: bajo la suite completa supera los 5 s
      // por defecto sin que nada falle.
    }, 20000);
  });

  describe('tipo de negocio: una sola fuente (plantilla o descripción manual)', () => {
    it('«Datos de empresa» ya no pide un tipo de negocio', async () => {
      const user = userEvent.setup();
      montar();
      await user.type(screen.getByLabelText('Código de invitación'), 'TAKTO-AAAA-BBBB-CCCC-DDDD');
      await avanzar(user);
      expect(screen.getByRole('heading', { name: 'Datos de tu empresa' })).toBeInTheDocument();
      expect(screen.queryByLabelText(/Tipo de negocio/)).not.toBeInTheDocument();
    });

    it('«Otro / Configurar manualmente» exige una descripción, la recorta y la envía; la confirmación la muestra', async () => {
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
      await user.click(screen.getByRole('radio', { name: /Otro \/ Configurar manualmente/ }));
      await avanzar(user);
      expect(screen.getByRole('alert')).toHaveTextContent(/Describe tu tipo de negocio/);
      expect(screen.getByRole('heading', { name: '¿A qué se dedica tu empresa?' })).toBeInTheDocument();

      await user.type(screen.getByLabelText(/Describe tu tipo de negocio/), '  Insumos   agrícolas  ');
      await avanzar(user); // módulos
      await avanzar(user); // pipeline (sin catálogo en «Otro»)
      await avanzar(user); // branding
      await avanzar(user); // admin
      await user.type(screen.getByLabelText(/^Nombre/), 'Admin QA');
      await user.type(screen.getByLabelText(/^Email/), 'admin@example.test');
      await user.type(screen.getByLabelText(/^Contraseña/), 'SuperSecret!123');
      await user.type(screen.getByLabelText(/Confirmar contraseña/), 'SuperSecret!123');
      await avanzar(user); // asesores
      await avanzar(user); // confirmación

      // La fila «Tipo de negocio» muestra la descripción recortada; la fila
      // «Plantilla» sigue nombrando la opción manual, que es informativa.
      expect(screen.getByText('Insumos agrícolas')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Crear empresa' }));
      await waitFor(() => expect(createCompanyOnboarding).toHaveBeenCalledTimes(1));
      const [payload] = createCompanyOnboarding.mock.calls[0];
      expect(payload.company.businessType).toBe('Insumos agrícolas');
      expect(payload.commercial.businessType).toBe('other');
    });

    it('al pasar de manual a una plantilla normal el texto manual no viaja y el diálogo de protección sigue funcionando', async () => {
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
      await user.click(screen.getByRole('radio', { name: /Otro \/ Configurar manualmente/ }));
      await user.type(screen.getByLabelText(/Describe tu tipo de negocio/), 'Texto manual');
      await avanzar(user); // módulos
      // Personaliza módulos para que el cambio de plantilla pida confirmación.
      await user.click(screen.getByRole('checkbox', { name: /Cotizaciones/ }));
      await user.click(screen.getByRole('button', { name: 'Atrás' }));
      await user.click(screen.getByRole('radio', { name: /Venta de productos/ }));
      const dialogo = await screen.findByRole('dialog');
      await user.click(within(dialogo).getByRole('button', { name: 'Aplicar sugerencias' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryByLabelText(/Describe tu tipo de negocio/)).not.toBeInTheDocument();

      await avanzar(user); // módulos
      await avanzar(user); // categorías
      await avanzar(user); // pipeline
      await avanzar(user); // branding
      await avanzar(user); // admin
      await user.type(screen.getByLabelText(/^Nombre/), 'Admin QA');
      await user.type(screen.getByLabelText(/^Email/), 'admin@example.test');
      await user.type(screen.getByLabelText(/^Contraseña/), 'SuperSecret!123');
      await user.type(screen.getByLabelText(/Confirmar contraseña/), 'SuperSecret!123');
      await avanzar(user); // asesores
      await avanzar(user); // confirmación
      // «Tipo de negocio» y «Plantilla» muestran ambas el nombre canónico.
      expect(screen.getAllByText('Venta de productos', { selector: 'span.font-medium' }).length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Texto manual')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Crear empresa' }));
      await waitFor(() => expect(createCompanyOnboarding).toHaveBeenCalledTimes(1));
      const [payload] = createCompanyOnboarding.mock.calls[0];
      expect(payload.company.businessType).toBeUndefined();
      expect(payload.commercial.businessType).toBe('products');
    });
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
    // Con una plantilla normal no viaja ningún texto libre: el backend guarda
    // el nombre canónico de la plantilla.
    expect(payload.company.businessType).toBeUndefined();
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
