'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { getMyCompany } from '@/lib/companies';
import {
  ETIQUETA_ESTADO_SOLICITUD,
  RETENCION_MINIMA_MESES,
  descargarExportacion,
  exportCompanyData,
  getDeletionRequests,
  getRetention,
  previewPurge,
  purge,
  requestDeletion,
  setRetention,
} from '@/lib/compliance';
import { Button } from '@/components/ui/Button';

/**
 * Datos de la empresa: retención, exportación y solicitud de eliminación.
 *
 * Las tres cosas viven juntas porque son la misma pregunta —«¿qué pasa con
 * nuestros datos?»— y porque separarlas escondería la única secuencia sensata:
 * exportar antes de purgar, y desde luego antes de pedir la eliminación.
 */
export default function DataSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const puedeAdministrar =
    user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  if (!puedeAdministrar) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-neutral-900">Datos</h2>
        <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-sm text-neutral-600">
            No tienes permiso para administrar los datos de la empresa. Pídeselo
            a quien administra la cuenta.
          </p>
        </div>
      </div>
    );
  }

  return <PanelDatos />;
}

function PanelDatos() {
  const queryClient = useQueryClient();

  const { data: politica, isLoading } = useQuery({
    queryKey: ['compliance', 'retention'],
    queryFn: getRetention,
  });
  const { data: previsualizacion } = useQuery({
    queryKey: ['compliance', 'purge-preview'],
    queryFn: previewPurge,
  });
  const { data: solicitudes } = useQuery({
    queryKey: ['compliance', 'requests'],
    queryFn: getDeletionRequests,
  });
  const { data: empresa } = useQuery({
    queryKey: ['company-me'],
    queryFn: getMyCompany,
  });

  async function refrescar() {
    await queryClient.invalidateQueries({ queryKey: ['compliance'] });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900">Datos</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Cuánto tiempo se guarda el historial, cómo llevártelo y cómo pedir que
          se elimine.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-neutral-500">Cargando…</p>
      ) : (
        <BloqueRetencion
          politica={politica ?? null}
          previsualizacion={previsualizacion ?? null}
          onCambio={refrescar}
        />
      )}

      <BloqueExportacion nombreEmpresa={empresa?.name ?? 'empresa'} />

      <BloqueEliminacion
        solicitudes={solicitudes ?? []}
        onCambio={refrescar}
      />
    </div>
  );
}

// ── retención ──────────────────────────────────────────────────

