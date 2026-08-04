'use client';

import { useState } from 'react';
import {
  ArrowRight,
  Clock,
  FlaskConical,
  MessageSquare,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import {
  flowbots,
  type EntradaSimulacion,
  type GrafoFlow,
  type ResultadoSimulacion,
} from '@/lib/flowbots';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { mensajeDeError } from '@/components/ui/ListState';

/**
 * Probar el flujo sin tocar nada real.
 *
 * EL AVISO ESTÁ SIEMPRE VISIBLE, no solo al empezar. Una pantalla que enseña
 * mensajes enviados, oportunidades movidas y tareas creadas es indistinguible
 * de la de verdad a los treinta segundos, y quien entre a mitad —o quien mire
 * por encima del hombro— no tiene forma de saber que nada de eso pasó.
 *
 * Se contesta como contestaría el cliente y se puede adelantar el reloj para
 * ver qué hace una espera de dos horas sin esperarlas.
 */
export function PanelSimulador({
  grafo,
  onResaltar,
  onCerrar,
}: {
  grafo: GrafoFlow;
  onResaltar: (nodeId: string | null) => void;
  onCerrar: () => void;
}) {
  const [entrada, setEntrada] = useState<EntradaSimulacion>({
    graph: grafo,
    contacto: { nombre: 'Ana Pérez (simulada)', telefono: '+57 300 000 0000' },
    mensajeInicial: 'Hola',
    respuestas: [],
  });
  const [resultado, setResultado] = useState<ResultadoSimulacion | null>(null);
  const [respuesta, setRespuesta] = useState('');
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paso, setPaso] = useState(0);

  async function simular(cambios: Partial<EntradaSimulacion> = {}) {
    setError(null);
    setCorriendo(true);
    try {
      const cuerpo: EntradaSimulacion = { ...entrada, ...cambios, graph: grafo };
      setEntrada(cuerpo);
      const r = await flowbots.simular(cuerpo);
      setResultado(r);
      setPaso(r.ruta.length);
      onResaltar(r.nodoActual);
    } catch (e) {
      setError(mensajeDeError(e) || 'No se pudo simular el flujo.');
    } finally {
      setCorriendo(false);
    }
  }

  function reiniciar() {
    setResultado(null);
    setRespuesta('');
    setPaso(0);
    onResaltar(null);
    setEntrada((e) => ({ ...e, respuestas: [], avanzarRelojSegundos: 0 }));
  }

  /** Ver la ruta paso a paso, resaltando cada nodo en el lienzo. */
  function irAPaso(n: number) {
    if (!resultado) return;
    const limite = Math.max(0, Math.min(n, resultado.ruta.length));
    setPaso(limite);
    onResaltar(limite > 0 ? resultado.ruta[limite - 1] : null);
  }

  return (
    <aside
      aria-label="Simulación del flujo"
      className="flex h-full w-full flex-col overflow-y-auto border-l border-neutral-200 bg-white"
    >
      {/* Fijo arriba y siempre presente: el aviso no se va al hacer scroll. */}
      <p className="sticky top-0 z-10 flex items-center gap-1.5 bg-brand-primary px-3 py-2 text-[11px] font-medium text-white">
        <FlaskConical size={13} />
        Simulación: no se realizarán acciones reales
      </p>

      <div className="space-y-3 border-b border-neutral-200 p-3">
        <label className="block">
          <span className="text-[11px] font-medium text-neutral-700">
            Primer mensaje del cliente
          </span>
          <input
            value={entrada.mensajeInicial ?? ''}
            onChange={(e) =>
              setEntrada((x) => ({ ...x, mensajeInicial: e.target.value }))
            }
            className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] font-medium text-neutral-700">
              Nombre
            </span>
            <input
              value={entrada.contacto?.nombre ?? ''}
              onChange={(e) =>
                setEntrada((x) => ({
                  ...x,
                  contacto: { ...x.contacto, nombre: e.target.value },
                }))
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-neutral-700">
              Hora simulada
            </span>
            <input
              type="datetime-local"
              value={entrada.ahora?.slice(0, 16) ?? ''}
              onChange={(e) =>
                setEntrada((x) => ({
                  ...x,
                  ahora: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : undefined,
                }))
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
            />
          </label>
        </div>

        <details className="text-[11px]">
          <summary className="cursor-pointer text-neutral-600">
            Simular que algo falla
          </summary>
          <div className="mt-1.5 space-y-1">
            {(['whatsapp', 'http', 'ia'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-neutral-700">
                <input
                  type="checkbox"
                  checked={entrada.fallos?.[k] ?? false}
                  onChange={(e) =>
                    setEntrada((x) => ({
                      ...x,
                      fallos: { ...x.fallos, [k]: e.target.checked },
                    }))
                  }
                  className="h-3.5 w-3.5 rounded border-neutral-300"
                />
                Falla {k === 'ia' ? 'la IA' : k === 'http' ? 'la llamada HTTP' : 'el envío por WhatsApp'}
              </label>
            ))}
            <label className="flex items-center gap-2 text-neutral-700">
              <input
                type="checkbox"
                checked={entrada.forzarTimeout ?? false}
                onChange={(e) =>
                  setEntrada((x) => ({ ...x, forzarTimeout: e.target.checked }))
                }
                className="h-3.5 w-3.5 rounded border-neutral-300"
              />
              El cliente no contesta
            </label>
          </div>
        </details>

        <div className="flex gap-2">
          <Button
            variant="accent"
            size="sm"
            onClick={() => void simular()}
            disabled={corriendo}
          >
            {corriendo ? 'Simulando…' : resultado ? 'Volver a simular' : 'Simular'}
          </Button>
          {resultado && (
            <Button variant="quiet" size="sm" onClick={reiniciar}>
              <RotateCcw size={13} />
              Reiniciar
            </Button>
          )}
          <Button variant="quiet" size="sm" onClick={onCerrar}>
            Cerrar
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-[11px] text-status-error">
            {error}
          </p>
        )}
      </div>

      {resultado && (
        <div className="space-y-3 p-3">
          <div className="flex items-center gap-2">
            <Badge tone={resultado.ok ? 'success' : 'error'}>
              {resultado.estadoFinal}
            </Badge>
            <span className="text-[11px] text-neutral-500">
              {resultado.pasos} pasos · {resultado.turnos} turnos
            </span>
          </div>

          {resultado.motivo && (
            <p className="text-[11px] text-neutral-600">{resultado.motivo}</p>
          )}

          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              Recorrido
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="quiet"
                size="sm"
                onClick={() => irAPaso(paso - 1)}
                disabled={paso <= 0}
                aria-label="Paso anterior"
              >
                ←
              </Button>
              <span className="text-[11px] text-neutral-500">
                {paso} / {resultado.ruta.length}
              </span>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => irAPaso(paso + 1)}
                disabled={paso >= resultado.ruta.length}
                aria-label="Paso siguiente"
              >
                <ArrowRight size={13} />
              </Button>
            </div>
            <ol className="mt-1 space-y-0.5">
              {resultado.decisiones.map((d, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => irAPaso(i + 1)}
                    className={`w-full rounded px-1.5 py-1 text-left text-[11px] outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50 ${
                      i + 1 === paso ? 'bg-primary-50' : ''
                    }`}
                  >
                    <span className="font-mono text-[9px] text-neutral-400">
                      {i + 1}
                    </span>{' '}
                    {d.explicacion}
                  </button>
                </li>
              ))}
            </ol>
          </div>

          {resultado.mensajes.length > 0 && (
            <Seccion titulo="Mensajes que se habrían enviado" icono={MessageSquare}>
              {resultado.mensajes.map((m, i) => (
                <p
                  key={i}
                  className="rounded-md bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700"
                >
                  {m.texto}
                </p>
              ))}
            </Seccion>
          )}

          {resultado.efectos.length > 0 && (
            <Seccion titulo="Lo que habría cambiado en el CRM" icono={ArrowRight}>
              {resultado.efectos.map((e, i) => (
                <p key={i} className="text-[11px] text-neutral-700">
                  · {e.operacion}
                </p>
              ))}
            </Seccion>
          )}

          {resultado.esperas.length > 0 && (
            <Seccion titulo="Esperas" icono={Clock}>
              {resultado.esperas.map((e, i) => (
                <p key={i} className="text-[11px] text-neutral-700">
                  · {e.kind}
                  {e.wakeAt
                    ? ` hasta ${new Date(e.wakeAt).toLocaleString('es')}`
                    : ''}
                </p>
              ))}
              <div className="mt-1 flex gap-1">
                <input
                  value={respuesta}
                  onChange={(e) => setRespuesta(e.target.value)}
                  placeholder="Contesta como el cliente"
                  className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!respuesta.trim() || corriendo}
                  onClick={() => {
                    void simular({
                      respuestas: [...(entrada.respuestas ?? []), respuesta],
                    });
                    setRespuesta('');
                  }}
                >
                  Responder
                </Button>
              </div>
              <Button
                variant="quiet"
                size="sm"
                onClick={() =>
                  void simular({
                    avanzarRelojSegundos:
                      (entrada.avanzarRelojSegundos ?? 0) + 3600,
                  })
                }
              >
                <Clock size={12} />
                Adelantar una hora
              </Button>
            </Seccion>
          )}

          {resultado.handoff && (
            <Seccion titulo="Pasaría a una persona" icono={UserRound}>
              <p className="text-[11px] text-neutral-700">
                {resultado.handoff.motivo}
              </p>
            </Seccion>
          )}

          {Object.keys(resultado.variablesDespues).length > 0 && (
            <Seccion titulo="Datos al terminar" icono={ArrowRight}>
              <dl className="space-y-0.5">
                {Object.entries(resultado.variablesDespues).map(([k, v]) => (
                  <div key={k} className="flex gap-1 text-[10px]">
                    <dt className="font-mono text-neutral-500">{k}</dt>
                    <dd className="truncate text-neutral-700">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </Seccion>
          )}
        </div>
      )}
    </aside>
  );
}

function Seccion({
  titulo,
  icono: Icono,
  children,
}: {
  titulo: string;
  icono: typeof MessageSquare;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        <Icono size={11} />
        {titulo}
      </p>
      <div className="space-y-1">{children}</div>
    </section>
  );
}
