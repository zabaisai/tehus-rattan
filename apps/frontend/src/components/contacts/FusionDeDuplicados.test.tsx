import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FusionDeDuplicados } from './FusionDeDuplicados';

const getCandidatos = vi.fn();
const compararContactos = vi.fn();
const ejecutarFusion = vi.fn();
const descartarDuplicado = vi.fn();
const deshacerFusion = vi.fn();

vi.mock('@/lib/fusion', async () => {
  const real = await vi.importActual<typeof import('@/lib/fusion')>('@/lib/fusion');
  return {
    ...real,
    getCandidatos: (id: string) => getCandidatos(id),
    compararContactos: (p: string, d: string) => compararContactos(p, d),
    ejecutarFusion: (payload: unknown) => ejecutarFusion(payload),
    descartarDuplicado: (a: string, b: string) => descartarDuplicado(a, b),
    deshacerFusion: (id: string) => deshacerFusion(id),
  };
});

const getContacts = vi.fn();
vi.mock('@/lib/contacts', async () => {
  const real = await vi.importActual<typeof import('@/lib/contacts')>('@/lib/contacts');
  return { ...real, getContacts: () => getContacts() };
});

function contacto(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'QA_MERGE_ Laura Martinez',
    phone: '+573001110001',
    email: 'laura@example.invalid',
    tags: ['vip'],
    altPhones: [],
    altEmails: [],
    archivedAt: null,
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-08-13T10:00:00.000Z',
    mergedIntoId: null,
    ...over,
  };
}

const VISTA = {
  principal: contacto(),
  duplicado: contacto({
    id: 'd1',
    name: 'QA_MERGE_ Laura M',
    phone: '3001110002',
    email: 'laura.m@example.invalid',
    tags: ['feria'],
    archivedAt: '2026-08-02T10:00:00.000Z',
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-13T11:00:00.000Z',
  }),
  coincidencia: { nivel: 'alta' as const, razones: ['Mismo correo'] },
  campos: [
    {
      campo: 'name',
      etiqueta: 'Nombre',
      valorPrincipal: 'QA_MERGE_ Laura Martinez',
      valorDuplicado: 'QA_MERGE_ Laura M',
      iguales: false,
      sugerido: 'principal' as const,
      requiereDecision: true,
    },
    {
      campo: 'phone',
      etiqueta: 'Teléfono',
      valorPrincipal: '+573001110001',
      valorDuplicado: '3001110002',
      iguales: false,
      sugerido: 'principal' as const,
      requiereDecision: true,
    },
    {
      campo: 'email',
      etiqueta: 'Correo',
      valorPrincipal: 'laura@example.invalid',
      valorDuplicado: 'laura@example.invalid',
      iguales: true,
      sugerido: 'principal' as const,
      requiereDecision: false,
      nota: 'Mismo correo con otra escritura',
    },
  ],
  camposPersonalizados: [
    {
      campo: 'def-presupuesto',
      etiqueta: 'Presupuesto',
      valorPrincipal: '15-20 millones',
      valorDuplicado: '10-15 millones',
      iguales: false,
      sugerido: 'principal' as const,
      requiereDecision: true,
    },
  ],
  etiquetas: { principal: ['vip'], duplicado: ['feria'], union: ['vip', 'feria'] },
  identidadesAlternativas: {
    telefonos: ['+573001110002'],
    correos: ['laura.m@example.invalid'],
  },
  relaciones: {
    conversaciones: 2,
    mensajes: 9,
    oportunidades: 1,
    tareas: 3,
    sugerenciasDeTarea: 0,
    cotizaciones: 1,
    camposPersonalizados: 1,
    ejecucionesDeBot: 0,
    notas: 2,
  },
  versiones: { principal: 'v-p', duplicado: 'v-d' },
  decisionesPendientes: 3,
};

/** Lo que se movió del duplicado: suma 9. */
const TRASLADADAS = {
  conversaciones: 1,
  mensajes: 3,
  oportunidades: 1,
  tareas: 1,
  sugerenciasDeTarea: 0,
  cotizaciones: 1,
  camposPersonalizados: 1,
  ejecucionesDeBot: 0,
  notas: 1,
};

