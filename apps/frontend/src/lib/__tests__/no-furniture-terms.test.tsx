import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import ProductsPage from '@/app/dashboard/products/page';
import { ProductModal } from '@/components/products/ProductModal';
import { AddProductToLeadModal } from '@/components/leads/AddProductToLeadModal';
import { LeadFormModal } from '@/components/leads/LeadFormModal';
import type { PipelineStage, Product } from '@/types';
import { capacidadesDeCatalogo } from '@/lib/__fixtures__/catalogo.fixture';

/**
 * TAKTO es multi-sector. Las pantallas comerciales heredaron ejemplos de la
 * primera empresa (mobiliario) en marcadores, ayudas y vacíos; para una
 * veterinaria, una clínica o una agencia eso se lee como «este producto no es
 * para mí». Esta prueba monta cada pantalla como la vería una empresa de
 * servicios de OTRO sector y comprueba que ninguna palabra del sector inicial
 * aparece en lo que se ve, se lee por lector de pantalla o se muestra como
 * ejemplo.
 */
const TERMINOS_DEL_SECTOR_INICIAL = /mueble|rattan|Salas|Comedores/i;

const capacidades = capacidadesDeCatalogo(['SERVICE'], {
  identity: { industry: 'veterinary_pet', businessType: 'clinic' },
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/products',
}));

vi.mock('@/components/capabilities/RequireTenantCapability', () => ({
  RequireTenantCapability: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/tenant-capabilities', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-capabilities')>('@/lib/tenant-capabilities');
  return { ...real, useTenantCapabilities: () => capacidades };
});

vi.mock('@/lib/tenant-configuration', async () => {
  const real = await vi.importActual<typeof import('@/lib/tenant-configuration')>('@/lib/tenant-configuration');
  const fetchConfig = async () => capacidades.configuration;
  return {
    ...real,
    getMyTenantConfiguration: fetchConfig,
    useTenantConfiguration: () =>
      useQuery({ queryKey: real.TENANT_CONFIGURATION_QUERY_KEY, queryFn: fetchConfig }),
  };
});

// Datos de la empresa de prueba, sin nada del sector inicial: lo que se busca
// son palabras que pone el PRODUCTO, no las que trae el cliente.
const productos: Product[] = [
  { id: 'p1', name: 'Consulta general', category: 'Consultas', price: 80000, isActive: true, itemType: 'SERVICE' } as Product,
  // Heredado: un producto en una empresa de solo servicios.
  { id: 'p2', name: 'Alimento premium', category: 'Alimentos', price: 45000, isActive: true, itemType: 'PRODUCT' } as Product,
];

vi.mock('@/lib/products', async () => {
  const real = await vi.importActual<typeof import('@/lib/products')>('@/lib/products');
  return {
    ...real,
    getProducts: vi.fn(async () => productos),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deactivateProduct: vi.fn(),
  };
});

vi.mock('@/lib/companies', () => ({
  getMyCompany: vi.fn(async () => ({ id: 'e1', name: 'Clínica Vet', city: null })),
  resolveCompanyAssetUrl: (u: string) => u,
}));

vi.mock('@/lib/company-settings', async () => {
  const real = await vi.importActual<typeof import('@/lib/company-settings')>('@/lib/company-settings');
  const fetchSettings = async () => ({
    version: 2 as const,
    commercial: { sellsProducts: false, sellsServices: true, usesCatalog: true, usesQuotes: true, usesTasks: false },
    catalog: { categories: ['Consultas', 'Alimentos'], allowFreeText: true as const },
    vertical: null,
    pipelineDefaults: null,
    limits: { categories: { maxLength: 60, maxCount: 30 } },
  });
  return {
    ...real,
    getMyCompanySettings: fetchSettings,
    useCompanySettings: () =>
      useQuery({ queryKey: real.COMPANY_SETTINGS_QUERY_KEY, queryFn: fetchSettings }),
  };
});

