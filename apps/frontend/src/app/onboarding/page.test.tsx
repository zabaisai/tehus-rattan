import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OnboardingPage from './page';
import { TEMPLATES_FIXTURE } from '@/lib/__fixtures__/onboarding-templates.fixture';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const getOnboardingTemplates = vi.fn();
vi.mock('@/lib/onboarding-templates', async () => {
  const real = await vi.importActual<typeof import('@/lib/onboarding-templates')>(
    '@/lib/onboarding-templates',
  );
  return { ...real, getOnboardingTemplates: () => getOnboardingTemplates() };
});

const createCompanyOnboarding = vi.fn();
const checkInvitationCode = vi.fn();
vi.mock('@/lib/onboarding', async () => {
  const real = await vi.importActual<typeof import('@/lib/onboarding')>('@/lib/onboarding');
  return {
    ...real,
    createCompanyOnboarding: (...args: unknown[]) => createCompanyOnboarding(...args),
    checkInvitationCode: (code: string) => checkInvitationCode(code),
  };
});

const getMe = vi.fn();
vi.mock('@/lib/auth', () => ({ getMe: () => getMe() }));

// Recorridos completos de doce pasos con userEvent: con toda la suite en
// paralelo tardan más de los 5 s por defecto sin que nada esté roto.
vi.setConfig({ testTimeout: 20_000 });

const CODE = 'TAKTO-AAAA-BBBB-CCCC-DDDD';
const PASSWORD = 'Segura!12345';

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OnboardingPage />
    </QueryClientProvider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

const avanzar = (user: User) => user.click(screen.getByRole('button', { name: 'Siguiente' }));
const atras = (user: User) => user.click(screen.getByRole('button', { name: 'Atrás' }));

async function pasarInvitacion(user: User) {
  await user.type(screen.getByRole('textbox', { name: /Código de invitación/ }), CODE);
  await avanzar(user);
  await screen.findByRole('heading', { name: 'Datos de tu empresa' });
}

async function pasarEmpresa(user: User, industry: string, name = 'Empresa QA') {
  await user.type(screen.getByLabelText(/Nombre comercial/), name);
  await user.selectOptions(await screen.findByLabelText(/Industria/), industry);
  await avanzar(user);
  await screen.findByRole('heading', { name: '¿Dónde opera tu empresa?' });
}

async function pasarRegion(user: User, country = 'Colombia') {
  await user.selectOptions(screen.getByLabelText(/^País/), country);
  await avanzar(user);
  await screen.findByRole('heading', { name: '¿Qué vendes?' });
}

async function pasarVenta(user: User, modelo?: 'Solo productos' | 'Solo servicios' | 'Productos y servicios') {
  if (modelo) await user.click(screen.getByRole('radio', { name: new RegExp(modelo) }));
  await avanzar(user);
  await screen.findByRole('heading', { name: 'Nuestra recomendación' });
}

async function pasarRecomendacion(user: User) {
  await avanzar(user);
  await screen.findByRole('heading', { name: 'Módulos' });
}

async function pasarModulos(user: User) {
  await avanzar(user);
}

async function pasarHastaConfirmar(user: User) {
  // categorías (si hay) → pipeline → branding → admin → asesores → confirmación
  if (screen.queryByRole('heading', { name: 'Categorías del catálogo' })) await avanzar(user);
  await screen.findByRole('heading', { name: 'Pipeline inicial' });
  await avanzar(user);
  await screen.findByRole('heading', { name: /Branding/ });
  await avanzar(user);
  await screen.findByRole('heading', { name: 'Administrador' });
  await user.type(screen.getByLabelText(/^Nombre/), 'Ana Admin');
  await user.type(screen.getByLabelText(/^Email/), 'ana@example.test');
  await user.type(screen.getByLabelText(/^Contraseña/), PASSWORD);
  await user.type(screen.getByLabelText(/Confirmar contraseña/), PASSWORD);
  await avanzar(user);
  await screen.findByRole('heading', { name: 'Asesores' });
  await avanzar(user);
  await screen.findByRole('heading', { name: 'Confirmación' });
}

