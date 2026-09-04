import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';
import { useAuthStore } from '@/store/auth.store';
import { LEYENDA_ILUSTRATIVA } from '@/components/auth/LoginShowcase';
import type { User } from '@/types';

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

const login = vi.fn();
const verifyDevice = vi.fn();
const resendDeviceVerification = vi.fn();
const getMe = vi.fn();
vi.mock('@/lib/auth', () => ({
  login: (...args: unknown[]) => login(...args),
  verifyDevice: (...args: unknown[]) => verifyDevice(...args),
  resendDeviceVerification: (...args: unknown[]) =>
    resendDeviceVerification(...args),
  getMe: () => getMe(),
}));

// El cliente HTTP real se sustituye por espías: la pantalla de login NO debe
// pedir dato alguno de una empresa —no hay ninguna todavía— y el panel
// ilustrativo tiene que ser 100 % sintético.
const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/axios', async () => {
  const real = await vi.importActual<typeof import('@/lib/axios')>('@/lib/axios');
  return {
    ...real,
    default: {
      get: (...args: unknown[]) => apiGet(...args),
      post: (...args: unknown[]) => apiPost(...args),
    },
  };
});

const USUARIO: User = {
  id: 'u1',
  email: 'ana@empresa.com',
  name: 'Ana',
  role: 'ADMIN',
  companyId: 'c1',
};

const RETO = {
  status: 'verification_required' as const,
  challengeId: 'ret-1',
  maskedEmail: 'a***@empresa.com',
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  resendAvailableAt: new Date(Date.now() + 30_000).toISOString(),
  attemptsRemaining: 5,
};