function BloqueRetencion({
  politica,
  previsualizacion,
  onCambio,
}: {
  politica: { retentionMonths: number | null; retentionPurgeEnabled: boolean } | null;
  previsualizacion:
    | { aplicable: false; motivo: string; mensajes: number }
    | { aplicable: true; corte: string; purgaActivada: boolean; mensajes: number }
    | null;
  onCambio: () => Promise<void>;
}) {
  const [meses, setMeses] = useState<string>(
    politica?.retentionMonths?.toString() ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [purgando, setPurgando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  const activada = politica?.retentionPurgeEnabled ?? false;

  async function guardar() {
    setError(null);
    setResultado(null);
    const valor = meses.trim() === '' ? null : Number(meses);
    if (valor !== null && (!Number.isInteger(valor) || valor < RETENCION_MINIMA_MESES)) {
      setError(
        `El plazo mínimo es de ${RETENCION_MINIMA_MESES} meses. Deja el campo vacío para no borrar nada.`,
      );
      return;
    }
    setGuardando(true);
    try {
      await setRetention({ retentionMonths: valor });
      await onCambio();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo guardar el plazo.'));
    } finally {
      setGuardando(false);
    }
  }

  async function alternarPurga() {
    setError(null);
    setResultado(null);
    try {
      await setRetention({ retentionPurgeEnabled: !activada });
      await onCambio();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo cambiar la purga automática.'));
    }
  }

  async function purgarAhora() {
    setError(null);
    setResultado(null);
    setPurgando(true);
    try {
      const r = await purge();
      setResultado(
        `Se eliminaron ${r.mensajesEliminados.toLocaleString('es-CO')} mensajes anteriores al ${new Date(
          r.corte,
        ).toLocaleDateString('es-CO')}.`,
      );
      await onCambio();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo purgar.'));
    } finally {
      setPurgando(false);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-neutral-900">Retención</h3>
      <p className="mt-1 text-xs text-neutral-500">
        Solo afecta a mensajes de conversaciones cerradas o archivadas. Una
        conversación abierta es trabajo en curso y no se toca, por antigua que
        sea.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-neutral-600">
          Guardar los mensajes durante
          <div className="mt-1 flex items-center gap-2">
            <input
              value={meses}
              onChange={(e) => setMeses(e.target.value)}
              inputMode="numeric"
              placeholder="sin límite"
              aria-label="Meses de retención"
              className="w-28 rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
            <span className="text-sm text-neutral-600">meses</span>
          </div>
        </label>
        <Button size="sm" onClick={() => void guardar()} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar plazo'}
        </Button>
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        Vacío significa que no se borra nada nunca. Es lo que hay por defecto.
      </p>

      {/* Las DOS señales del backend se muestran como dos cosas separadas: un
          plazo escrito por error no debe purgar nada por sí solo. */}
      <label className="mt-3 flex items-start gap-2 text-xs text-neutral-700">
        <input
          type="checkbox"
          checked={activada}
          onChange={() => void alternarPurga()}
          className="mt-0.5 accent-neutral-800"
        />
        <span>
          Purgar automáticamente al cumplirse el plazo.
          <span className="block text-neutral-500">
            Sin esta casilla, el plazo solo sirve para saber qué se purgaría.
          </span>
        </span>
      </label>

      <div className="mt-3 rounded-md bg-neutral-50 p-3">
        {!previsualizacion ? (
          <p className="text-xs text-neutral-500">Calculando…</p>
        ) : !previsualizacion.aplicable ? (
          <p className="text-xs text-neutral-600">
            No hay ninguna política de retención: no se borraría ningún mensaje.
          </p>
        ) : (
          <>
            <p className="text-xs text-neutral-700">
              Se eliminarían{' '}
              <strong className="text-neutral-900">
                {previsualizacion.mensajes.toLocaleString('es-CO')} mensajes
              </strong>{' '}
              anteriores al{' '}
              {new Date(previsualizacion.corte).toLocaleDateString('es-CO')}.
            </p>
            <Button
              size="sm"
              variant="danger"
              className="mt-2"
              disabled={
                purgando ||
                !previsualizacion.purgaActivada ||
                previsualizacion.mensajes === 0
              }
              onClick={() => void purgarAhora()}
            >
              {purgando ? 'Purgando…' : 'Purgar ahora'}
            </Button>
            {!previsualizacion.purgaActivada && (
              <p className="mt-1 text-xs text-neutral-500">
                Activa la purga para poder ejecutarla.
              </p>
            )}
          </>
        )}
      </div>

      {resultado && (
        <p className="mt-2 text-xs text-status-success-strong">{resultado}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-status-error">
          {error}
        </p>
      )}
    </section>
  );
}

// ── exportación ────────────────────────────────────────────────

function BloqueExportacion({ nombreEmpresa }: { nombreEmpresa: string }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportar() {
    setError(null);
    setOcupado(true);
    try {
      const datos = await exportCompanyData();
      descargarExportacion(datos, nombreEmpresa);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo generar la exportación.'));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-neutral-900">Exportar</h3>
      <p className="mt-1 text-xs text-neutral-500">
        Un JSON con contactos, conversaciones, oportunidades, tareas y
        cotizaciones. Queda registrado en la auditoría: es una copia completa de
        los datos de tus clientes.
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="mt-3"
        disabled={ocupado}
        onClick={() => void exportar()}
      >
        <Download size={14} />
        {ocupado ? 'Generando…' : 'Descargar mis datos'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-status-error">
          {error}
        </p>
      )}
    </section>
  );
}

// ── eliminación ────────────────────────────────────────────────

function BloqueEliminacion({
  solicitudes,
  onCambio,
}: {
  solicitudes: Array<{
    id: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
    reason: string | null;
    requestedAt: string;
    rejectionReason: string | null;
  }>;
  onCambio: () => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const hayPendiente = solicitudes.some(
    (s) => s.status === 'PENDING' || s.status === 'APPROVED',
  );

  async function enviar() {
    setError(null);
    if (motivo.trim().length < 10) {
      setError('Explica el motivo con al menos 10 caracteres.');
      return;
    }
    setEnviando(true);
    try {
      await requestDeletion(motivo.trim());
      setMotivo('');
      await onCambio();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo registrar la solicitud.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="rounded-lg border border-status-error/20 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-status-error">
        <AlertTriangle size={15} />
        Eliminar todos los datos
      </h3>
      <p className="mt-1 text-xs text-neutral-600">
        Esto no borra nada ahora. Registra una solicitud que revisa y ejecuta el
        equipo de la plataforma: hacen falta dos personas distintas y el nombre
        exacto de la empresa escrito a mano. Exporta tus datos antes.
      </p>

      {hayPendiente ? (
        <p className="mt-3 rounded-md bg-status-warning-surface p-2.5 text-xs text-status-warning-strong">
          Ya hay una solicitud en curso. No se puede pedir otra hasta que se
          resuelva.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Motivo de la eliminación"
            aria-label="Motivo de la eliminación"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
          <Button
            size="sm"
            variant="danger"
            disabled={enviando}
            onClick={() => void enviar()}
          >
            <Trash2 size={14} />
            {enviando ? 'Enviando…' : 'Solicitar eliminación'}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-status-error">
          {error}
        </p>
      )}

      <h4 className="mt-4 text-xs font-semibold text-neutral-700">
        Solicitudes
      </h4>
      {solicitudes.length === 0 ? (
        <p className="mt-1 text-xs text-neutral-500">
          No has pedido nunca la eliminación de los datos.
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-neutral-100">
          {solicitudes.map((s) => (
            <li key={s.id} className="py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-neutral-800">
                  {ETIQUETA_ESTADO_SOLICITUD[s.status]}
                </span>
                <span className="text-neutral-400">
                  {new Date(s.requestedAt).toLocaleString('es-CO')}
                </span>
              </div>
              {s.reason && <p className="text-neutral-600">{s.reason}</p>}
              {s.rejectionReason && (
                <p className="text-neutral-500">
                  Motivo del rechazo: {s.rejectionReason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * El backend explica POR QUÉ rechaza (plazo por debajo del mínimo, purga sin
 * activar, solicitud sin motivo). Tragarse ese texto y poner un genérico
 * obliga a adivinar, así que se muestra cuando existe.
 */
function mensajeDeError(e: unknown, respaldo: string) {
  const detalle = (e as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (typeof detalle === 'string') return detalle;
  if (Array.isArray(detalle) && typeof detalle[0] === 'string') return detalle[0];
  return respaldo;
}