/** Lo que queda en el contacto resultante: suma 11. Distinto a propósito. */
const CONSERVADO = {
  conversaciones: 2,
  mensajes: 4,
  oportunidades: 1,
  tareas: 1,
  sugerenciasDeTarea: 0,
  cotizaciones: 1,
  camposPersonalizados: 1,
  ejecucionesDeBot: 0,
  notas: 1,
};

const RESULTADO = {
  mergeId: 'm1',
  principalId: 'p1',
  duplicadoId: 'd1',
  trasladadas: TRASLADADAS,
  totalConservado: CONSERVADO,
  realizadaEn: '2026-08-13T12:00:00.000Z',
  deshacerHasta: '',
  segundosRestantes: 540,
  deshecha: false,
};

/** Marca fresca en cada prueba: si no, la suite completa la deja vencida. */
function resultadoConVentana(minutos = 9) {
  return {
    ...RESULTADO,
    deshacerHasta: new Date(Date.now() + minutos * 60_000).toISOString(),
  };
}

/**
 * El componente es CONTROLADO: el par de contactos llega por props y vive en
 * la ruta, no en su estado. Aquí se monta con un padre mínimo que hace lo
 * mismo que la pantalla real —guardar lo que le avisan y volver a pasarlo—,
 * porque si nadie responde al aviso el componente se queda quieto, que es
 * exactamente lo que debe pasar.
 */
function montar(props: Partial<Parameters<typeof FusionDeDuplicados>[0]> = {}) {
  const onCerrar = vi.fn();
  const onFusionado = vi.fn();
  const onCambioDeSeleccion = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Padre() {
    const [sel, setSel] = useState<{
      principalId: string;
      duplicadoId: string | null;
    }>({
      principalId: (props.contactoId as string) ?? 'p1',
      duplicadoId: (props.duplicadoInicialId as string | null) ?? null,
    });
    return (
      <FusionDeDuplicados
        puedeEjecutar
        onCerrar={onCerrar}
        onFusionado={onFusionado}
        {...props}
        contactoId={sel.principalId}
        duplicadoInicialId={sel.duplicadoId}
        onCambioDeSeleccion={(s) => {
          onCambioDeSeleccion(s);
          setSel({ principalId: s.principalId, duplicadoId: s.duplicadoId });
        }}
      />
    );
  }

  const utils = render(
    <QueryClientProvider client={client}>
      <Padre />
    </QueryClientProvider>,
  );
  return { ...utils, onCerrar, onFusionado, onCambioDeSeleccion };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCandidatos.mockResolvedValue([
    {
      contacto: VISTA.duplicado,
      nivel: 'alta',
      razones: ['Mismo correo', 'Nombre parecido'],
    },
  ]);
  compararContactos.mockResolvedValue(VISTA);
  ejecutarFusion.mockResolvedValue(resultadoConVentana());
  descartarDuplicado.mockResolvedValue({ descartado: true, nuevo: true });
  deshacerFusion.mockResolvedValue({ deshecha: true });
  getContacts.mockResolvedValue([
    contacto({ id: 'otro', name: 'QA_MERGE_ Otro Distinto', phone: '+573009999999' }),
  ]);
});

async function irAResolver(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Comparar' }));
  await screen.findByText('Coincidencia alta · Mismo correo');
  await user.click(screen.getByRole('button', { name: 'Resolver diferencias' }));
  await screen.findByText('Elige el valor final');
}

