'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertTriangle,
  Cloud,
  CloudOff,
  Layers,
  Loader2,
  PlayCircle,
  Redo2,
  Save,
  Undo2,
  Upload,
} from 'lucide-react';
import type {
  CatalogoDto,
  GrafoFlow,
  NodoCatalogoDto,
  NodoFlow,
  Problema,
} from '@/lib/flowbots';
import { Button } from '@/components/ui/Button';
import { NodoFlowBot, type DatosNodo } from './NodoFlowBot';
import { Paleta } from './Paleta';
import { PanelConfiguracion } from './PanelConfiguracion';
import { BandejaValidacion } from './BandejaValidacion';
import { useHistorial } from './useHistorial';
import { useAutoguardado, useAvisoAlSalir } from './useAutoguardado';
import { useValidacion } from './useValidacion';
import {
  conexionValida,
  configuracionInicial,
  estadoDe,
  limpiarConexiones,
  nuevoId,
  puertosDe,
  resumenDe,
} from './grafo';

const TIPOS_NODO = { takto: NodoFlowBot };

export function Editor(props: PropsEditor) {
  // El proveedor tiene que envolver al componente que usa `useReactFlow`, no
  // estar dentro: sin esto, centrar el lienzo en un nodo no funciona.
  return (
    <ReactFlowProvider>
      <EditorInterno {...props} />
    </ReactFlowProvider>
  );
}

interface PropsEditor {
  botId: string;
  nombre: string;
  catalogo: CatalogoDto;
  grafoInicial: GrafoFlow;
  revisionInicial: number;
  soloLectura: boolean;
  onPublicar: (grafo: GrafoFlow) => void;
  onSimular: (grafo: GrafoFlow) => void;
}

