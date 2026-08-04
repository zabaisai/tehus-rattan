'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Info, Trash2, X } from 'lucide-react';
import type {
  CampoConfigDto,
  NodoCatalogoDto,
  NodoFlow,
  Problema,
  VariableDto,
} from '@/lib/flowbots';
import { Button } from '@/components/ui/Button';
import { SelectorVariables } from './SelectorVariables';
import { useRecursos, type OpcionRecurso } from './useRecursos';

/**
 * El panel que configura el paso seleccionado.
 *
 * LOS CAMPOS SALEN DEL CONTRATO, uno por uno, tal y como los declara el
 * servidor: nombre, tipo, si es obligatorio y a qué recurso apunta. No hay un
 * formulario escrito a mano por tipo de paso, porque cincuenta formularios a
 * mano se desincronizan del motor en cuanto alguien añade un campo, y el
 * síntoma es un flujo que no valida sin que se vea por qué.
 *
 * Lo que SÍ está a mano es cómo se dibuja cada TIPO de campo —un texto largo
 * con selector de variables, una lista de opciones que además crea puertos, un
 * desplegable de etapas—, que es presentación y no contrato.
 */
export function PanelConfiguracion({
  nodo,
  definicion,
  problemas,
  variables,
  soloLectura,
  campoEnfocado,
  tiposAnteriores,
  onCambiar,
  onRenombrar,
  onDuplicar,
  onEliminar,
  onCerrar,
}: {
  nodo: NodoFlow;
  definicion: NodoCatalogoDto | null;
  problemas: Problema[];
  variables: VariableDto[];
  soloLectura: boolean;
  campoEnfocado?: string | null;
  tiposAnteriores: Set<string>;
  onCambiar: (config: Record<string, unknown>) => void;
  onRenombrar: (etiqueta: string) => void;
  onDuplicar: () => void;
  onEliminar: () => void;
  onCerrar: () => void;
}) {
  const recursos = useRecursos(true);
  const contenedor = useRef<HTMLDivElement>(null);

  // Al pulsar un problema de la bandeja hay que acabar CON EL CURSOR EN EL
  // CAMPO, no en el panel: dejar a alguien delante de doce campos con la
  // instrucción «uno de estos está mal» es la mitad del trabajo.
  useEffect(() => {
    if (!campoEnfocado) return;
    const campo = contenedor.current?.querySelector<HTMLElement>(
      `[data-campo="${CSS.escape(campoEnfocado)}"]`,
    );
    campo?.focus();
    campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [campoEnfocado, nodo.id]);

  function actualizar(nombre: string, valor: unknown) {
    const siguiente = { ...nodo.config };
    if (valor === '' || valor === undefined) delete siguiente[nombre];
    else siguiente[nombre] = valor;
    onCambiar(siguiente);
  }

  const problemasDe = (campo: string) =>
    problemas.filter((p) => p.campo === campo);

  return (
    <aside
      ref={contenedor}
      aria-label={`Configuración de ${nodo.label ?? definicion?.etiqueta ?? nodo.type}`}
      className="flex h-full w-full flex-col overflow-y-auto border-l border-neutral-200 bg-white"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-neutral-200 bg-white px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-neutral-400">
            {definicion?.etiqueta ?? nodo.type}
          </p>
          <input
            value={nodo.label ?? ''}
            disabled={soloLectura}
            onChange={(e) => onRenombrar(e.target.value)}
            placeholder={definicion?.etiqueta ?? 'Nombre del paso'}
            aria-label="Nombre del paso"
            className="w-full border-0 p-0 text-sm font-semibold text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-line-focus disabled:bg-transparent"
          />
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar la configuración"
          className="rounded p-1 text-neutral-400 outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 space-y-3 px-3 py-3">
        {definicion?.ayuda && (
          <p className="flex items-start gap-1.5 rounded-md bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-600">
            <Info size={12} className="mt-px shrink-0 text-neutral-400" />
            {definicion.ayuda}
          </p>
        )}

        {!definicion && (
          <p className="rounded-md border border-status-warning bg-status-warning-surface px-2 py-1.5 text-[11px] text-status-warning">
            Este paso es de un tipo que ya no está en el catálogo. Puedes
            borrarlo, pero no configurarlo.
          </p>
        )}

        {definicion?.config.length === 0 && (
          <p className="text-[11px] text-neutral-500">
            Este paso no necesita configuración.
          </p>
        )}

        {(definicion?.config ?? []).map((campo) => (
          <Campo
            key={campo.nombre}
            campo={campo}
            valor={nodo.config[campo.nombre]}
            problemas={problemasDe(campo.nombre)}
            variables={variables}
            tiposAnteriores={tiposAnteriores}
            soloLectura={soloLectura}
            opciones={recursos.opciones(campo.referencia)}
            onCambiar={(v) => actualizar(campo.nombre, v)}
          />
        ))}

        {problemas.filter((p) => !p.campo).length > 0 && (
          <ul className="space-y-1">
            {problemas
              .filter((p) => !p.campo)
              .map((p, i) => (
                <li
                  key={`${p.codigo}-${i}`}
                  className={`rounded-md px-2 py-1.5 text-[11px] ${
                    p.severidad === 'error'
                      ? 'bg-status-error-surface text-status-error'
                      : 'bg-status-warning-surface text-status-warning'
                  }`}
                >
                  {p.mensaje}
                  {p.solucion && (
                    <span className="mt-0.5 block opacity-80">{p.solucion}</span>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>

      {!soloLectura && (
        <div className="sticky bottom-0 flex gap-2 border-t border-neutral-200 bg-white px-3 py-2">
          <Button variant="secondary" size="sm" onClick={onDuplicar}>
            <Copy size={13} />
            Duplicar
          </Button>
          <Button variant="quiet" size="sm" onClick={onEliminar}>
            <Trash2 size={13} />
            Eliminar
          </Button>
        </div>
      )}
    </aside>
  );
}

function Campo({
  campo,
  valor,
  problemas,
  variables,
  tiposAnteriores,
  soloLectura,
  opciones,
  onCambiar,
}: {
  campo: CampoConfigDto;
  valor: unknown;
  problemas: Problema[];
  variables: VariableDto[];
  tiposAnteriores: Set<string>;
  soloLectura: boolean;
  opciones: OpcionRecurso[] | null;
  onCambiar: (valor: unknown) => void;
}) {
  const entrada = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const hayError = problemas.some((p) => p.severidad === 'error');

  const clases = `mt-1 w-full rounded-md border px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus disabled:bg-neutral-50 ${
    hayError ? 'border-status-error' : 'border-neutral-300'
  }`;

  function insertarVariable(texto: string) {
    const el = entrada.current;
    if (!el) {
      onCambiar(`${typeof valor === 'string' ? valor : ''}${texto}`);
      return;
    }
    // Se inserta DONDE ESTÁ EL CURSOR, no al final: quien escribe «Hola , ¿en
    // qué te ayudo?» y pone el cursor tras «Hola » espera el nombre ahí.
    const actual = typeof valor === 'string' ? valor : '';
    const inicio = el.selectionStart ?? actual.length;
    const fin = el.selectionEnd ?? actual.length;
    const nuevo = actual.slice(0, inicio) + texto + actual.slice(fin);
    onCambiar(nuevo);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inicio + texto.length, inicio + texto.length);
    });
  }

  const admiteVariables = campo.tipo === 'texto' && !campo.referencia;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={`campo-${campo.nombre}`}
          className="text-[11px] font-medium text-neutral-700"
        >
          {etiquetaDeCampo(campo.nombre)}
          {campo.obligatorio && (
            <span className="ml-1 text-status-error" aria-label="obligatorio">
              *
            </span>
          )}
        </label>
        {admiteVariables && !soloLectura && (
          <SelectorVariables
            variables={variables}
            onInsertar={insertarVariable}
            disponiblesEn={tiposAnteriores}
          />
        )}
      </div>

      {opciones !== null ? (
        <select
          id={`campo-${campo.nombre}`}
          data-campo={campo.nombre}
          disabled={soloLectura}
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => onCambiar(e.target.value)}
          className={clases}
        >
          <option value="">
            {opciones.length === 0
              ? 'No tienes ninguno todavía'
              : 'Elige uno…'}
          </option>
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
              {o.ayuda ? ` (${o.ayuda})` : ''}
            </option>
          ))}
        </select>
      ) : campo.tipo === 'booleano' ? (
        <label className="mt-1 flex items-center gap-2 text-xs text-neutral-700">
          <input
            id={`campo-${campo.nombre}`}
            data-campo={campo.nombre}
            type="checkbox"
            disabled={soloLectura}
            checked={valor === true}
            onChange={(e) => onCambiar(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-neutral-300 outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          />
          Sí
        </label>
      ) : campo.tipo === 'numero' ? (
        <input
          id={`campo-${campo.nombre}`}
          data-campo={campo.nombre}
          type="number"
          disabled={soloLectura}
          value={typeof valor === 'number' ? valor : ''}
          onChange={(e) =>
            onCambiar(e.target.value === '' ? '' : Number(e.target.value))
          }
          className={clases}
        />
      ) : campo.tipo === 'lista' ? (
        <EditorLista
          nombre={campo.nombre}
          valor={Array.isArray(valor) ? (valor as unknown[]) : []}
          soloLectura={soloLectura}
          clases={clases}
          onCambiar={onCambiar}
        />
      ) : campo.tipo === 'objeto' ? (
        <EditorObjeto
          nombre={campo.nombre}
          valor={valor}
          soloLectura={soloLectura}
          clases={clases}
          onCambiar={onCambiar}
        />
      ) : esTextoLargo(campo.nombre) ? (
        <textarea
          id={`campo-${campo.nombre}`}
          data-campo={campo.nombre}
          ref={entrada as React.RefObject<HTMLTextAreaElement>}
          rows={4}
          disabled={soloLectura}
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => onCambiar(e.target.value)}
          className={clases}
        />
      ) : (
        <input
          id={`campo-${campo.nombre}`}
          data-campo={campo.nombre}
          ref={entrada as React.RefObject<HTMLInputElement>}
          type="text"
          disabled={soloLectura}
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => onCambiar(e.target.value)}
          className={clases}
        />
      )}

      {campo.referencia && opciones === null && (
        <p className="mt-0.5 text-[10px] text-neutral-500">
          {AYUDA_REFERENCIA[campo.referencia] ??
            'Tiene que coincidir exactamente con lo que ya existe.'}
        </p>
      )}

      {problemas.map((p, i) => (
        <p
          key={`${p.codigo}-${i}`}
          className={`mt-0.5 text-[10px] ${
            p.severidad === 'error'
              ? 'text-status-error'
              : 'text-status-warning'
          }`}
        >
          {p.mensaje}
          {p.solucion ? ` ${p.solucion}` : ''}
        </p>
      ))}
    </div>
  );
}

