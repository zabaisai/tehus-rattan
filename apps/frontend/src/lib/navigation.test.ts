import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, PLATFORM_NAV_ITEMS, visibleNavItems } from './navigation';
import type { TenantCapabilityKey } from './tenant-capabilities';

const TODO = () => true;
const NADA = () => false;
const solo =
  (...activas: TenantCapabilityKey[]) =>
  (k: TenantCapabilityKey) =>
    activas.includes(k);

const claves = (items: ReturnType<typeof visibleNavItems>) => items.map((i) => i.key);

describe('visibleNavItems — módulos', () => {
  it('con todo activo y listo, un ADMIN ve todas las entradas', () => {
    const visibles = visibleNavItems(NAV_ITEMS, { role: 'ADMIN', can: TODO, isReady: true });

    expect(claves(visibles)).toEqual(NAV_ITEMS.map((i) => i.key));
  });

  it('un módulo apagado quita SU entrada y solo la suya', () => {
    const visibles = visibleNavItems(NAV_ITEMS, {
      role: 'ADMIN',
      can: solo('tasks', 'quotes'),
      isReady: true,
    });

    expect(claves(visibles)).not.toContain('catalogo');
    expect(claves(visibles)).toEqual(expect.arrayContaining(['tareas', 'cotizaciones']));
  });

  it('mientras NO está lista la configuración, ninguna entrada opcional aparece, aunque `can` diga sí', () => {
    // Un módulo prohibido no debe aparecer un instante y desaparecer.
    const visibles = visibleNavItems(NAV_ITEMS, { role: 'ADMIN', can: TODO, isReady: false });

    expect(claves(visibles)).not.toContain('tareas');
    expect(claves(visibles)).not.toContain('catalogo');
    expect(claves(visibles)).not.toContain('cotizaciones');
  });

  it('mientras carga (o con error), las entradas centrales siguen enteras', () => {
    const visibles = visibleNavItems(NAV_ITEMS, { role: 'AGENT', can: NADA, isReady: false });

    expect(claves(visibles)).toEqual([
      'inicio',
      'contactos',
      'pipeline',
      'conversaciones',
      'pulso',
      'documentos',
    ]);
  });

  it('la entrada del catálogo se llama «Catálogo», no «Productos»: sirve igual a quien vende servicios', () => {
    expect(NAV_ITEMS.find((i) => i.key === 'catalogo')?.label).toBe('Catálogo');
  });
});

describe('visibleNavItems — roles', () => {
  it('un AGENT no ve las entradas de administración', () => {
    const visibles = visibleNavItems(NAV_ITEMS, { role: 'AGENT', can: TODO, isReady: true });

    for (const k of ['automatizaciones', 'whatsapp', 'empresa', 'datos']) {
      expect(claves(visibles)).not.toContain(k);
    }
  });

  it('un ADMIN sí las ve', () => {
    const visibles = visibleNavItems(NAV_ITEMS, { role: 'ADMIN', can: TODO, isReady: true });

    expect(claves(visibles)).toEqual(
      expect.arrayContaining(['automatizaciones', 'whatsapp', 'empresa', 'datos']),
    );
  });

  it('sin rol, solo lo que no exige ninguno', () => {
    const visibles = visibleNavItems(NAV_ITEMS, { role: undefined, can: TODO, isReady: true });

    expect(claves(visibles)).not.toContain('empresa');
    expect(claves(visibles)).toContain('inicio');
  });

  it('la navegación de plataforma no depende de capacidades de empresa', () => {
    // Un SUPER_ADMIN de plataforma no tiene empresa: sus entradas no llevan
    // `capability` y se ven enteras con `isReady` en falso.
    expect(PLATFORM_NAV_ITEMS.every((i) => !i.capability)).toBe(true);
    expect(
      visibleNavItems(PLATFORM_NAV_ITEMS, { role: 'SUPER_ADMIN', can: NADA, isReady: false }),
    ).toHaveLength(PLATFORM_NAV_ITEMS.length);
  });
});