function EditorInterno({
  botId,
  nombre,
  catalogo,
  grafoInicial,
  revisionInicial,
  soloLectura,
  onPublicar,
  onSimular,
}: PropsEditor) {
  const rf = useReactFlow();
  const lienzo = useRef<HTMLDivElement>(null);

  const historial = useHistorial(grafoInicial);
  const grafo = historial.grafo;

  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [campoEnfocado, setCampoEnfocado] = useState<string | null>(null);
  const [avisoConexion, setAvisoConexion] = useState<string | null>(null);

  const porTipo = useMemo(
    () => new Map(catalogo.nodos.map((n) => [n.tipo, n])),
    [catalogo],
  );

  const validacion = useValidacion(grafo, !soloLectura);
  const guardado = useAutoguardado({
    botId,
    grafo,
    revisionInicial,
    activo: !soloLectura,
  });
  useAvisoAlSalir(
    guardado.estado === 'pendiente' ||
      guardado.estado === 'guardando' ||
      guardado.estado === 'error',
  );

  // Memorizado porque `?? []` crea un array nuevo en cada render y eso haría
  // recalcular la proyección del lienzo entero sin que nada haya cambiado.
  const problemas = useMemo(
    () => validacion.resultado?.problemas ?? [],
    [validacion.resultado],
  );

  // ── proyección al lienzo ──────────────────────────────────────

  const nodosRF: Node[] = useMemo(() => {
    if (!grafo) return [];
    return grafo.nodes.map((n, i) => {
      const def = porTipo.get(n.type) ?? null;
      const suyos = problemas.filter((p) => p.nodeId === n.id);
      const datos: DatosNodo = {
        definicion: def,
        tipo: n.type,
        etiqueta: n.label || def?.etiqueta || n.type,
        resumen: resumenDe(n, def),
        estado: estadoDe(n, def, problemas),
        problemas: suyos.filter((p) => p.severidad === 'error').length,
        avisos: suyos.filter((p) => p.severidad === 'aviso').length,
        paso: i + 1,
        esInicio: def ? !def.aceptaEntrada : false,
        puertos: puertosDe(n, def),
      };
      return {
        id: n.id,
        type: 'takto',
        position: n.position,
        data: datos,
        selected: n.id === seleccionado,
        draggable: !soloLectura,
      };
    });
  }, [grafo, porTipo, problemas, seleccionado, soloLectura]);

  const conexionesRF: Edge[] = useMemo(() => {
    if (!grafo) return [];
    return grafo.edges.map((e) => ({
      id: e.id,
      source: e.from,
      sourceHandle: e.fromPort,
      target: e.to,
      // Sin animación: veinte conexiones animadas a la vez marean y además
      // ignoran a quien pidió menos movimiento en su sistema.
      style: { stroke: '#94a3b8', strokeWidth: 1.5 },
    }));
  }, [grafo]);

  // ── edición ───────────────────────────────────────────────────

  const arrastrando = useRef(false);

  const alCambiarNodos: OnNodesChange = useCallback(
    (cambios: NodeChange[]) => {
      if (soloLectura) return;

      const movimientos = cambios.filter(
        (c): c is NodeChange & { id: string; position: { x: number; y: number }; dragging?: boolean } =>
          c.type === 'position' && 'position' in c && !!c.position,
      );
      if (movimientos.length === 0) return;

      // El historial se apunta UNA VEZ, al empezar a arrastrar, no en cada
      // píxel: si no, deshacer devolvería el nodo paso a paso.
      const empieza = movimientos.some((m) => m.dragging) && !arrastrando.current;
      if (empieza) {
        arrastrando.current = true;
        historial.marcar();
      }
      if (movimientos.every((m) => !m.dragging)) arrastrando.current = false;

      historial.aplicarSinHistorial((previo) => ({
        ...previo,
        nodes: previo.nodes.map((n) => {
          const m = movimientos.find((x) => x.id === n.id);
          return m ? { ...n, position: m.position } : n;
        }),
      }));
    },
    [historial, soloLectura],
  );

  const alConectar = useCallback(
    (c: Connection) => {
      if (soloLectura || !grafo || !c.source || !c.target) return;

      const veredicto = conexionValida(
        grafo,
        porTipo,
        { nodeId: c.source, port: c.sourceHandle ?? 'next' },
        { nodeId: c.target },
      );
      if (!veredicto.ok) {
        setAvisoConexion(veredicto.motivo ?? 'Esa conexión no es posible.');
        return;
      }

      setAvisoConexion(null);
      historial.aplicar((previo) => ({
        ...previo,
        edges: [
          ...previo.edges,
          {
            id: `e-${c.source}-${c.sourceHandle ?? 'next'}-${c.target}`,
            from: c.source!,
            fromPort: c.sourceHandle ?? 'next',
            to: c.target!,
          },
        ],
      }));
    },
    [grafo, historial, porTipo, soloLectura],
  );

  const agregarNodo = useCallback(
    (def: NodoCatalogoDto, posicion?: { x: number; y: number }) => {
      if (soloLectura) return;
      historial.aplicar((previo) => {
        const id = nuevoId(def.tipo, new Set(previo.nodes.map((n) => n.id)));
        const nodo: NodoFlow = {
          id,
          type: def.tipo,
          position:
            posicion ??
            // Sin posición —se añadió con el teclado— cae a la derecha del
            // último, no encima: apilados en el mismo punto parecen uno solo.
            {
              x: 120 + previo.nodes.length * 40,
              y: 120 + (previo.nodes.length % 5) * 90,
            },
          config: configuracionInicial(def),
        };
        setSeleccionado(id);
        return { ...previo, nodes: [...previo.nodes, nodo] };
      });
    },
    [historial, soloLectura],
  );

  const eliminarNodo = useCallback(
    (id: string) => {
      if (soloLectura || !grafo) return;
      // Borrar el arranque deja el flujo sin punto de entrada, así que se
      // pregunta en vez de hacerlo y explicarlo después.
      if (id === grafo.startNodeId) {
        const seguro = window.confirm(
          'Ese es el paso por el que arranca el bot. Si lo borras, el flujo se queda sin punto de entrada y no podrás publicarlo hasta elegir otro. ¿Lo borras?',
        );
        if (!seguro) return;
      }

      historial.aplicar((previo) => ({
        ...previo,
        nodes: previo.nodes.filter((n) => n.id !== id),
        edges: previo.edges.filter((e) => e.from !== id && e.to !== id),
      }));
      setSeleccionado((s) => (s === id ? null : s));
    },
    [grafo, historial, soloLectura],
  );

  const duplicarNodo = useCallback(
    (id: string) => {
      if (soloLectura) return;
      historial.aplicar((previo) => {
        const original = previo.nodes.find((n) => n.id === id);
        if (!original) return previo;
        const nuevo: NodoFlow = {
          ...original,
          id: nuevoId(original.type, new Set(previo.nodes.map((n) => n.id))),
          position: {
            x: original.position.x + 40,
            y: original.position.y + 40,
          },
          // Copia profunda: compartir el objeto haría que editar la copia
          // cambiara también el original sin avisar.
          config: JSON.parse(JSON.stringify(original.config)),
        };
        setSeleccionado(nuevo.id);
        return { ...previo, nodes: [...previo.nodes, nuevo] };
      });
    },
    [historial, soloLectura],
  );

  const cambiarConfig = useCallback(
    (id: string, config: Record<string, unknown>) => {
      historial.aplicar((previo) => {
        const siguiente = {
          ...previo,
          nodes: previo.nodes.map((n) => (n.id === id ? { ...n, config } : n)),
        };
        // Quitar una opción de un menú borra su puerto; la conexión que
        // colgaba de él ya no lleva a ninguna parte.
        return limpiarConexiones(siguiente, porTipo);
      });
    },
    [historial, porTipo],
  );

  // ── ir al problema ────────────────────────────────────────────

  const irAlProblema = useCallback(
    (p: Problema) => {
      if (!p.nodeId) return;
      setSeleccionado(p.nodeId);
      setCampoEnfocado(p.campo ?? null);
      const nodo = grafo?.nodes.find((n) => n.id === p.nodeId);
      if (nodo) {
        rf.setCenter(nodo.position.x + 110, nodo.position.y + 60, {
          zoom: 1,
          duration: 300,
        });
      }
    },
    [grafo, rf],
  );

  // ── atajos ────────────────────────────────────────────────────

  const portapapeles = useRef<NodoFlow | null>(null);

  useEffect(() => {
    function alPulsar(e: KeyboardEvent) {
      const enCampo =
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      // Ctrl+Z dentro de un campo de texto es «deshacer lo que escribí», no
      // «deshacer el paso anterior del flujo». Robarlo enfada a cualquiera.
      if (enCampo) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        historial.deshacer();
      } else if (
        mod &&
        (e.key.toLowerCase() === 'y' ||
          (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        historial.rehacer();
      } else if (mod && e.key.toLowerCase() === 'c' && seleccionado) {
        const n = grafo?.nodes.find((x) => x.id === seleccionado);
        if (n) portapapeles.current = n;
      } else if (mod && e.key.toLowerCase() === 'v' && portapapeles.current) {
        e.preventDefault();
        duplicarNodo(portapapeles.current.id);
      } else if (mod && e.key.toLowerCase() === 'd' && seleccionado) {
        e.preventDefault();
        duplicarNodo(seleccionado);
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void guardado.guardarAhora();
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        seleccionado
      ) {
        e.preventDefault();
        eliminarNodo(seleccionado);
      } else if (e.key === 'Escape') {
        setSeleccionado(null);
      }
    }

    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [historial, seleccionado, grafo, duplicarNodo, eliminarNodo, guardado]);

  // ── conflicto ─────────────────────────────────────────────────

  function descargarLocal() {
    if (!grafo) return;
    const blob = new Blob([JSON.stringify(grafo, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombre || 'flujo'}-local.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const nodoSeleccionado = grafo?.nodes.find((n) => n.id === seleccionado);

  // Qué pasos hay ANTES del seleccionado, para avisar de variables que puede
  // que nunca lleguen a existir.
  const tiposAnteriores = useMemo(() => {
    if (!grafo || !seleccionado) return new Set<string>();
    const previos = new Set<string>();
    const visitados = new Set<string>();
    const buscar = (id: string) => {
      if (visitados.has(id)) return;
      visitados.add(id);
      for (const e of grafo.edges.filter((x) => x.to === id)) {
        const n = grafo.nodes.find((x) => x.id === e.from);
        if (n) {
          previos.add(n.type);
          buscar(n.id);
        }
      }
    };
    buscar(seleccionado);
    return previos;
  }, [grafo, seleccionado]);

  if (!grafo) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BarraSuperior
        estado={guardado.estado}
        guardadoEn={guardado.guardadoEn}
        soloLectura={soloLectura}
        puedeDeshacer={historial.puedeDeshacer}
        puedeRehacer={historial.puedeRehacer}
        sePuedePublicar={validacion.resultado?.sePuedePublicar ?? false}
        onDeshacer={historial.deshacer}
        onRehacer={historial.rehacer}
        onGuardar={() => void guardado.guardarAhora()}
        onValidar={() => void validacion.validar()}
        onSimular={() => onSimular(grafo)}
        onPublicar={async () => {
          // Se guarda ANTES de publicar: publicar lo que hay en el servidor
          // cuando en pantalla hay otra cosa es la sorpresa más cara posible.
          const ok = await guardado.guardarAhora();
          if (ok) onPublicar(grafo);
        }}
      />

      {guardado.conflicto && (
        <AvisoConflicto
          conflicto={guardado.conflicto}
          onDescargar={descargarLocal}
          onUsarRemoto={() => {
            const remoto = guardado.aceptarRemoto();
            if (remoto) historial.reiniciar(remoto);
          }}
        />
      )}

      {avisoConexion && (
        <p
          role="alert"
          className="flex items-center gap-2 border-b border-status-warning bg-status-warning-surface px-3 py-1.5 text-[11px] text-status-warning"
        >
          <AlertTriangle size={12} />
          {avisoConexion}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {!soloLectura && (
          <div className="hidden w-56 shrink-0 border-r border-neutral-200 bg-white lg:block">
            <Paleta catalogo={catalogo} onAgregar={(n) => agregarNodo(n)} />
          </div>
        )}

        <div
          ref={lienzo}
          className="relative min-w-0 flex-1"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const tipo = e.dataTransfer.getData(
              'application/takto-flowbot-nodo',
            );
            const def = porTipo.get(tipo);
            if (!def) return;
            const posicion = rf.screenToFlowPosition({
              x: e.clientX,
              y: e.clientY,
            });
            agregarNodo(def, posicion);
          }}
        >
          <ReactFlow
            nodes={nodosRF}
            edges={conexionesRF}
            nodeTypes={TIPOS_NODO}
            onNodesChange={alCambiarNodos}
            onConnect={alConectar}
            onNodeClick={(_, n) => {
              setSeleccionado(n.id);
              setCampoEnfocado(null);
            }}
            onPaneClick={() => setSeleccionado(null)}
            onEdgesDelete={(borradas) => {
              if (soloLectura) return;
              const ids = new Set(borradas.map((e) => e.id));
              historial.aplicar((previo) => ({
                ...previo,
                edges: previo.edges.filter((e) => !ids.has(e.id)),
              }));
            }}
            nodesConnectable={!soloLectura}
            elementsSelectable
            fitView
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: false }}
            aria-label="Lienzo del flujo"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor="#131C4A"
              maskColor="rgba(19,28,74,0.08)"
              className="!hidden md:!block"
            />
          </ReactFlow>
        </div>

        {nodoSeleccionado && (
          <div className="w-72 shrink-0">
            <PanelConfiguracion
              nodo={nodoSeleccionado}
              definicion={porTipo.get(nodoSeleccionado.type) ?? null}
              problemas={problemas.filter(
                (p) => p.nodeId === nodoSeleccionado.id,
              )}
              variables={catalogo.variables}
              soloLectura={soloLectura}
              campoEnfocado={campoEnfocado}
              tiposAnteriores={tiposAnteriores}
              onCambiar={(c) => cambiarConfig(nodoSeleccionado.id, c)}
              onRenombrar={(etiqueta) =>
                historial.aplicar((previo) => ({
                  ...previo,
                  nodes: previo.nodes.map((n) =>
                    n.id === nodoSeleccionado.id ? { ...n, label: etiqueta } : n,
                  ),
                }))
              }
              onDuplicar={() => duplicarNodo(nodoSeleccionado.id)}
              onEliminar={() => eliminarNodo(nodoSeleccionado.id)}
              onCerrar={() => setSeleccionado(null)}
            />
          </div>
        )}
      </div>

      <div className="max-h-56 shrink-0 overflow-hidden border-t border-neutral-200 bg-white">
        <BandejaValidacion
          resultado={validacion.resultado}
          validando={validacion.validando}
          onIrA={irAlProblema}
        />
      </div>
    </div>
  );
}

function BarraSuperior({
  estado,
  guardadoEn,
  soloLectura,
  puedeDeshacer,
  puedeRehacer,
  sePuedePublicar,
  onDeshacer,
  onRehacer,
  onGuardar,
  onValidar,
  onSimular,
  onPublicar,
}: {
  estado: string;
  guardadoEn: string | null;
  soloLectura: boolean;
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
  sePuedePublicar: boolean;
  onDeshacer: () => void;
  onRehacer: () => void;
  onGuardar: () => void;
  onValidar: () => void;
  onSimular: () => void;
  onPublicar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
      {!soloLectura && (
        <>
          <Button
            variant="quiet"
            size="sm"
            onClick={onDeshacer}
            disabled={!puedeDeshacer}
            aria-label="Deshacer"
            title="Deshacer (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </Button>
          <Button
            variant="quiet"
            size="sm"
            onClick={onRehacer}
            disabled={!puedeRehacer}
            aria-label="Rehacer"
            title="Rehacer (Ctrl+Y)"
          >
            <Redo2 size={14} />
          </Button>
          <span className="mx-1 h-4 w-px bg-neutral-200" />
        </>
      )}

      <IndicadorGuardado estado={estado} guardadoEn={guardadoEn} />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="quiet" size="sm" onClick={onValidar}>
          <Layers size={14} />
          Revisar
        </Button>
        <Button variant="secondary" size="sm" onClick={onSimular}>
          <PlayCircle size={14} />
          Simular
        </Button>
        {!soloLectura && (
          <>
            <Button variant="secondary" size="sm" onClick={onGuardar}>
              <Save size={14} />
              Guardar
            </Button>
            <Button
              variant="accent"
              size="sm"
              onClick={onPublicar}
              disabled={!sePuedePublicar}
              title={
                sePuedePublicar
                  ? undefined
                  : 'Corrige los errores antes de publicar'
              }
            >
              <Upload size={14} />
              Publicar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const TEXTOS_GUARDADO: Record<string, string> = {
  limpio: 'Sin cambios',
  pendiente: 'Cambios sin guardar',
  guardando: 'Guardando…',
  guardado: 'Guardado',
  'sin-conexion': 'Sin conexión',
  error: 'No se pudo guardar',
  conflicto: 'Otra persona lo modificó',
};

function IndicadorGuardado({
  estado,
  guardadoEn,
}: {
  estado: string;
  guardadoEn: string | null;
}) {
  const malo = estado === 'error' || estado === 'sin-conexion' || estado === 'conflicto';

  return (
    <p
      // `polite` y no `assertive`: interrumpir la lectura de un campo cada vez
      // que se guarda haría el editor inusable con lector de pantalla.
      aria-live="polite"
      className={`flex items-center gap-1.5 text-[11px] ${
        malo ? 'text-status-error' : 'text-neutral-500'
      }`}
    >
      {estado === 'guardando' ? (
        <Loader2 size={12} className="animate-spin" />
      ) : malo ? (
        <CloudOff size={12} />
      ) : (
        <Cloud size={12} />
      )}
      {TEXTOS_GUARDADO[estado] ?? estado}
      {estado === 'guardado' && guardadoEn && (
        <span className="text-neutral-400">
          {new Date(guardadoEn).toLocaleTimeString('es', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      )}
    </p>
  );
}

/**
 * Dos personas editando lo mismo.
 *
 * NO SE MEZCLAN LOS DOS GRAFOS. Fusionar automáticamente puede producir un
 * flujo que nadie escribió —una rama de cada uno, conectadas de una forma que
 * ninguno revisó— y lo peor es que parecería correcto. Se para, se explica y
 * se ofrece llevarse el trabajo local antes de tomar el remoto.
 */
function AvisoConflicto({
  conflicto,
  onDescargar,
  onUsarRemoto,
}: {
  conflicto: {
    mensaje: string;
    revisionEnviada: number;
    revisionActual: number;
    actualizadoPor: string | null;
    actualizadoEn: string;
  };
  onDescargar: () => void;
  onUsarRemoto: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 border-b border-status-error bg-status-error-surface px-3 py-2 text-[11px] text-status-error"
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        Otra persona guardó cambios en este flujo mientras lo editabas
        {conflicto.actualizadoPor ? ` (${conflicto.actualizadoPor})` : ''}. Tu
        versión es la {conflicto.revisionEnviada} y en el servidor está la{' '}
        {conflicto.revisionActual}. No se ha sobrescrito nada.
      </span>
      <Button variant="secondary" size="sm" onClick={onDescargar}>
        Descargar mi versión
      </Button>
      <Button variant="danger" size="sm" onClick={onUsarRemoto}>
        Cargar la del servidor
      </Button>
    </div>
  );
}
