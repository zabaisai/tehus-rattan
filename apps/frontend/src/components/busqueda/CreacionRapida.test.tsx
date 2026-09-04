import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreacionRapida } from './CreacionRapida';
import { useAuthStore } from '@/store/auth.store';
import { olvidarRecientes, registrarReciente } from '@/lib/creacion-rapida';
import { capacidadesDePrueba } from '@/lib/__fixtures__/tenant-capabilities.fixture';
import type { Role } from '@/types';

// Capacidades de la empresa (Fase 4): todo activo salvo que la prueba lo apague.
let capacidades = capacidadesDePrueba();
vi.mock('@/lib/tenant-capabilities', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-capabilities')>(
    '@/lib/tenant-capabilities',
  );
  return { ...real, useTenantCapabilities: () => capacidades };
});

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}));

// Tipado explicito del payload: con `unknown[]` + `as []` TypeScript deduce
// una tupla de longitud cero y `mock.calls[0][0]` deja de existir. El `tsc`
// del CI lo ve aunque las pruebas pasen.
type PayloadContacto = { phone: string; name?: string; email?: string };
const createContact = vi.fn<(payload: PayloadContacto) => Promise<{ id: string }>>(
  async () => ({ id: 'c9' }),
);
vi.mock('@/lib/contacts', async () => {
  const real = await vi.importActual<typeof import('@/lib/contacts')>('@/lib/contacts');
  return { ...real, createContact: (p: PayloadContacto) => createContact(p) };
});

const getPipelines = vi.fn(async () => [
  { id: 'p1', name: 'Embudo', isDefault: true, stages: [{ id: 's1', name: 'Nuevo', order: 0 }] },
]);
vi.mock('@/lib/pipeline', async () => {
  const real = await vi.importActual<typeof import('@/lib/pipeline')>('@/lib/pipeline');
  return { ...real, getPipelines: () => getPipelines() };
});

vi.mock('@/lib/users', async () => {
  const real = await vi.importActual<typeof import('@/lib/users')>('@/lib/users');
  return { ...real, getCompanyUsers: vi.fn(async () => []) };
});

