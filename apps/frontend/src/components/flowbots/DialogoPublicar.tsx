'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { mensajeDeError } from '@/components/ui/ListState';
import {
  flowbots,
  type GrafoFlow,
  type ResultadoValidacion,
} from '@/lib/flowbots';

/**
 * Publicar.
 *
 * PUBLICAR NO ES ACTIVAR. Se puede tener la versión lista y encenderla el
 * lunes; juntarlo en un botón hace que quien solo quería dejarlo preparado
 * ponga a hablar un bot con clientes esa misma tarde. Por eso activar es una
 * casilla aparte, apagada por defecto.
 *
 * LO QUE YA ESTÁ CORRIENDO NO CAMBIA. Cada ejecución sigue con la versión con
 * la que empezó, y se dice aquí: si no, la pregunta «¿esto arregla las
 * conversaciones que están a medias?» se responde suponiendo, y la suposición
 * natural es la contraria.
 */
export function DialogoPublicar({
  botId,
  grafo,
  validacion,
  versionActual,
  onCerrar,
  onPublicado,
}: {
  botId: string;
  grafo: GrafoFlow;
  validacion: ResultadoValidacion | null;
  versionActual: number | null;
  onCerrar: () => void;
  onPublicado: (version: number, activado: boolean) => void;
}) {
  const [nota, setNota] = useState('');
  const [activar, setActivar] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errores = (validacion?.problemas ?? []).filter(
    (p) => p.severidad === 'error',
  );
  const avisos = (validacion?.problemas ?? []).filter(
    (p) => p.severidad === 'aviso',
  );
  const bloqueado = errores.length > 0 || !validacion?.sePuedePublicar;

  async function publicar() {
    setError(null);
    setPublicando(true);
    try {
      const r = await flowbots.publicar(botId, nota.trim() || undefined);
      if (activar) await flowbots.cambiarEstado(botId, 'ACTIVE');
      onPublicado(r.version, activar);
    } catch (e) {
      setError(mensajeDeError(e) || 'No se pudo publicar.');
      setPublicando(false);
    }
  }

  return (
    <Modal title="Publicar esta versión" onClose={onCerrar} maxWidth="md">
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-2 rounded-md bg-neutral-50 p-2.5 text-xs">
          <div>
            <dt className="text-neutral-500">Versión que se crea</dt>
            <dd className="font-semibold text-neutral-900">
              {(versionActual ?? 0) + 1}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Pasos</dt>
            <dd className="font-semibold text-neutral-900">
              {grafo.nodes.length}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Conexiones</dt>
            <dd className="font-semibold text-neutral-900">
              {grafo.edges.length}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Versión anterior</dt>
            <dd className="font-semibold text-neutral-900">
              {versionActual ?? 'Ninguna'}
            </dd>
          </div>
        </dl>

        {bloqueado ? (
          <div className="rounded-md border border-status-error bg-status-error-surface p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-status-error">
              <AlertTriangle size={13} />
              {errores.length === 1
                ? 'Hay un error que impide publicar'
                : `Hay ${errores.length} errores que impiden publicar`}
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-status-error">
              {errores.slice(0, 5).map((e, i) => (
                <li key={i}>· {e.mensaje}</li>
              ))}
              {errores.length > 5 && <li>· y {errores.length - 5} más</li>}
            </ul>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-status-success">
            <CheckCircle2 size={13} />
            El flujo está listo para publicarse.
          </p>
        )}

        {avisos.length > 0 && !bloqueado && (
          <div className="rounded-md border border-status-warning bg-status-warning-surface p-2.5">
            <p className="text-xs font-medium text-status-warning">
              {avisos.length === 1
                ? 'Un aviso que conviene revisar'
                : `${avisos.length} avisos que conviene revisar`}
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-status-warning">
              {avisos.slice(0, 4).map((a, i) => (
                <li key={i}>· {a.mensaje}</li>
              ))}
            </ul>
          </div>
        )}

        <label className="block">
          <span className="text-xs font-medium text-neutral-700">
            Qué cambia en esta versión{' '}
            <span className="text-neutral-400">(opcional)</span>
          </span>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Añadí la pregunta por el presupuesto antes de pasar a una persona."
            className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          />
          <span className="text-[10px] text-neutral-400">
            Sale en el historial. Dentro de un mes es lo único que explica por
            qué se cambió.
          </span>
        </label>

        <label className="flex items-start gap-2 rounded-md border border-neutral-200 p-2.5">
          <input
            type="checkbox"
            checked={activar}
            onChange={(e) => setActivar(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-neutral-300 outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
          />
          <span className="text-xs text-neutral-700">
            Activarlo al publicar
            <span className="mt-0.5 block text-[11px] text-neutral-500">
              Empezará a atender conversaciones nuevas en cuanto se publique.
            </span>
          </span>
        </label>

        <p className="rounded-md bg-neutral-50 px-2.5 py-1.5 text-[11px] text-neutral-600">
          Las conversaciones que ya están en curso siguen con la versión con la
          que empezaron. Publicar no las cambia a mitad de camino.
        </p>

        {error && (
          <p role="alert" className="text-xs text-status-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            variant="accent"
            onClick={() => void publicar()}
            disabled={bloqueado || publicando}
          >
            {publicando ? 'Publicando…' : 'Publicar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