/**
 * Una lista de valores.
 *
 * En los menús de WhatsApp esta lista además CREA PUERTOS: cada opción es una
 * salida distinta del paso. Por eso borrar una opción tiene consecuencias en
 * el lienzo y se avisa al lado, en vez de descubrirlo cuando la conexión
 * desaparece.
 */
function EditorLista({
  nombre,
  valor,
  soloLectura,
  clases,
  onCambiar,
}: {
  nombre: string;
  valor: unknown[];
  soloLectura: boolean;
  clases: string;
  onCambiar: (v: unknown) => void;
}) {
  const generaPuertos = nombre === 'options' || nombre === 'cases';

  return (
    <div className="mt-1 space-y-1" data-campo={nombre}>
      {valor.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            disabled={soloLectura}
            value={typeof v === 'string' ? v : JSON.stringify(v)}
            onChange={(e) => {
              const copia = [...valor];
              copia[i] = e.target.value;
              onCambiar(copia);
            }}
            className={`${clases} mt-0 flex-1`}
            aria-label={`${etiquetaDeCampo(nombre)} ${i + 1}`}
          />
          {!soloLectura && (
            <button
              type="button"
              aria-label={`Quitar ${i + 1}`}
              onClick={() => onCambiar(valor.filter((_, j) => j !== i))}
              className="rounded p-1 text-neutral-400 outline-none hover:bg-neutral-100 hover:text-status-error focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}

      {!soloLectura && (
        <Button
          variant="quiet"
          size="sm"
          onClick={() => onCambiar([...valor, ''])}
        >
          Añadir
        </Button>
      )}

      {generaPuertos && valor.length > 0 && (
        <p className="text-[10px] text-neutral-500">
          Cada opción es una salida del paso. Si quitas una, se borra también
          su conexión.
        </p>
      )}
    </div>
  );
}

/**
 * Un objeto libre: cabeceras HTTP, cuerpo de una petición, mapa de campos.
 *
 * Se edita como JSON y NO se envía si no es válido: mandar `{ "a": }` al
 * servidor devolvería un error de esquema muy poco explicativo, cuando aquí
 * se puede decir exactamente lo que pasa mientras se escribe.
 */
function EditorObjeto({
  nombre,
  valor,
  soloLectura,
  clases,
  onCambiar,
}: {
  nombre: string;
  valor: unknown;
  soloLectura: boolean;
  clases: string;
  onCambiar: (v: unknown) => void;
}) {
  const [texto, setTexto] = useState(() =>
    valor === undefined ? '' : JSON.stringify(valor, null, 2),
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <textarea
        id={`campo-${nombre}`}
        data-campo={nombre}
        rows={5}
        disabled={soloLectura}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          if (!e.target.value.trim()) {
            setError(null);
            onCambiar(undefined);
            return;
          }
          try {
            onCambiar(JSON.parse(e.target.value));
            setError(null);
          } catch {
            setError('Todavía no es un JSON válido; no se guardará así.');
          }
        }}
        className={`${clases} font-mono`}
      />
      {error && <p className="mt-0.5 text-[10px] text-status-warning">{error}</p>}
    </div>
  );
}

const AYUDA_REFERENCIA: Record<string, string> = {
  template:
    'El nombre exacto de la plantilla aprobada en WhatsApp. Si no coincide, Meta rechaza el envío.',
  tag: 'La etiqueta se crea si no existe.',
  credential:
    'El nombre de la credencial guardada en la configuración de la empresa. Aquí nunca se escribe el secreto.',
};

const ETIQUETAS_CAMPO: Record<string, string> = {
  text: 'Mensaje',
  templateName: 'Plantilla de WhatsApp',
  options: 'Opciones',
  cases: 'Casos',
  url: 'Dirección',
  method: 'Método',
  headers: 'Cabeceras',
  body: 'Cuerpo',
  minutes: 'Minutos',
  hours: 'Horas',
  days: 'Días',
  stageId: 'Etapa',
  pipelineId: 'Embudo',
  userId: 'Responsable',
  assigneeId: 'Responsable',
  field: 'Campo',
  value: 'Valor',
  reason: 'Motivo',
  percent: 'Porcentaje',
  prompt: 'Instrucción para la IA',
  title: 'Título',
  note: 'Nota',
  cron: 'Cuándo se repite',
  timezone: 'Zona horaria',
  keywords: 'Palabras clave',
  variable: 'Guardar la respuesta en',
  timeoutMinutes: 'Esperar como máximo (minutos)',
};

function etiquetaDeCampo(nombre: string): string {
  return ETIQUETAS_CAMPO[nombre] ?? nombre;
}

function esTextoLargo(nombre: string): boolean {
  return (
    nombre === 'text' ||
    nombre === 'prompt' ||
    nombre === 'note' ||
    nombre === 'question'
  );
}
