'use client';

import { createElement, memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  Bot,
  Brain,
  CircleDot,
  Clock,
  Flag,
  GitBranch,
  Globe,
  MessageSquare,
  Play,
  Send,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { NodoCatalogoDto } from '@/lib/flowbots';

export type EstadoNodo =
  | 'normal'
  | 'incompleto'
  | 'invalido'
  | 'deshabilitado'
  | 'corriendo'
  | 'completado'
  | 'esperando'
  | 'fallido'
  | 'handoff';

export interface DatosNodo extends Record<string, unknown> {
  definicion: NodoCatalogoDto | null;
  tipo: string;
  etiqueta: string;
  resumen: string;
  estado: EstadoNodo;
  problemas: number;
  avisos: number;
  paso?: number;
  esInicio: boolean;
  puertos: Array<{ id: string; etiqueta: string }>;
}

/**
 * Un paso dibujado en el lienzo.
 *
 * EL COLOR NO ES DECORACIÓN. Cada estado tiene un borde y un icono distintos
 * porque un flujo de veinte pasos se lee de un vistazo o no se lee: si lo
 * único que cambia es un tono de gris, encontrar el paso mal configurado
 * cuesta lo mismo que leerlos todos.
 *
 * NARANJA NUNCA DE FONDO DOMINANTE. El manual de marca lo reserva para el
 * acento; un lienzo con veinte cajas naranjas no tiene acento ninguno, tiene
 * ruido. El navy manda y el naranja marca lo seleccionado.
 *
 * Y ningún estado se distingue SOLO por color: cada uno lleva icono o texto,
 * porque el rojo y el verde son el mismo gris para bastante gente.
 */
const ICONOS: Record<string, LucideIcon> = {
  trigger: Play,
  send: Send,
  ask: MessageSquare,
  control: GitBranch,
  crm: Users,
  integration: Globe,
  ai: Sparkles,
  conversation: MessageSquare,
};

const ICONOS_EXACTOS: Record<string, LucideIcon> = {
  'crm.handoff': UserRound,
  'ai.detect_handoff': UserRound,
  'control.end': Flag,
  'control.cancel': Flag,
  'control.wait_duration': Clock,
  'control.wait_until': Clock,
  'control.business_hours': Clock,
  'ai.reply': Brain,
};

const ESTILOS: Record<EstadoNodo, string> = {
  normal: 'border-neutral-300 bg-white',
  incompleto: 'border-status-warning bg-status-warning-surface',
  invalido: 'border-status-error bg-status-error-surface',
  deshabilitado: 'border-neutral-200 bg-neutral-50 opacity-60',
  corriendo: 'border-brand-secondary bg-white ring-2 ring-brand-secondary',
  completado: 'border-status-success bg-status-success-surface',
  esperando: 'border-status-info bg-status-info-surface',
  fallido: 'border-status-error bg-status-error-surface',
  handoff: 'border-status-info bg-status-info-surface',
};

const TEXTO_ESTADO: Partial<Record<EstadoNodo, string>> = {
  incompleto: 'Requiere configuración',
  invalido: 'Revisa este paso',
  deshabilitado: 'No disponible',
  corriendo: 'Ejecutándose',
  completado: 'Hecho',
  esperando: 'Esperando',
  fallido: 'Falló',
  handoff: 'Pasó a una persona',
};

function componenteDe(tipo: string): LucideIcon {
  return ICONOS_EXACTOS[tipo] ?? ICONOS[tipo.split('.')[0]] ?? Bot;
}

/**
 * El icono de un tipo de paso.
 *
 * Se monta con `createElement` y no asignando el componente a una variable en
 * medio del render: esto último crea un componente nuevo en cada pasada, y
 * React lo trata como otro distinto —desmonta y vuelve a montar— en vez de
 * actualizarlo.
 */
export function IconoNodo({
  tipo,
  size = 14,
  className,
}: {
  tipo: string;
  size?: number;
  className?: string;
}) {
  return createElement(componenteDe(tipo), { size, className });
}

function NodoFlowBotBase({ data, selected }: NodeProps) {
  const d = data as DatosNodo;
  const texto = TEXTO_ESTADO[d.estado];

  return (
    <div
      className={`w-56 rounded-lg border-2 shadow-sm transition-shadow ${
        ESTILOS[d.estado]
      } ${selected ? 'ring-2 ring-brand-secondary ring-offset-1' : ''}`}
      // El lienzo entero es una región para lectores de pantalla; cada paso se
      // anuncia con su estado, no solo con su nombre.
      aria-label={`${d.etiqueta}${texto ? `. ${texto}` : ''}`}
    >
      {/* Los disparadores no aceptan entrada: sin este puerto, el lienzo no
          deja siquiera intentar conectarles algo delante. */}
      {!d.esInicio && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2.5 !w-2.5 !border-2 !border-white !bg-brand-primary"
        />
      )}

      <div className="flex items-start gap-2 px-2.5 py-2">
        <span className="mt-0.5 rounded bg-brand-primary/10 p-1 text-brand-primary">
          <IconoNodo tipo={d.tipo} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-neutral-900">
            {d.paso !== undefined && (
              <span className="mr-1 font-mono text-[10px] text-neutral-400">
                {d.paso}
              </span>
            )}
            {d.etiqueta}
          </p>
          {d.resumen && (
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-neutral-500">
              {d.resumen}
            </p>
          )}
        </div>
      </div>

      {(texto || d.problemas > 0 || d.avisos > 0) && (
        <div className="flex items-center gap-1.5 border-t border-black/5 px-2.5 py-1 text-[10px]">
          {d.problemas > 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-status-error">
              <AlertTriangle size={11} />
              {d.problemas} {d.problemas === 1 ? 'error' : 'errores'}
            </span>
          ) : d.avisos > 0 ? (
            <span className="inline-flex items-center gap-1 text-status-warning">
              <AlertTriangle size={11} />
              {d.avisos} {d.avisos === 1 ? 'aviso' : 'avisos'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-neutral-500">
              <CircleDot size={11} />
              {texto}
            </span>
          )}
        </div>
      )}

      {/* Un puerto por salida, con su nombre visible. Sin nombre, «la de
          arriba» y «la de abajo» es todo lo que se sabe de un condicional, y
          conectar el sí donde va el no es un fallo que solo se descubre en
          producción. */}
      <div className="flex flex-col gap-0.5 border-t border-black/5 px-2.5 py-1">
        {d.puertos.map((p, i) => (
          <div
            key={p.id}
            className="relative flex items-center justify-end pr-1 text-[10px] text-neutral-500"
          >
            <span className="truncate">{p.etiqueta}</span>
            <Handle
              id={p.id}
              type="source"
              position={Position.Right}
              style={{ top: `${(i + 0.5) * (100 / d.puertos.length)}%` }}
              className="!h-2.5 !w-2.5 !border-2 !border-white !bg-brand-secondary"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export const NodoFlowBot = memo(NodoFlowBotBase);