describe('FusionDeDuplicados — flujo del mockup 22', () => {
  describe('permisos', () => {
    it('un AGENT ve por qué no puede y no se le ofrece ninguna acción', () => {
      montar({ puedeEjecutar: false });

      expect(
        screen.getByText('Fusionar contactos es para administradores'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /fusionar contactos$/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('paso 1 — elegir con quién', () => {
    it('lista los candidatos con su nivel y su razón', async () => {
      montar();
      expect(await screen.findByText('Coincidencia alta')).toBeInTheDocument();
      expect(
        screen.getByText('Mismo correo · Nombre parecido'),
      ).toBeInTheDocument();
    });

    it('sin candidatos lo dice y deja elegir a mano', async () => {
      getCandidatos.mockResolvedValue([]);
      const user = userEvent.setup();
      montar();

      expect(
        await screen.findByText(/No encontramos duplicados de este contacto/),
      ).toBeInTheDocument();

      await user.type(
        screen.getByLabelText('Buscar un contacto para comparar'),
        'Otro',
      );
      await user.click(await screen.findByText('QA_MERGE_ Otro Distinto'));

      expect(compararContactos).toHaveBeenCalledWith('p1', 'otro');
    });

    it('«No son duplicados» descarta la pareja y no toca los contactos', async () => {
      const user = userEvent.setup();
      montar();

      await user.click(
        await screen.findByRole('button', { name: 'No son duplicados' }),
      );

      expect(descartarDuplicado).toHaveBeenCalledWith('p1', 'd1');
      expect(ejecutarFusion).not.toHaveBeenCalled();
    });

    it('mientras carga anuncia ocupado en vez de enseñar una lista vacía', () => {
      getCandidatos.mockReturnValue(new Promise(() => {}));
      const { container } = montar();
      expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    });

    it('un error se anuncia como alerta', async () => {
      getCandidatos.mockRejectedValue({ response: { status: 500 } });
      montar();
      expect(await screen.findByRole('alert')).toBeInTheDocument();
    });
  });

  describe('paso 2 — comparar', () => {
    it('enseña ambos contactos, las fechas y que el duplicado está archivado', async () => {
      const user = userEvent.setup();
      montar();
      await user.click(await screen.findByRole('button', { name: 'Comparar' }));

      expect(await screen.findByText('Contacto principal')).toBeInTheDocument();
      expect(screen.getByText('Posible duplicado')).toBeInTheDocument();
      expect(screen.getByText('Archivado')).toBeInTheDocument();
      expect(screen.getAllByText(/Creado el/)).toHaveLength(2);
    });

    it('cambiar el principal invierte la pareja y descarta las decisiones previas', async () => {
      const user = userEvent.setup();
      const { onCambioDeSeleccion } = montar();
      await irAResolver(user);

      // Se decide un campo…
      await user.click(
        screen.getByRole('radio', {
          name: /Nombre: usar «QA_MERGE_ Laura M» del posible duplicado/,
        }),
      );
      await user.click(screen.getByRole('button', { name: 'Volver' }));

      // …y al invertir el principal, esa decisión ya no significa lo mismo.
      await user.click(
        screen.getByRole('button', { name: 'Cambiar contacto principal' }),
      );

      // LOS DOS EXTREMOS EN EL MISMO AVISO: el que era duplicado pasa a
      // principal y viceversa. Mandar solo uno fue lo que produjo la
      // comparación de un contacto consigo mismo.
      expect(onCambioDeSeleccion).toHaveBeenLastCalledWith(
        expect.objectContaining({ principalId: 'd1', duplicadoId: 'p1' }),
      );
      await waitFor(() => expect(compararContactos).toHaveBeenCalledWith('d1', 'p1'));
    });
  });

  describe('paso 3 — resolver diferencias', () => {
    it('preselecciona el valor del principal en cada campo', async () => {
      const user = userEvent.setup();
      montar();
      await irAResolver(user);

      const delPrincipal = screen.getByRole('radio', {
        name: /Nombre: usar «QA_MERGE_ Laura Martinez» del contacto principal/,
      });
      expect(delPrincipal).toBeChecked();
    });

    it('un campo que ya coincide no pide decisión', async () => {
      const user = userEvent.setup();
      montar();
      await irAResolver(user);

      expect(
        screen.getByRole('radio', {
          name: /Correo: usar «laura@example.invalid» del contacto principal/,
        }),
      ).toBeDisabled();
      expect(
        screen.getByText('Mismo correo con otra escritura'),
      ).toBeInTheDocument();
    });

    it('las etiquetas se enseñan combinadas y sin repetir', async () => {
      const user = userEvent.setup();
      montar();
      await irAResolver(user);

      const seccion = screen.getByRole('region', { name: 'Etiquetas combinadas' });
      expect(within(seccion).getByText('vip')).toBeInTheDocument();
      expect(within(seccion).getByText('feria')).toBeInTheDocument();
    });

    it('los campos personalizados salen del contrato, no inventados', async () => {
      const user = userEvent.setup();
      montar();
      await irAResolver(user);
      // Aparece como nombre del grupo de radios y como etiqueta visible: la
      // segunda va `aria-hidden` para no leerse dos veces.
      const grupo = screen.getByRole('group', { name: 'Presupuesto' });
      expect(
        within(grupo).getByRole('radio', {
          name: /Presupuesto: usar «15-20 millones» del contacto principal/,
        }),
      ).toBeChecked();
    });

    it('las identidades alternativas se pueden conservar y se enseñan', async () => {
      const user = userEvent.setup();
      montar();
      await irAResolver(user);

      expect(screen.getByText(/\+573001110002/)).toBeInTheDocument();
      const casilla = screen.getByRole('checkbox', {
        name: /Conservar el teléfono y el correo/,
      });
      expect(casilla).toBeChecked();
    });

    it('el resumen de relaciones es el real y NO enseña consentimientos', async () => {
      const user = userEvent.setup();
      montar();
      await irAResolver(user);

      const resumen = screen.getByRole('region', { name: 'Todo esto se conservará' });
      expect(within(resumen).getByText('conversaciones')).toBeInTheDocument();
      expect(within(resumen).getByText('9')).toBeInTheDocument();
      expect(within(resumen).queryByText(/consentimiento/i)).not.toBeInTheDocument();
    });

    /**
     * SIN DESBORDAMIENTO HORIZONTAL.
     *
     * jsdom no calcula maquetación, así que aquí no se mide el desborde: se
     * fijan las condiciones que lo hacen imposible. Un elemento de retícula o
     * de flex tiene `min-width: auto`, así que una cadena sin puntos de corte
     * —un correo como `valentina.ocampo@example.invalid`— empuja su columna
     * hasta su ancho intrínseco y arrastra la tabla entera. Medido en
     * navegador antes de arreglarlo: 195 px de exceso en 1280, 1366, 1440 y
     * 1920, con la columna del valor final recortada.
     *
     * Hacen falta las dos cosas: `min-w-0` para que la columna PUEDA
     * encogerse, y una clase de corte para que el texto largo se reparta en
     * varias líneas en vez de exigir una sola. Con una sola de las dos el
     * desborde vuelve.
     */
    it('las celdas pueden encogerse y los valores largos parten: sin desborde horizontal', async () => {
      const user = userEvent.setup();
      const { container } = montar();
      await irAResolver(user);

      const filas = container.querySelectorAll('fieldset');
      expect(filas.length).toBeGreaterThan(0);

      for (const fila of filas) {
        const rejilla = fila.querySelector('div');
        expect(rejilla?.className).toContain('min-w-0');

        // Cada celda de la fila tiene que poder encogerse.
        for (const celda of rejilla!.children)
          expect(celda.className).toContain('min-w-0');
      }

      // El valor final se parte en vez de exigir una línea entera, y no se
      // recorta: el contenido completo sigue siendo legible.
      const correo = screen.getAllByText('laura@example.invalid')[0];
      expect(correo.className).toMatch(/break-words|break-all/);
      expect(correo.className).not.toContain('truncate');
    });

    it('dice cuántas diferencias faltan por decidir', async () => {
      const user = userEvent.setup();
      montar();
      await irAResolver(user);
      expect(
        screen.getByText('3 diferencias requieren tu decisión'),
      ).toBeInTheDocument();
    });
  });

  describe('paso 4 — confirmar', () => {
    async function irAConfirmar(user: ReturnType<typeof userEvent.setup>) {
      await irAResolver(user);
      await user.click(
        screen.getByRole('button', { name: 'Continuar a confirmación' }),
      );
      await screen.findByText(/será el contacto principal/);
    }

    it('sin marcar la confirmación explícita, el botón no fusiona', async () => {
      const user = userEvent.setup();
      montar();
      await irAConfirmar(user);

      const boton = screen.getByRole('button', { name: 'Sí, fusionar contactos' });
      expect(boton).toBeDisabled();
      await user.click(boton);
      expect(ejecutarFusion).not.toHaveBeenCalled();
    });

    it('promete lo que el backend garantiza y nada más', async () => {
      const user = userEvent.setup();
      montar();
      await irAConfirmar(user);

      expect(screen.getByText('No se enviará ningún mensaje.')).toBeInTheDocument();
      expect(
        screen.getByText('No se moverá ninguna oportunidad de etapa.'),
      ).toBeInTheDocument();
      expect(screen.getByText(/quedará como alias interno/)).toBeInTheDocument();
      // El alias y la redirección son garantías permanentes, no interruptores.
      expect(
        screen.queryByRole('switch', { name: /alias|redirig/i }),
      ).not.toBeInTheDocument();
      // Y NO se promete que un administrador pueda restaurarla después desde
      // Auditoría: esa capacidad no existe. Sí se dice que queda registrada,
      // que es cierto.
      expect(screen.queryByText(/restaurar/i)).not.toBeInTheDocument();
      expect(
        screen.getByText(/queda registrada en la auditoría/i),
      ).toBeInTheDocument();
    });

    it('envía las versiones de la vista previa y las decisiones tomadas', async () => {
      const user = userEvent.setup();
      montar();
      await irAResolver(user);
      await user.click(
        screen.getByRole('radio', {
          name: /Presupuesto: usar «10-15 millones» del posible duplicado/,
        }),
      );
      await user.click(
        screen.getByRole('button', { name: 'Continuar a confirmación' }),
      );
      await screen.findByText(/será el contacto principal/);
      await user.click(
        screen.getByRole('checkbox', { name: /misma persona/ }),
      );
      await user.click(screen.getByRole('button', { name: 'Sí, fusionar contactos' }));

      await waitFor(() => expect(ejecutarFusion).toHaveBeenCalled());
      expect(ejecutarFusion.mock.calls[0][0]).toMatchObject({
        principalId: 'p1',
        duplicadoId: 'd1',
        versiones: { principal: 'v-p', duplicado: 'v-d' },
        elecciones: {
          camposPersonalizados: { 'def-presupuesto': 'duplicado' },
          conservarAlternativas: true,
        },
      });
    });

    it('un 409 por vista previa obsoleta ofrece volver a comparar, no reintentar', async () => {
      ejecutarFusion.mockRejectedValue({
        response: { status: 409, data: { codigo: 'VISTA_PREVIA_OBSOLETA' } },
      });
      const user = userEvent.setup();
      montar();
      await irAConfirmar(user);
      await user.click(screen.getByRole('checkbox', { name: /misma persona/ }));
      await user.click(screen.getByRole('button', { name: 'Sí, fusionar contactos' }));

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(/Vuelve a compararlos/);
      expect(
        within(alerta).getByRole('button', { name: 'Volver a comparar' }),
      ).toBeInTheDocument();
    });
  });

  describe('paso 5 — resultado y deshacer', () => {
    async function fusionar(user: ReturnType<typeof userEvent.setup>) {
      await irAResolver(user);
      await user.click(
        screen.getByRole('button', { name: 'Continuar a confirmación' }),
      );
      await screen.findByText(/será el contacto principal/);
      await user.click(screen.getByRole('checkbox', { name: /misma persona/ }));
      await user.click(screen.getByRole('button', { name: 'Sí, fusionar contactos' }));
      await screen.findByText(/se conservaron \d+ registros/i);
    }

    it('enseña el éxito con el recuento real y lleva al contacto canónico', async () => {
      const user = userEvent.setup();
      const { onFusionado } = montar();
      await fusionar(user);

      expect(screen.getByText(/se conservaron 11 registros/i)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Ver el contacto' }));
      expect(onFusionado).toHaveBeenCalledWith('p1');
    });

    /**
     * LA CONTRADICCION QUE ENCONTRO LA REVISION. La confirmacion prometia «se
     * conservaran 10» y el exito decia «se conservaron 9», porque la pantalla
     * llamaba «conservados» al contador de lo TRASLADADO. Son dos preguntas
     * distintas: lo que cambio de dueño y lo que el contacto resultante
     * tiene. Aqui los dos recuentos son distintos a proposito —9 y 11— para
     * que confundirlos no pueda pasar inadvertido.
     */
    it('no llama «conservados» a lo trasladado: enseña las dos cifras', async () => {
      const user = userEvent.setup();
      montar();
      await fusionar(user);

      const aviso = screen.getByText(/se conservaron \d+ registros/i);
      expect(aviso).toHaveTextContent(/se trasladaron 9 registros/i);
      expect(aviso).toHaveTextContent(/se conservaron 11 registros/i);
      // Y NUNCA la cifra de trasladados presentada como conservados.
      expect(aviso).not.toHaveTextContent(/conservaron 9/i);
    });

    it('la cuenta atrás sale de `deshacerHasta` del servidor', async () => {
      const user = userEvent.setup();
      montar();
      await fusionar(user);
      // La ventana del servidor era de 9 minutos, así que lo que se enseña
      // está por debajo de 9:00 y nunca es el «10:00» que saldría de contar
      // diez minutos desde el navegador.
      const reloj = screen.getByText(/^\d:\d\d$/).textContent!;
      const [m, sg] = reloj.split(':').map(Number);
      expect(m * 60 + sg).toBeGreaterThan(8 * 60);
      expect(m * 60 + sg).toBeLessThanOrEqual(9 * 60);
    });

    it('deshacer con éxito lo dice y deja de ofrecer el botón', async () => {
      const user = userEvent.setup();
      montar();
      await fusionar(user);

      await user.click(screen.getByRole('button', { name: 'Deshacer' }));
      expect(await screen.findByText(/La fusión se deshizo/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
    });

    it('una ventana vencida se explica y no ofrece deshacer', async () => {
      ejecutarFusion.mockResolvedValue({
        ...RESULTADO,
        deshacerHasta: new Date(Date.now() - 1000).toISOString(),
        segundosRestantes: 0,
      });
      const user = userEvent.setup();
      montar();
      await fusionar(user);

      expect(
        screen.getByText(/Ya pasaron los 10 minutos/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
    });

    it('una reversión bloqueada lo explica sin culpar al usuario', async () => {
      deshacerFusion.mockRejectedValue({
        response: { status: 409, data: { codigo: 'REVERSION_INSEGURA' } },
      });
      const user = userEvent.setup();
      montar();
      await fusionar(user);
      await user.click(screen.getByRole('button', { name: 'Deshacer' }));

      expect(
        await screen.findByText(/algo cambió después de la fusión/i),
      ).toBeInTheDocument();
    });
  });

  describe('teclado y foco', () => {
    it('el diálogo atrapa el foco y se anuncia como modal', async () => {
      montar();
      const dialogo = await screen.findByRole('dialog');
      expect(dialogo).toHaveAttribute('aria-modal', 'true');
      await waitFor(() => expect(dialogo.contains(document.activeElement)).toBe(true));
    });

    it('Escape cierra cuando no hay nada que perder', async () => {
      const user = userEvent.setup();
      const { onCerrar } = montar();
      await screen.findByText('Posibles duplicados');
      await user.keyboard('{Escape}');
      expect(onCerrar).toHaveBeenCalled();
    });

    it('si ya hay decisiones, avisa antes de perderlas en vez de cerrar', async () => {
      const user = userEvent.setup();
      const { onCerrar } = montar();
      await irAResolver(user);
      await user.click(
        screen.getByRole('radio', {
          name: /Nombre: usar «QA_MERGE_ Laura M» del posible duplicado/,
        }),
      );

      await user.keyboard('{Escape}');

      expect(onCerrar).not.toHaveBeenCalled();
      expect(
        await screen.findByRole('alertdialog', { name: 'Confirmar salida' }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Salir sin fusionar' }));
      expect(onCerrar).toHaveBeenCalled();
    });
  });
});