function montar(role: Role = 'ADMIN', onCerrar = vi.fn()) {
  useAuthStore.setState({
    user: { id: 'u1', companyId: 'e1', role, name: 'Ana', email: 'a@b.c' } as never,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CreacionRapida onCerrar={onCerrar} />
    </QueryClientProvider>,
  );
  return { onCerrar };
}

describe('CreacionRapida', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    olvidarRecientes();
    capacidades = capacidadesDePrueba();
    getPipelines.mockResolvedValue([
      { id: 'p1', name: 'Embudo', isDefault: true, stages: [{ id: 's1', name: 'Nuevo', order: 0 }] },
    ]);
  });

  describe('módulos de la empresa (Fase 4)', () => {
    it('sin catálogo, un ADMIN no ve la acción del catálogo', () => {
      capacidades = capacidadesDePrueba({ modules: { catalog: false } });
      montar('ADMIN');

      expect(screen.queryByRole('button', { name: /Nuevo producto/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Nueva tarea/ })).toBeInTheDocument();
    });

    it('sin tareas ni cotizaciones desaparecen sus acciones; el resto sigue', () => {
      capacidades = capacidadesDePrueba({ modules: { tasks: false, quotes: false } });
      montar('ADMIN');

      expect(screen.queryByRole('button', { name: /Nueva tarea/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Nueva cotización/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Nuevo contacto/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Nueva oportunidad/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Nuevo producto/ })).toBeInTheDocument();
    });

    it('mientras la configuración carga, las acciones opcionales no aparecen', () => {
      capacidades = capacidadesDePrueba({ status: 'loading' });
      montar('ADMIN');

      expect(screen.queryByRole('button', { name: /Nuevo producto/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Nueva tarea/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Nuevo contacto/ })).toBeInTheDocument();
    });

    it('la acción del catálogo habla como la empresa: «Nuevo servicio» para quien solo vende servicios', () => {
      capacidades = capacidadesDePrueba({
        catalogRules: { allowedItemTypes: ['SERVICE'], defaultItemType: 'SERVICE' },
      });
      montar('ADMIN');

      expect(screen.getByRole('button', { name: /Nuevo servicio/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Nuevo producto/ })).not.toBeInTheDocument();
    });

    it('el formulario del catálogo recibe las categorías de la empresa', async () => {
      const user = userEvent.setup();
      capacidades = capacidadesDePrueba({ categories: ['Salas', 'Comedores'] });
      montar('ADMIN');

      await user.click(screen.getByRole('button', { name: /Nuevo producto/ }));
      await screen.findByRole('dialog');

      const sugeridas = Array.from(document.querySelectorAll('datalist option')).map(
        (o) => (o as HTMLOptionElement).value,
      );
      expect(sugeridas).toEqual(['Salas', 'Comedores']);
    });

    it('la oportunidad nueva usa el embudo PREDETERMINADO, no el primero de la lista', async () => {
      const user = userEvent.setup();
      getPipelines.mockResolvedValue([
        { id: 'p1', name: 'Secundario', isDefault: false, stages: [{ id: 's1', name: 'Etapa secundaria', order: 0 }] },
        { id: 'p2', name: 'Principal', isDefault: true, stages: [{ id: 's2', name: 'Etapa principal', order: 0 }] },
      ]);
      montar('ADMIN');

      await user.click(screen.getByRole('button', { name: /Nueva oportunidad/ }));

      expect(await screen.findByRole('option', { name: 'Etapa principal' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Etapa secundaria' })).not.toBeInTheDocument();
    });
  });

  describe('permisos', () => {
    it('un AGENT no ve «Nuevo producto» ni «Nuevo bot»', () => {
      montar('AGENT');

      expect(screen.queryByRole('button', { name: /Nuevo producto/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Nuevo bot/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Nuevo contacto/ })).toBeInTheDocument();
    });

    it('un MANAGER ve bot pero no producto', () => {
      montar('MANAGER');

      expect(screen.getByRole('button', { name: /Nuevo bot/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Nuevo producto/ })).not.toBeInTheDocument();
    });

    it('un ADMIN las ve todas', () => {
      montar('ADMIN');

      for (const t of [
        /Nuevo contacto/,
        /Nueva oportunidad/,
        /Nueva tarea/,
        /Nueva cotización/,
        /Nuevo producto/,
        /Nuevo bot/,
      ]) {
        expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
      }
    });
  });

  describe('acciones que navegan', () => {
    it('«Nueva cotización» lleva al embudo, porque una cotización necesita una oportunidad', async () => {
      const user = userEvent.setup();
      const { onCerrar } = montar('ADMIN');

      await user.click(screen.getByRole('button', { name: /Nueva cotización/ }));

      expect(push).toHaveBeenCalledWith('/dashboard/pipeline');
      expect(onCerrar).toHaveBeenCalled();
    });

    it('«Nuevo bot» lleva al editor', async () => {
      const user = userEvent.setup();
      montar('ADMIN');

      await user.click(screen.getByRole('button', { name: /Nuevo bot/ }));

      expect(push).toHaveBeenCalledWith('/dashboard/flowbots/new');
    });

    it('avisan de que navegan antes de pulsarlas', () => {
      montar('ADMIN');

      expect(screen.getByRole('button', { name: /Nueva cotización/ })).toHaveTextContent(
        'Elige la oportunidad',
      );
      expect(screen.getByRole('button', { name: /Nuevo bot/ })).toHaveTextContent(
        'Se abre el editor',
      );
    });
  });

  describe('acciones que abren un modal existente', () => {
    it('«Nuevo contacto» abre el MISMO modal de contactos, no otro formulario', async () => {
      const user = userEvent.setup();
      montar('ADMIN');

      await user.click(screen.getByRole('button', { name: /Nuevo contacto/ }));

      const dialogo = await screen.findByRole('dialog');
      expect(dialogo).toHaveTextContent('Nuevo contacto');
      expect(screen.getByLabelText(/Teléfono/)).toBeInTheDocument();
    });

    it('crear un contacto llama a la API y cierra la paleta', async () => {
      const user = userEvent.setup();
      const { onCerrar } = montar('ADMIN');

      await user.click(screen.getByRole('button', { name: /Nuevo contacto/ }));
      await screen.findByRole('dialog');
      await user.type(screen.getByLabelText(/Teléfono/), '+573001112233');
      await user.click(screen.getByRole('button', { name: 'Guardar' }));

      await waitFor(() => expect(createContact).toHaveBeenCalled());
      expect(createContact.mock.calls[0][0]).toMatchObject({ phone: '+573001112233' });
      await waitFor(() => expect(onCerrar).toHaveBeenCalled());
    });

    it('cerrar el modal no cierra la paleta: se puede elegir otra acción', async () => {
      const user = userEvent.setup();
      const { onCerrar } = montar('ADMIN');

      await user.click(screen.getByRole('button', { name: /Nuevo contacto/ }));
      await screen.findByRole('dialog');
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(onCerrar).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Nuevo contacto/ })).toBeInTheDocument();
    });
  });

  describe('recientes', () => {
    it('no se muestran si no hay ninguno', () => {
      montar('ADMIN');

      expect(screen.queryByText('Recientes')).not.toBeInTheDocument();
    });

    it('muestra lo abierto en esta sesión, con su tipo', () => {
      registrarReciente(
        {
          tipo: 'oportunidades',
          id: 'l1',
          titulo: 'Renovación lobby',
          subtitulo: null,
          insignia: null,
          contactoId: null,
        },
        { companyId: 'e1', userId: 'u1' },
      );
      montar('ADMIN');

      expect(screen.getByText('Recientes')).toBeInTheDocument();
      expect(screen.getByText('Renovación lobby')).toBeInTheDocument();
      expect(screen.getByText('Oportunidades')).toBeInTheDocument();
    });

    it('un reciente de OTRA sesión no aparece', () => {
      registrarReciente(
        {
          tipo: 'contactos',
          id: 'c1',
          titulo: 'De otra empresa',
          subtitulo: null,
          insignia: null,
          contactoId: 'c1',
        },
        { companyId: 'OTRA', userId: 'u9' },
      );
      montar('ADMIN');

      expect(screen.queryByText('De otra empresa')).not.toBeInTheDocument();
      expect(screen.queryByText('Recientes')).not.toBeInTheDocument();
    });

    it('pulsar un reciente abre ese objeto', async () => {
      registrarReciente(
        {
          tipo: 'cotizaciones',
          id: 'q1',
          titulo: 'COT-0521',
          subtitulo: null,
          insignia: null,
          contactoId: null,
        },
        { companyId: 'e1', userId: 'u1' },
      );
      const user = userEvent.setup();
      montar('ADMIN');

      await user.click(screen.getByRole('button', { name: /COT-0521/ }));

      expect(push).toHaveBeenCalledWith('/dashboard/quotes?open=q1');
    });
  });
});