describe('Onboarding guiado (Fase 3)', () => {
  beforeEach(() => {
    push.mockReset();
    getMe.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN', companyId: 'c1' });
    getOnboardingTemplates.mockReset().mockResolvedValue(TEMPLATES_FIXTURE);
    checkInvitationCode.mockReset().mockResolvedValue({ valid: true });
    createCompanyOnboarding.mockReset().mockResolvedValue({
      message: 'ok',
      company: { id: 'c1', name: 'Empresa QA', slug: 'empresa-qa', status: 'ACTIVE', logoUrl: null, secondaryLogoUrl: null },
      admin: { id: 'u1', name: 'Ana', email: 'ana@example.test', role: 'ADMIN' },
      agents: [],
      pipeline: { id: 'p1', name: 'Ventas' },
      stages: [],
      token: 'jwt',
      user: { id: 'u1', email: 'ana@example.test', name: 'Ana' },
    });
  });

  describe('código de invitación', () => {
    it('se comprueba antes de avanzar, sin consumirlo, y un código malo muestra su motivo', async () => {
      const user = userEvent.setup();
      checkInvitationCode.mockRejectedValueOnce({
        response: { status: 400, data: { message: 'Código de invitación vencido' } },
      });
      montar();
      await user.type(screen.getByRole('textbox', { name: /Código de invitación/ }), `  ${CODE} `);
      await avanzar(user);
      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Código de invitación vencido');
      expect(alerta).toHaveFocus();
      expect(screen.queryByRole('heading', { name: 'Datos de tu empresa' })).not.toBeInTheDocument();
      expect(checkInvitationCode).toHaveBeenCalledWith(CODE);

      await avanzar(user);
      expect(await screen.findByRole('heading', { name: 'Datos de tu empresa' })).toBeInTheDocument();
      expect(createCompanyOnboarding).not.toHaveBeenCalled();
    });

    it('no deja avanzar sin código', async () => {
      const user = userEvent.setup();
      montar();
      await avanzar(user);
      expect(screen.getByRole('alert')).toHaveTextContent(/Ingresa el código/);
      expect(checkInvitationCode).not.toHaveBeenCalled();
    });
  });

  describe('recomendaciones según las respuestas', () => {
    it('industria y forma de vender determinan la plantilla; veterinaria no ve categorías de muebles', async () => {
      const user = userEvent.setup();
      montar();
      await pasarInvitacion(user);
      await pasarEmpresa(user, 'veterinary_pet');
      await pasarRegion(user, 'Costa Rica');

      // Recomendado según la industria (grooming → servicios).
      expect(screen.getByRole('radio', { name: /Solo servicios/ })).toBeChecked();
      expect(screen.getByRole('radio', { name: /Solo servicios/ })).toHaveAccessibleName(/Recomendado/);
      await pasarVenta(user);

      const region = screen.getByRole('region', { name: 'Grooming' });
      expect(region).toHaveTextContent('Recomendada');
      expect(region).toHaveTextContent(/veterinaria y mascotas/i);
      expect(region).toHaveTextContent('Grooming, Otros servicios');
      expect(region.textContent).not.toMatch(/Salas|Comedores/);

      await pasarRecomendacion(user);
      await pasarModulos(user);
      await screen.findByRole('heading', { name: 'Categorías del catálogo' });
      expect(screen.getByRole('button', { name: 'Grooming' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('button', { name: 'Salas' })).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/Comedores/);
    });

    it('cambiar la forma de vender cambia la plantilla recomendada cuando aún no se eligió una', async () => {
      const user = userEvent.setup();
      montar();
      await pasarInvitacion(user);
      await pasarEmpresa(user, 'generic');
      await pasarRegion(user);
      expect(screen.getByRole('radio', { name: /Solo productos/ })).toBeChecked();
      await pasarVenta(user, 'Solo servicios');
      expect(screen.getByRole('region', { name: 'Venta de servicios' })).toHaveTextContent('Recomendada');
      // Sin catálogo → el paso de categorías no existe.
      await pasarRecomendacion(user);
      await pasarModulos(user);
      expect(await screen.findByRole('heading', { name: 'Pipeline inicial' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Categorías del catálogo' })).not.toBeInTheDocument();
    });

    it('la forma de vender elegida por la persona no la pisa la plantilla', async () => {
      const user = userEvent.setup();
      montar();
      await pasarInvitacion(user);
      await pasarEmpresa(user, 'furniture_decor');
      await pasarRegion(user);
      await pasarVenta(user, 'Productos y servicios');
      const region = screen.getByRole('region', { name: 'Tienda / showroom' });
      expect(region).toHaveTextContent('Vendo productos y servicios');
      expect(region).toHaveTextContent(/conservamos tu forma de vender/);
    });
  });

  describe('región', () => {
    it('el país propone zona, moneda e idioma; lo editado a mano se protege con dos decisiones explícitas', async () => {
      const user = userEvent.setup();
      montar();
      await pasarInvitacion(user);
      await pasarEmpresa(user, 'generic');

      await user.selectOptions(screen.getByLabelText(/^País/), 'Costa Rica');
      expect(screen.getByLabelText(/Zona horaria/)).toHaveValue('America/Costa_Rica');
      expect(screen.getByLabelText(/Moneda/)).toHaveValue('CRC');
      expect(screen.getByLabelText(/Idioma/)).toHaveValue('es-CR');

      await user.clear(screen.getByLabelText(/Moneda/));
      await user.type(screen.getByLabelText(/Moneda/), 'usd');
      expect(screen.getByLabelText(/Moneda/)).toHaveValue('USD');
      expect(screen.getByText('Editado')).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText(/^País/), 'México');
      const grupo = screen.getByRole('group');
      expect(grupo).toHaveTextContent(/México/);
      await user.click(within(grupo).getByRole('button', { name: 'Conservar mis cambios' }));
      expect(screen.getByLabelText(/Moneda/)).toHaveValue('USD');
      expect(screen.getByLabelText(/Zona horaria/)).toHaveValue('America/Costa_Rica');

      await user.click(screen.getByRole('button', { name: /Volver a los valores de México/ }));
      expect(screen.getByLabelText(/Moneda/)).toHaveValue('MXN');
      expect(screen.getByLabelText(/Zona horaria/)).toHaveValue('America/Mexico_City');
    });

    it('una zona horaria inválida bloquea el paso y marca el campo', async () => {
      const user = userEvent.setup();
      montar();
      await pasarInvitacion(user);
      await pasarEmpresa(user, 'generic');
      await user.selectOptions(screen.getByLabelText(/^País/), 'Colombia');
      await user.clear(screen.getByLabelText(/Zona horaria/));
      await user.type(screen.getByLabelText(/Zona horaria/), 'Bogota');
      await avanzar(user);
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
      expect(screen.getByLabelText(/Zona horaria/)).toBeInvalid();
      expect(screen.getByLabelText(/Zona horaria/)).toHaveAccessibleDescription(/IANA/);
      expect(screen.queryByRole('heading', { name: '¿Qué vendes?' })).not.toBeInTheDocument();
    });

    it('sin país no se avanza', async () => {
      const user = userEvent.setup();
      montar();
      await pasarInvitacion(user);
      await pasarEmpresa(user, 'generic');
      await avanzar(user);
      expect(screen.getAllByRole('alert')[0]).toHaveTextContent(/país/i);
    });
  });

  describe('protección de ediciones', () => {
    async function hastaModulosGenerico(user: User) {
      await pasarInvitacion(user);
      await pasarEmpresa(user, 'generic');
      await pasarRegion(user);
      await pasarVenta(user);
      await pasarRecomendacion(user);
    }

    it('al cambiar de plantilla con ediciones pregunta; «Conservar mis cambios» los mantiene', async () => {
      const user = userEvent.setup();
      montar();
      await hastaModulosGenerico(user);
      await user.click(screen.getByLabelText(/Cotizaciones/));
      expect(screen.getByLabelText(/Cotizaciones/)).not.toBeChecked();
      expect(screen.getByText('Editado')).toBeInTheDocument();

      await atras(user);
      await screen.findByRole('heading', { name: 'Nuestra recomendación' });
      await user.click(screen.getByRole('radio', { name: /Venta de servicios/ }));
      const dialogo = await screen.findByRole('dialog');
      expect(dialogo).toHaveTextContent('¿Aplicar las nuevas recomendaciones?');
      await user.click(within(dialogo).getByRole('button', { name: 'Conservar mis cambios' }));

      expect(screen.getByRole('radio', { name: /Venta de servicios/ })).toBeChecked();
      await pasarRecomendacion(user);
      expect(screen.getByLabelText(/Cotizaciones/)).not.toBeChecked();
      expect(screen.getByText('Editado')).toBeInTheDocument();
    });

    it('«Aplicar las nuevas recomendaciones» reemplaza lo editado y «Restablecer recomendaciones» vuelve a la plantilla', async () => {
      const user = userEvent.setup();
      montar();
      await hastaModulosGenerico(user);
      await user.click(screen.getByLabelText(/Cotizaciones/));
      await atras(user);
      await screen.findByRole('heading', { name: 'Nuestra recomendación' });
      expect(screen.getByRole('button', { name: /Restablecer recomendaciones/ })).toBeInTheDocument();

      await user.click(screen.getByRole('radio', { name: /Venta de servicios/ }));
      const dialogo = await screen.findByRole('dialog');
      await user.click(within(dialogo).getByRole('button', { name: 'Aplicar las nuevas recomendaciones' }));
      await pasarRecomendacion(user);
      // La plantilla de servicios trae cotizaciones activas.
      expect(screen.getByLabelText(/Cotizaciones/)).toBeChecked();
      expect(screen.getByText('Sugerido')).toBeInTheDocument();

      await user.click(screen.getByLabelText(/Tareas/));
      await atras(user);
      await screen.findByRole('heading', { name: 'Nuestra recomendación' });
      await user.click(screen.getByRole('button', { name: /Restablecer recomendaciones/ }));
      expect(screen.queryByRole('button', { name: /Restablecer recomendaciones/ })).not.toBeInTheDocument();
      await pasarRecomendacion(user);
      expect(screen.getByLabelText(/Tareas/)).toBeChecked();
    });
  });

  describe('resumen y creación', () => {
    async function hastaConfirmarMuebles(user: User) {
      await pasarInvitacion(user);
      await pasarEmpresa(user, 'furniture_decor', 'Muebles QA');
      await pasarRegion(user, 'Colombia');
      await pasarVenta(user);
      await pasarRecomendacion(user);
      await pasarModulos(user);
      await pasarHastaConfirmar(user);
    }

    it('el resumen muestra exactamente lo que se envía y cada bloque permite volver a editar', async () => {
      const user = userEvent.setup();
      montar();
      await hastaConfirmarMuebles(user);

      const body = document.body.textContent ?? '';
      for (const texto of ['Muebles QA', 'Muebles y decoración', 'Tienda / showroom', 'Colombia', 'America/Bogota', 'COP', 'es-CO', 'Vendo productos', 'Salas, Comedores, Dormitorios', 'Asesoría en proceso', 'Cerrado ganado (cierre ganado)', 'ana@example.test']) {
        expect(body).toContain(texto);
      }

      await user.click(screen.getByRole('button', { name: 'Editar región' }));
      expect(await screen.findByRole('heading', { name: '¿Dónde opera tu empresa?' })).toBeInTheDocument();
      expect(screen.getByLabelText(/Moneda/)).toHaveValue('COP');
      // Volver a la confirmación conserva todo.
      for (let i = 0; i < 9; i++) await avanzar(user);
      await screen.findByRole('heading', { name: 'Confirmación' });

      await user.click(screen.getByRole('button', { name: 'Crear empresa' }));
      await waitFor(() => expect(createCompanyOnboarding).toHaveBeenCalledTimes(1));
      const [payload, files, code] = createCompanyOnboarding.mock.calls[0];
      expect(code).toBe(CODE);
      expect(files).toEqual({ logo: undefined, secondaryLogo: undefined });
      expect(payload.company).toMatchObject({
        name: 'Muebles QA',
        country: 'Colombia',
        timezone: 'America/Bogota',
        currency: 'COP',
        locale: 'es-CO',
      });
      expect(payload.commercial).toEqual({
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
        categories: ['Salas', 'Comedores', 'Dormitorios'],
        industry: 'furniture_decor',
        businessType: 'showroom',
        businessModel: 'products',
      });
      expect(payload.pipeline.typedStages.map((s: { name: string }) => s.name)).toEqual([
        'Nuevo lead',
        'Asesoría en proceso',
        'Cotización',
        'Cerrado ganado',
        'Cerrado perdido',
      ]);
      expect(payload.admin).toEqual({ name: 'Ana Admin', email: 'ana@example.test', password: PASSWORD });
      expect(payload.branding).toEqual({ primaryColor: undefined, accentColor: undefined, backgroundColor: undefined });
      expect(JSON.stringify(payload)).not.toMatch(/tehus|A57014/i);
      await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
    });

    it('dos clics en «Crear empresa» envían una sola petición', async () => {
      const user = userEvent.setup();
      let resolver: (v: unknown) => void = () => undefined;
      createCompanyOnboarding.mockImplementation(() => new Promise((r) => (resolver = r)));
      montar();
      await hastaConfirmarMuebles(user);
      const boton = screen.getByRole('button', { name: 'Crear empresa' });
      await user.click(boton);
      await user.click(screen.getByRole('button', { name: /Creando empresa/ }));
      expect(createCompanyOnboarding).toHaveBeenCalledTimes(1);
      resolver({ company: { id: 'c1', name: 'Muebles QA', slug: 'x', status: 'ACTIVE', logoUrl: null, secondaryLogoUrl: null }, admin: {}, agents: [], pipeline: {}, stages: [] });
      await waitFor(() => expect(screen.queryByText(/Creando empresa/)).not.toBeInTheDocument());
    });

    it('un error del servidor conserva los datos y permite corregir', async () => {
      const user = userEvent.setup();
      createCompanyOnboarding.mockRejectedValueOnce({
        response: { status: 409, data: { message: 'Los siguientes emails ya están registrados: ana@example.test' } },
      });
      montar();
      await hastaConfirmarMuebles(user);
      await user.click(screen.getByRole('button', { name: 'Crear empresa' }));
      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(/ya están registrados/);
      expect(screen.getByRole('heading', { name: 'Confirmación' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Editar administrador' }));
      expect(await screen.findByDisplayValue('ana@example.test')).toBeInTheDocument();
    });

    it('si la sesión automática falla después de crear, muestra el éxito y no un error de creación', async () => {
      const user = userEvent.setup();
      getMe.mockRejectedValue(new Error('network'));
      montar();
      await hastaConfirmarMuebles(user);
      await user.click(screen.getByRole('button', { name: 'Crear empresa' }));
      expect(await screen.findByText(/Empresa QA/)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(push).not.toHaveBeenCalledWith('/dashboard');
    });
  });

  describe('accesibilidad y validaciones', () => {
    it('el stepper marca el paso actual con aria-current', async () => {
      const user = userEvent.setup();
      montar();
      const nav = screen.getByRole('navigation', { name: 'Pasos del registro' });
      expect(nav.querySelector('[aria-current="step"]')).toHaveTextContent('Código de invitación');
      await pasarInvitacion(user);
      expect(nav.querySelector('[aria-current="step"]')).toHaveTextContent('Datos de empresa');
    });

    it('la contraseña del administrador sigue la política del backend', async () => {
      const user = userEvent.setup();
      montar();
      await pasarInvitacion(user);
      await pasarEmpresa(user, 'generic');
      await pasarRegion(user);
      await pasarVenta(user);
      await pasarRecomendacion(user);
      await pasarModulos(user);
      await avanzar(user); // categorías
      await screen.findByRole('heading', { name: 'Pipeline inicial' });
      await avanzar(user);
      await avanzar(user); // branding
      await screen.findByRole('heading', { name: 'Administrador' });
      await user.type(screen.getByLabelText(/^Nombre/), 'Ana');
      await user.type(screen.getByLabelText(/^Email/), 'ana@example.test');
      await user.type(screen.getByLabelText(/^Contraseña/), 'abcdef!123');
      await user.type(screen.getByLabelText(/Confirmar contraseña/), 'abcdef!123');
      await avanzar(user);
      expect(screen.getByRole('alert')).toHaveTextContent(/mayúscula/);
    });

    it('si las plantillas no cargan, avisa y permite reintentar', async () => {
      const user = userEvent.setup();
      getOnboardingTemplates.mockRejectedValueOnce(new Error('red')).mockRejectedValueOnce(new Error('red'));
      montar();
      await pasarInvitacion(user);
      expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos cargar/);
      getOnboardingTemplates.mockResolvedValue(TEMPLATES_FIXTURE);
      await user.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(await screen.findByLabelText(/Industria/)).toBeInTheDocument();
    });
  });
});
