'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Gauge, RotateCcw, ShieldAlert } from 'lucide-react';
import { flowbots, type FotoBreaker } from '@/lib/flowbots';
import { permisosDe } from '@/lib/flowbot-permisos';
import { useAuthStore } from '@/store/auth.store';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { mensajeDeError } from '@/components/ui/ListState';

/**
 * Por qué no está saliendo un mensaje.
 *
 * ES LA PANTALLA QUE EVITA EL TICKET. Sin ella, «el bot no contesta» obliga a
 * abrir registros del servidor para descubrir que el número lleva cinco fallos
 * seguidos o que Redis no responde. Aquí se lee, con el motivo escrito y
 * cuándo se volverá a intentar.
 *
 * NO SE LE ENSEÑA A UN AGENT: el servidor ni siquiera le manda estos datos.
 * No es secreto, es que no es una decisión suya y sería ruido en su pantalla.
 */
export function PanelEnvios() {
  const queryClient = useQueryClient();
  const rol = useAuthStore((s) => s.user?.role);
  const permisos = permisosDe(rol);

  const [reiniciando, setReiniciando] = useState<{
    id: string;
    etiqueta: string;
  } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const { data } = useQuery({
    queryKey: ['flowbots', 'estado-operativo'],
    queryFn: flowbots.estadoOperativo,
    refetchInterval: 30_000,
    retry: false,
  });

  // Sin permisos de administración el servidor no manda el detalle, así que no
  // hay nada que pintar aunque alguien fuerce el componente.
  if (!permisos.puedeEditar || !data?.contador) return null;

  const abiertos = (data.numeros ?? []).filter(
    (n) => n.breaker.estado !== 'CLOSED',
  );

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
        <Gauge size={14} />
        Estado de los envíos
      </h3>

      {error && (
        <p role="alert" className="text-xs text-status-error">
          {error}
        </p>
      )}

      {!data.contador.disponible && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-status-error bg-status-error-surface px-2.5 py-1.5 text-[11px] text-status-error"
        >
          <ShieldAlert size={13} className="mt-px shrink-0" />
          {/* Se dice qué implica, no solo que falla: «Redis no responde» no le
              dice nada a quien administra una empresa. */}
          El contador de envíos no responde. Los envíos reales están bloqueados
          hasta que vuelva; los bots siguen funcionando sin mandar nada.
        </p>
      )}

      {(data.ejecucionesEnAtencion ?? 0) > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-status-warning">
          <AlertTriangle size={12} />
          {data.ejecucionesEnAtencion}{' '}
          {data.ejecucionesEnAtencion === 1
            ? 'ejecución espera'
            : 'ejecuciones esperan'}{' '}
          que alguien las revise.
        </p>
      )}

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          Números
        </p>
        {(data.numeros ?? []).length === 0 ? (
          <p className="text-[11px] text-neutral-500">
            No hay ningún número de WhatsApp conectado.
          </p>
        ) : (
          <ul className="space-y-1">
            {(data.numeros ?? []).map((n) => (
              <li
                key={n.integrationId}
                className="flex flex-wrap items-center gap-2 rounded-md bg-neutral-50 px-2 py-1.5 text-[11px]"
              >
                <span className="flex-1 text-neutral-800">{n.etiqueta}</span>
                <EstadoDelBreaker foto={n.breaker} />
                {n.breaker.ultimaCausa && (
                  <span className="text-neutral-500">
                    {n.breaker.ultimaCausa}
                  </span>
                )}
                {n.breaker.proximoIntento && (
                  <span className="text-neutral-500">
                    reintenta{' '}
                    {new Date(n.breaker.proximoIntento).toLocaleTimeString(
                      'es',
                      { hour: '2-digit', minute: '2-digit' },
                    )}
                  </span>
                )}
                {n.breaker.estado !== 'CLOSED' && permisos.puedeArchivar && (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() =>
                      setReiniciando({
                        id: n.integrationId,
                        etiqueta: n.etiqueta,
                      })
                    }
                  >
                    <RotateCcw size={12} />
                    Reintentar ya
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="text-[11px]">
        <summary className="cursor-pointer text-neutral-600">
          Límites de envío configurados
        </summary>
        <table className="mt-1.5 w-full text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-neutral-400">
              <th className="py-1 font-medium">Ámbito</th>
              <th className="py-1 font-medium">Por minuto</th>
              <th className="py-1 font-medium">Por hora</th>
              <th className="py-1 font-medium">Por día</th>
            </tr>
          </thead>
          <tbody>
            {data.contador.limites.map((l) => (
              <tr key={l.dimension} className="border-t border-neutral-100">
                <td className="py-1 text-neutral-700">{l.dimension}</td>
                <td className="py-1 text-neutral-600">{l.minuto}</td>
                <td className="py-1 text-neutral-600">{l.hora}</td>
                <td className="py-1 text-neutral-600">{l.dia}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {abiertos.length >= 2 && (
        <p className="text-[11px] text-status-error">
          Hay {abiertos.length} números con los envíos en pausa. Suele indicar
          un problema común, no de cada número.
        </p>
      )}

      {reiniciando && (
        <Modal
          title={`Reintentar los envíos de ${reiniciando.etiqueta}`}
          onClose={() => {
            setReiniciando(null);
            setMotivo('');
          }}
          maxWidth="sm"
        >
          <div className="space-y-3 text-sm">
            {/* Se dice lo que NO hace: quien pulse esto esperando desbloquear
                un envío que el interruptor impide, no lo va a conseguir. */}
            <p className="text-neutral-600">
              Vuelve a permitir los envíos por este número. No cambia nada más:
              si el interruptor de emergencia está activo, si la empresa no
              está permitida o si se alcanzó el límite de envíos, seguirán
              bloqueados igual.
            </p>

            <label className="block">
              <span className="text-xs font-medium text-neutral-700">
                Por qué
              </span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={300}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-line-focus"
              />
              <span className="text-[10px] text-neutral-400">
                Queda registrado junto a la acción.
              </span>
            </label>

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setReiniciando(null);
                  setMotivo('');
                }}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                disabled={!motivo.trim() || ocupado}
                onClick={async () => {
                  setError(null);
                  setOcupado(true);
                  try {
                    await flowbots.reiniciarBreaker(
                      reiniciando.id,
                      motivo.trim(),
                    );
                    await queryClient.invalidateQueries({
                      queryKey: ['flowbots', 'estado-operativo'],
                    });
                    setReiniciando(null);
                    setMotivo('');
                  } catch (e) {
                    setError(
                      mensajeDeError(e) || 'No se pudo reiniciar el número.',
                    );
                  } finally {
                    setOcupado(false);
                  }
                }}
              >
                {ocupado ? 'Reintentando…' : 'Reintentar'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function EstadoDelBreaker({ foto }: { foto: FotoBreaker }) {
  if (foto.estado === 'CLOSED') {
    return <Badge tone="success">Enviando</Badge>;
  }
  if (foto.estado === 'HALF_OPEN') {
    return <Badge tone="warning">Probando</Badge>;
  }
  return <Badge tone="error">En pausa</Badge>;
}