vi.mock('@/lib/contacts', async () => {
  const real = await vi.importActual<typeof import('@/lib/contacts')>('@/lib/contacts');
  return { ...real, getContacts: vi.fn(async () => [{ id: 'c1', name: 'Laura Pérez', phone: '+57300' }]) };
});
vi.mock('@/lib/users', async () => {
  const real = await vi.importActual<typeof import('@/lib/users')>('@/lib/users');
  return { ...real, getCompanyUsers: vi.fn(async () => []) };
});
vi.mock('@/lib/leads', async () => {
  const real = await vi.importActual<typeof import('@/lib/leads')>('@/lib/leads');
  return { ...real, createLead: vi.fn() };
});

/**
 * Todo lo que la pantalla pone delante de alguien: el texto visible, los
 * marcadores de posición (que nadie ve en el DOM de texto), los nombres
 * accesibles y las ayudas emergentes.
 */
function textosVisibles(raiz: ParentNode): string[] {
  const textos: string[] = [];
  raiz.querySelectorAll('*').forEach((el) => {
    for (const atributo of ['placeholder', 'aria-label', 'title', 'alt']) {
      const v = el.getAttribute(atributo);
      if (v) textos.push(v);
    }
  });
  textos.push(raiz.textContent ?? '');
  return textos;
}

function sinTerminosDelSectorInicial(raiz: ParentNode) {
  const culpables = textosVisibles(raiz).filter((t) => TERMINOS_DEL_SECTOR_INICIAL.test(t));
  expect(culpables).toEqual([]);
}

function conCliente(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const etapas: PipelineStage[] = [
  { id: 's1', name: 'Nuevo', order: 0, color: null, isInitial: true },
];

describe('Vocabulario neutro para una empresa de otro sector (veterinaria, solo servicios)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el catálogo, con elementos y con la ficha abierta', async () => {
    const user = userEvent.setup();
    conCliente(<ProductsPage />);
    await screen.findByText('Consulta general');
    // Hay un heredado en la lista: también su explicación debe ser neutra.
    expect(screen.getByText('Heredado')).toBeInTheDocument();
    sinTerminosDelSectorInicial(document.body);

    await user.click(screen.getByRole('button', { name: /Nuevo servicio/ }));
    await screen.findByRole('dialog');
    sinTerminosDelSectorInicial(document.body);
  });

  it('el formulario del catálogo al crear y al editar un heredado, en los tres modos', () => {
    for (const permitidos of [['SERVICE'], ['PRODUCT'], ['PRODUCT', 'SERVICE']] as const) {
      const creando = render(
        <ProductModal
          product={null}
          allowedItemTypes={[...permitidos]}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );
      sinTerminosDelSectorInicial(document.body);
      creando.unmount();

      const editando = render(
        <ProductModal
          product={productos[1]}
          allowedItemTypes={[...permitidos]}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );
      sinTerminosDelSectorInicial(document.body);
      editando.unmount();
    }
  });

  it('agregar un elemento a la oportunidad, incluida la línea de notas', async () => {
    const user = userEvent.setup();
    conCliente(<AddProductToLeadModal onClose={vi.fn()} onAdd={vi.fn(async () => undefined)} />);
    const fila = (await screen.findByText('Consulta general')).closest('label')!;
    await user.click(within(fila).getByRole('radio'));
    expect(screen.getByLabelText(/Notas/)).toHaveAttribute('placeholder', 'Notas para esta línea');
    sinTerminosDelSectorInicial(document.body);
  });

  it('la nueva oportunidad, antes y después de elegir contacto', async () => {
    const user = userEvent.setup();
    conCliente(
      <LeadFormModal pipelineId="p1" stages={etapas} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    await screen.findByRole('option', { name: 'Laura Pérez' });
    sinTerminosDelSectorInicial(document.body);
    await user.selectOptions(screen.getByLabelText(/Contacto/), 'c1');
    sinTerminosDelSectorInicial(document.body);
  });
});
