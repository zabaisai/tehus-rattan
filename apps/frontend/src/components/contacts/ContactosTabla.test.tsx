import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactosTabla } from './ContactosTabla';
import type { ContactoDeListado } from '@/lib/contacts';

/**
 * LAS ACCIONES DE FILA: qué se ofrece, cómo se explica y qué NO está.
 *
 * Este archivo nace de un defecto que encontró la revisión humana en la
 * papelera: a la derecha de «Restaurar» había un icono pequeño de papelera que
 * al pasar el cursor no decía nada. Eran DOS problemas en uno.
 *
 *   1. Ese icono ejecutaba la ELIMINACIÓN DEFINITIVA
 *      (`DELETE /contacts/:id/definitivo`), que está explícitamente fuera del
 *      alcance aprobado de 3.z: el incremento cubre archivar y restaurar.
 *      Venía heredado de la pantalla anterior y no se retiró al reescribirla.
 *   2. Un control de solo icono se explicaba con `title`, que tarda un segundo,
 *      no aparece al llegar por teclado y no se ve como el producto.
 */

const acciones = {
  onArchivar: vi.fn(),
  onRestaurar: vi.fn(),
  onEditar: vi.fn(),
  onFusionar: vi.fn(),
};

function fila(overrides: Partial<ContactoDeListado> = {}): ContactoDeListado {
  return {
    id: 'c1',
    nombre: 'Ana Restrepo',
    telefono: '+573001112233',
    email: 'ana@example.invalid',
    etiquetas: [],
    bloqueado: false,
    anonimizado: false,
    creadoEn: '2026-03-04T10:00:00.000Z',
    archivadoEn: null,
    motivoDeArchivo: null,
    asesor: null,
    etapa: null,
    conversacionId: null,
    ultimaInteraccionEn: null,
    tareasPendientes: 0,
    ...overrides,
  };
}

function pintar(opciones: {
  contactos?: ContactoDeListado[];
  enPapelera?: boolean;
  puedeFusionar?: boolean;
} = {}) {
  return render(
    <ContactosTabla
      contactos={opciones.contactos ?? [fila()]}
      enPapelera={opciones.enPapelera ?? false}
      puedeFusionar={opciones.puedeFusionar ?? true}
      rutaDeRegreso="/dashboard/contacts"
      acciones={acciones}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('el borrado definitivo no está en 3.z', () => {
  const archivado = () =>
    fila({ id: 'c2', archivadoEn: '2026-08-10T10:00:00.000Z' });

  it('la papelera NO ofrece eliminar definitivamente', () => {
    pintar({ contactos: [archivado()], enPapelera: true });

    expect(
      screen.queryByRole('button', { name: /eliminar definitivamente/i }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /eliminar/i })).toBeNull();
  });

  it('tampoco lo ofrece en los activos', () => {
    pintar();
    expect(screen.queryByRole('button', { name: /eliminar/i })).toBeNull();
  });

  it('en la papelera solo se puede RESTAURAR', () => {
    pintar({ contactos: [archivado()], enPapelera: true });

    const botones = screen.getAllByRole('button');
    expect(botones).toHaveLength(1);
    expect(botones[0]).toHaveAccessibleName(/restaurar/i);
  });
});

describe('todo control de solo icono tiene nombre y explicación', () => {
  it('las tres acciones de una fila activa tienen nombre accesible', () => {
    pintar();

    expect(
      screen.getByRole('button', { name: 'Editar a Ana Restrepo' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Fusionar duplicado de Ana Restrepo',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Archivar a Ana Restrepo' }),
    ).toBeInTheDocument();
  });

  it('NINGÚN botón se queda sin nombre accesible', () => {
    pintar({ contactos: [fila({ conversacionId: 'conv-1' })] });

    for (const boton of screen.getAllByRole('button')) {
      expect(boton).toHaveAccessibleName(/\S/);
    }
  });

  it('el hover explica qué hace el icono', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.hover(
      screen.getByRole('button', { name: 'Archivar a Ana Restrepo' }),
    );

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /archivar/i,
    );
  });

  it('el foco de teclado explica lo mismo que el hover', async () => {
    const usuario = userEvent.setup();
    pintar();

    // Tabulando de verdad, no con `.focus()`: lo que falló en la revisión fue
    // justo esto, llegar al control sin ratón y no obtener ninguna pista.
    // Con esta fila los focos son: nombre del contacto → editar.
    await usuario.tab();
    await usuario.tab();

    expect(
      screen.getByRole('button', { name: 'Editar a Ana Restrepo' }),
    ).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/editar/i);
  });

  it('ya no se usa `title`: era el defecto, no la solución', () => {
    pintar();
    const archivar = screen.getByRole('button', {
      name: 'Archivar a Ana Restrepo',
    });
    expect(archivar).not.toHaveAttribute('title');
  });
});