function stubMatchMedia({ ancho = false, reducido = false } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (consulta: string) => ({
      matches: consulta.includes('min-width: 1024px')
        ? ancho
        : consulta.includes('prefers-reduced-motion')
          ? reducido
          : false,
      media: consulta,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

const correo = () => screen.getByLabelText(/^Correo/);
const contrasena = () => screen.getByLabelText(/^Contraseña/);
const continuar = () => screen.getByRole('button', { name: 'Continuar' });

async function entrarConCredenciales() {
  fireEvent.change(correo(), { target: { value: 'ana@empresa.com' } });
  fireEvent.change(contrasena(), { target: { value: 'Segura!12345' } });
  fireEvent.click(continuar());
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubMatchMedia();
    useAuthStore.setState({ user: null, status: 'anonymous' });
    window.history.replaceState(null, '', '/login');
    getMe.mockResolvedValue(USUARIO);
  });

  afterEach(() => {
    useAuthStore.setState({ user: null, status: 'anonymous' });
  });

  it('muestra el formulario de credenciales con un solo h1', () => {
    render(<LoginPage />);
    const titulos = screen.getAllByRole('heading', { level: 1 });
    expect(titulos).toHaveLength(1);
    expect(titulos[0]).toHaveTextContent('Inicia sesión');
    expect(correo()).toHaveAttribute('autocomplete', 'username');
    expect(contrasena()).toHaveAttribute('autocomplete', 'current-password');
    expect(continuar()).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' }),
    ).toHaveAttribute('href', '/forgot-password');
  });

  it('afirma solo lo que es cierto sobre la seguridad', () => {
    render(<LoginPage />);
    expect(screen.getByText('Conexión segura y sesión protegida.')).toBeInTheDocument();
    expect(
      screen.getByText('Cada usuario accede únicamente con sus permisos asignados.'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/extremo a extremo/i);
    expect(document.body.textContent).not.toMatch(/dispositivo autorizado/i);
  });

  it('con status authenticated abre el tablero pasando por la apertura real', async () => {
    login.mockResolvedValue({ status: 'authenticated', token: 'tok', user: USUARIO });
    render(<LoginPage />);
    await entrarConCredenciales();

    expect(await screen.findByText('Bienvenido, Ana')).toBeInTheDocument();
    expect(screen.getByText('Sesión verificada')).toBeInTheDocument();
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    // No hay porcentajes inventados en ningún paso.
    expect(document.body.textContent).not.toMatch(/\d+\s?%/);
  });

  it('lleva a un SUPER_ADMIN global al área de plataforma', async () => {
    const superAdmin: User = {
      ...USUARIO,
      role: 'SUPER_ADMIN',
      companyId: null,
    };
    login.mockResolvedValue({ status: 'authenticated', token: 'tok', user: superAdmin });
    getMe.mockResolvedValue(superAdmin);
    render(<LoginPage />);
    await entrarConCredenciales();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/dashboard/platform/companies'),
    );
  });

  it('pasa a la verificación de dispositivo cuando el servidor lo pide', async () => {
    login.mockResolvedValue(RETO);
    render(<LoginPage />);
    await entrarConCredenciales();

    expect(
      await screen.findByText('Enviamos un código de 6 dígitos a a***@empresa.com.'),
    ).toBeInTheDocument();
    const titulos = screen.getAllByRole('heading', { level: 1 });
    expect(titulos).toHaveLength(1);
    expect(titulos[0]).toHaveTextContent('Verifica este dispositivo');
    // Sin token no hay sesión: la tienda sigue anónima.
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('pegar el código lo reparte y lo envía sin confiar en el equipo', async () => {
    login.mockResolvedValue(RETO);
    verifyDevice.mockResolvedValue({
      status: 'authenticated',
      token: 'tok',
      user: USUARIO,
    });
    render(<LoginPage />);
    await entrarConCredenciales();
    await screen.findByLabelText('Dígito 1 de 6');

    fireEvent.paste(screen.getByLabelText('Dígito 1 de 6'), {
      clipboardData: { getData: () => '482913' },
    });

    await waitFor(() =>
      expect(verifyDevice).toHaveBeenCalledWith({
        challengeId: 'ret-1',
        code: '482913',
        trustDevice: false,
      }),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('la casilla de confianza va desmarcada y manda trustDevice: true al marcarla', async () => {
    login.mockResolvedValue(RETO);
    verifyDevice.mockResolvedValue({
      status: 'authenticated',
      token: 'tok',
      user: USUARIO,
    });
    render(<LoginPage />);
    await entrarConCredenciales();
    const casilla = await screen.findByRole('checkbox', {
      name: /Confiar en este dispositivo privado durante 30 días/,
    });
    expect(casilla).not.toBeChecked();

    fireEvent.click(casilla);
    fireEvent.paste(screen.getByLabelText('Dígito 1 de 6'), {
      clipboardData: { getData: () => '111222' },
    });

    await waitFor(() =>
      expect(verifyDevice).toHaveBeenCalledWith({
        challengeId: 'ret-1',
        code: '111222',
        trustDevice: true,
      }),
    );
  });

  it('un código rechazado se anuncia, vacía los campos y no cierra el reto', async () => {
    login.mockResolvedValue(RETO);
    verifyDevice.mockRejectedValue({
      response: {
        status: 400,
        data: { message: 'El código no es válido o ya venció. Solicita uno nuevo.' },
      },
    });
    render(<LoginPage />);
    await entrarConCredenciales();
    await screen.findByLabelText('Dígito 1 de 6');

    fireEvent.paste(screen.getByLabelText('Dígito 1 de 6'), {
      clipboardData: { getData: () => '000000' },
    });

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(
      'El código no es válido o ya venció. Solicita uno nuevo.',
    );
    await waitFor(() => {
      const campos = screen.getAllByRole('textbox') as HTMLInputElement[];
      expect(campos.every((campo) => campo.value === '')).toBe(true);
      expect(document.activeElement).toBe(campos[0]);
    });
  });

  it('«Enviar otro código» pide uno nuevo y lo confirma', async () => {
    login.mockResolvedValue({
      ...RETO,
      resendAvailableAt: new Date(Date.now() - 1000).toISOString(),
    });
    resendDeviceVerification.mockResolvedValue({
      ...RETO,
      resendAvailableAt: new Date(Date.now() + 30_000).toISOString(),
      attemptsRemaining: 4,
    });
    render(<LoginPage />);
    await entrarConCredenciales();

    const boton = await screen.findByRole('button', { name: 'Enviar otro código' });
    expect(boton).toBeEnabled();
    fireEvent.click(boton);

    await waitFor(() =>
      expect(resendDeviceVerification).toHaveBeenCalledWith('ret-1'),
    );
    expect(await screen.findByText('Te enviamos otro código.')).toBeInTheDocument();
  });

  it('«Volver» regresa a las credenciales sin llamar a la API', async () => {
    login.mockResolvedValue(RETO);
    render(<LoginPage />);
    await entrarConCredenciales();
    await screen.findByRole('button', { name: 'Volver' });

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Inicia sesión',
    );
    expect(verifyDevice).not.toHaveBeenCalled();
    expect(resendDeviceVerification).not.toHaveBeenCalled();
  });

  it('un 401 da un mensaje genérico que no revela si el correo existe', async () => {
    login.mockRejectedValue({
      response: { status: 401, data: { message: 'Credenciales inválidas' } },
    });
    render(<LoginPage />);
    await entrarConCredenciales();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Credenciales inválidas');
    expect(document.activeElement).toBe(alerta);
    expect(alerta.textContent).not.toMatch(/ana@empresa\.com/);
    expect(document.body.textContent).not.toMatch(/no existe|no encontrad|sin registrar/i);
  });

  it('un 429 bloquea el envío y lo explica', async () => {
    login.mockRejectedValue({
      response: {
        status: 429,
        data: { message: 'Demasiados intentos. Espera un momento.' },
        headers: { 'retry-after': '45' },
      },
    });
    render(<LoginPage />);
    await entrarConCredenciales();

    expect(
      await screen.findByText('Demasiados intentos. Espera un momento.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Puedes volver a intentarlo en \d+s/)).toBeInTheDocument();
    expect(continuar()).toBeDisabled();
  });

  it('no envía dos veces con dos pulsaciones seguidas', async () => {
    let resolver: (valor: unknown) => void = () => {};
    login.mockImplementation(
      () => new Promise((cumplir) => { resolver = cumplir; }),
    );
    render(<LoginPage />);
    fireEvent.change(correo(), { target: { value: 'ana@empresa.com' } });
    fireEvent.change(contrasena(), { target: { value: 'Segura!12345' } });

    const boton = continuar();
    fireEvent.click(boton);
    fireEvent.click(boton);

    expect(login).toHaveBeenCalledTimes(1);
    resolver({ status: 'authenticated', token: 'tok', user: USUARIO });
    await waitFor(() => expect(getMe).toHaveBeenCalled());
  });

  it('el botón de ver contraseña cambia el tipo y su aria-pressed', () => {
    render(<LoginPage />);
    expect(contrasena()).toHaveAttribute('type', 'password');

    const boton = screen.getByRole('button', { name: 'Mostrar contraseña' });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(boton);

    expect(contrasena()).toHaveAttribute('type', 'text');
    const ocultar = screen.getByRole('button', { name: 'Ocultar contraseña' });
    expect(ocultar).toHaveAttribute('aria-pressed', 'true');
  });

  it('en móvil no monta el panel decorativo', () => {
    render(<LoginPage />);
    expect(document.querySelector('[data-testid="login-showcase"]')).toBeNull();
    expect(screen.queryByText(LEYENDA_ILUSTRATIVA)).not.toBeInTheDocument();
  });

  it('en escritorio el panel es ilustrativo, se anuncia su leyenda y no consulta nada', async () => {
    stubMatchMedia({ ancho: true });
    const fetchEspia = vi.fn();
    vi.stubGlobal('fetch', fetchEspia);

    render(<LoginPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-testid="login-showcase"]')).not.toBeNull(),
    );
    // La leyenda se ve Y se oye: una copia dentro del panel decorativo y otra
    // `sr-only` fuera del subárbol `aria-hidden`.
    expect(screen.getAllByText(LEYENDA_ILUSTRATIVA)).toHaveLength(2);
    expect(document.querySelector('[data-testid="login-showcase"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    // Nada de datos reales: ni un nombre de empresa, ni un importe, ni una
    // petición al servidor más allá de las de autenticación (aquí, ninguna).
    expect(apiGet).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    expect(fetchEspia).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/\$|Muebles|Clínica|Marcela/);

    vi.unstubAllGlobals();
  });

  it('con movimiento reducido el panel se pinta igual y no revienta', async () => {
    stubMatchMedia({ ancho: true, reducido: true });
    render(<LoginPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-testid="login-showcase"]')).not.toBeNull(),
    );
    expect(screen.getAllByText(LEYENDA_ILUSTRATIVA).length).toBeGreaterThan(0);
    expect(screen.getByText('Toma el mando de cada jugada.')).toBeInTheDocument();
  });

  it('no menciona ningún código de prueba en ningún paso', async () => {
    login.mockResolvedValue(RETO);
    render(<LoginPage />);
    expect(document.body.textContent).not.toMatch(/código de prueba/i);

    await entrarConCredenciales();
    await screen.findByLabelText('Dígito 1 de 6');
    expect(document.body.textContent).not.toMatch(/código de prueba/i);
  });

  it('mantiene el aviso de contraseña restablecida (?reset=1)', async () => {
    window.history.replaceState(null, '', '/login?reset=1');
    render(<LoginPage />);
    expect(
      await screen.findByText(
        'Contraseña actualizada correctamente. Ya puedes iniciar sesión.',
      ),
    ).toBeInTheDocument();
  });

  it('mantiene el aviso de empresa creada (?created=1)', async () => {
    window.history.replaceState(null, '', '/login?created=1');
    render(<LoginPage />);
    expect(
      await screen.findByText(
        'Tu empresa se creó correctamente. Inicia sesión con el correo del administrador.',
      ),
    ).toBeInTheDocument();
  });

  it('con una sesión previa no enseña el formulario y va al tablero', async () => {
    useAuthStore.setState({ user: USUARIO, status: 'authenticated' });
    render(<LoginPage />);

    expect(screen.queryByLabelText(/^Contraseña/)).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});