describe('cada botón hace SOLO lo suyo', () => {
  it('editar llama a editar', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.click(
      screen.getByRole('button', { name: 'Editar a Ana Restrepo' }),
    );

    expect(acciones.onEditar).toHaveBeenCalledTimes(1);
    expect(acciones.onArchivar).not.toHaveBeenCalled();
    expect(acciones.onFusionar).not.toHaveBeenCalled();
    expect(acciones.onRestaurar).not.toHaveBeenCalled();
  });

  it('fusionar llama a fusionar', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.click(
      screen.getByRole('button', { name: 'Fusionar duplicado de Ana Restrepo' }),
    );

    expect(acciones.onFusionar).toHaveBeenCalledTimes(1);
    expect(acciones.onArchivar).not.toHaveBeenCalled();
    expect(acciones.onEditar).not.toHaveBeenCalled();
  });

  it('archivar llama a archivar', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.click(
      screen.getByRole('button', { name: 'Archivar a Ana Restrepo' }),
    );

    expect(acciones.onArchivar).toHaveBeenCalledTimes(1);
    expect(acciones.onEditar).not.toHaveBeenCalled();
    expect(acciones.onFusionar).not.toHaveBeenCalled();
  });

  it('restaurar llama a restaurar', async () => {
    const usuario = userEvent.setup();
    pintar({
      contactos: [fila({ archivadoEn: '2026-08-10T10:00:00.000Z' })],
      enPapelera: true,
    });

    await usuario.click(screen.getByRole('button', { name: /restaurar/i }));

    expect(acciones.onRestaurar).toHaveBeenCalledTimes(1);
    expect(acciones.onArchivar).not.toHaveBeenCalled();
  });

  it('sin permiso de fusión, ese botón no está', () => {
    pintar({ puedeFusionar: false });

    expect(
      screen.queryByRole('button', { name: /fusionar/i }),
    ).toBeNull();
    // Los otros dos siguen.
    expect(
      screen.getByRole('button', { name: 'Editar a Ana Restrepo' }),
    ).toBeInTheDocument();
  });
});

describe('lo deshabilitado se explica en vez de desaparecer', () => {
  const anonimo = () =>
    fila({
      id: 'c3',
      nombre: 'Contacto anonimizado',
      anonimizado: true,
      archivadoEn: '2026-08-10T10:00:00.000Z',
    });

  it('un anonimizado enseña «Restaurar» DESHABILITADO, no una fila sin acciones', () => {
    // Antes se ocultaba. Una fila sin ningún control deja preguntándose si
    // falta un permiso, si está rota o si es que no se puede: tres respuestas
    // distintas para la misma pantalla en blanco.
    pintar({ contactos: [anonimo()], enPapelera: true });

    const restaurar = screen.getByRole('button', { name: /restaurar/i });
    expect(restaurar).toHaveAttribute('aria-disabled', 'true');
  });

  it('deshabilitado pero ALCANZABLE por teclado, para poder oír el motivo', () => {
    // `aria-disabled` y no `disabled`: un botón deshabilitado de verdad sale
    // del orden de tabulación, así que quien navega con teclado nunca llegaría
    // a la explicación. Justo el caso en el que más falta hace.
    pintar({ contactos: [anonimo()], enPapelera: true });

    const restaurar = screen.getByRole('button', { name: /restaurar/i });
    restaurar.focus();

    expect(restaurar).toHaveFocus();
  });

  it('y dice POR QUÉ está deshabilitado, con ratón y con foco', async () => {
    const usuario = userEvent.setup();
    pintar({ contactos: [anonimo()], enPapelera: true });

    const restaurar = screen.getByRole('button', { name: /restaurar/i });

    await usuario.hover(restaurar);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/anonimizado/i);
    await usuario.unhover(restaurar);

    restaurar.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/anonimizado/i);
  });

  it('deshabilitado de verdad: no ejecuta la acción', async () => {
    const usuario = userEvent.setup();
    pintar({ contactos: [anonimo()], enPapelera: true });

    await usuario.click(screen.getByRole('button', { name: /restaurar/i }));

    expect(acciones.onRestaurar).not.toHaveBeenCalled();
  });
});
